/** M02h5 AC-2: Bridson Poisson-disk sampling (`geom/poisson.ts`): spacing, density, determinism, the shared hash across polygons. */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../packages/shared/src/index.ts';
import { BRIDSON_DENSITY, PointHash, bridson, discPoint, type PoissonDomain } from '../src/geom/poisson.ts';

const box = (minX: number, minZ: number, maxX: number, maxZ: number, accept: (x: number, z: number) => boolean = () => true): PoissonDomain => ({ minX, minZ, maxX, maxZ, accept });

describe('bridson (M02h5)', () => {
  it('keeps every point at least rMin from every other and inside the domain', () => {
    const hash = new PointHash(6);
    const pts = bridson(box(0, 0, 300, 200), 6, new Rng(7), hash);
    expect(pts.length / 2).toBeGreaterThan(500);
    expect(hash.minPairDistance(6)).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < pts.length; i += 2) {
      expect(pts[i]! >= 0 && pts[i]! < 300 && pts[i + 1]! >= 0 && pts[i + 1]! < 200).toBe(true);
      // the decimetre grid of the pack
      expect(Math.abs(pts[i]! * 10 - Math.round(pts[i]! * 10))).toBeLessThan(1e-6);
    }
  });

  it('fills 1 km2 of open ground at BRIDSON_DENSITY / rMin^2 within 10 %', () => {
    for (const rMin of [6, 8]) {
      const pts = bridson(box(0, 0, 1000, 1000), rMin, new Rng(11), new PointHash(rMin));
      const target = (BRIDSON_DENSITY / (rMin * rMin)) * 1e6;
      const n = pts.length / 2;
      expect(Math.abs(n - target) / target, `rMin ${rMin}: ${n} points, target ${target.toFixed(0)}`).toBeLessThan(0.1);
    }
  });

  it('is deterministic for a seed and differs for another', () => {
    const a = bridson(box(0, 0, 200, 200), 5, new Rng(3), new PointHash(5));
    const b = bridson(box(0, 0, 200, 200), 5, new Rng(3), new PointHash(5));
    const c = bridson(box(0, 0, 200, 200), 5, new Rng(4), new PointHash(5));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('respects the accept test (holes stay empty) and the points of earlier polygons in the hash', () => {
    const hash = new PointHash(6);
    const hole = (x: number, z: number): boolean => !(x > 50 && x < 100 && z > 50 && z < 100);
    const first = bridson(box(0, 0, 150, 150, hole), 6, new Rng(1), hash);
    for (let i = 0; i < first.length; i += 2) expect(hole(first[i]!, first[i + 1]!)).toBe(true);
    // a touching polygon sampled second against the same hash keeps the spacing across the shared edge
    bridson(box(150, 0, 300, 150), 6, new Rng(2), hash);
    expect(hash.minPairDistance(6)).toBeGreaterThanOrEqual(6);
  });

  it('discPoint stays in its disc', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const [x, z] = discPoint(rng, 10, -4, 14);
      expect(Math.hypot(x - 10, z + 4)).toBeLessThanOrEqual(14 + 1e-9);
    }
  });
});
