import type { Stats } from '../api';

export default function ActivityChart({ activity }: { activity: Stats['activity'] }) {
  const weeks = Math.ceil(activity.length / 7);
  const months = Array.from({ length: weeks }, (_, i) => {
    const days = activity.slice(i * 7, i * 7 + 7).filter(day => day.in_range);
    const first = days.find(day => day.date.endsWith('-01')) || (i === 0 ? days[0] : null);
    return first ? `${Number(first.date.slice(5, 7))}月` : '';
  });
  return <div className="activity-calendar" aria-label="最近半年的学习足迹">
    <div className="activity-months" style={{ gridTemplateColumns: `repeat(${weeks || 27}, minmax(0, 1fr))` }}>{months.map((month, index) => <span key={index}>{month}</span>)}</div>
    <div className="activity-chart"><div className="activity-weekdays"><span>一</span><span>三</span><span>五</span><span>日</span></div>
      <div className="heatmap" style={{ gridTemplateColumns: `repeat(${weeks || 27}, minmax(0, 1fr))` }}>{activity.map(day => <div key={day.date} className={`heat-cell ${day.in_range ? `level-${Math.min(day.count, 4)}` : 'outside-range'}`} title={day.in_range ? `${day.date} · ${day.count} 次积累` : undefined} aria-label={day.in_range ? `${day.date} ${day.count} 次积累` : undefined} aria-hidden={!day.in_range}/>)}</div>
    </div>
  </div>;
}
