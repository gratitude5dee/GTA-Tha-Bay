import { describe, expect, it } from 'vitest';
import { loadSynth } from '../src/config.ts';
import { ccwArea } from '../src/geom/rings.ts';
import { Raster } from '../src/geom/raster.ts';
import { mainOutline, islandRing } from '../src/sources/synth.ts';
import {
  assembleLand, bufferLine, chainWays, clipChainToBox, closePieces, growBoundary, landMask, landuseOfTags, perimeterT, waterGate,
  type WaterProduct,
} from '../src/stages/s3-water.ts';
import { bakeExcerpt } from './helpers.ts';

const box = { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 };
const landFraction = (rings: number[][]): number => {
  const r = new Raster(0, 0, 4, 250, 250, 0.5);
  r.fillRings(rings, 1);
  return r.count(1) / (250 * 250);
};
const noHint = (): boolean => false;

describe('S3 coastline assembly', () => {
  it('chains ways end to start into one closed ring, in any input order', () => {
    const ring = [0, 0, 0, 10, 10, 10, 10, 0, 0, 0];
    const ways = [ring.slice(4, 8), ring.slice(0, 6), ring.slice(6)];
    const chains = chainWays(ways);
    expect(chains).toHaveLength(1);
    const c = chains[0] as number[];
    expect(c[0]).toBe(c[c.length - 2]);
    expect(c[1]).toBe(c[c.length - 1]);
    expect(c.length / 2).toBe(5);
  });

  it('closes the synth coastline: every chained outline ring closes', () => {
    const cfg = loadSynth();
    const outline = mainOutline(cfg);
    const closed = [...outline, outline[0] as number, outline[1] as number];
    const n = closed.length / 2;
    const a = Math.floor(n / 3), c = Math.floor((2 * n) / 3);
    const chains = chainWays([closed.slice(c * 2), closed.slice(0, (a + 1) * 2), closed.slice(a * 2, (c + 1) * 2)]);
    expect(chains).toHaveLength(1);
    const ch = chains[0] as number[];
    expect(ch.slice(0, 2)).toEqual(ch.slice(-2));
    expect(ccwArea(outline)).toBeGreaterThan(0);
    for (const p of cfg.landPads) if (p.kind === 'island') expect(ccwArea(islandRing(p))).toBeGreaterThan(0);
  });

  it('closes a coast that crosses the box along the perimeter, land on the left', () => {
    // west to east at z = 400 (north-up: land to the north, which is z < 400)
    const r = assembleLand({ coastWays: [[-50, 400, 400, 400, 1050, 400]], box, minRingKm2: 0, baseLandHint: noHint });
    expect(r.stats.openPieces).toBe(1);
    expect(r.rings).toHaveLength(1);
    expect(ccwArea(r.rings[0] as number[])).toBeGreaterThan(0);
    expect(landFraction(r.rings)).toBeCloseTo(0.4, 1);
  });

  it('puts the land on the other side when the coast runs the other way', () => {
    const r = assembleLand({ coastWays: [[1050, 400, 400, 400, -50, 400]], box, minRingKm2: 0, baseLandHint: noHint });
    expect(landFraction(r.rings)).toBeCloseTo(0.6, 1);
  });

  it('adds the corner for a coast that cuts off one corner', () => {
    // diagonal from the north edge (x=300) to the east edge (z=300), land to the north-east corner side (left of travel)
    const r = assembleLand({ coastWays: [[300, -50, 1050, 650]], box, minRingKm2: 0, baseLandHint: noHint });
    const pieces = clipChainToBox([300, -50, 1050, 650], box);
    expect(pieces).toHaveLength(1);
    const closed = closePieces(pieces, box);
    expect(closed.rings).toHaveLength(1);
    expect(r.rings).toHaveLength(1);
    // land is the NE corner triangle: (353.6, 0), (1000, 0), (1000, 603) is 19.5 % of the box
    expect(ccwArea(r.rings[0] as number[])).toBeGreaterThan(0);
    expect(Math.abs(landFraction(r.rings) - 0.195)).toBeLessThan(0.02);
  });

  it('builds two land polygons for a strait', () => {
    const north = [-50, 300, 1050, 300]; // land to the north of z = 300 (left of east-bound travel)
    const south = [1050, 700, -50, 700]; // west-bound: land to the south of z = 700
    const r = assembleLand({ coastWays: [north, south], box, minRingKm2: 0, baseLandHint: noHint });
    expect(r.rings).toHaveLength(2);
    expect(landFraction(r.rings)).toBeCloseTo(0.6, 1);
  });

  it('drops rings under the area floor and keeps the rest, simplified', () => {
    const island = (x: number, z: number, s: number): number[] => [x, z, x, z + s, x + s, z + s, x + s, z, x, z];
    const ways = [island(100, 100, 100), island(400, 400, 600)]; // 0.01 km2 and 0.36 km2, both CW in z-down = CCW north-up
    const strict = assembleLand({ coastWays: ways, box, minRingKm2: 0.25, baseLandHint: noHint });
    expect(strict.stats.ringsDropped).toBe(1);
    expect(strict.stats.ringsKept).toBe(1);
    const loose = assembleLand({ coastWays: ways, box, minRingKm2: 0.005, baseLandHint: noHint });
    expect(loose.stats.ringsKept).toBe(2);
  });

  it('treats a box with no coastline as land or water by the hint', () => {
    const land = assembleLand({ coastWays: [], box, minRingKm2: 0, baseLandHint: () => true });
    expect(landFraction(land.rings)).toBe(1);
    const sea = assembleLand({ coastWays: [], box, minRingKm2: 0, baseLandHint: () => false });
    expect(sea.rings).toHaveLength(0);
  });

  it('grows perimeter vertices one post outward so the last post row is land', () => {
    const g = growBoundary([0, 0, 0, 1000, 1000, 1000, 1000, 0, 500, 500], box);
    expect(g.slice(0, 8)).toEqual([-4, -4, -4, 1004, 1004, 1004, 1004, -4]);
    expect(g.slice(8)).toEqual([500, 500]);
    expect(perimeterT(0, 0, box)).toBe(0);
    expect(perimeterT(0, 1000, box)).toBe(1000);
    expect(perimeterT(1000, 1000, box)).toBe(2000);
    expect(perimeterT(1000, 0, box)).toBe(3000);
  });

  it('keeps the last post row and column of an inland box on land', () => {
    const r = assembleLand({ coastWays: [], box, minRingKm2: 0, baseLandHint: () => true });
    const posts = new Raster(0, 0, 4, 251, 251, 0);
    const w: WaterProduct = { landRings: r.rings, waterPolys: [], piers: [], landuse: [], trees: [], hoods: [], stats: r.stats };
    landMask(posts, w);
    expect(posts.at(1000, 1000)).toBe(1);
    expect(posts.at(0, 1000)).toBe(1);
  });
});

