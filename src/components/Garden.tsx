import type { Stats } from '../api';
import bottle from '../assets/spirit-bottle.png';

export default function Garden({ stats }: { stats: Stats }) {
  const progress = Math.min(100, Math.max(8, stats.notes * 10 + stats.links * 6));
  return <div className="garden" role="img" aria-label={`天地灵气：${stats.notes} 篇笔记，${stats.links} 个知识连接`}>
    <img className="spirit-bottle" src={bottle} alt="一只汇聚知识灵气的青绿色玉瓶"/>
    <div className="spirit-message"><strong>天地灵气汇聚中…</strong><span>让知识的灵气，<br/>滋养你的修行。</span></div>
    <div className="spirit-progress"><div><i style={{ width: `${progress}%` }}/></div><span>{progress}%</span></div>
    <p>每一次理解，都是在淬炼自己。</p>
  </div>;
}
