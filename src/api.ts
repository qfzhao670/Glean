export interface Note { id: string; title: string; excerpt: string; content: string; transcript: string; kind: string; source: string; duration: number; links: number; created_at: string; updated_at: string; vault_file: string; note_file: string; messages: Message[]; revisions: Revision[] }
export interface Message { id: string; role: string; content: string; patch: string }
export interface Revision { id: string; reason: string; created_at: string }
export interface Job { id: string; status: string; title: string; kind: string; stage: string; progress: number; error: string; note_id: string }
export interface Stats { generated: number; curated: number; manual: number; notes: number; links: number; minutes: number; patches: number; streak: number; active_days: number; activity: { date: string; count: number; in_range: boolean }[]; graph: { id: string; title: string; links: string[] }[] }
export interface Settings { base_url: string; model: string; api_key: string | null; has_api_key?: boolean; transcription_base_url: string; transcription_model: string; transcription_language: 'auto' | 'zh' | 'en'; transcription_key: string | null; has_transcription_key?: boolean; vault_path: string; repository_path: string; notes_folder: string; chunk_chars: number; auto_patch: boolean }
declare global { interface Window { glean?: { config: () => Promise<{ token: string; baseUrl: string }>; chooseVault: () => Promise<string | null>; revealNote: (id: string) => Promise<void>; openRepository: () => Promise<void> } } }
let token = import.meta.env.VITE_GLEAN_TOKEN || '';
let baseUrl = '';
export async function initialize() { if (window.glean) { const config = await window.glean.config(); token = config.token; baseUrl = config.baseUrl; } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(baseUrl + '/api' + path, { ...options, headers: { 'X-Glean-Token': token, ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(typeof error.detail === 'string' ? error.detail : '操作未完成，请检查输入后重试。'); }
  return response.json();
}
export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export function uploadJob(file: File, detailed: boolean, onProgress: (progress: number) => void): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', baseUrl + '/api/jobs/upload');
    request.setRequestHeader('X-Glean-Token', token);
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));
    };
    request.onerror = () => reject(new Error('上传中断，请检查连接后重试。'));
    request.onload = () => {
      let value: { id?: string; detail?: string } = {};
      try { value = JSON.parse(request.responseText || '{}'); } catch { /* handled below */ }
      if (request.status >= 200 && request.status < 300 && value.id) { onProgress(100); resolve({ id: value.id }); }
      else reject(new Error(typeof value.detail === 'string' ? value.detail : '上传未完成，请重试。'));
    };
    const form = new FormData();
    form.append('file', file);
    form.append('detailed', String(detailed));
    request.send(form);
  });
}

export async function streamJobUpdates(id: string, onJob: (job: Job) => void, signal: AbortSignal) {
  const response = await fetch(baseUrl + `/api/jobs/${id}/stream`, {
    headers: { 'X-Glean-Token': token }, signal,
  });
  if (!response.ok || !response.body) throw new Error('无法接收任务进度。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type: string; job?: Job };
      if (event.type === 'job' && event.job) onJob(event.job);
    }
    if (done) break;
  }
}

export type JobOutputEvent =
  | { type: 'job'; job: Job }
  | { type: 'snapshot' | 'delta'; content: string }
  | { type: 'done'; note_id: string; message: string }
  | { type: 'failed'; note_id: string; message: string }
  | { type: 'error'; message: string };

export async function streamJobOutput(id: string, onEvent: (event: JobOutputEvent) => void, signal: AbortSignal) {
  const response = await fetch(baseUrl + `/api/jobs/${id}/output/stream`, {
    headers: { 'X-Glean-Token': token }, signal,
  });
  if (!response.ok || !response.body) throw new Error('无法接收笔记生成内容。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop() || '';
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as JobOutputEvent);
    if (done) break;
  }
}
export async function streamJsonLines<T>(path: string, body: unknown, onEvent: (event: T) => void) {
  const response = await fetch(baseUrl + '/api' + path, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'X-Glean-Token': token, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : '操作未完成，请检查输入后重试。');
  }
  if (!response.body) throw new Error('当前环境不支持流式回答。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop() || '';
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as T);
    if (done) {
      if (buffer.trim()) onEvent(JSON.parse(buffer) as T);
      break;
    }
  }
}
export function download(name: string, content: string, extension = 'md') { const type = extension === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8'; const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = name.replace(/[<>:"/\\|?*]/g, '-') + '.' + extension; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
