import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityMonthBands } from '../src/activityMonths.ts';

function calendarDays(start, end, visibleStart, visibleEnd) {
  const days = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10);
    days.push({ date, in_range: date >= visibleStart && date <= visibleEnd });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

test('month labels occupy non-overlapping week bands near a month boundary', () => {
  const activity = calendarDays('2026-04-20', '2026-10-25', '2026-04-21', '2026-10-21');
  const bands = buildActivityMonthBands(activity);

  assert.deepEqual(bands.map(band => band.label), ['4月', '5月', '6月', '7月', '8月', '9月', '10月']);
  assert.deepEqual(bands[0], { key: '2026-04', label: '4月', start: 0, span: 2 });
  assert.equal(bands.reduce((weeks, band) => weeks + band.span, 0), activity.length / 7);
  bands.slice(1).forEach((band, index) => {
    const previous = bands[index];
    assert.equal(band.start, previous.start + previous.span);
  });
});

test('month bands stay distinct across a year boundary', () => {
  const activity = calendarDays('2025-11-17', '2026-02-22', '2025-11-20', '2026-02-18');
  const bands = buildActivityMonthBands(activity);

  assert.deepEqual(bands.map(band => band.key), ['2025-11', '2025-12', '2026-01', '2026-02']);
});
