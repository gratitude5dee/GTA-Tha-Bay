/**
 * M08b1 AC-7 (FC10.4): the four CPU levels. 200 mirrored bouts per pair of levels (each kit pair twice, the levels swapping sides),
 * execution error by level, habit variety 3 / 5 / 8 / 12, and every action a `FighterInput` word.
 */
import { FM, hashBuffer } from '@dv/shared/fight';
import type { FighterSlotId } from '@dv/shared/fight';
import { describe, expect, it } from 'vitest';
import { KitCache, playBout } from '../src/sim/balance.ts';
import { CpuDriver, CPU_LEVELS } from '../src/sim/cpu/index.ts';
import type { CpuLevel } from '../src/types.ts';
import { FighterMatch } from '../src/sim/match.ts';
import { BALANCE_RULES } from '../src/sim/balance.ts';
import { pack } from './helpers.ts';

const cache = new KitCache(pack);
const SLOTS: FighterSlotId[] = ['RAP_HYPHY_ELDER', 'RAP_LYRICIST', 'RAP_NEW_WAVE', 'TECH_VISIONARY', 'TECH_HACKER', 'ATH_SHOOTER', 'ATH_POWER_BACK', 'INFLUENCER'];

/** Win rate (%) of level `hi` over level `lo` in `n` bouts, half of them with the sides swapped (mirrored). */
function rate(hi: CpuLevel, lo: CpuLevel, n: number): number {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const slot = SLOTS[i % SLOTS.length] as FighterSlotId;
    const hiLeft = i % 2 === 0;
    const r = playBout(cache, slot, slot, 7000 + i, { levels: hiLeft ? [hi, lo] : [lo, hi], ids: ['a', 'b'] });
    if (r.winner >= 0 && (r.winner === 0) === hiLeft) wins++;
    else if (r.winner < 0) wins += 0.5;
  }
  return (100 * wins) / n;
}

describe('levels beat each other in order', () => {
  it('Hard beats Easy at least 70 % of 200 mirrored bouts', () => {
    const r = rate(2, 0, 200);
    console.log(`Hard over Easy: ${r} %`);
    expect(r).toBeGreaterThanOrEqual(70);
  }, 240_000);
  it('Brutal beats Easy, Normal beats Easy, Brutal beats Normal', () => {
    for (const [hi, lo] of [[3, 0], [1, 0], [3, 1]] as [CpuLevel, CpuLevel][]) {
      const r = rate(hi, lo, 200);
      console.log(`${CPU_LEVELS[hi].name} over ${CPU_LEVELS[lo].name}: ${r} %`);
      expect(r, `${hi} over ${lo}`).toBeGreaterThan(55);
    }
  }, 480_000);
});

describe('execution error and habit variety', () => {
  function play(level: CpuLevel, bouts: number): { starts: number; errors: number; outside: string[]; maxDistinct: number; enabled: number } {
    let starts = 0, errors = 0, enabled = 0, maxDistinct = 0;
    const outside: string[] = [];
    for (let i = 0; i < bouts; i++) {
      const a = SLOTS[i % SLOTS.length] as FighterSlotId, b = SLOTS[(i + 3) % SLOTS.length] as FighterSlotId;
      const ka = cache.get(a), kb = cache.get(b);
      const m = new FighterMatch({
        pack, rules: { ...BALANCE_RULES, cpuLevel: [level, level] }, seed: 500 + i, stage: 'powell_turntable',
        lineup: [{ slot: a, fighterId: 'a', scheme: 'classic', costume: 0 }, { slot: b, fighterId: 'b', scheme: 'classic', costume: 0 }],
      });
      const d0 = new CpuDriver({ slot: 0, level, seed: i * 2 + 1, kit: ka, oppKit: kb });
      const d1 = new CpuDriver({ slot: 1, level, seed: i * 2 + 2, kit: kb, oppKit: ka });
      for (let t = 0; t < 9000 && !m.ended; t++) m.step(d0.input(m.buf, m.tick), d1.input(m.buf, m.tick));
      for (const d of [d0, d1]) {
        const s = d.execStats();
        starts += s.starts; errors += s.errors;
        for (const h of d.habitCounts.keys()) if (!d.habits.has(h)) outside.push(h);
        maxDistinct = Math.max(maxDistinct, d.habitCounts.size);
        enabled = d.habits.size;
      }
    }
    return { starts, errors, outside, maxDistinct, enabled };
  }

  it('Brutal makes no execution error and Easy 20 % +- 3 %', () => {
    const brutal = play(3, 12);
    expect(brutal.starts).toBeGreaterThan(300);
    expect(brutal.errors).toBe(0);
    const easy = play(0, 12);
    expect(easy.starts).toBeGreaterThan(300);
    const pct = (100 * easy.errors) / easy.starts;
    console.log(`Easy execution error ${pct.toFixed(1)} % over ${easy.starts} scripts`);
    expect(pct).toBeGreaterThanOrEqual(17);
    expect(pct).toBeLessThanOrEqual(23);
  }, 240_000);

  it('habit variety per level is 3 / 5 / 8 / 12, and a level plays no habit outside its set', () => {
    const want: Record<number, number> = { 0: 3, 1: 5, 2: 8, 3: 12 };
    const distinct: number[] = [];
    for (const level of [0, 1, 2, 3] as CpuLevel[]) {
      const r = play(level, 16);
      expect(r.enabled, `level ${level}`).toBe(want[level]);
      expect(r.outside, `level ${level} plays only habits of its own set`).toEqual([]);
      expect(r.maxDistinct, `level ${level}`).toBeLessThanOrEqual(want[level] as number);
      distinct.push(r.maxDistinct);
    }
    console.log(`most distinct habits one CPU played, per level: ${distinct.join(' / ')}`);
    expect(distinct[0]).toBeGreaterThanOrEqual(2);
    expect(distinct[1]).toBeGreaterThanOrEqual(4);
    expect(distinct[2]).toBeGreaterThanOrEqual(6);
    expect(distinct[3]).toBeGreaterThanOrEqual(8);
  }, 240_000);
});

describe('every CPU action is a FighterInput word', () => {
  it('input() returns u16 words and leaves the match buffer untouched', () => {
    const slot: FighterSlotId = 'TECH_VISIONARY';
    const k = cache.get(slot);
    const m = new FighterMatch({
      pack, rules: { ...BALANCE_RULES, cpuLevel: [3, 3] }, seed: 9, stage: 'powell_turntable',
      lineup: [{ slot, fighterId: 'a', scheme: 'classic', costume: 0 }, { slot, fighterId: 'b', scheme: 'classic', costume: 0 }],
    });
    const d0 = new CpuDriver({ slot: 0, level: 3, seed: 1, kit: k, oppKit: k });
    const d1 = new CpuDriver({ slot: 1, level: 3, seed: 2, kit: k, oppKit: k });
    let nonZero = 0;
    for (let t = 0; t < 2400 && !m.ended; t++) {
      const before = hashBuffer(m.buf);
      const w0 = d0.input(m.buf, m.buf[FM.Tick] as number), w1 = d1.input(m.buf, m.buf[FM.Tick] as number);
      expect(hashBuffer(m.buf)).toEqual(before);
      for (const w of [w0, w1]) {
        expect(Number.isInteger(w) && w >= 0 && w <= 0xffff).toBe(true);
        if (w !== 0) nonZero++;
      }
      m.step(w0, w1);
    }
    expect(nonZero).toBeGreaterThan(200);
  });
});
