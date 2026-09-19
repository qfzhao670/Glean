import type { Stats } from '../api';
import bottle from '../assets/spirit-bottle-absorb-v2.webp';
import stillBottle from '../assets/spirit-bottle-cutout-stage.png';

export default function Garden({ stats }: { stats: Stats }) {
  const progress = Math.min(100, Math.max(8, stats.notes * 10 + stats.links * 6));
  return <div className="garden" role="img" aria-label={`天地灵气：${stats.notes} 篇笔记，${stats.links} 个知识连接`}>
    <div className="spirit-vessel-stage" aria-hidden="true">
      <picture className="spirit-bottle">
        <source media="(prefers-reduced-motion: reduce)" srcSet={stillBottle}/>
        <img src={bottle} alt=""/>
      </picture>
    </div>
    <div className="spirit-ripples" aria-hidden="true"><i/><i/><i/></div>
    <div className="spirit-message"><strong>天地灵气汇聚中…</strong><span>让知识的灵气，<br/>滋养你的修行。</span></div>
    <div className="spirit-progress"><div><i style={{ width: `${progress}%` }}/></div><span>{progress}%</span></div>
    <p>每一次理解，都是在淬炼自己。</p>
  </div>;
}
