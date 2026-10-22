import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import scroll from '../assets/spirit-scroll.png';
import opening30 from '../assets/spirit-book-opening-30.webp';
import opening62 from '../assets/spirit-book-opening-62.webp';
import opening86 from '../assets/spirit-book-opening-86.webp';
import openTopdown from '../assets/spirit-book-open-topdown-plain.png';
import paperTexture from '../assets/book-page-paper.webp';

export const bookOpeningFrames = [opening30, opening62, opening86, openTopdown];

export type BookOrigin = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type BookPhase = 'opening' | 'opened' | 'closing';
type TurnDirection = 'next' | 'previous';
type PageSide = 'left' | 'right';

type BookPage = {
  eyebrow: string;
  title: string;
  quote: string;
  author: string;
  pageNumber: string;
};

type BookSpread = { left: BookPage; right: BookPage };

const bookSpreads: BookSpread[] = [
  {
    left: { eyebrow: 'GLEAN · VERSE BOOK', title: '拾知成诵', quote: '把零散的新知拾起，慢慢连接成属于自己的世界。', author: '序', pageNumber: '壹' },
    right: { eyebrow: 'MEMORY & INSIGHT', title: '金句手札', quote: '值得记住的知识，将在这里凝成一句话。', author: '卷首', pageNumber: '贰' },
  },
  {
    left: { eyebrow: 'CULTIVATION · I', title: '积跬步', quote: '不积跬步，无以至千里；不积小流，无以成江海。', author: '《荀子》', pageNumber: '叁' },
    right: { eyebrow: 'CULTIVATION · II', title: '笃行之', quote: '博学之，审问之，慎思之，明辨之，笃行之。', author: '《中庸》', pageNumber: '肆' },
  },
  {
    left: { eyebrow: 'REFLECTION · I', title: '温故', quote: '温故而知新，可以为师矣。', author: '《论语》', pageNumber: '伍' },
    right: { eyebrow: 'REFLECTION · II', title: '日新', quote: '苟日新，日日新，又日新。', author: '《大学》', pageNumber: '陆' },
  },
  {
    left: { eyebrow: 'JOURNEY · I', title: '行则将至', quote: '道阻且长，行则将至；行而不辍，未来可期。', author: '修行札记', pageNumber: '柒' },
    right: { eyebrow: 'JOURNEY · II', title: '知而好学', quote: '知之者不如好之者，好之者不如乐之者。', author: '《论语》', pageNumber: '捌' },
  },
];

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function BookPageContent({ page, side }: { page: BookPage; side: PageSide }) {
  return <article className={`book-page-content book-page-${side}`}>
    <small>{page.eyebrow}</small>
    <h2>{page.title}</h2>
    <blockquote>“{page.quote}”</blockquote>
    <footer><span>—— {page.author}</span><b>{page.pageNumber}</b></footer>
  </article>;
}

