import { useRef, useState, type MouseEvent } from 'react';
import type { Stats } from '../api';

export default function ActivityChart({ activity }: { activity: Stats['activity'] }) {
  const calendarRef = useRef<HTMLDivElement>(null);
  const [hoveredDay, setHoveredDay] = useState<{ day: Stats['activity'][number]; left: number; top: number } | null>(null);
  const weeks = Math.ceil(activity.length / 7);
  const months = Array.from({ length: weeks }, (_, i) => {
    const days = activity.slice(i * 7, i * 7 + 7).filter(day => day.in_range);
    const first = days.find(day => day.date.endsWith('-01')) || (i === 0 ? days[0] : null);
    return first ? `${Number(first.date.slice(5, 7))}月` : '';
  });
  const showTooltip = (day: Stats['activity'][number], event: MouseEvent<HTMLDivElement>) => {
    const calendar = calendarRef.current?.getBoundingClientRect();
    if (!calendar) return;
    const cell = event.currentTarget.getBoundingClientRect();
    const tooltipHalfWidth = 78;
    const cellCenter = cell.left - calendar.left + cell.width / 2;
    setHoveredDay({
      day,
      left: Math.max(tooltipHalfWidth, Math.min(calendar.width - tooltipHalfWidth, cellCenter)),
      top: cell.top - calendar.top - 7,
    });
  };
  return <div ref={calendarRef} className="activity-calendar" aria-label="最近半年的学习足迹">
    {hoveredDay && <div className="activity-tooltip" role="status" style={{ left: hoveredDay.left, top: hoveredDay.top }}>{Number(hoveredDay.day.date.slice(5, 7))}月{Number(hoveredDay.day.date.slice(8, 10))}日 · 沉淀 <strong>{hoveredDay.day.count}</strong> 篇笔记</div>}
    <div className="activity-months" style={{ gridTemplateColumns: `repeat(${weeks || 27}, minmax(0, 1fr))` }}>{months.map((month, index) => <span key={index}>{month}</span>)}</div>
    <div className="activity-chart"><div className="activity-weekdays"><span>一</span><span>三</span><span>五</span><span>日</span></div>
      <div className="heatmap" style={{ gridTemplateColumns: `repeat(${weeks || 27}, minmax(0, 1fr))` }}>{activity.map(day => <div key={day.date} className={`heat-cell ${day.in_range ? `level-${Math.min(day.count, 4)}` : 'outside-range'}`} aria-label={day.in_range ? `${day.date} 沉淀 ${day.count} 篇笔记` : undefined} aria-hidden={!day.in_range} onMouseEnter={event => day.in_range && showTooltip(day, event)} onMouseLeave={() => setHoveredDay(null)}/>)}</div>
    </div>
  </div>;
}
