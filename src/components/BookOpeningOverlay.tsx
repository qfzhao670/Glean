import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Check, ChevronLeft, ChevronRight, FileText, LoaderCircle, Sparkles, Trash2, X } from 'lucide-react';
import { api, post, streamJsonLines, type BookEntry, type Note } from '../api';
import { groupBookEntriesByPage } from '../bookPagination';
import scroll from '../assets/spirit-scroll.png';
import opening30 from '../assets/spirit-book-opening-30.webp';
import opening62 from '../assets/spirit-book-opening-62.webp';
import opening86 from '../assets/spirit-book-opening-86.webp';
import openTopdown from '../assets/spirit-book-open-topdown-plain.png';
import paperTexture from '../assets/book-page-paper.webp';

export const bookOpeningFrames = [opening30, opening62, opening86, openTopdown];

export type BookOrigin = { left: number; top: number; width: number; height: number };

type BookPhase = 'opening' | 'opened' | 'closing';
type TurnDirection = 'next' | 'previous';
type PageSide = 'left' | 'right';
type BookPage = { eyebrow: string; title: string; quote: string; author: string; pageNumber: string; empty?: boolean; entries?: BookEntry[] };
type BookSpread = { left: BookPage; right: BookPage };
type SummaryStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'delta'; content: string }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string };

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date).replaceAll('/', '.');
}

function emptyPage(side: PageSide, loading = false): BookPage {
  return side === 'left'
    ? { eyebrow: 'GLEAN · KNOWLEDGE BOOK', title: loading ? '正在展卷' : '拾知成诵', quote: loading ? '正在读取已经收入的知识……' : '从已有笔记中提炼真正值得反复回看的知识。', author: '知识手札', pageNumber: '01', empty: true }
    : { eyebrow: 'READ · DISTILL · KEEP', title: loading ? '请稍候' : '写下一页', quote: loading ? '纸页很快就会呈现。' : '选择一篇笔记，将它浓缩成一段专业、通俗、值得重读的摘要；你可以编辑后再确认入册。', author: '点击上方「生成摘要」', pageNumber: '02', empty: true };
}

function entryPage(entries: BookEntry[], index: number): BookPage {
  const entry = entries[0];
  return {
    eyebrow: formatDate(entry.created_at),
    title: entry.note_title,
    quote: '', author: '一篇笔记 · 一页摘要', entries,
    pageNumber: String(index + 1).padStart(2, '0'),
  };
}

