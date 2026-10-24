import { describe, expect, it } from 'vitest';
import type { ChunkKey } from '../../../packages/shared/src/index.ts';
import { clampPolylineDm, closeNodeHeights, runGrading, type BridgesConfig } from '../src/stages/s7-grading.ts';
import { CITY_KEYS, bridgesCfg, gridsFor, net, resetIds, roadCfg, way } from './net-fixtures.ts';

type Height = (x: number, z: number) => number;

function grade(osm: ReturnType<typeof way>[], h: Height, cfg: BridgesConfig = bridgesCfg, keys: ChunkKey[] = CITY_KEYS) {
  const { roads, junctions } = net(osm);
  return runGrading({ segs: roads.segs, nodes: junctions.nodes, edges: roads.edges, grids: gridsFor(keys, h), cfg, hillGradePct: roadCfg.hillGradePct });
}

describe('S7 integer closure (DL-707)', () => {
  it('lowers node heights to the exact allowance of every link and never raises one', () => {
    // a chain 0 - 1 - 2 - 3 with allowances of 10 dm: heights 0, 100, 0, 100 dm close to 0, 10, 0, 10
    const r = closeNodeHeights([0, 100, 0, 100], [{ a: 0, b: 1, k: 10 }, { a: 1, b: 2, k: 10 }, { a: 2, b: 3, k: 10 }]);
    expect(r.dm).toEqual([0, 10, 0, 10]);
    expect(r.lowered).toBe(2);
    expect(closeNodeHeights([0, 5, 12], [{ a: 0, b: 1, k: 10 }, { a: 1, b: 2, k: 10 }]).lowered).toBe(0);
    // a high node next to a low one is pulled down, a low one is never pulled up
    expect(closeNodeHeights([200, 0], [{ a: 0, b: 1, k: 30 }]).dm).toEqual([30, 0]);
  });

  it('clamps a polyline in decimetres with pinned ends and an integer allowance per step', () => {
    const d = [0, 90, 10, 80, 20];
    clampPolylineDm(d, [5, 5, 5, 5]);
    expect(d[0]).toBe(0);
    expect(d[4]).toBe(20);
    for (let q = 1; q < d.length; q++) expect(Math.abs(d[q]! - d[q - 1]!)).toBeLessThanOrEqual(5);
  });

  it('ends an 80 % hillside at 40 % exactly, with no step that rounds past it', () => {
    resetIds();
    const steep: Height = (x) => 10 + 0.8 * Math.max(-100, Math.min(100, x)) + 80;
    const g = grade([way([-100, 0, 100, 0], { highway: 'residential' })], steep);
    for (const s of g.segs) {
      for (let i = 1; i < s.ys.length; i++) {
        const h = Math.hypot(s.pts[i * 2]! - s.pts[i * 2 - 2]!, s.pts[i * 2 + 1]! - s.pts[i * 2 - 1]!);
        expect(Math.round(Math.abs(s.ys[i]! - s.ys[i - 1]!) * 10)).toBeLessThanOrEqual(Math.floor(0.4 * h * 10 + 1e-9));
      }
    }
    expect(g.stats.maxGradePct).toBeLessThanOrEqual(40);
  });

  it('holds 6 % on a bridge segment above a 30 % hillside and keeps slab tops within 0.1 m of each other', () => {
    resetIds();
    const climb: Height = (x) => 10 + 0.3 * Math.max(-100, Math.min(100, x));
    const g = grade([way([-100, 0, 100, 0], { highway: 'primary', bridge: 'yes', layer: '1' }), way([100, 0, 260, 0], { highway: 'residential' })], climb);
    const seg = g.segs.find((s) => s.bridge)!;
    for (let i = 1; i < seg.ys.length; i++) {
      const h = Math.hypot(seg.pts[i * 2]! - seg.pts[i * 2 - 2]!, seg.pts[i * 2 + 1]! - seg.pts[i * 2 - 1]!);
      expect(Math.abs(seg.ys[i]! - seg.ys[i - 1]!) / h).toBeLessThanOrEqual(0.06 + 1e-9);
    }
    expect(g.stats.maxSlabStepM).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(g.stats.slabs).toBeGreaterThan(100);
    expect(Math.max(0, ...g.edges.map((e) => e.maxGradePct))).toBeLessThanOrEqual(40);
  });
});
