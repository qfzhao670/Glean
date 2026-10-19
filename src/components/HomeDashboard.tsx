import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowUpRight, CalendarDays, Check, ChevronRight, FileText, Lightbulb, Link2, Plus, RefreshCw, Sprout } from 'lucide-react';
import type { Note, Stats } from '../api';
import ActivityChart from './ActivityChart';
import Garden from './Garden';

const quotes = [
  ['人外有人，天外有天，修行之路，贵在坚持。', '韩立'],
  ['不积跬步，无以至千里。', '荀子'],
  ['知之者不如好之者，好之者不如乐之者。', '论语'],
  ['博学之，审问之，慎思之，明辨之，笃行之。', '中庸'],
];

const taskLabels = ['整理项目设计思路', '阅读一篇旧笔记', '学习一个新概念', '复盘今日收获'];

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '昨天' : `${days} 天前`;
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(media.matches);
    media.addEventListener?.('change', updatePreference);
    return () => media.removeEventListener?.('change', updatePreference);
  }, []);

  return reducedMotion;
}

function useAnimatedInteger(value: number, reducedMotion: boolean, duration = 650) {
  const [displayValue, setDisplayValue] = useState(reducedMotion ? value : 0);
  const currentValue = useRef(reducedMotion ? value : 0);

  useEffect(() => {
    if (reducedMotion) {
      currentValue.current = value;
      setDisplayValue(value);
      return;
    }

    const from = currentValue.current;
    const startedAt = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (value - from) * eased);
      currentValue.current = next;
      setDisplayValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, reducedMotion, value]);

  return displayValue;
}

function trackSpotlight(event: PointerEvent<HTMLElement>) {
  if (event.pointerType === 'touch') return;
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--spotlight-x', `${event.clientX - bounds.left}px`);
  event.currentTarget.style.setProperty('--spotlight-y', `${event.clientY - bounds.top}px`);
}

export default function HomeDashboard({ stats, notes, dateLabel, onCreate, onOpen, onLibrary }: {
  stats: Stats;
  notes: Note[];
  dateLabel: string;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onLibrary: () => void;
}) {
  const storageKey = `glean-daily-practice-${new Date().toLocaleDateString('sv-SE')}`;
  const [completed, setCompleted] = useState<boolean[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(value) ? taskLabels.map((_, index) => Boolean(value[index])) : taskLabels.map(() => false);
    }
    catch { return [false, false, false, false]; }
  });
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * quotes.length));
  const recentNotes = useMemo(() => [...notes].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)).slice(0, 4), [notes]);
  const reducedMotion = usePrefersReducedMotion();
  const animatedNotes = useAnimatedInteger(stats.notes, reducedMotion);
  const animatedLinks = useAnimatedInteger(stats.links, reducedMotion, 720);
  const animatedDays = useAnimatedInteger(stats.active_days, reducedMotion, 780);

  const toggleTask = (index: number) => {
    const next = completed.map((value, taskIndex) => taskIndex === index ? !value : value);
    setCompleted(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  return <div className="dashboard page-enter">
    <div className="home-topline"><span><Sprout size={16}/>你好，探索者。</span><time>{dateLabel}</time></div>
    <section className="hero">
      <div className="hero-copy">
        <h1 className="hero-title"><span>让好奇心，</span><span>长成自己的修为。</span></h1>
        <p className="hero-description">从一份学问、一个想法开始。<br/>拾起零散的知识，连接成属于你的世界。</p>
        <div className="hero-stats">
          <div><strong>{animatedNotes.toString().padStart(2, '0')}<span>篇</span></strong><p>已沉淀笔记 <FileText size={14}/></p></div>
          <div><strong>{animatedLinks.toString().padStart(2, '0')}<span>个</span></strong><p>知识连接 <Link2 size={14}/></p></div>
          <div><strong>{animatedDays.toString().padStart(2, '0')}<span>天</span></strong><p>与知识相遇 <CalendarDays size={14}/></p></div>
        </div>
        <button className="hero-cta" onClick={onCreate}><Plus size={18}/>拾取今天的新知<ChevronRight size={18}/></button>
        <div className="hero-footnote"><span className="thin-line"/>每一份积累，都是向上的力量。</div>
      </div>
      <Garden stats={stats}/>
      <aside className="hero-verse"><strong>道阻且长，<br/>行则将至。</strong><span>——《凡人修仙传》</span></aside>
    </section>

    <section className="cultivation-grid">
      <article className="dashboard-card daily-practice" onPointerMove={trackSpotlight}>
        <header><h2><CalendarDays size={19}/>今日修行</h2><button title="重置今日进度" onClick={() => { const next = taskLabels.map(() => false); setCompleted(next); localStorage.setItem(storageKey, JSON.stringify(next)); }}>重新开始 <RefreshCw size={13}/></button></header>
        <div className="practice-list">{taskLabels.map((label, index) => <button key={label} className={completed[index] ? 'done' : ''} onClick={() => toggleTask(index)}><i>{completed[index] && <Check size={13}/>}</i><span>{label}</span><time>{completed[index] ? '已完成' : '未开始'}</time></button>)}</div>
        <p>“千里之行，始于足下。” ——《道德经》</p>
      </article>

      <article className="dashboard-card practice-trail" onPointerMove={trackSpotlight}>
        <header><h2><Sprout size={19}/>修行足迹</h2><span>最近半年⌄</span></header>
        <ActivityChart activity={stats.activity}/>
        <footer><span>“不积跬步，无以至千里。” ——《荀子》</span><strong>{stats.streak}<small> 天连续记录</small></strong></footer>
      </article>

      <article className="dashboard-card inspiration-card" onPointerMove={trackSpotlight}>
        <header><h2><Lightbulb size={19}/>灵感一刻</h2><button onClick={() => setQuoteIndex(index => (index + 1) % quotes.length)}>换一条 <RefreshCw size={13}/></button></header>
        <div className="inspiration-quote" key={quoteIndex}>
          <blockquote>“{quotes[quoteIndex][0]}”</blockquote>
          <cite>—— {quotes[quoteIndex][1]}</cite>
        </div>
      </article>
    </section>

    <section className="recent-notes">
      <header><h2><FileText size={19}/>最近笔记</h2><button onClick={onLibrary}>查看全部 <ArrowUpRight size={14}/></button></header>
      {recentNotes.length ? <div className="recent-note-grid">{recentNotes.map(note => <button key={note.id} onPointerMove={trackSpotlight} onClick={() => onOpen(note.id)}>
        <FileText size={22}/><span><strong>{note.title}</strong><small>{relativeTime(note.updated_at)}</small></span><em>{note.kind === 'manual' ? '手记' : note.kind === 'curate' ? '阅读' : '知识'}</em>
      </button>)}</div> : <button className="recent-empty" onClick={onCreate}><Plus size={18}/>拾取第一份新知</button>}
    </section>
  </div>;
}
