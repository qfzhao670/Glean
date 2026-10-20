export type ActivityCalendarDay = {
  date: string;
  in_range: boolean;
};

export type ActivityMonthBand = {
  key: string;
  label: string;
  start: number;
  span: number;
};

export function buildActivityMonthBands(activity: ActivityCalendarDay[]): ActivityMonthBand[] {
  const weeks = Math.ceil(activity.length / 7);
  const weekMonths = Array.from({ length: weeks }, (_, weekIndex) => {
    const visibleDays = activity.slice(weekIndex * 7, weekIndex * 7 + 7).filter(day => day.in_range);
    if (!visibleDays.length) return null;
    const representativeDay = visibleDays[Math.floor(visibleDays.length / 2)];
    return representativeDay.date.slice(0, 7);
  });

  return weekMonths.reduce<ActivityMonthBand[]>((bands, key, weekIndex) => {
    if (!key) return bands;
    const previous = bands.at(-1);
    if (previous?.key === key && previous.start + previous.span === weekIndex) {
      previous.span += 1;
      return bands;
    }
    bands.push({ key, label: `${Number(key.slice(5, 7))}月`, start: weekIndex, span: 1 });
    return bands;
  }, []);
}
