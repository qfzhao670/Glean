import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import scroll from '../assets/spirit-scroll.png';
import opening30 from '../assets/spirit-book-opening-30.webp';
import opening62 from '../assets/spirit-book-opening-62.webp';
import opening86 from '../assets/spirit-book-opening-86.webp';
import openTopdown from '../assets/spirit-book-open-topdown.webp';

export const bookOpeningFrames = [opening30, opening62, opening86, openTopdown];

export type BookOrigin = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type BookPhase = 'opening' | 'opened' | 'closing';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function BookOpeningOverlay({ origin, onClose }: { origin: BookOrigin; onClose: () => void }) {
  const [phase, setPhase] = useState<BookPhase>(() => prefersReducedMotion() ? 'opened' : 'opening');
  const closeButton = useRef<HTMLButtonElement>(null);
  const closing = phase === 'closing';

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
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const useKeys = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || closing) return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', useKeys);
    return () => window.removeEventListener('keydown', useKeys);
  }, [closing]);

  const close = () => {
    if (closing) return;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setPhase('closing');
    window.setTimeout(onClose, 760);
  };

  const originStyle = {
    '--book-origin-left': `${origin.left}px`,
    '--book-origin-top': `${origin.top}px`,
    '--book-origin-width': `${origin.width}px`,
    '--book-origin-height': `${origin.height}px`,
  } as CSSProperties;

  return createPortal(
    <section className={`book-opening-overlay phase-${phase}`} style={originStyle} role="dialog" aria-modal="true" aria-label="拾知金句册">
      <div className="book-opening-atmosphere" aria-hidden="true"><i/><i/><i/></div>
      <img className="book-origin-echo" src={scroll} alt="" draggable="false"/>

      <button ref={closeButton} className="book-opening-close" type="button" onClick={close} aria-label="合上书本" title="合上书本（Esc）">
        <X size={20}/>
      </button>

      <div className="book-opening-scene">
        <div className="book-open-stage">
          <div className="book-frame-stack" aria-hidden="true">
            <img className="book-sequence-frame frame-opening-30" src={opening30} alt="" draggable="false"/>
            <img className="book-sequence-frame frame-opening-62" src={opening62} alt="" draggable="false"/>
            <img className="book-sequence-frame frame-opening-86" src={opening86} alt="" draggable="false"/>
            <img className="book-sequence-frame frame-open-topdown" src={openTopdown} alt="" draggable="false"/>
          </div>
          <div className="book-open-copy book-open-copy-left" aria-hidden="true">
            <small>GLEAN · VERSE BOOK</small><span>拾知成诵</span><i/><i/><i/>
          </div>
          <div className="book-open-copy book-open-copy-right">
            <small>MEMORY &amp; INSIGHT</small><span>金句手札</span>
            <p>值得记住的知识，<br/>将在这里凝成一句话。</p>
          </div>
        </div>
      </div>

      <p className="book-opening-hint">{phase === 'opened' ? '金句册已展开' : phase === 'closing' ? '正在合卷…' : '正在展开金句册…'}</p>
    </section>,
    document.body,
  );
}
