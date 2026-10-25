/**
 * NPC schedule evaluation (C10 ScheduleBlock, C06 clock). Pure integer maths.
 * One game hour is 7,200 C06 half-seconds, one day 172,800, the weekday is floor(t / 172800) % 7 with 0 = Monday.
 */
import type { CompiledSoulPublic, ScheduleBlock, Weekday } from '../contracts/c10-npc.ts';

export const HALF_SECONDS_PER_MINUTE = 120;
export const HALF_SECONDS_PER_HOUR = 7200;
export const HALF_SECONDS_PER_DAY = 172800;
export const MINUTES_PER_DAY = 1440;

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Weekday index of a clock value: 0 = Monday. */
export const weekdayOf = (clockT: number): number => Math.floor(Math.max(0, clockT) / HALF_SECONDS_PER_DAY) % 7;

/** Minute of the game day, 0..1439. */
export const minuteOfDay = (clockT: number): number =>
  Math.floor((Math.max(0, Math.floor(clockT)) % HALF_SECONDS_PER_DAY) / HALF_SECONDS_PER_MINUTE);

/** 'HH:MM' to minutes; '24:00' is 1440. Returns -1 for anything else. */
export function parseClock(hhmm: string): number {
  const m = /^([01][0-9]|2[0-3]|24):([0-5][0-9])$/.exec(hhmm);
  if (!m) return -1;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins > MINUTES_PER_DAY ? -1 : mins;
}

export const formatClock = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
};

/** Weekday indices a block applies to. */
export function blockDays(days: ScheduleBlock['days']): number[] {
  if (days === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (days === 'weekdays') return [0, 1, 2, 3, 4];
  if (days === 'weekends') return [5, 6];
  const out: number[] = [];
  for (const d of days) {
    const i = WEEKDAYS.indexOf(d);
    if (i >= 0 && !out.includes(i)) out.push(i);
  }
  return out;
}

export interface DayInterval { from: number; to: number; index: number }

/**
 * Per-weekday minute intervals [from, to) of every block. A block whose end is before its start (for example 22:00 to
 * 06:00) covers the rest of its day and the beginning of the next one. Intervals of one weekday are sorted by start.
 */
export function dayIntervals(schedule: readonly ScheduleBlock[]): DayInterval[][] {
  const days: DayInterval[][] = [[], [], [], [], [], [], []];
  schedule.forEach((b, index) => {
    const from = parseClock(b.from);
    const to = parseClock(b.to);
    if (from < 0 || to < 0 || from === to || from >= MINUTES_PER_DAY) return;
    for (const d of blockDays(b.days)) {
      if (from < to) days[d]?.push({ from, to, index });
      else {
        days[d]?.push({ from, to: MINUTES_PER_DAY, index });
        if (to > 0) days[(d + 1) % 7]?.push({ from: 0, to, index });
      }
    }
  });
  for (const list of days) list.sort((a, b) => a.from - b.from || a.index - b.index);
  return days;
}

/** Intervals by schedule array: souls are immutable once compiled, and `scheduleAt` runs every brain step (M06c). */
const intervalCache = new WeakMap<readonly ScheduleBlock[], DayInterval[][]>();
function intervalsOf(schedule: readonly ScheduleBlock[]): DayInterval[][] {
  let v = intervalCache.get(schedule);
  if (v === undefined) {
    v = dayIntervals(schedule);
    intervalCache.set(schedule, v);
  }
  return v;
}

/**
 * The schedule block active at `clockT`. When blocks overlap (the lint forbids it) the higher priority wins, then the
 * lower index; when nothing covers the minute the first block is returned.
 */
export function scheduleAt(s: Pick<CompiledSoulPublic, 'schedule'>, clockT: number): { index: number; block: ScheduleBlock } {
  const first = s.schedule[0];
  if (!first) throw new Error('scheduleAt: the soul has no schedule');
  const minute = minuteOfDay(clockT);
  const list = intervalsOf(s.schedule)[weekdayOf(clockT)] ?? [];
  let best = -1;
  for (const iv of list) {
    if (minute < iv.from || minute >= iv.to) continue;
    if (best < 0 || (s.schedule[iv.index]?.priority ?? 0) > (s.schedule[best]?.priority ?? 0)) best = iv.index;
  }
  const index = best >= 0 ? best : 0;
  return { index, block: s.schedule[index] ?? first };
}
