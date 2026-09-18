export interface Note { id: string; title: string; excerpt: string; content: string; transcript: string; kind: string; source: string; duration: number; links: number; created_at: string; updated_at: string; vault_file: string; note_file: string; messages: Message[]; revisions: Revision[] }
export interface Message { id: string; role: string; content: string; patch: string }
export interface Revision { id: string; reason: string; created_at: string }
export interface Job { id: string; status: string; title: string; kind: string; stage: string; progress: number; error: string; note_id: string }
export interface Stats { generated: number; curated: number; manual: number; notes: number; links: number; minutes: number; patches: number; streak: number; active_days: number; activity: { date: string; count: number; in_range: boolean }[]; graph: { id: string; title: string; links: string[] }[] }
export interface Settings { base_url: string; model: string; api_key: string | null; has_api_key?: boolean; transcription_base_url: string; transcription_model: string; transcription_key: string | null; has_transcription_key?: boolean; vault_path: string; repository_path: string; notes_folder: string; chunk_chars: number; auto_patch: boolean }
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
export function download(name: string, content: string, extension = 'md') { const type = extension === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8'; const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = name.replace(/[<>:"/\\|?*]/g, '-') + '.' + extension; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
