import { WeekDate } from '@/types';

export function fmtDate(dt: Date): string {
  return `${dt.getDate()} ${dt.toLocaleString('en', { month: 'short' })}`;
}

// Selectable range: start of the 2025-26 Australian financial year (week
// containing 1 July 2025) through the week containing the end of FY 2026-27.
export const FY_END = new Date(2027, 5, 30);

const RANGE_START = (() => {
  const d = new Date(2025, 6, 1);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
})();

function weekNumInYear(mon: Date): number {
  const jan1 = new Date(mon.getFullYear(), 0, 1);
  const firstMon = new Date(mon.getFullYear(), 0, 1 + ((8 - jan1.getDay()) % 7));
  return Math.round((mon.getTime() - firstMon.getTime()) / 604800000) + 1;
}

function buildWeeks(): WeekDate[] {
  const weeks: WeekDate[] = [];
  for (const d = new Date(RANGE_START); d <= FY_END; d.setDate(d.getDate() + 7)) {
    const start = new Date(d);
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    const num = weekNumInYear(start);
    weeks.push({
      num,
      start,
      end,
      label: `W${num} '${String(start.getFullYear()).slice(2)}: ${fmtDate(start)} - ${fmtDate(end)}`,
    });
  }
  return weeks;
}

export const allWeeks = buildWeeks();

// Indices saved before the range was extended back to FY25-26 were relative to
// 5 Jan 2026; persisted state from those versions is shifted by this offset.
export const LEGACY_WEEK_OFFSET = allWeeks.findIndex(
  w => w.start.getTime() === new Date(2026, 0, 5).getTime(),
);

// Default projection end: last week of calendar 2026.
export const default2026EndIdx = (() => {
  for (let i = allWeeks.length - 1; i >= 0; i--) {
    if (allWeeks[i].start.getFullYear() === 2026) return i;
  }
  return allWeeks.length - 1;
})();

export function getCurrentWeekIdx(): number {
  const now = new Date();
  for (let i = 0; i < allWeeks.length; i++) {
    if (now >= allWeeks[i].start && now <= allWeeks[i].end) return i;
    if (now < allWeeks[i].start) return Math.max(0, i - 1);
  }
  return allWeeks.length - 1;
}
