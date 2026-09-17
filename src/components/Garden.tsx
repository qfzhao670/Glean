import { useState } from 'react';
import { ArrowUpRight, Sprout } from 'lucide-react';
import type { Stats } from '../api';

export default function Garden({ stats, onNote }: { stats: Stats; onNote: (id: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const count = Math.min(stats.notes, 36);
  const nodes = Array.from({ length: count }, (_, i) => {
    const angle = i * 2.39996;
    const radius = 27 + Math.sqrt(i + 1) * 23;
    return { x: 250 + Math.cos(angle) * radius, y: 228 + Math.sin(angle) * radius * .72, ...stats.graph[i] };
  });
  const title = hovered ? stats.graph.find(n => n.id === hovered)?.title : stats.notes ? '每一次理解，都在悄悄生长' : '一颗种子，等待你的第一份好奇';
  return <div className="garden">
    <div className="garden-label"><span className="status-dot" /> 我的知识植物 <span className="garden-phase">{stats.notes < 1 ? '待萌芽' : stats.notes < 8 ? '萌芽期' : stats.notes < 24 ? '生长期' : '丰茂期'}</span></div>
    <svg className="plant" viewBox="0 0 500 480" role="img" aria-label={`知识植物：${stats.notes} 篇笔记，${stats.links} 个知识链接`}>
      <defs>
        <radialGradient id="atmosphere"><stop offset="0" stopColor="#dce8d9" stopOpacity=".7"/><stop offset="1" stopColor="#e8eee7" stopOpacity="0"/></radialGradient>
        <linearGradient id="leaf" x1="0" y1="1" x2="1" y2="0"><stop stopColor="#3d6651"/><stop offset=".6" stopColor="#9bb49a"/><stop offset="1" stopColor="#d4ddc4"/></linearGradient>
        <linearGradient id="stem" x1="0" x2="1"><stop stopColor="#365743"/><stop offset="1" stopColor="#94a789"/></linearGradient>
        <filter id="soft"><feGaussianBlur stdDeviation="10"/></filter>
      </defs>
      <circle cx="250" cy="245" r="218" fill="url(#atmosphere)"/>
      <g className="orbit-lines" fill="none" stroke="#78957b" strokeWidth=".6" opacity=".18">
        <ellipse cx="250" cy="278" rx="211" ry="76" transform="rotate(-24 250 278)"/>
        <ellipse cx="250" cy="278" rx="211" ry="76" transform="rotate(24 250 278)"/>
        <circle cx="250" cy="260" r="186" strokeDasharray="2 9"/>
      </g>
      <ellipse cx="250" cy="407" rx="82" ry="12" fill="#748d65" opacity=".13" filter="url(#soft)"/>
      <g className="plant-body">
        {stats.notes > 0 ? <><path d="M250 399 C248 360 256 326 248 287 C242 257 253 231 250 209" fill="none" stroke="url(#stem)" strokeWidth="3" strokeLinecap="round"/>
        <path d="M250 361 C231 352 202 324 191 310 M250 329 C270 313 302 283 312 267" fill="none" stroke="#789176" strokeWidth="1.5"/>
        <path d="M247 351 C195 356 158 321 164 281 C202 278 242 308 247 351Z" fill="url(#leaf)" opacity=".95"/>
        <path d="M253 322 C256 274 302 244 338 256 C325 292 292 322 253 322Z" fill="url(#leaf)"/>
        <path d="M250 281 C215 261 210 226 229 199 C255 216 266 249 250 281Z" fill="url(#leaf)" opacity=".88"/>
        <path d="M250 214 C247 184 266 163 284 159 C289 185 273 205 250 214Z" fill="url(#leaf)" opacity=".8"/>
        <g stroke="#edf2df" fill="none" strokeWidth=".8" opacity=".5"><path d="M242 346 Q194 325 169 287 M256 317 Q295 284 332 261 M249 274 Q234 234 230 206 M252 209 L281 165"/></g>
        </> : <g transform="translate(-200 -320) scale(1.8)"><ellipse cx="250" cy="393" rx="8" ry="12" fill="url(#leaf)" transform="rotate(-25 250 393)"/><path d="M249 396 Q242 369 256 351" stroke="#8fa37e" strokeWidth="1.5" fill="none"/><path d="M249 374 Q229 374 231 359 Q247 357 249 374Z" fill="url(#leaf)"/><path d="M251 364 Q250 346 266 344 Q269 357 251 364Z" fill="url(#leaf)"/></g>}
        {nodes.map((node, i) => <g key={node.id} className="knowledge-node" onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onClick={() => onNote(node.id)} onKeyDown={e => e.key === 'Enter' && onNote(node.id)} tabIndex={0} role="button" aria-label={`打开笔记：${node.title}`}>
          <path d={`M250 ${300 - i % 4 * 20} Q${250 + (node.x - 250) * .25} ${node.y + 15} ${node.x} ${node.y}`} stroke="#8da88b" strokeWidth=".7" opacity=".4" fill="none"/>
          <circle cx={node.x} cy={node.y} r="13" fill="transparent"/><circle cx={node.x} cy={node.y} r={hovered === node.id ? 5 : 3.5} fill={i % 4 === 0 ? '#b59758' : '#618166'} />
        </g>)}
        {stats.links > 0 && nodes.slice(0, 20).map((n, i) => n.links.slice(0, 5).map(link => { const other = nodes.find(node => node.title === link); return other ? <path key={`${i}-${link}`} d={`M${n.x} ${n.y} Q250 150 ${other.x} ${other.y}`} stroke="#b69c61" strokeWidth=".7" fill="none" opacity=".45"/> : null; }))}
      </g>
      <g stroke="#a3af98" strokeWidth=".8" fill="none" opacity=".6"><path d="M250 402 C238 415 226 413 220 421 M250 402 C259 418 271 412 282 425 M250 402 L248 427"/><ellipse cx="250" cy="401" rx="45" ry="7"/></g>
      <g className="floating-seed" fill="#b99e65"><circle cx="148" cy="208" r="2"/><circle cx="340" cy="192" r="1.7"/><circle cx="306" cy="116" r="1.3"/></g>
    </svg>
    <div className="garden-caption"><Sprout size={15}/><span>{title}</span>{hovered && <ArrowUpRight size={14}/>}</div>
    <div className="garden-scale"><span>一叶一知</span><div/><span>持续生长</span></div>
  </div>;
}
