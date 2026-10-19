import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NHOOD_NONE, decodeDistrictGrid, encodeDistrictGrid, nhoodIndexAt, sha256Hex } from '../../../packages/shared/src/index.ts';
import { loadBounds } from '../src/config.ts';
import { loadContentWorld } from '../src/content.ts';
import { NEIGHBOURHOODS_41, slugOf } from '../src/districts-seed.ts';
import { runDistrictGrid } from '../src/stages/s12-district-grid.ts';
import type { HoodPoly } from '../src/stages/s3-water.ts';
import { bakeExcerpt } from './helpers.ts';

const BAKE_ID = 'ab'.repeat(32);
const square = (x0: number, z0: number, x1: number, z1: number): number[] => [x0, z0, x1, z0, x1, z1, x0, z1];

describe('S12 district grid', () => {
  const play = loadBounds().play;

  it('rasterises neighbourhood polygons at 64 m with the NEIGHBOURHOODS_41 index, holes left empty', () => {
    const mission = NEIGHBOURHOODS_41.indexOf('Mission');
    const soma = NEIGHBOURHOODS_41.indexOf('South of Market');
    const hoods: HoodPoly[] = [
      { name: 'Mission', polys: [{ outer: square(0, 0, 640, 640), holes: [square(256, 256, 384, 384)] }] },
      { name: 'South of Market', polys: [{ outer: square(1000, 0, 1256, 256), holes: [] }] },
    ];
    const { grid, report } = runDistrictGrid({ bakeId: BAKE_ID, hoods, play });
    expect(grid.cellM).toBe(64);
    expect(Math.abs(grid.minX % 64)).toBe(0);
    expect(grid.cols).toBe(Math.ceil((play.maxX - grid.minX) / 64));
    expect(grid.rows).toBe(Math.ceil((play.maxZ - grid.minZ) / 64));
    expect(nhoodIndexAt(grid, 100, 100)).toBe(mission);
    expect(nhoodIndexAt(grid, 320, 320)).toBe(NHOOD_NONE);   // inside the hole
    expect(nhoodIndexAt(grid, 1100, 100)).toBe(soma);
    expect(nhoodIndexAt(grid, 5000, 5000)).toBe(NHOOD_NONE);
    expect(nhoodIndexAt(grid, play.maxX + 500, 0)).toBe(NHOOD_NONE);
    expect(report.nhoodsPresent).toBe(2);
    expect(report.unknownNames).toEqual([]);
    expect(grid.nhoods).toEqual(NEIGHBOURHOODS_41.map(slugOf));
  });

  it('keeps a polygon that is not one of the 41 out of the grid and reports it', () => {
    const { grid, report } = runDistrictGrid({ bakeId: BAKE_ID, hoods: [{ name: 'Atlantis', polys: [{ outer: square(0, 0, 640, 640), holes: [] }] }], play });
    expect(report.unknownNames).toEqual(['Atlantis']);
    expect(report.assigned).toBe(0);
    expect(nhoodIndexAt(grid, 100, 100)).toBe(NHOOD_NONE);
  });

  it('encodes to the same bytes on every run, and decode then encode is the identity', () => {
    const hoods: HoodPoly[] = [{ name: 'Marina', polys: [{ outer: square(-2000, -3000, -1000, -2000), holes: [] }] }];
    const a = runDistrictGrid({ bakeId: BAKE_ID, hoods, play });
    const b = runDistrictGrid({ bakeId: BAKE_ID, hoods: [...hoods].reverse(), play });
    const bytesA = encodeDistrictGrid(a.grid);
    expect(sha256Hex(encodeDistrictGrid(b.grid))).toBe(sha256Hex(bytesA));
    const back = decodeDistrictGrid(bytesA);
    expect(back.bakeId).toBe(BAKE_ID);
    expect(sha256Hex(encodeDistrictGrid(back))).toBe(sha256Hex(bytesA));
    expect(bytesA.byteLength).toBe(52 + 1 + NEIGHBOURHOODS_41.reduce((n, s) => n + 1 + slugOf(s).length, 0) + a.grid.cols * a.grid.rows);
  });

  it('rejects a damaged file', () => {
    const { grid } = runDistrictGrid({ bakeId: BAKE_ID, hoods: [], play });
    const bytes = encodeDistrictGrid(grid);
    expect(() => decodeDistrictGrid(bytes.subarray(0, bytes.length - 1))).toThrow(/length/);
    const bad = bytes.slice();
    bad[0] = 0;
    expect(() => decodeDistrictGrid(bad)).toThrow(/magic/);
  });

  it('civic-excerpt: every cell is 0 to 40 or 255 and every index maps through districts.json to d1 to d10, outer or stage', async () => {
    const bake = await bakeExcerpt();
    const bytes = readFileSync(path.join(bake.outDir, 'district-grid.v1.pack'));
    const grid = decodeDistrictGrid(bytes);
    expect(grid.bakeId).toBe(bake.result.bakeId);
    const districts = loadContentWorld().districts.districts;
    const districtOfSlug = new Map<string, string>();
    for (const d of districts) for (const n of d.nhoods) districtOfSlug.set(slugOf(n), d.id);
    const allowed = new Set(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'outer', 'stage']);
    const used = new Set<number>();
    for (const v of grid.cells) used.add(v);
    expect(used.size).toBeGreaterThan(1);
    for (const v of used) {
      if (v === NHOOD_NONE) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(40);
      const d = districtOfSlug.get(grid.nhoods[v] as string);
      expect(allowed.has(d as string), `index ${v} (${grid.nhoods[v]}) -> ${String(d)}`).toBe(true);
    }
    const gate = bake.report.gates.filter((g) => g.id.startsWith('s12.') || g.id === 's14.district-grid');
    expect(gate.map((g) => g.id).sort()).toEqual(['s12.district-cells', 's12.district-names', 's14.district-grid']);
    expect(gate.every((g) => g.level === 'pass')).toBe(true);
  });
});
