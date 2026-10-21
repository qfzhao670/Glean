import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { BookOpen, Moon, Shuffle, Sparkles, Sun } from 'lucide-react';
import type { Note } from '../api';
import { getPreference, setPreference } from '../preferences';
import { getSpiritSwordCount, NOTES_PER_SPIRIT_SWORD, parseSpiritLayoutSeed } from '../spiritSwords';
import sword01 from '../assets/spirit-sea/sword-01.png';
import sword02 from '../assets/spirit-sea/sword-02.png';
import sword03 from '../assets/spirit-sea/sword-03.png';
import sword04 from '../assets/spirit-sea/sword-04.png';
import sword05 from '../assets/spirit-sea/sword-05.png';
import sword06 from '../assets/spirit-sea/sword-06.png';
import sword07 from '../assets/spirit-sea/sword-07.png';
import sword08 from '../assets/spirit-sea/sword-08.png';

const swordModels = [sword01, sword02, sword03, sword04, sword05, sword06, sword07, sword08];
const MIN_VISIBLE_AXIS_RATIO = .5;

type SpiritSeaProps = {
  notes: Note[];
  colorMode: 'light' | 'dark';
  onColorModeToggle: () => void;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function placeSword(note: Note, layoutSeed = 0): SwordPlacement {
  const identity = note.id || note.title;
  const identitySeed = hashString(identity);
  const identityRandom = seededRandom(identitySeed);
  const model = swordModels[Math.floor(identityRandom() * swordModels.length)];
  const random = layoutSeed === 0
    ? identityRandom
    : seededRandom(hashString(`${identity}:${layoutSeed}`));
  const depth = random();
  const x = 5 + random() * 90;
  const rawBaseY = 14 + depth * 90 + (random() - .5) * 6;
  const height = 14 + Math.pow(depth, 1.42) * 74 + (random() - .5) * 5;
  const baseY = clamp(
    rawBaseY,
    height * MIN_VISIBLE_AXIS_RATIO,
    100 + height * (1 - MIN_VISIBLE_AXIS_RATIO),
  );
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

export default function SpiritSea({ notes, colorMode, onColorModeToggle, onOpenNote }: SpiritSeaProps) {
  const sceneRef = useRef<HTMLElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [hoveredSwordId, setHoveredSwordId] = useState<string | null>(null);
  const [layoutSeed, setLayoutSeed] = useState(() => (
    parseSpiritLayoutSeed(getPreference('glean-spirit-layout-seed'))
  ));
  const swordCount = getSpiritSwordCount(notes.length);
  const swords = useMemo(() => (
    notes.slice(0, swordCount).map(note => placeSword(note, layoutSeed)).sort((a, b) => a.depth - b.depth)
  ), [layoutSeed, notes, swordCount]);

  function moveScene(event: PointerEvent<HTMLElement>) {
    const bounds = sceneRef.current?.getBoundingClientRect();
    if (!bounds || event.pointerType === 'touch') return;
    setParallax({
      x: (event.clientX - bounds.left) / bounds.width - .5,
      y: (event.clientY - bounds.top) / bounds.height - .5,
    });
  }

  function reshapeSwords() {
    setHoveredSwordId(null);
    setParallax({ x: 0, y: 0 });
    const nextSeed = layoutSeed === Number.MAX_SAFE_INTEGER ? 1 : layoutSeed + 1;
    setPreference('glean-spirit-layout-seed', String(nextSeed));
    setLayoutSeed(nextSeed);
  }

  return <section
    ref={sceneRef}
    className="spirit-sea"
    aria-label="精神识海"
    onPointerMove={moveScene}
    onPointerLeave={() => {
      setParallax({ x: 0, y: 0 });
      setHoveredSwordId(null);
    }}
    style={{ '--sea-shift-x': parallax.x, '--sea-shift-y': parallax.y } as CSSProperties}
  >
    <div className="spirit-sea-atmosphere" aria-hidden="true"><i/><i/><i/></div>
    {!!swords.length && <button
      className="spirit-reshape-button"
      onClick={reshapeSwords}
      title="随机重塑飞剑分布"
      aria-label="随机重塑飞剑分布"
    >
      <Shuffle size={15}/><span>重塑剑阵</span>
    </button>}
    <button
      className="spirit-theme-toggle"
      onClick={onColorModeToggle}
      title={`切换为${colorMode === 'dark' ? '浅色' : '深色'}模式`}
      aria-label={`切换为${colorMode === 'dark' ? '浅色' : '深色'}模式`}
    >
      {colorMode === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}
    </button>
    <header className="spirit-sea-heading">
      <span className="spirit-sea-kicker"><Sparkles size={13}/> MIND SEA</span>
      <h1>精神识海</h1>
      <p>十念凝成一剑，所记皆有锋芒</p>
      <div><strong>{swordCount}</strong><span>柄飞剑<br/>{notes.length} 篇笔记凝成</span></div>
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
        className={`spirit-sword${hoveredSwordId === sword.note.id ? ' is-hovered' : ''}`}
        style={style}
        key={sword.note.id}
        onClick={() => onOpenNote(sword.note.id)}
        aria-label={`打开笔记：${sword.note.title}`}
      >
        <span className="spirit-sword-aura" aria-hidden="true"/>
        <img src={sword.model} alt="" draggable={false}/>
        <span
          className="spirit-sword-hit"
          aria-hidden="true"
          onPointerEnter={() => setHoveredSwordId(sword.note.id)}
          onPointerLeave={() => setHoveredSwordId((currentId) => (
            currentId === sword.note.id ? null : currentId
          ))}
        />
        <span className="spirit-sword-label">
          <small>{formatDate(sword.note.updated_at || sword.note.created_at)}</small>
          <strong>{sword.note.title}</strong>
          <em><BookOpen size={11}/> 点击阅览</em>
        </span>
      </button>;
    })}

    {!swords.length && <div className="spirit-sea-empty">
      <span><Sparkles size={24}/></span>
      <h2>识海尚静，灵剑未生</h2>
      <p>{notes.length
        ? `再积累 ${NOTES_PER_SPIRIT_SWORD - notes.length} 篇笔记，便会凝出第一柄飞剑。`
        : `每积累 ${NOTES_PER_SPIRIT_SWORD} 篇笔记，这里便会凝出一柄飞剑。`}</p>
    </div>}
    <footer className="spirit-sea-legend"><i/><span>每十篇笔记凝成一柄飞剑，至多十五柄</span><i/></footer>
  </section>;
}
