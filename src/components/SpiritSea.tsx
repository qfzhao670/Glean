import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { BookOpen, Sparkles } from 'lucide-react';
import type { Note } from '../api';
import sword01 from '../assets/spirit-sea/sword-01.png';
import sword02 from '../assets/spirit-sea/sword-02.png';
import sword03 from '../assets/spirit-sea/sword-03.png';
import sword04 from '../assets/spirit-sea/sword-04.png';
import sword05 from '../assets/spirit-sea/sword-05.png';
import sword06 from '../assets/spirit-sea/sword-06.png';
import sword07 from '../assets/spirit-sea/sword-07.png';
import sword08 from '../assets/spirit-sea/sword-08.png';

const swordModels = [sword01, sword02, sword03, sword04, sword05, sword06, sword07, sword08];

type SpiritSeaProps = {
  notes: Note[];
  onOpenNote: (id: string) => void;
};

type SwordPlacement = {
  note: Note;
  model: string;
  x: number;
  baseY: number;
  height: number;
  depth: number;
  tilt: number;
  drift: number;
  delay: number;
};

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function placeSword(note: Note): SwordPlacement {
  const seed = hashString(note.id || note.title);
  const random = seededRandom(seed);
  const model = swordModels[Math.floor(random() * swordModels.length)];
  const depth = random();
  // A little overscan at both sides lets foreground swords enter the frame naturally.
  const x = -5 + random() * 110;
  const baseY = 14 + depth * 90 + (random() - .5) * 6;
  const height = 14 + Math.pow(depth, 1.42) * 74 + (random() - .5) * 5;
  return {
    note,
    model,
    x,
    baseY,
    height,
    depth,
    tilt: (random() - .5) * (2.4 - depth * 1.2),
    drift: 7 + random() * 5,
    delay: -random() * 10,
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export default function SpiritSea({ notes, onOpenNote }: SpiritSeaProps) {
  const sceneRef = useRef<HTMLElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const swords = useMemo(() => notes.map(placeSword).sort((a, b) => a.depth - b.depth), [notes]);

  function moveScene(event: PointerEvent<HTMLElement>) {
    const bounds = sceneRef.current?.getBoundingClientRect();
    if (!bounds || event.pointerType === 'touch') return;
    setParallax({
      x: (event.clientX - bounds.left) / bounds.width - .5,
      y: (event.clientY - bounds.top) / bounds.height - .5,
    });
  }

  return <section
    ref={sceneRef}
    className="spirit-sea"
    aria-label="精神识海"
    onPointerMove={moveScene}
    onPointerLeave={() => setParallax({ x: 0, y: 0 })}
    style={{ '--sea-shift-x': parallax.x, '--sea-shift-y': parallax.y } as CSSProperties}
  >
    <div className="spirit-sea-atmosphere" aria-hidden="true"><i/><i/><i/></div>
    <header className="spirit-sea-heading">
      <span className="spirit-sea-kicker"><Sparkles size={13}/> MIND SEA</span>
      <h1>精神识海</h1>
      <p>一念凝成一剑，所记皆有锋芒</p>
      <div><strong>{notes.length}</strong><span>篇笔记<br/>已化灵剑</span></div>
    </header>

    {swords.map((sword, index) => {
      const style = {
        '--sword-x': `${sword.x}%`,
        '--sword-y': `${sword.baseY}%`,
        '--sword-height': `${sword.height}%`,
        '--sword-depth': sword.depth,
        '--sword-tilt': `${sword.tilt}deg`,
        '--sword-drift': `${sword.drift}s`,
        '--sword-delay': `${sword.delay}s`,
        '--sword-z': Math.round(sword.depth * 100) + 10,
        '--sword-index': index,
        '--sword-opacity': .62 + sword.depth * .38,
        '--sword-blur': `${(1 - sword.depth) * .72}px`,
        '--sword-shift-x': `${parallax.x * (5 + sword.depth * 14)}px`,
        '--sword-shift-y': `${parallax.y * (2 + sword.depth * 7)}px`,
      } as CSSProperties;
      return <button
        className="spirit-sword"
        style={style}
        key={sword.note.id}
        onClick={() => onOpenNote(sword.note.id)}
        aria-label={`打开笔记：${sword.note.title}`}
      >
        <span className="spirit-sword-aura" aria-hidden="true"/>
        <img src={sword.model} alt="" draggable={false}/>
        <span className="spirit-sword-label">
          <small>{formatDate(sword.note.updated_at || sword.note.created_at)}</small>
          <strong>{sword.note.title}</strong>
          <em><BookOpen size={11}/> 点击阅览</em>
        </span>
      </button>;
    })}

    {!notes.length && <div className="spirit-sea-empty">
      <span><Sparkles size={24}/></span>
      <h2>识海尚静，灵剑未生</h2>
      <p>每写下一篇笔记，这里便会凝出一柄飞剑。</p>
    </div>}
    <footer className="spirit-sea-legend"><i/><span>每一柄剑，都是一篇正在生长的笔记</span><i/></footer>
  </section>;
}
