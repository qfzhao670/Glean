import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Check, ChevronLeft, ChevronRight, FileText, LoaderCircle, Sparkles, X } from 'lucide-react';
import { api, post, type BookEntry, type Note } from '../api';
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
type Suggestion = { id: string; content: string; selected: boolean };
type BookPage = { eyebrow: string; title: string; quote: string; author: string; pageNumber: string; empty?: boolean };
type BookSpread = { left: BookPage; right: BookPage };

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
    : { eyebrow: 'SELECT · DISTILL · KEEP', title: loading ? '请稍候' : '开始提炼', quote: loading ? '纸页很快就会呈现。' : '选择一篇笔记，让模型按知识浓度提炼 3–10 条短段落，再由你决定留下哪些。', author: '点击上方「从笔记提炼」', pageNumber: '02', empty: true };
}

function entryPage(entry: BookEntry, index: number): BookPage {
  return { eyebrow: formatDate(entry.created_at), title: entry.note_title, quote: entry.content, author: '摘自原笔记', pageNumber: String(index + 1).padStart(2, '0') };
}

function makeSpreads(entries: BookEntry[], loaded: boolean): BookSpread[] {
  if (!entries.length) return [{ left: emptyPage('left', !loaded), right: emptyPage('right', !loaded) }];
  const pages = entries.map(entryPage);
  if (pages.length % 2) pages.push({ eyebrow: 'GLEAN · CONTINUE', title: '待续', quote: '下一条值得记住的知识，会落在这一页。', author: '继续提炼', pageNumber: String(pages.length + 1).padStart(2, '0'), empty: true });
  const spreads: BookSpread[] = [];
  for (let index = 0; index < pages.length; index += 2) spreads.push({ left: pages[index], right: pages[index + 1] });
  return spreads;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function BookPageContent({ page, side }: { page: BookPage; side: PageSide }) {
  return <article className={`book-page-content book-page-${side}${page.empty ? ' book-page-empty' : ''}`}>
    <small>{page.eyebrow}</small><h2>{page.title}</h2><blockquote>{page.quote}</blockquote>
    <footer><span>{page.author}</span><b>{page.pageNumber}</b></footer>
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<'generating' | 'saving' | ''>('');
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
      setEntries(value); setEntriesLoaded(true); setSpreadIndex(Math.max(0, Math.ceil(value.length / 2) - 1));
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
    if (phase !== 'opened' || composerOpen || turning || turnLock.current) return;
    const targetIndex = spreadIndex + (direction === 'next' ? 1 : -1);
    if (targetIndex < 0 || targetIndex >= bookSpreads.length) return;
    if (prefersReducedMotion()) { setSpreadIndex(targetIndex); return; }
    turnLock.current = true; setTurning(direction);
    turnTimer.current = window.setTimeout(() => { setSpreadIndex(targetIndex); setTurning(null); turnLock.current = false; }, 780);
  }, [bookSpreads.length, composerOpen, phase, spreadIndex, turning]);

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

  const openComposer = () => { setFeedback(''); setError(''); setSuggestions([]); setComposerOpen(true); };
  const generateSuggestions = async () => {
    if (!selectedNoteId) return;
    setBusy('generating'); setError('');
    try {
      const result = await post<{ suggestions: string[] }>('/book/suggestions', { note_id: selectedNoteId });
      setSuggestions(result.suggestions.map((content, index) => ({ id: `${index}-${content}`, content, selected: false })));
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };

  const chosenCount = suggestions.filter(item => item.selected).length;
  const selectedNote = notes.find(note => note.id === selectedNoteId);
  const toggleSuggestion = (id: string) => setSuggestions(current => current.map(item => item.id === id ? { ...item, selected: !item.selected } : item));
  const selectAll = () => {
    const next = chosenCount !== suggestions.length;
    setSuggestions(current => current.map(item => ({ ...item, selected: next })));
  };
  const saveSuggestions = async () => {
    const contents = suggestions.filter(item => item.selected).map(item => item.content);
    if (!contents.length) return;
    setBusy('saving'); setError('');
    try {
      const result = await post<{ entries: BookEntry[] }>('/book/entries', { note_id: selectedNoteId, contents });
      const nextEntries = [...entries, ...result.entries];
      setEntries(nextEntries); setEntriesLoaded(true); setSpreadIndex(Math.max(0, Math.ceil(nextEntries.length / 2) - 1));
      setComposerOpen(false); setSuggestions([]); setFeedback(`已将 ${result.entries.length} 条知识收入笔记本`);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
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
  const pageStart = spreadIndex * 2 + 1;
  const statusText = feedback || (phase === 'closing' ? '正在合卷…' : phase === 'opening' ? '正在展开知识笔记本…' : turning ? (turning === 'next' ? '向后翻页…' : '向前翻页…') : entries.length ? `第 ${pageStart}—${Math.min(pageStart + 1, entries.length)} 页 · 使用 ← → 翻页` : '尚未收入知识 · 从一篇现有笔记开始提炼');

  return createPortal(
    <section className={`book-opening-overlay phase-${phase}${composerOpen ? ' is-extracting' : ''}`} style={originStyle} role="dialog" aria-modal="true" aria-label="拾知知识笔记本">
      <div className="book-opening-atmosphere" aria-hidden="true"><i/><i/><i/></div>
      <img className="book-origin-echo" src={scroll} alt="" draggable="false"/>
      <button ref={closeButton} className="book-opening-close" type="button" onClick={close} aria-label="合上书本" title="合上书本（Esc）"><X size={20}/></button>
      <button className="book-create-entry" type="button" onClick={openComposer} disabled={phase !== 'opened' || Boolean(turning) || composerOpen}><Sparkles size={15}/>从笔记提炼</button>

      <div className="book-opening-scene" onPointerDown={beginSwipe} onPointerUp={endSwipe} onPointerCancel={() => { swipeOrigin.current = null; }}>
        <div className="book-open-stage">
          <div className="book-frame-stack" aria-hidden="true">
            <img className="book-sequence-frame frame-opening-30" src={opening30} alt="" draggable="false"/>
            <img className="book-sequence-frame frame-opening-62" src={opening62} alt="" draggable="false"/>
            <img className="book-sequence-frame frame-opening-86" src={opening86} alt="" draggable="false"/>
            <img className="book-sequence-frame frame-open-topdown" src={openTopdown} alt="" draggable="false"/>
          </div>
          <div className="book-page-system" aria-live="polite">
            <div className="book-page-static book-page-static-left"><BookPageContent page={baseLeft} side="left"/></div>
            <div className="book-page-static book-page-static-right"><BookPageContent page={baseRight} side="right"/></div>
            {turning && <div className={`book-turn-leaf book-turn-${turning}`} aria-hidden="true">
              <div className="book-page-face book-page-face-front"><BookPageContent page={flipFront} side={turning === 'next' ? 'right' : 'left'}/></div>
              <div className="book-page-face book-page-face-back"><BookPageContent page={flipBack} side={turning === 'next' ? 'left' : 'right'}/></div>
            </div>}
          </div>
        </div>

        {composerOpen && <section className={`book-extract-panel ${suggestions.length ? 'reviewing' : 'choosing'}`} role="dialog" aria-modal="true" aria-label="从现有笔记提炼知识" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
          <button className="book-extract-close" type="button" onClick={() => setComposerOpen(false)} disabled={Boolean(busy)} aria-label="关闭提炼面板"><X size={17}/></button>
          {!suggestions.length ? <div className="book-extract-start">
            <section className="book-extract-intro">
              <span className="book-extract-kicker"><BookOpen size={14}/>知识提炼</span>
              <h2>从一篇笔记，<br/>留下几段真知</h2>
              <p>模型负责通读与浓缩，最后留下什么，由你决定。</p>
              <ol>
                <li><i>一</i><span><b>选一篇笔记</b><small>以完整正文作为提炼范围</small></span></li>
                <li><i>二</i><span><b>获得知识段落</b><small>按内容浓度生成 3–10 条</small></span></li>
                <li><i>三</i><span><b>亲自确认入册</b><small>只保存真正值得记住的内容</small></span></li>
              </ol>
            </section>
            <section className="book-extract-source">
              <header><span>选择来源</span><h3>哪篇笔记值得再读一次？</h3></header>
              <label><span className="sr-only">选择现有笔记</span><select value={selectedNoteId} onChange={event => { setSelectedNoteId(event.target.value); setError(''); }} disabled={Boolean(busy) || !notes.length}>
                {!notes.length && <option value="">还没有可用笔记</option>}{notes.map(note => <option key={note.id} value={note.id}>{note.title}</option>)}
              </select></label>
              {selectedNote ? <article className="book-source-preview"><FileText size={18}/><div><strong>{selectedNote.title}</strong><p>{selectedNote.excerpt || '这篇笔记暂无摘要，模型将直接阅读全文。'}</p></div></article> : <div className="book-source-empty"><FileText size={18}/><span>先创建或导入一篇笔记，再回来提炼。</span></div>}
              <div className="book-extract-source-foot">
                {busy === 'generating' ? <div className="book-extract-progress" role="status"><LoaderCircle size={17}/>正在通读并判断知识浓度…</div> : <p>原笔记不会被修改</p>}
                {error && <p className="book-extract-error" role="alert">{error}</p>}
                <button className="book-extract-primary" type="button" onClick={generateSuggestions} disabled={!selectedNoteId || Boolean(busy)}>{busy === 'generating' ? <LoaderCircle size={16}/> : <Sparkles size={16}/>}开始提炼</button>
              </div>
            </section>
          </div> : <div className="book-extract-review">
            <header>
              <div><span className="book-extract-kicker"><BookOpen size={14}/>摘录复核</span><h2>这些内容，值得留下吗？</h2><p>勾选你愿意再次翻到的段落。</p></div>
              <div className="book-review-count"><span><b>{chosenCount}</b> / {suggestions.length} 已选</span><button type="button" onClick={selectAll}>{chosenCount === suggestions.length ? '全部取消' : '全部选择'}</button></div>
            </header>
            <div className="book-suggestion-list">{[
              suggestions.slice(0, Math.ceil(suggestions.length / 2)),
              suggestions.slice(Math.ceil(suggestions.length / 2)),
            ].map((column, columnIndex) => <div key={columnIndex}>{column.map(item => <label key={item.id} className={item.selected ? 'selected' : ''}><input type="checkbox" checked={item.selected} onChange={() => toggleSuggestion(item.id)}/><i>{item.selected && <Check size={13}/>}</i><span>{item.content}</span></label>)}</div>)}</div>
            {error && <p className="book-extract-error" role="alert">{error}</p>}
            <footer><div className="book-review-source"><FileText size={14}/><span>提炼自</span><strong>{selectedNote?.title}</strong></div><button className="book-review-back" type="button" onClick={() => { setSuggestions([]); setError(''); }} disabled={Boolean(busy)}>换一篇笔记</button><button className="book-extract-primary book-save-seal" type="button" onClick={saveSuggestions} disabled={!chosenCount || Boolean(busy)}>{busy === 'saving' ? <LoaderCircle size={16}/> : <Check size={16}/>}收入 {chosenCount || ''} 条</button></footer>
          </div>}
        </section>}

        <button className="book-page-control book-page-control-previous" type="button" onClick={() => turnPage('previous')} disabled={spreadIndex === 0 || Boolean(turning) || phase !== 'opened' || composerOpen} aria-label="向前翻页" title="向前翻页（←）"><ChevronLeft size={25}/></button>
        <button className="book-page-control book-page-control-next" type="button" onClick={() => turnPage('next')} disabled={spreadIndex === bookSpreads.length - 1 || Boolean(turning) || phase !== 'opened' || composerOpen} aria-label="向后翻页" title="向后翻页（→）"><ChevronRight size={25}/></button>
      </div>

      <div className="book-page-pagination" aria-label={`第 ${spreadIndex + 1} 册页，共 ${bookSpreads.length} 册页`}><span>{spreadIndex + 1} / {bookSpreads.length}</span></div>
      <p className="book-opening-hint" aria-live="polite">{statusText}</p>
    </section>, document.body,
  );
}