function makeSpreads(entries: BookEntry[], loaded: boolean): BookSpread[] {
  if (!entries.length) return [{ left: emptyPage('left', !loaded), right: emptyPage('right', !loaded) }];
  const pages = groupBookEntriesByPage(entries).map(entryPage);
  if (pages.length % 2) pages.push({ eyebrow: 'GLEAN · CONTINUE', title: '待续', quote: '下一条值得记住的知识，会落在这一页。', author: '继续提炼', pageNumber: String(pages.length + 1).padStart(2, '0'), empty: true });
  const spreads: BookSpread[] = [];
  for (let index = 0; index < pages.length; index += 2) spreads.push({ left: pages[index], right: pages[index + 1] });
  return spreads;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function BookPageContent({ page, side, onDelete, deletingEntryId }: { page: BookPage; side: PageSide; onDelete?: (entry: BookEntry) => void; deletingEntryId?: string }) {
  const entry = page.entries?.[0];
  return <article className={`book-page-content book-page-${side}${page.empty ? ' book-page-empty' : ''}${page.entries ? ' book-page-with-entries' : ''}`}>
    <small>{page.eyebrow}</small><h2>{page.title}</h2>
    {page.entries ? <div className={`book-knowledge-list count-${page.entries.length}`}>
      {page.entries.map(entry => <section className={entry.content.length > 240 ? 'is-long' : ''} key={entry.id}>
        <p>{entry.content}</p>
        <div><span>摘自《{entry.note_title}》</span><time dateTime={entry.created_at}>{formatDate(entry.created_at)}</time></div>
      </section>)}
    </div> : <blockquote>{page.quote}</blockquote>}
    <footer><div className="book-page-footer-meta"><span>{page.author}</span>{entry && onDelete && <button className="book-entry-delete" type="button" disabled={Boolean(deletingEntryId)} onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onClick={() => onDelete(entry)} aria-label={`删除《${entry.note_title}》的摘要`} title="从书本中删除摘要">{deletingEntryId === entry.id ? <LoaderCircle className="spin" size={11}/> : <Trash2 size={11}/>}<span>删除</span></button>}</div><b>{page.pageNumber}</b></footer>
  </article>;
}

export default function BookOpeningOverlay({ origin, notes, onClose }: { origin: BookOrigin; notes: Note[]; onClose: () => void }) {
  const [phase, setPhase] = useState<BookPhase>(() => prefersReducedMotion() ? 'opened' : 'opening');
  const [entries, setEntries] = useState<BookEntry[]>([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [turning, setTurning] = useState<TurnDirection | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState(notes[0]?.id || '');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [busy, setBusy] = useState<'generating' | 'saving' | ''>('');
  const [deletingEntryId, setDeletingEntryId] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const turnTimer = useRef<number | undefined>(undefined);
  const turnLock = useRef(false);
  const swipeOrigin = useRef<number | null>(null);
  const closing = phase === 'closing';
  const bookSpreads = useMemo(() => makeSpreads(entries, entriesLoaded), [entries, entriesLoaded]);

  useEffect(() => {
    let active = true;
    api<BookEntry[]>('/book/entries').then(value => {
      if (!active) return;
      setEntries(value); setEntriesLoaded(true); setSpreadIndex(Math.max(0, makeSpreads(value, true).length - 1));
    }).catch(reason => {
      if (!active) return;
      setEntriesLoaded(true); setFeedback((reason as Error).message);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedNoteId && notes.length) setSelectedNoteId(notes[0].id);
  }, [notes, selectedNoteId]);

  useEffect(() => {
    if (spreadIndex >= bookSpreads.length) setSpreadIndex(bookSpreads.length - 1);
  }, [bookSpreads.length, spreadIndex]);

  const close = useCallback(() => {
    if (closing) return;
    window.clearTimeout(turnTimer.current); turnLock.current = false; setTurning(null);
    if (prefersReducedMotion()) { onClose(); return; }
    setPhase('closing'); closeTimer.current = window.setTimeout(onClose, 760);
  }, [closing, onClose]);

  const turnPage = useCallback((direction: TurnDirection) => {
    if (phase !== 'opened' || composerOpen || deletingEntryId || turning || turnLock.current) return;
    const targetIndex = spreadIndex + (direction === 'next' ? 1 : -1);
    if (targetIndex < 0 || targetIndex >= bookSpreads.length) return;
    if (prefersReducedMotion()) { setSpreadIndex(targetIndex); return; }
    turnLock.current = true; setTurning(direction);
    turnTimer.current = window.setTimeout(() => { setSpreadIndex(targetIndex); setTurning(null); turnLock.current = false; }, 780);
  }, [bookSpreads.length, composerOpen, deletingEntryId, phase, spreadIndex, turning]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (prefersReducedMotion()) {
      requestAnimationFrame(() => closeButton.current?.focus());
      return () => { document.body.style.overflow = previousOverflow; };
    }
    const settleTimer = window.setTimeout(() => { setPhase('opened'); requestAnimationFrame(() => closeButton.current?.focus()); }, 820);
    return () => { window.clearTimeout(settleTimer); window.clearTimeout(closeTimer.current); window.clearTimeout(turnTimer.current); document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    const useKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closing) {
        event.preventDefault();
        if (composerOpen && !busy) setComposerOpen(false); else if (!composerOpen) close();
      } else if (event.key === 'ArrowRight') { event.preventDefault(); turnPage('next'); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); turnPage('previous'); }
    };
    window.addEventListener('keydown', useKeys);
    return () => window.removeEventListener('keydown', useKeys);
  }, [busy, close, closing, composerOpen, turnPage]);

  const beginSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 0 && phase === 'opened' && !composerOpen) swipeOrigin.current = event.clientX;
  };
  const endSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (swipeOrigin.current === null) return;
    const distance = event.clientX - swipeOrigin.current; swipeOrigin.current = null;
    if (Math.abs(distance) >= 54) turnPage(distance < 0 ? 'next' : 'previous');
  };

  const openComposer = () => { setFeedback(''); setError(''); setDraftSummary(''); setDraftOpen(false); setDraftReady(false); setComposerOpen(true); };
  const generateSummary = async () => {
    if (!selectedNoteId) return;
    setBusy('generating'); setError(''); setDraftSummary(''); setDraftOpen(true); setDraftReady(false); setGenerationStatus('正在连接模型…');
    let streamError = '';
    try {
      await streamJsonLines<SummaryStreamEvent>('/book/summary/stream', { note_id: selectedNoteId }, event => {
        if (event.type === 'status') setGenerationStatus(event.message);
        else if (event.type === 'delta') {
          setGenerationStatus('正在写摘要…');
          setDraftSummary(current => current + event.content);
        } else if (event.type === 'done') {
          setDraftSummary(event.summary);
          setDraftReady(true);
          setGenerationStatus('摘要已生成，可以编辑');
        } else {
          streamError = event.message;
        }
      });
      if (streamError) throw new Error(streamError);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };

  const selectedNote = notes.find(note => note.id === selectedNoteId);
  const saveSummary = async () => {
    const content = draftSummary.replace(/\s+/g, ' ').trim();
    if (!content || !draftReady) return;
    setBusy('saving'); setError('');
    try {
      const result = await post<{ entry: BookEntry }>('/book/entries', { note_id: selectedNoteId, content });
      const nextEntries = [...entries, result.entry];
      setEntries(nextEntries); setEntriesLoaded(true); setSpreadIndex(Math.max(0, makeSpreads(nextEntries, true).length - 1));
      setComposerOpen(false); setDraftSummary(''); setDraftOpen(false); setDraftReady(false); setFeedback('摘要已写入新的一页');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };

  const deleteEntry = async (entry: BookEntry) => {
    if (deletingEntryId || !window.confirm(`确定从书本中删除《${entry.note_title}》的摘要吗？\n\n原笔记不会被删除。`)) return;
    setDeletingEntryId(entry.id); setFeedback('');
    try {
      await api<{ ok: boolean }>(`/book/entries/${entry.id}`, { method: 'DELETE' });
      setEntries(current => current.filter(item => item.id !== entry.id));
      setFeedback('摘要已从书本中删除，原笔记保持不变');
    } catch (reason) {
      setFeedback(`删除失败：${(reason as Error).message}`);
    } finally {
      setDeletingEntryId('');
    }
  };

  const originStyle = {
    '--book-origin-left': `${origin.left}px`, '--book-origin-top': `${origin.top}px`, '--book-origin-width': `${origin.width}px`, '--book-origin-height': `${origin.height}px`, '--book-paper-texture': `url("${paperTexture}")`,
  } as CSSProperties;
  const currentSpread = bookSpreads[spreadIndex] || bookSpreads[0];
  const targetIndex = turning === 'next' ? spreadIndex + 1 : turning === 'previous' ? spreadIndex - 1 : spreadIndex;
  const targetSpread = bookSpreads[targetIndex] || currentSpread;
  const baseLeft = turning === 'previous' ? targetSpread.left : currentSpread.left;
  const baseRight = turning === 'next' ? targetSpread.right : currentSpread.right;
  const flipFront = turning === 'next' ? currentSpread.right : currentSpread.left;
  const flipBack = turning === 'next' ? targetSpread.left : targetSpread.right;
  const statusText = feedback || (phase === 'closing' ? '正在合卷…' : phase === 'opening' ? '正在展开知识笔记本…' : turning ? (turning === 'next' ? '向后翻页…' : '向前翻页…') : entries.length ? `共写下 ${entries.length} 篇摘要 · 使用 ← → 翻页` : '书页尚空 · 从一篇现有笔记开始生成摘要');

  return createPortal(
    <section className={`book-opening-overlay phase-${phase}${composerOpen ? ' is-extracting' : ''}`} style={originStyle} role="dialog" aria-modal="true" aria-label="拾知知识笔记本">
      <div className="book-opening-atmosphere" aria-hidden="true"><i/><i/><i/></div>
      <img className="book-origin-echo" src={scroll} alt="" draggable="false"/>
      <button ref={closeButton} className="book-opening-close" type="button" onClick={close} aria-label="合上书本" title="合上书本（Esc）"><X size={20}/></button>
      <button className="book-create-entry" type="button" onClick={openComposer} disabled={phase !== 'opened' || Boolean(turning) || Boolean(deletingEntryId) || composerOpen}><Sparkles size={15}/>生成摘要</button>

      <div className="book-opening-scene" onPointerDown={beginSwipe} onPointerUp={endSwipe} onPointerCancel={() => { swipeOrigin.current = null; }}>
        <div className="book-open-stage">
          <div className="book-frame-stack" aria-hidden="true">
            <img className="book-sequence-frame frame-opening-30" src={opening30} alt="" draggable="false"/>
            <img className="book-sequence-frame frame-opening-62" src={opening62} alt="" draggable="false"/>
            <img className="book-sequence-frame frame-opening-86" src={opening86} alt="" draggable="false"/>
            <img className="book-sequence-frame frame-open-topdown" src={openTopdown} alt="" draggable="false"/>
          </div>
          <div className="book-page-system" aria-live="polite">
            <div className="book-page-static book-page-static-left"><BookPageContent page={baseLeft} side="left" onDelete={turning ? undefined : deleteEntry} deletingEntryId={deletingEntryId}/></div>
            <div className="book-page-static book-page-static-right"><BookPageContent page={baseRight} side="right" onDelete={turning ? undefined : deleteEntry} deletingEntryId={deletingEntryId}/></div>
            {turning && <div className={`book-turn-leaf book-turn-${turning}`} aria-hidden="true">
              <div className="book-page-face book-page-face-front"><BookPageContent page={flipFront} side={turning === 'next' ? 'right' : 'left'}/></div>
              <div className="book-page-face book-page-face-back"><BookPageContent page={flipBack} side={turning === 'next' ? 'left' : 'right'}/></div>
            </div>}
          </div>
        </div>

        {composerOpen && <section className={`book-extract-panel ${draftOpen ? 'reviewing' : 'choosing'}`} role="dialog" aria-modal="true" aria-label="从现有笔记生成摘要" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
          <button className="book-extract-close" type="button" onClick={() => setComposerOpen(false)} disabled={Boolean(busy)} aria-label="关闭摘要面板"><X size={17}/></button>
          {!draftOpen ? <div className="book-extract-start">
            <section className="book-extract-intro">
              <span className="book-extract-kicker"><BookOpen size={14}/>一页摘要</span>
              <h2>读完一篇，<br/>写成一页</h2>
              <p>模型先阅读全文，写出准确又好读的摘要；你可以亲自修改，再把它收入书中。</p>
              <ol>
                <li><i>一</i><span><b>选择一篇笔记</b><small>以完整正文作为摘要范围</small></span></li>
                <li><i>二</i><span><b>流式生成摘要</b><small>专业准确，也让人一读就懂</small></span></li>
                <li><i>三</i><span><b>编辑确认入册</b><small>每篇摘要独占一页纸</small></span></li>
              </ol>
            </section>
            <section className="book-extract-source">
              <header><span>选择来源</span><h3>这次要浓缩哪篇笔记？</h3></header>
              <label><span className="sr-only">选择现有笔记</span><select value={selectedNoteId} onChange={event => { setSelectedNoteId(event.target.value); setError(''); }} disabled={Boolean(busy) || !notes.length}>
                {!notes.length && <option value="">还没有可用笔记</option>}{notes.map(note => <option key={note.id} value={note.id}>{note.title}</option>)}
              </select></label>
              {selectedNote ? <article className="book-source-preview"><FileText size={18}/><div><strong>{selectedNote.title}</strong><p>{selectedNote.excerpt || '模型会直接阅读全文，再写出一段完整摘要。'}</p></div></article> : <div className="book-source-empty"><FileText size={18}/><span>先创建或导入一篇笔记，再回来生成摘要。</span></div>}
              <div className="book-extract-source-foot">
                <p>原笔记不会被修改</p>
                {error && <p className="book-extract-error" role="alert">{error}</p>}
                <button className="book-extract-primary" type="button" onClick={generateSummary} disabled={!selectedNoteId || Boolean(busy)}><Sparkles size={16}/>生成一段摘要</button>
              </div>
            </section>
          </div> : <div className="book-extract-review">
            <header>
              <div><span className="book-extract-kicker"><BookOpen size={14}/>摘要校阅</span><h2>{busy === 'generating' ? '正在落笔…' : draftReady ? '读一遍，再亲手定稿' : '这次没有写完'}</h2><p>{busy === 'generating' ? generationStatus : draftReady ? '摘要已生成，你可以直接修改下面的文字。' : '保留了已经生成的内容；重新生成后再确认写入。'}</p></div>
              <div className="book-summary-count"><span>{draftSummary.length} / 600 字</span><strong>{draftReady ? '可编辑' : busy === 'generating' ? '生成中' : '待重试'}</strong></div>
            </header>
            <div className={`book-summary-editor${busy === 'generating' ? ' is-streaming' : ''}`}>
              <textarea aria-label="笔记摘要" value={draftSummary} readOnly={Boolean(busy)} maxLength={600} onChange={event => { setDraftSummary(event.target.value); setError(''); }} placeholder={busy === 'generating' ? '正在通读笔记并组织语言…' : '在这里编辑摘要'}/>
              {busy === 'generating' && <div className="book-summary-stream-indicator" role="status"><LoaderCircle size={13}/><span>{generationStatus}</span></div>}
            </div>
            {error && <p className="book-extract-error" role="alert">{error}</p>}
            <footer><div className="book-review-source"><FileText size={14}/><span>摘要自</span><strong>{selectedNote?.title}</strong></div><button className="book-review-back" type="button" onClick={() => { setDraftOpen(false); setDraftSummary(''); setDraftReady(false); setError(''); }} disabled={Boolean(busy)}>换一篇</button><button className="book-review-back" type="button" onClick={generateSummary} disabled={Boolean(busy)}>重新生成</button><button className="book-extract-primary book-save-seal" type="button" onClick={saveSummary} disabled={!draftReady || !draftSummary.trim() || Boolean(busy)}>{busy === 'saving' ? <LoaderCircle size={16}/> : <Check size={16}/>}确认写入</button></footer>
          </div>}
        </section>}

        <button className="book-page-control book-page-control-previous" type="button" onClick={() => turnPage('previous')} disabled={spreadIndex === 0 || Boolean(turning) || Boolean(deletingEntryId) || phase !== 'opened' || composerOpen} aria-label="向前翻页" title="向前翻页（←）"><ChevronLeft size={25}/></button>
        <button className="book-page-control book-page-control-next" type="button" onClick={() => turnPage('next')} disabled={spreadIndex === bookSpreads.length - 1 || Boolean(turning) || Boolean(deletingEntryId) || phase !== 'opened' || composerOpen} aria-label="向后翻页" title="向后翻页（→）"><ChevronRight size={25}/></button>
      </div>

      <div className="book-page-pagination" aria-label={`第 ${spreadIndex + 1} 册页，共 ${bookSpreads.length} 册页`}><span>{spreadIndex + 1} / {bookSpreads.length}</span></div>
      <p className="book-opening-hint" aria-live="polite">{statusText}</p>
    </section>, document.body,
  );
}
