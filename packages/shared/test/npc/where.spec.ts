import { describe, expect, it } from 'vitest';
import type { ScheduleBlock } from '../../src/contracts/c10-npc.ts';
import { HALF_SECONDS_PER_DAY, HALF_SECONDS_PER_HOUR } from '../../src/npc/schedule.ts';
import { pointAlong, whereIs, type Vec3 } from '../../src/npc/where.ts';

const HOME = 'poi.mission.24th-st.apt-ro';
const SHOP = 'poi.mission.shop-batista';
const BAR = 'poi.soma.coffee-cart-4th';
const pois: Record<string, Vec3> = { [HOME]: [0, 0, 0], [SHOP]: [100, 0, 0], [BAR]: [100, 0, 100] };
const poi = (id: string): Vec3 | null => pois[id] ?? null;

const block = (from: string, to: string, activity: ScheduleBlock['activity'], place: string): ScheduleBlock =>
  ({ days: 'daily', from, to, activity, place, interruptible: true, priority: 5 });

// Sleep at home across midnight (22:00 to 06:00), a commute to the shop 06:00 to 07:00, work to 18:00, a commute to the bar to 19:00,
// socialize to 22:00.
const soul = {
  schedule: [
    block('22:00', '06:00', 'sleep', HOME),
    block('06:00', '07:00', 'commute', SHOP),
    block('07:00', '18:00', 'work', SHOP),
    block('18:00', '19:00', 'commute', BAR),
    block('19:00', '22:00', 'socialize', BAR),
  ],
};
const at = (h: number, m = 0): number => h * HALF_SECONDS_PER_HOUR + m * 120;

describe('whereIs (AC-2)', () => {
  it('answers the block POI outside a commute, across midnight', () => {
    for (const t of [at(23, 30), at(0, 10), at(5, 59)]) {
      const r = whereIs(soul, t, poi);
      expect(r.pos).toEqual(pois[HOME]);
      expect(r.activity).toBe('sleep');
      expect(r.commute).toBeNull();
    }
    expect(whereIs(soul, at(12), poi).pos).toEqual(pois[SHOP]);
    expect(whereIs(soul, at(20), poi).pos).toEqual(pois[BAR]);
  });

  it('is the previous POI at the start of a commute and the destination at its end', () => {
    expect(whereIs(soul, at(6), poi).pos).toEqual(pois[HOME]);
    const end = whereIs(soul, at(7) - 1, poi);
    expect(end.activity).toBe('commute');
    expect(end.pos[0]).toBeGreaterThan(99.9);
    expect(whereIs(soul, at(7), poi).pos).toEqual(pois[SHOP]);
  });

  it('interpolates along the straight line mid-commute', () => {
    const r = whereIs(soul, at(6, 30), poi);
    expect(r.activity).toBe('commute');
    expect(r.pos[0]).toBeCloseTo(50, 6);
    expect(r.pos[2]).toBeCloseTo(0, 6);
    expect(r.commute).toEqual({ from: HOME, to: SHOP, t: 0.5 });
  });

  it('follows the pedestrian route by arc length when one is given', () => {
    const route = (): Vec3[] => [[0, 0, 0], [0, 0, 50], [100, 0, 50], [100, 0, 0]];
    // total length 50 + 100 + 50 = 200; half way is the middle of the long leg
    const r = whereIs(soul, at(6, 30), poi, route);
    expect(r.pos[0]).toBeCloseTo(50, 6);
    expect(r.pos[2]).toBeCloseTo(50, 6);
    // a route with fewer than two points is ignored
    expect(whereIs(soul, at(6, 30), poi, () => []).pos[0]).toBeCloseTo(50, 6);
  });

  it('commutes across midnight', () => {
    const night = {
      schedule: [block('08:00', '23:30', 'work', SHOP), block('23:30', '00:30', 'commute', HOME), block('00:30', '08:00', 'sleep', HOME)],
    };
    // 00:00 is half way through a commute that started at 23:30 the day before
    const r = whereIs(night, HALF_SECONDS_PER_DAY * 3, poi);
    expect(r.activity).toBe('commute');
    expect(r.pos[0]).toBeCloseTo(50, 6);
    expect(r.commute?.t).toBeCloseTo(0.5, 6);
    const r2 = whereIs(night, HALF_SECONDS_PER_DAY * 3 - 30 * 120 + 1, poi);
    expect(r2.activity).toBe('commute');
    expect(r2.pos[0]).toBeCloseTo(100, 1);
  });

  it('survives a POI the world cannot place', () => {
    const r = whereIs(soul, at(6, 30), (id) => (id === SHOP ? null : poi(id)));
    expect(r.pos).toEqual(pois[HOME]);
    expect(whereIs(soul, at(12), () => null).pos).toEqual([0, 0, 0]);
  });

  it('pointAlong clamps and handles degenerate paths', () => {
    expect(pointAlong([], 0.5)).toEqual([0, 0, 0]);
    expect(pointAlong([[1, 2, 3]], 0.5)).toEqual([1, 2, 3]);
    expect(pointAlong([[0, 0, 0], [0, 0, 0]], 0.5)).toEqual([0, 0, 0]);
    expect(pointAlong([[0, 0, 0], [10, 0, 0]], 2)).toEqual([10, 0, 0]);
    expect(pointAlong([[0, 0, 0], [10, 0, 0]], -1)).toEqual([0, 0, 0]);
  });
});
