import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, ArrowUp, BookOpen, Check, Download, ExternalLink, FileText, History, FolderOpen, LoaderCircle, MessageCircle, PanelRightClose, Save, Sparkles, X } from 'lucide-react';
import { api, download, post, streamJsonLines, type Note } from '../api';
import Markdown from './Markdown';
import RichMarkdownEditor, { type RichMarkdownEditorHandle } from './RichMarkdownEditor';

type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; note: Note }
  | { type: 'error'; message: string };

type ReadingPosition = { scrollTop: number; blockIndex: number; blockOffset: number };
const readingPositions = new Map<string, ReadingPosition>();

function documentParts(content: string) {
  let offset = 0;
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  if (frontmatter) offset = frontmatter.length;
  const title = content.slice(offset).match(/^# [^\r\n]*(?:\r?\n|$)/)?.[0];
  if (title) offset += title.length;
  return { prefix: content.slice(0, offset), body: content.slice(offset) };
}

function replaceDocumentTitle(content: string, title: string) {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || '';
  const rest = content.slice(frontmatter.length);
  const heading = rest.match(/^# [^\r\n]*(?:\r?\n|$)/)?.[0];
  if (heading) return frontmatter + rest.replace(/^# [^\r\n]*/, '# ' + title);
  return frontmatter + '# ' + title + '\n\n' + rest;
}

function replaceDocumentBody(content: string, body: string) {
  const { prefix } = documentParts(content);
  return `${prefix.trimEnd()}\n\n${body.trim()}${body.trim() ? '\n' : ''}`;
}

export default function NoteDetail({ id, initialEdit = false, onDirtyChange, onBack, onUpdated, onJobCreated, notify, onLink }: {
  id: string;
  initialEdit?: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBack: () => void;
  onUpdated: () => void;
  onJobCreated: (id: string) => void;
  notify: (message: string) => void;
  onLink: (title: string) => void;
}) {
  const [note, setNote] = useState<Note | null>(null);
  const [tab, setTab] = useState<'read' | 'transcript'>('read');
  const [titleEditing, setTitleEditing] = useState(initialEdit);
  const [richDirty, setRichDirty] = useState(false);
  const [richFocused, setRichFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [streaming, setStreaming] = useState<{ question: string; answer: string } | null>(null);
  const [chatWidth, setChatWidth] = useState(() => Math.max(280, Math.min(520, Number(localStorage.getItem('glean-chat-width')) || 340)));
  const titleEditor = useRef<HTMLInputElement>(null);
  const richEditor = useRef<RichMarkdownEditorHandle>(null);
  const columns = useRef<HTMLDivElement>(null);
  const noteDocument = useRef<HTMLElement>(null);
  const chatMessages = useRef<HTMLDivElement>(null);
  const pendingReadingPosition = useRef<ReadingPosition | null>(null);
  const dirty = !!note && (draft !== note.content || draftTitle !== note.title || richDirty);
  const editing = titleEditing || richFocused || richDirty;

  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  useEffect(() => {
    setNote(null);
    setError('');
    setTab('read');
    setTitleEditing(initialEdit);
    setRichDirty(false);
    setRichFocused(false);
    api<Note>(`/notes/${id}`).then(value => {
      setNote(value);
      setDraft(value.content);
      setDraftTitle(value.title);
      if (initialEdit) requestAnimationFrame(() => titleEditor.current?.focus());
    }).catch(reason => setError(reason.message));
  }, [id, initialEdit]);
  useEffect(() => {
    const element = chatMessages.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, [note?.messages.length, streaming?.answer]);
  // Layout cleanup runs while the outgoing note DOM still exists, so switching
  // tabs cannot lose the last position before React detaches the scroll node.
  useLayoutEffect(() => () => { saveReadingPosition(); }, [id, chatVisible]);
  useLayoutEffect(() => {
    if (!note || tab !== 'read') return;
    const position = pendingReadingPosition.current ?? readingPositions.get(id);
    if (!position) return;
    let innerFrame = 0;
    const frame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        restoreReadingPosition(position);
        pendingReadingPosition.current = null;
        saveReadingPosition();
      });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(innerFrame); };
  }, [id, note?.id, tab, chatVisible]);

  async function action(name: string, work: () => Promise<void>) {
    setBusy(name);
    setError('');
    try { await work(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(''); }
  }

  function updateTitle(value: string) {
    setDraftTitle(value);
    setDraft(current => replaceDocumentTitle(current, value));
  }

  function scrollContainer(visible = chatVisible) {
    return visible ? noteDocument.current : columns.current;
  }

  function readingBlocks() {
    return Array.from(noteDocument.current?.querySelectorAll<HTMLElement>(
      '.rich-markdown-editor > h1,.rich-markdown-editor > h2,.rich-markdown-editor > h3,.rich-markdown-editor > h4,.rich-markdown-editor > h5,.rich-markdown-editor > h6,.rich-markdown-editor > p,.rich-markdown-editor > ul,.rich-markdown-editor > ol,.rich-markdown-editor > blockquote,.rich-markdown-editor > pre,.rich-markdown-editor > table,.rich-markdown-editor > img,.rich-markdown-editor > span.image-ref',
    ) || []);
  }

  function captureReadingPosition(visible = chatVisible): ReadingPosition | null {
    const container = scrollContainer(visible);
    if (!container) return null;
    const containerTop = container.getBoundingClientRect().top;
    const blocks = readingBlocks();
    let blockIndex = blocks.findIndex(block => block.getBoundingClientRect().bottom > containerTop + 1);
    if (blockIndex < 0) blockIndex = Math.max(0, blocks.length - 1);
    const blockOffset = blocks[blockIndex] ? blocks[blockIndex].getBoundingClientRect().top - containerTop : 0;
    return { scrollTop: container.scrollTop, blockIndex, blockOffset };
  }

  function restoreReadingPosition(position: ReadingPosition) {
    const container = scrollContainer();
    if (!container) return;
    container.scrollTop = position.scrollTop;
    const block = readingBlocks()[position.blockIndex];
    if (!block) return;
    const currentOffset = block.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += currentOffset - position.blockOffset;
  }

  function saveReadingPosition() {
    if (pendingReadingPosition.current) return;
    const position = captureReadingPosition();
    if (position) readingPositions.set(id, position);
  }

  function toggleChat() {
    pendingReadingPosition.current = captureReadingPosition();
    setChatVisible(value => !value);
  }

  function currentDraft() {
    const body = richEditor.current?.getMarkdown();
    if (body === undefined || body === documentParts(draft).body) return draft;
    return replaceDocumentBody(draft, body);
  }

  const save = () => action('save', async () => {
    if (!note) return;
    const content = currentDraft();
    const next = await api<Note>(`/notes/${id}`, {
      method: 'PUT', body: JSON.stringify({ title: draftTitle.trim(), content, expected: note.content }),
    });
    setNote(next);
    setDraft(next.content);
    setDraftTitle(next.title);
    setTitleEditing(false);
    setRichDirty(false);
    setRichFocused(false);
    onUpdated();
    notify('笔记已保存到本地仓库');
  });

  async function ask(text: string) {
    setBusy('chat');
    setError('');
    setQuestion('');
    setStreaming({ question: text, answer: '' });
    let completed = false;
    try {
      await streamJsonLines<StreamEvent>(`/notes/${id}/chat/stream`, { message: text }, event => {
        if (event.type === 'delta') setStreaming(value => value ? { ...value, answer: value.answer + event.content } : value);
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'done') {
          completed = true;
          setNote(event.note);
          setDraft(event.note.content);
          setDraftTitle(event.note.title);
          setRichDirty(false);
          onUpdated();
        }
      });
      if (!completed) throw new Error('流式回答意外中断，请重试。');
    } catch (reason) {
      setError((reason as Error).message);
      setQuestion(text);
    } finally {
      setStreaming(null);
      setBusy('');
    }
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatWidth;
    const available = columns.current?.clientWidth || window.innerWidth;
    const maximum = Math.min(620, Math.max(300, available - 420));
    const move = (pointer: PointerEvent) => setChatWidth(Math.max(280, Math.min(maximum, startWidth - (pointer.clientX - startX))));
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      setChatWidth(value => { localStorage.setItem('glean-chat-width', String(value)); return value; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  }

  const parts = documentParts(draft);

  return <div className="note-detail page-enter">
    <div className="note-toolbar">
      <button className="button text-button" onClick={onBack}><ArrowLeft size={17}/>所有笔记</button>
      <div>
        <button className="icon-button" title="版本历史" aria-label="版本历史" onClick={() => setHistory(!history)}><History size={18}/></button>
        <button className="icon-button" title="导出 Markdown" aria-label="导出 Markdown" disabled={!note} onClick={() => note && download(note.title, currentDraft())}><Download size={18}/></button>
        <button className="button secondary small" disabled={!note?.note_file} onClick={() => action('reveal', async () => {
          if (window.glean) await window.glean.revealNote(id);
          else if (note) { await navigator.clipboard.writeText(note.note_file); notify('笔记文件路径已复制'); }
        })}><FolderOpen size={15}/>{window.glean ? '显示文件' : '复制文件路径'}</button>
        <button className={`icon-button ${chatVisible ? 'selected' : ''}`} title={chatVisible ? '收起知识对话' : '展开知识对话'} aria-label={chatVisible ? '收起知识对话' : '展开知识对话'} aria-expanded={chatVisible} onClick={toggleChat}><MessageCircle size={18}/></button>
      </div>
    </div>
    {error && <div className="error-message" role="alert">{error}</div>}
    {history && <div className="revision-panel"><div><strong>每一次生长，都有迹可循</strong><button className="icon-button" aria-label="关闭历史" onClick={() => setHistory(false)}><X size={16}/></button></div>{note?.revisions.length ? note.revisions.map(revision => <div className="revision-row" key={revision.id}><span>{({ chat_patch: '添加知识补丁', edit: '手动编辑', restore: '恢复版本', curate: 'AI 整理', original_import: '整理前的原始笔记' } as Record<string, string>)[revision.reason] || revision.reason}<small>{new Date(revision.created_at).toLocaleString('zh-CN')}</small></span><button className="button subtle small" disabled={!!busy || dirty} onClick={() => action('restore', async () => { const next = await post<Note>(`/notes/${id}/restore/${revision.id}`); setNote(next); setDraft(next.content); setDraftTitle(next.title); onUpdated(); notify('已恢复该次修改之前的内容'); })}>恢复修改前</button></div>) : <p className="muted">还没有修改记录。</p>}</div>}
    {!note ? <div className="loading-state"><LoaderCircle className="spin"/>正在展开笔记…</div> : <div ref={columns} className={`note-columns ${chatVisible ? '' : 'without-chat'}`} style={{ '--chat-width': `${chatWidth}px` } as CSSProperties} onScroll={saveReadingPosition}>
      <section ref={noteDocument} className="note-document" onScroll={saveReadingPosition}>
        <header><div className="note-source"><span className="tag">{note.kind === 'manual' ? '手写笔记' : note.kind === 'txt' ? '字幕拾知' : note.kind === 'mp4' ? '声音拾知' : note.kind === 'url' ? '视频拾知' : '笔记整理'}</span><span>{new Date(note.created_at).toLocaleDateString('zh-CN')}</span></div>{titleEditing ? <input ref={titleEditor} className="inline-note-title-input" aria-label="编辑笔记标题" value={draftTitle} maxLength={160} onChange={event => updateTitle(event.target.value)} onBlur={() => setTitleEditing(false)} onMouseLeave={() => titleEditor.current?.blur()}/> : <button className="inline-note-title" title="点击编辑标题" onClick={() => { setTitleEditing(true); requestAnimationFrame(() => titleEditor.current?.focus()); }}>{draftTitle}</button>}<div className="note-source-line">来源：{note.source.startsWith('https://') ? <a href={note.source} target="_blank" rel="noreferrer">查看原视频 <ExternalLink size={12}/></a> : note.source}</div></header>
        <div className="document-tabs"><button className={tab === 'read' ? 'active' : ''} onClick={() => setTab('read')}><BookOpen size={15}/>笔记</button><button className={tab === 'transcript' ? 'active' : ''} onClick={() => { richEditor.current?.flush(); setTitleEditing(false); setTab('transcript'); }}><FileText size={15}/>原始字幕</button><button className="document-curate" disabled={!!busy || dirty} onClick={() => action('curate', async () => { const job = await post<{ id: string }>('/jobs', { kind: 'curate', note_id: id }); onJobCreated(job.id); notify('已加入整理队列，完成后重新打开此笔记即可查看'); })}><Sparkles size={14}/>重新整理</button></div>
        {tab === 'read' && <RichMarkdownEditor ref={richEditor} value={parts.body} noteId={id} disabled={!!busy && busy !== 'image'} onCommit={body => { setDraft(current => replaceDocumentBody(current, body)); setRichDirty(false); }} onDirtyChange={setRichDirty} onFocusChange={setRichFocused} onUploadingChange={uploading => setBusy(uploading ? 'image' : '')} onError={setError} notify={notify} onLink={onLink}/>}
        {tab === 'transcript' && <div className="transcript"><div className="transcript-heading"><span>生成时使用的完整字幕</span>{note.transcript && <button className="button subtle small" onClick={() => download(note.title + '-原始字幕', note.transcript, 'txt')}><Download size={14}/>导出</button>}</div>{note.transcript ? <pre>{note.transcript}</pre> : <div className="empty-inline">这篇笔记没有原始字幕。聊天会使用笔记正文作为上下文。</div>}</div>}
        {dirty && <div className="inline-save-bar"><span>有未保存的修改</span><button className="button primary small" disabled={!!busy || !draftTitle.trim()} onClick={save}>{busy === 'save' ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>}保存笔记</button></div>}
        <div className="note-location"><Check size={13}/><span>{note.note_file ? '已保存 · ' + note.note_file : '等待保存到本地仓库'}</span></div>
      </section>
      {chatVisible && <button className="column-resizer" role="separator" aria-label="拖动调整对话框宽度" aria-orientation="vertical" onPointerDown={startResize} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setChatWidth(value => Math.max(280, Math.min(620, value + (event.key === 'ArrowLeft' ? 20 : -20)))); } }}><span/></button>}
      {chatVisible && <aside className="chat-panel">
        <div className="chat-heading"><span className="chat-icon"><Sparkles size={19}/></span><div><h3>把知识，聊透。</h3><span>基于笔记{note.transcript ? '与原始字幕' : '正文'}</span></div><span className="status-dot"/><button className="icon-button chat-close" title="隐藏对话框" aria-label="隐藏对话框" onClick={toggleChat}><PanelRightClose size={17}/></button></div>
        <div ref={chatMessages} className="chat-messages">
          {!note.messages.length && !streaming && <div className="chat-welcome"><div className="chat-welcome-art"><MessageCircle size={33} strokeWidth={1}/><span>?</span></div><h4>好的问题，是理解的开始。</h4><p>追问概念，厘清联系。值得留下的解释，会成为笔记的一部分。</p><button onClick={() => ask('这篇笔记的核心概念是什么？请用通俗的语言讲清楚。')} disabled={!!busy || dirty || editing}>用通俗的话解释核心概念 <ArrowUp size={13}/></button><button onClick={() => ask('请根据原文梳理这些知识点之间的联系，不要增加原文没有的事实。')} disabled={!!busy || dirty || editing}>帮我串起知识点之间的联系 <ArrowUp size={13}/></button></div>}
          {note.messages.map(message => <div key={message.id} className={`chat-message ${message.role}`}><span className="message-author">{message.role === 'user' ? '你' : '拾知'}</span><div className="markdown"><Markdown text={message.content} onLink={onLink}/></div>{message.patch && <span className="patch-badge"><Sparkles size={12}/>{message.patch}</span>}</div>)}
          {streaming && <><div className="chat-message user"><span className="message-author">你</span><div className="markdown"><Markdown text={streaming.question}/></div></div><div className="chat-message assistant streaming-answer"><span className="message-author">拾知</span>{streaming.answer ? <div className="markdown"><Markdown text={streaming.answer} onLink={onLink}/><span className="stream-cursor"/></div> : <div className="chat-thinking"><span/><span/><span/>正在梳理原文与笔记</div>}</div></>}
        </div>
        <form className="chat-composer" onSubmit={event => { event.preventDefault(); if (question.trim() && !busy && !dirty && !editing) ask(question.trim()); }}><textarea aria-label="向笔记提问" placeholder={editing || dirty ? '先保存编辑，再继续对话' : '有什么还想弄明白的？'} value={question} disabled={busy === 'chat' || dirty || editing} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (question.trim() && !busy && !dirty && !editing) ask(question.trim()); } }}/><div><span>Enter 发送 · Shift + Enter 换行</span><button aria-label="发送提问" disabled={!question.trim() || !!busy || dirty || editing}>{busy === 'chat' ? <LoaderCircle size={17} className="spin"/> : <ArrowUp size={18}/>}</button></div></form>
        <p className="chat-footnote">有价值的解释自动补入笔记，支持版本恢复</p>
      </aside>}
    </div>}
  </div>;
}