describe('S3 landuse, piers and the land/union gate', () => {
  it.each([
    [{ leisure: 'park' }, 'park'],
    [{ leisure: 'pitch' }, 'park'],
    [{ landuse: 'grass' }, 'grass'],
    [{ natural: 'beach' }, 'sand'],
    [{ place: 'square' }, 'plaza'],
    [{ highway: 'pedestrian', area: 'yes' }, 'plaza'],
    [{ natural: 'bare_rock' }, 'rock'],
    [{ landuse: 'industrial' }, 'industrial'],
    [{ landuse: 'retail' }, 'commercial'],
    [{ landuse: 'residential' }, 'residential'],
    [{ highway: 'residential' }, null],
  ] as const)('maps %j to %s', (tags, cls) => {
    expect(landuseOfTags(tags as Record<string, string>)).toBe(cls);
  });

  it('buffers a pier way to quads at least 8 m wide', () => {
    const quads = bufferLine([0, 0, 100, 0], 3);
    expect(quads).toHaveLength(1);
    expect(Math.abs(ccwArea(quads[0] as number[]))).toBeCloseTo(800, 3);
  });

  it('computes area(land ∩ union) / area(union) and reports land outside the union', () => {
    const cells = (fill: (r: Raster) => void): Raster => {
      const r = new Raster(0, 0, 4, 250, 250, 0.5);
      fill(r);
      return r;
    };
    const land = cells((r) => r.fillRings([[0, 0, 0, 1000, 1000, 1000, 1000, 0]], 1));
    const union = cells((r) => r.fillRings([[0, 0, 0, 500, 500, 500, 500, 0]], 1));
    const g = waterGate(land, union, box);
    expect(g.ratio).toBe(1);
    expect(g.unionKm2).toBeCloseTo(0.25, 3);
    expect(g.landOutsideUnionKm2).toBeCloseTo(0.75, 3);
    const wet = cells((r) => r.fillRings([[0, 0, 0, 250, 500, 250, 500, 0]], 1));
    expect(waterGate(wet, union, box).ratio).toBeCloseTo(0.5, 1);
  });
});

describe('S3 on the civic-excerpt', () => {
  it('finds no coastline, takes the box as land and passes the union gate', async () => {
    const b = await bakeExcerpt();
    const gate = b.report.gates.find((g) => g.id === 's3.land-union');
    expect(gate?.level).toBe('pass');
    expect((b.report as unknown as { water: { baseLand: boolean; coastChains: number } }).water).toMatchObject({ baseLand: true, coastChains: 0 });
  });
});
