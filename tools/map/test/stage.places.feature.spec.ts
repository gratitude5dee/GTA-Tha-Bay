import { describe, expect, it } from 'vitest';
import { latLngFromEnu } from '../../../packages/shared/src/index.ts';
import type { OsmFeature } from '../src/sources/geo.ts';
import { areaIdOf, nearestOnFeature } from '../src/stages/s10-places.ts';

const ll = (x: number, z: number): number[] => {
  const p = latLngFromEnu(x, z);
  return [Number(p.lng.toFixed(9)), Number(p.lat.toFixed(9))];
};
const ring = (pts: number[][]): number[][] => [...pts.map(([x, z]) => ll(x as number, z as number)), ll(pts[0]![0]!, pts[0]![1]!)];
const area = (id: string, outer: number[][], holes: number[][][] = []): OsmFeature => ({
  id, tags: { leisure: 'park' }, geometry: { type: 'MultiPolygon', coordinates: [[ring(outer), ...holes.map(ring)]] },
});
const line = (id: string, pts: number[][]): OsmFeature => ({ id, tags: {}, geometry: { type: 'LineString', coordinates: pts.map(([x, z]) => ll(x as number, z as number)) } });

describe('S10 landmark distance is measured to the feature geometry (DL-708)', () => {
  it('maps way N to its area a<2N> and relation N to a<2N+1>', () => {
    expect(areaIdOf('w21')).toBe('a42');
    expect(areaIdOf('r21')).toBe('a43');
    expect(areaIdOf('n21')).toBeNull();
  });

  it('is 0 inside an area and leaves the seed where it is, even when the centroid lies far away (a crescent)', () => {
    // a thin crescent: the arc from (0,0) round to (400,0) through (200,300); its centroid is in the hollow, outside the shape
    const outer: number[][] = [];
    for (let i = 0; i <= 20; i++) { const a = Math.PI * (i / 20); outer.push([200 - 200 * Math.cos(a), 300 * Math.sin(a)]); }
    for (let i = 20; i >= 0; i--) { const a = Math.PI * (i / 20); outer.push([200 - 160 * Math.cos(a), 240 * Math.sin(a)]); }
    const crescent = area('a100', outer);
    const seedInside: [number, number] = [200, 270];
    const hit = nearestOnFeature([crescent], 'w50', seedInside[0], seedInside[1]);
    expect(hit).not.toBeNull();
    expect(hit!.distM).toBe(0);
    expect(hit!.inside).toBe(true);
    expect([hit!.x, hit!.z]).toEqual(seedInside);
    // the centroid of the outline (about (200, 160)) is in the hollow, 80 m from the shape: a centroid-based check would fail this seed
    const hollow = nearestOnFeature([crescent], 'w50', 200, 120);
    expect(hollow!.distM).toBeGreaterThan(60);
  });

  it('prefers the area export over the closed-way line, and falls back to the line when there is no area', () => {
    const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const closedLine = line('w7', [...sq, sq[0]!]);
    const a = area('a14', sq);
    // inside: the area says 0, the line (boundary) would say 50
    expect(nearestOnFeature([closedLine, a], 'w7', 50, 50)!.distM).toBe(0);
    expect(nearestOnFeature([closedLine, a], 'w7', 50, 50)!.id).toBe('a14');
    const lineOnly = nearestOnFeature([closedLine], 'w7', 50, 50)!;
    expect(lineOnly.kind).toBe('line');
    expect(lineOnly.distM).toBeCloseTo(50, 0);
    // a relation resolves through a<2N+1>
    expect(nearestOnFeature([area('a15', sq)], 'r7', 50, 50)!.distM).toBe(0);
    expect(nearestOnFeature([closedLine], 'r7', 50, 50)).toBeNull();
  });

  it('snaps a seed outside an area to the nearest point inside it, never to the centroid, and reports the distance', () => {
    const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const hit = nearestOnFeature([area('a14', sq)], 'w7', 130, 40)!;
    expect(hit.inside).toBe(false);
    expect(hit.distM).toBeCloseTo(30, 0);
    expect(hit.x).toBeLessThan(100.01);
    expect(hit.x).toBeGreaterThan(99);   // on the east edge, 0.5 m in
    expect(hit.z).toBeCloseTo(40, 0);
  });

  it('reports a seed 121 m outside a polygon as 121 m, over the 120 m limit', () => {
    const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const hit = nearestOnFeature([area('a14', sq)], 'w7', 221, 50)!;
    expect(Math.round(hit.distM)).toBe(121);
    expect(hit.distM).toBeGreaterThan(120);
  });

  it('treats holes as outside and a node as a point', () => {
    const outer = [[0, 0], [200, 0], [200, 200], [0, 200]];
    const hole = [[80, 80], [120, 80], [120, 120], [80, 120]];
    const a = area('a2', outer, [hole]);
    expect(nearestOnFeature([a], 'w1', 100, 100)!.distM).toBeCloseTo(20, 0);
    const node: OsmFeature = { id: 'n9', tags: {}, geometry: { type: 'Point', coordinates: ll(30, 40) } };
    const p = nearestOnFeature([node], 'n9', 33, 44)!;
    expect(p.kind).toBe('node');
    expect(p.distM).toBeCloseTo(5, 0);
  });
});
