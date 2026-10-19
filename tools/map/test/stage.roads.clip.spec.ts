import { describe, expect, it } from 'vitest';
import { clipWayToBox, type Way } from '../src/stages/s5-roads.ts';

describe('S5 cuts ways at the area box (real extracts reach past it)', () => {
  const box = { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 };
  const w = (enu: number[]): Way => ({ id: 'way/1', num: 1, tags: { highway: 'residential' }, keys: enu.filter((_, i) => i % 2 === 0).map((_, i) => `k${i}`), enu });

  it('returns a way inside the box unchanged and drops one entirely outside', () => {
    const inside = w([10, 10, 500, 500]);
    expect(clipWayToBox(inside, box)).toEqual([inside]);
    expect(clipWayToBox(w([-500, -500, -100, -50]), box)).toEqual([]);
  });

  it('cuts a way leaving the box at the edge and keeps the original keys of inner vertices', () => {
    const [a] = clipWayToBox(w([900, 500, 1200, 500]), box);
    expect(a!.enu.slice(0, 2)).toEqual([900, 500]);
    expect(a!.enu[2]).toBeCloseTo(999.5, 6);
    expect(a!.keys[0]).toBe('k0');
    expect(a!.keys[1]).toMatch(/^cut:/);
  });

  it('splits a way that leaves and re-enters into two pieces', () => {
    const pieces = clipWayToBox(w([500, 500, 500, -300, 700, -300, 700, 500]), box);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.enu).toHaveLength(4);
    expect(pieces[1]!.enu).toHaveLength(4);
    for (const p of pieces) {
      for (let i = 0; i < p.enu.length; i += 2) {
        expect(p.enu[i]).toBeGreaterThanOrEqual(0);
        expect(p.enu[i + 1]).toBeGreaterThanOrEqual(0);
        expect(p.enu[i + 1]).toBeLessThan(1000);
      }
    }
  });

  it('crosses the whole box with two cut vertices', () => {
    const [a] = clipWayToBox(w([-100, 500, 1100, 500]), box);
    expect(a!.keys).toHaveLength(2);
    expect(a!.enu[0]).toBeCloseTo(0.5, 6);
    expect(a!.enu[2]).toBeCloseTo(999.5, 6);
  });
});
