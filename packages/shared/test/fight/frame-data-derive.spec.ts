import { describe, expect, it } from 'vitest';
import { derivedAdvantage } from '../../src/fight/pack.ts';
import type { MoveDef } from '../../src/fight/types.ts';
import { PLAYER } from './helpers.ts';

const all = [...PLAYER.moves, ...PLAYER.supers];
const byId = (id: string): MoveDef => all.find((m) => m.id === id) as MoveDef;

describe('derived frame data (FC1.2): advHit = hitstun - (A + R - 1), advBlock = blockstun - (A + R - 1)', () => {
  const table: [string, number | null, number | null][] = [
    ['5L', +4, +1], ['5M', +5, -1], ['5H', +3, -4], ['2L', +4, +2], ['2M', +4, -2], ['2H', null, -9],
    ['skidKick', +2, -5], ['uplift', null, -25], ['surge', null, -31],
  ];
  for (const [id, hit, block] of table) {
    it(`${id}: ${hit === null ? 'launch' : hit} on hit, ${block} on block`, () => {
      const m = byId(id);
      const d = derivedAdvantage(m, (m.hits[0] as { hit: Parameters<typeof derivedAdvantage>[1] }).hit);
      expect(d.advHit).toBe(hit);
      expect(d.advBlock).toBe(block);
    });
  }
  it('the twelve FX3 moves exist with their startup, active and recovery', () => {
    const sar: Record<string, [number, number, number]> = {
      '5L': [4, 2, 8], '5M': [6, 3, 12], '5H': [10, 4, 17], '2L': [4, 2, 7], '2M': [7, 3, 13], '2H': [11, 4, 22],
      jM: [6, 8, 3], throw: [5, 2, 19], sparkToss: [13, 1, 34], uplift: [4, 10, 30], skidKick: [11, 9, 16], surge: [6, 14, 38],
    };
    for (const [id, v] of Object.entries(sar)) {
      const m = byId(id);
      expect([m.startup, m.active, m.recovery]).toEqual(v);
    }
    expect(Object.keys(sar)).toHaveLength(12);
  });
  it('FX3 damage, guard and hitstop', () => {
    const dmg: Record<string, [number, string, number]> = {
      '5L': [300, 'mid', 8], '5M': [600, 'mid', 10], '5H': [900, 'mid', 12], '2L': [250, 'low', 8], '2M': [550, 'low', 10],
      '2H': [800, 'low', 12], jM: [650, 'high', 10], throw: [1000, 'throw', 14], uplift: [1000, 'mid', 12], skidKick: [700, 'low', 12],
    };
    for (const [id, [d, g, hs]] of Object.entries(dmg)) {
      const h = (byId(id).hits[0] as { hit: { damage: number; guard: string; hitstop: number } }).hit;
      expect([h.damage, h.guard, h.hitstop]).toEqual([d, g, hs]);
    }
    const surge = byId('surge');
    expect(surge.hits.map((h) => h.hit.damage).reduce((a, b) => a + b, 0)).toBe(2200);
    expect(surge.hits).toHaveLength(3);
    expect(surge.hits[0]?.hit.chipPermille).toBe(150);
    expect(surge.hypeCost).toBe(2000);
  });
});