export default function BookOpeningOverlay({ origin, onClose }: { origin: BookOrigin; onClose: () => void }) {
  const [phase, setPhase] = useState<BookPhase>(() => prefersReducedMotion() ? 'opened' : 'opening');
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [turning, setTurning] = useState<TurnDirection | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const turnTimer = useRef<number | undefined>(undefined);
  const turnLock = useRef(false);
  const swipeOrigin = useRef<number | null>(null);
  const closing = phase === 'closing';

  const close = useCallback(() => {
    if (closing) return;
    window.clearTimeout(turnTimer.current);
    turnLock.current = false;
    setTurning(null);
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setPhase('closing');
    closeTimer.current = window.setTimeout(onClose, 760);
  }, [closing, onClose]);

  const turnPage = useCallback((direction: TurnDirection) => {
    if (phase !== 'opened' || turning || turnLock.current) return;
    const targetIndex = spreadIndex + (direction === 'next' ? 1 : -1);
    if (targetIndex < 0 || targetIndex >= bookSpreads.length) return;
    if (prefersReducedMotion()) {
      setSpreadIndex(targetIndex);
      return;
    }
    turnLock.current = true;
    setTurning(direction);
    turnTimer.current = window.setTimeout(() => {
      setSpreadIndex(targetIndex);
      setTurning(null);
      turnLock.current = false;
    }, 780);
  }, [phase, spreadIndex, turning]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (prefersReducedMotion()) {
      requestAnimationFrame(() => closeButton.current?.focus());
      return () => { document.body.style.overflow = previousOverflow; };
    }

    const settleTimer = window.setTimeout(() => {
      setPhase('opened');
      requestAnimationFrame(() => closeButton.current?.focus());
    }, 820);
    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(closeTimer.current);
      window.clearTimeout(turnTimer.current);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const useKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closing) {
        event.preventDefault();
        close();
      }
      else if (event.key === 'ArrowRight') {
        event.preventDefault();
        turnPage('next');
      }
      else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        turnPage('previous');
      }
    };
    window.addEventListener('keydown', useKeys);
    return () => window.removeEventListener('keydown', useKeys);
  }, [close, closing, turnPage]);

  const beginSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 0 && phase === 'opened') swipeOrigin.current = event.clientX;
  };

  const endSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (swipeOrigin.current === null) return;
    const distance = event.clientX - swipeOrigin.current;
    swipeOrigin.current = null;
    if (Math.abs(distance) < 54) return;
    turnPage(distance < 0 ? 'next' : 'previous');
  };

  const originStyle = {
    '--book-origin-left': `${origin.left}px`,
    '--book-origin-top': `${origin.top}px`,
    '--book-origin-width': `${origin.width}px`,
    '--book-origin-height': `${origin.height}px`,
    '--book-paper-texture': `url("${paperTexture}")`,
  } as CSSProperties;

  const currentSpread = bookSpreads[spreadIndex];
  const targetIndex = turning === 'next' ? spreadIndex + 1 : turning === 'previous' ? spreadIndex - 1 : spreadIndex;
  const targetSpread = bookSpreads[targetIndex] || currentSpread;
  const baseLeft = turning === 'previous' ? targetSpread.left : currentSpread.left;
  const baseRight = turning === 'next' ? targetSpread.right : currentSpread.right;
  const flipFront = turning === 'next' ? currentSpread.right : currentSpread.left;
  const flipBack = turning === 'next' ? targetSpread.left : targetSpread.right;
  const pageStart = spreadIndex * 2 + 1;
  const statusText = phase === 'closing'
    ? '正在合卷…'
    : phase === 'opening'
      ? '正在展开金句册…'
      : turning
        ? turning === 'next' ? '向后翻页…' : '向前翻页…'
        : `第 ${pageStart}—${pageStart + 1} 页 · 使用 ← → 翻页`;

  return createPortal(
    <section className={`book-opening-overlay phase-${phase}`} style={originStyle} role="dialog" aria-modal="true" aria-label="拾知金句册">
      <div className="book-opening-atmosphere" aria-hidden="true"><i/><i/><i/></div>
      <img className="book-origin-echo" src={scroll} alt="" draggable="false"/>

      <button ref={closeButton} className="book-opening-close" type="button" onClick={close} aria-label="合上书本" title="合上书本（Esc）">
        <X size={20}/>
      </button>

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

        <button className="book-page-control book-page-control-previous" type="button" onClick={() => turnPage('previous')} disabled={spreadIndex === 0 || Boolean(turning) || phase !== 'opened'} aria-label="向前翻页" title="向前翻页（←）"><ChevronLeft size={25}/></button>
        <button className="book-page-control book-page-control-next" type="button" onClick={() => turnPage('next')} disabled={spreadIndex === bookSpreads.length - 1 || Boolean(turning) || phase !== 'opened'} aria-label="向后翻页" title="向后翻页（→）"><ChevronRight size={25}/></button>
      </div>

      <div className="book-page-pagination" aria-label={`第 ${spreadIndex + 1} 册页，共 ${bookSpreads.length} 册页`}>
        {bookSpreads.map((_, index) => <i key={index} className={index === spreadIndex ? 'active' : ''}/>) }
      </div>
      <p className="book-opening-hint" aria-live="polite">{statusText}</p>
    </section>,
    document.body,
  );
}
