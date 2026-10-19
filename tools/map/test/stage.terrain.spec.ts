import { describe, expect, it } from 'vitest';
import { TERRAIN_POSTS, chunkBounds, sampleHeight, type ChunkKey } from '../../../packages/shared/src/index.ts';
import { areaGridOf } from '../src/config.ts';
import { Raster } from '../src/geom/raster.ts';
import { decodeTerrarium, encodeTerrarium, TerrariumMosaic, tilesCovering, TILE_PX } from '../src/sources/terrarium.ts';
import { PIER_TOP_M, TerrainField, WATER_FLOOR_M, WATER_SHORE_M, runTerrain } from '../src/stages/s2-terrain.ts';
import { bakeExcerpt } from './helpers.ts';

describe('S2 terrain on the civic-excerpt', () => {
  it('decodes City Hall within 10-25 m', async () => {
    const b = await bakeExcerpt();
    const field = new TerrainField(new Map(b.sim.map((c) => [c.key, c.height.dm])));
    const h = field.heightAt(0, 0);
    expect(h).not.toBeNull();
    expect(h as number).toBeGreaterThanOrEqual(10);
    expect(h as number).toBeLessThanOrEqual(25);
    expect(b.report.terrain['cityHallM']).toBeCloseTo(h as number, 5);
  });

  it('gives neighbouring chunks equal shared edge posts', async () => {
    const b = await bakeExcerpt();
    const by = new Map(b.sim.map((c) => [c.key, c.height.dm]));
    let pairs = 0;
    for (const [key, dm] of by) {
      const [, x, y] = key.split('/').map(Number) as [number, number, number];
      const east = by.get(`9/${x + 1}/${y}` as ChunkKey);
      if (east) {
        pairs++;
        for (let j = 0; j < TERRAIN_POSTS; j++) expect(dm[j * TERRAIN_POSTS + TERRAIN_POSTS - 1]).toBe(east[j * TERRAIN_POSTS]);
      }
      const south = by.get(`9/${x}/${y + 1}` as ChunkKey);
      if (south) {
        pairs++;
        for (let i = 0; i < TERRAIN_POSTS; i++) expect(dm[(TERRAIN_POSTS - 1) * TERRAIN_POSTS + i]).toBe(south[i]);
      }
    }
    expect(pairs).toBeGreaterThan(20);
    expect(b.report.terrain['edgeMismatches']).toBe(0);
  });

  it('bakes all 16 chunks of the 4 x 4 box inland, with no post clamped as water', async () => {
    const b = await bakeExcerpt();
    expect(b.sim).toHaveLength(16);
    expect(b.report.terrain['minM']).toBeGreaterThan(-1);
  });

  it('agrees with sampleHeight from @dv/shared at the posts', async () => {
    const b = await bakeExcerpt();
    const c = b.sim[5]!;
    const bb = chunkBounds(c.key);
    expect(sampleHeight(c.height, bb.minX + 40, bb.minZ + 120)).toBeCloseTo((c.height.dm[30 * TERRAIN_POSTS + 10] as number) / 10, 6);
  });
});

describe('Terrarium decode', () => {
  it('uses h = R*256 + G + B/256 - 32768', () => {
    const h = new Float32Array(TILE_PX * TILE_PX).fill(0);
    h[0] = 17.6;
    h[1] = -114.25;
    h[2] = 340.3;
    const back = decodeTerrarium(encodeTerrarium(h));
    expect(back[0]).toBeCloseTo(17.6, 2);
    expect(back[1]).toBeCloseTo(-114.25, 2);
    expect(back[2]).toBeCloseTo(340.3, 2);
    expect(back[3]).toBe(0);
  });
});

describe('S2 clamps on one synthetic chunk', () => {
  // A 1 x 1 chunk box at chunk 9/256/256, flat tile heights chosen per case.
  const box = { minX: -128, minZ: -128, maxX: 128, maxZ: 128 };
  const grid = areaGridOf(box);
  const run = (tileH: number, landFill: (r: Raster) => void, pierFill: (r: Raster) => void) => {
    const m = new TerrariumMosaic(15);
    for (const t of tilesCovering(box, 15)) m.add(t.x, t.y, new Float32Array(TILE_PX * TILE_PX).fill(tileH));
    const land = new Raster(grid.minX, grid.minZ, 4, grid.postsX, grid.postsY, 0);
    const pier = new Raster(grid.minX, grid.minZ, 4, grid.postsX, grid.postsY, 0);
    landFill(land);
    pierFill(pier);
    return runTerrain(grid, m, land, pier);
  };
  const dmAt = (p: ReturnType<typeof runTerrain>, i: number, j: number): number => (p.grids.get('9/256/256' as ChunkKey) as Int16Array)[j * TERRAIN_POSTS + i] as number;

  it('clamps deep water to -60 m and shallow noise to -2.5 m', () => {
    // land only in the west half; the east half is water
    const deep = run(-100, (r) => r.fillRings([[-128, -128, -128, 128, 0, 128, 0, -128]], 1), () => {});
    expect(dmAt(deep, 60, 10)).toBe(Math.round(WATER_FLOOR_M * 10));
    expect(dmAt(deep, 2, 10)).toBe(-1000);
    const shallow = run(1.2, (r) => r.fillRings([[-128, -128, -128, 128, 0, 128, 0, -128]], 1), () => {});
    expect(dmAt(shallow, 60, 10)).toBe(Math.round(WATER_SHORE_M * 10));
    expect(dmAt(shallow, 2, 10)).toBe(12);
  });

  it('raises pier posts to 3.0 m', () => {
    const p = run(-5, (r) => r.fillRings([[-128, -128, -128, 0, 128, 0, 128, -128]], 1), (r) => r.fillRings([[-20, 20, -20, 60, 20, 60, 20, 20]], 1));
    expect(dmAt(p, 32, 40)).toBe(Math.round(PIER_TOP_M * 10));
    expect(dmAt(p, 32, 62)).toBe(-50);
    expect(p.stats.pierPosts).toBeGreaterThan(20);
  });
});
