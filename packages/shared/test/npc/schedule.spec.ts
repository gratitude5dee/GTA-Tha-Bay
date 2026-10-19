import { describe, expect, it } from 'vitest';
import type { ScheduleBlock } from '../../src/contracts/c10-npc.ts';
import {
  HALF_SECONDS_PER_DAY, HALF_SECONDS_PER_HOUR, MINUTES_PER_DAY, blockDays, dayIntervals, formatClock, minuteOfDay, parseClock, scheduleAt, weekdayOf,
} from '../../src/npc/schedule.ts';

const block = (days: ScheduleBlock['days'], from: string, to: string, activity: ScheduleBlock['activity'], priority = 5): ScheduleBlock =>
  ({ days, from, to, activity, place: 'poi.mission.shop-batista', interruptible: true, priority });

// A schedule that wraps midnight on Sunday: the race block runs Sunday 20:00 to Monday 04:00.
const schedule: ScheduleBlock[] = [
  block('daily', '04:00', '20:00', 'work'),                                  // 0
  block(['sun'], '20:00', '04:00', 'race', 6),                              // 1 (wraps into Monday)
  block(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], '20:00', '24:00', 'socialize'), // 2
  block(['tue', 'wed', 'thu', 'fri', 'sat', 'sun'], '00:00', '04:00', 'sleep', 9),   // 3
];

describe('scheduleAt (AC-4)', () => {
  const soul = { schedule };
  const week = 7 * HALF_SECONDS_PER_DAY;

  it('uses weekday = floor(t / 172800) % 7 with 0 = Monday', () => {
    expect(HALF_SECONDS_PER_HOUR * 24 * 7).toBe(week);
    for (const t of [0, 1, HALF_SECONDS_PER_DAY - 1, HALF_SECONDS_PER_DAY, 6 * HALF_SECONDS_PER_DAY, week - 1, week, week + HALF_SECONDS_PER_DAY * 3]) {
      expect(weekdayOf(t)).toBe(Math.floor(t / 172800) % 7);
    }
    expect(weekdayOf(0)).toBe(0);
    expect(weekdayOf(week - 1)).toBe(6);
    expect(weekdayOf(week)).toBe(0);
  });

  it('returns the wrapped Sunday block at t = 0, the late Sunday block at the last half-second, and Monday again one week on', () => {
    expect(scheduleAt(soul, 0)).toMatchObject({ index: 1, block: { activity: 'race' } });           // Monday 00:00 is the tail of Sunday's race
    expect(scheduleAt(soul, week - 1)).toMatchObject({ index: 1, block: { activity: 'race' } });    // Sunday 23:59:59.5
    expect(scheduleAt(soul, week)).toMatchObject({ index: 1, block: { activity: 'race' } });        // Monday 00:00 again
    expect(weekdayOf(week - 1)).toBe(6);
  });

  it('picks blocks across a normal week', () => {
    const at = (day: number, hh: number, mm = 0): number => day * HALF_SECONDS_PER_DAY + hh * HALF_SECONDS_PER_HOUR + mm * 120;
    expect(scheduleAt(soul, at(0, 3, 59)).index).toBe(1);   // Monday 03:59 still race
    expect(scheduleAt(soul, at(0, 4)).index).toBe(0);       // Monday 04:00 work
    expect(scheduleAt(soul, at(0, 21)).index).toBe(2);      // Monday evening
    expect(scheduleAt(soul, at(1, 1)).index).toBe(3);       // Tuesday 01:00 sleep
    expect(scheduleAt(soul, at(6, 12)).index).toBe(0);      // Sunday noon
    expect(scheduleAt(soul, at(6, 20)).index).toBe(1);      // Sunday 20:00 race starts
    expect(scheduleAt(soul, at(6, 3)).index).toBe(3);       // Sunday 03:00 sleep
  });

  it('covers 24 hours on every weekday without overlap', () => {
    for (const list of dayIntervals(schedule)) {
      let cursor = 0;
      for (const iv of list) {
        expect(iv.from).toBe(cursor);
        cursor = iv.to;
      }
      expect(cursor).toBe(MINUTES_PER_DAY);
    }
  });

  it('prefers the higher priority when blocks overlap, and falls back to block 0 in a gap', () => {
    const overlap = { schedule: [block('daily', '00:00', '24:00', 'idle', 1), block('daily', '10:00', '12:00', 'work', 8)] };
    expect(scheduleAt(overlap, 11 * HALF_SECONDS_PER_HOUR).index).toBe(1);
    const gap = { schedule: [block('daily', '08:00', '09:00', 'work')] };
    expect(scheduleAt(gap, 0).index).toBe(0);
    expect(() => scheduleAt({ schedule: [] }, 0)).toThrow();
  });

  it('clamps negative clocks to zero', () => {
    expect(scheduleAt(soul, -5).index).toBe(scheduleAt(soul, 0).index);
    expect(minuteOfDay(-1)).toBe(0);
  });
});

describe('clock helpers', () => {
  it('parses and formats HH:MM', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(1439);
    expect(parseClock('24:00')).toBe(1440);
    expect(parseClock('24:01')).toBe(-1);
    expect(parseClock('7:00')).toBe(-1);
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(1439)).toBe('23:59');
    expect(minuteOfDay(HALF_SECONDS_PER_HOUR * 13 + 120 * 5)).toBe(13 * 60 + 5);
  });
  it('resolves day sets', () => {
    expect(blockDays('daily')).toHaveLength(7);
    expect(blockDays('weekdays')).toEqual([0, 1, 2, 3, 4]);
    expect(blockDays('weekends')).toEqual([5, 6]);
    expect(blockDays(['sat', 'mon', 'sat'])).toEqual([5, 0]);
  });
});
