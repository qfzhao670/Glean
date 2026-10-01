import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Stats } from '../api';
import bottle from '../assets/spirit-bottle.png';

const spiritParticles = [
  { x: '-96px', y: '-52px', r: '-34deg', delay: '0ms' },
  { x: '-72px', y: '-104px', r: '24deg', delay: '35ms' },
  { x: '-24px', y: '-122px', r: '-18deg', delay: '80ms' },
  { x: '34px', y: '-118px', r: '38deg', delay: '20ms' },
  { x: '83px', y: '-84px', r: '-28deg', delay: '95ms' },
  { x: '108px', y: '-34px', r: '42deg', delay: '45ms' },
  { x: '92px', y: '40px', r: '-22deg', delay: '110ms' },
  { x: '38px', y: '70px', r: '30deg', delay: '65ms' },
  { x: '-48px', y: '66px', r: '-40deg', delay: '125ms' },
  { x: '-106px', y: '22px', r: '20deg', delay: '55ms' },
];

export default function Garden({ stats }: { stats: Stats }) {
  const progress = Math.min(100, Math.max(8, stats.notes * 10 + stats.links * 6));
  const [burst, setBurst] = useState(0);
  const [isAwake, setIsAwake] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const awakenSpirit = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setBurst(value => value + 1);
    setIsAwake(true);
    settleTimer.current = setTimeout(() => setIsAwake(false), 1800);
  };

  return <div className={`garden ${isAwake ? 'is-awake' : ''}`} aria-label={`天地灵气：${stats.notes} 篇笔记，${stats.links} 个知识连接`}>
    <button className="spirit-bottle-trigger" type="button" onClick={awakenSpirit} aria-label="轻触玉瓶，唤醒知识灵气" title="轻触玉瓶，唤醒灵气">
      <span className="spirit-bottle-motion" key={`bottle-${burst}`}>
        <img className="spirit-bottle" src={bottle} alt="" draggable="false"/>
      </span>
      {burst > 0 && <span className="spirit-burst" key={`burst-${burst}`} aria-hidden="true">
        <b className="spirit-ring ring-one"/><b className="spirit-ring ring-two"/>
        {spiritParticles.map((particle, index) => <i
          className={index % 3 === 0 ? 'spirit-leaf' : 'spirit-spark'}
          key={index}
          style={{ '--x': particle.x, '--y': particle.y, '--r': particle.r, '--delay': particle.delay } as CSSProperties}
        />)}
      </span>}
    </button>
    <div className="spirit-message" aria-live="polite"><strong>{isAwake ? '灵气回应了你' : '天地灵气汇聚中…'}</strong><span>{isAwake ? <>愿今日所学，<br/>都化作生长的力量。</> : <>让知识的灵气，<br/>滋养你的修行。</>}</span></div>
    <div className="spirit-progress" role="progressbar" aria-label="知识灵气" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div><i style={{ width: `${progress}%` }}/></div><span>{progress}%</span></div>
    <p>{isAwake ? '灵气已苏醒，再积累一点新知吧。' : '每一次理解，都是在淬炼自己。'}</p>
  </div>;
}
