import { useEffect, useRef, useState } from 'react';
import type { Stats } from '../api';
import scroll from '../assets/spirit-scroll.png';

export default function Garden({ stats }: { stats: Stats }) {
  const [wakeCycle, setWakeCycle] = useState(0);
  const [isAwake, setIsAwake] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const awakenSpirit = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setWakeCycle(value => value + 1);
    setIsAwake(true);
    settleTimer.current = setTimeout(() => setIsAwake(false), 1800);
  };

  return <div className={`garden ${isAwake ? 'is-awake' : ''}`} aria-label={`天地灵气：${stats.notes} 篇笔记，${stats.links} 个知识连接`}>
    <button className="spirit-scroll-trigger" type="button" onClick={awakenSpirit} aria-label="轻触灵卷，唤醒知识灵气" title="轻触灵卷，唤醒灵气">
      <span className="spirit-scroll-motion" key={`scroll-${wakeCycle}`}>
        <img className="spirit-scroll" src={scroll} alt="" draggable="false"/>
      </span>
    </button>
    <div className="spirit-message" aria-live="polite"><strong>{isAwake ? '灵气回应了你' : '天地灵气汇聚中…'}</strong><span>{isAwake ? <>愿今日所学，<br/>都化作生长的力量。</> : <>让知识的灵气，<br/>滋养你的修行。</>}</span></div>
    <p>{isAwake ? '灵气已苏醒，再积累一点新知吧。' : '每一次理解，都是在淬炼自己。'}</p>
  </div>;
}
