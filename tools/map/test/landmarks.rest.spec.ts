/**
 * M02d2: the 25 recipes of rows 13 to 37 (nine majors, sixteen minors): class budgets, falling counts, determinism, the shared kit
 * parts they added and the catalog completeness gate of `map:landmarks`.
 */
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, toolsRoot } from '../../ci/lib/common.ts';
import type { BudgetRow } from '../../assets/src/verify.ts';
import { loadContentWorld, type LandmarkSeed } from '../src/content.ts';
import { buildModel, type BaseParams } from '../src/landmarks/kit/build.ts';
import { FIDELITIES, rulesOf } from '../src/landmarks/kit/fidelity.ts';
import { gantryCrane } from '../src/landmarks/kit/gantry.ts';
import { glassHall, vault } from '../src/landmarks/kit/glasshouse.ts';
import { tiledRoof, tiers } from '../src/landmarks/kit/eaves.ts';
import { annulus, fence, flatDisc, flatRect, palm, tree } from '../src/landmarks/kit/landscape.ts';
import { Geo } from '../src/landmarks/kit/primitives.ts';
import { RECIPES } from '../src/landmarks/index.ts';
import { validateLandmarkAssets, validateLandmarkSeeds } from '../src/verify/landmarks.ts';
import { useTempDirs } from '../../ci/test-tmp.ts';

// BD-FIX-TMP-01: temp folders made here are removed after the last test of this file.
const tempDir = useTempDirs();

const MAJORS = [
  'lm.painted-ladies', 'lm.china-basin-ballpark', 'lm.mission-bay-arena', 'lm.pier-39', 'lm.fort-point', 'lm.grace-cathedral',
  'lm.dragon-gate', 'lm.transit-center-park', 'lm.hunters-point-yard',
];
const MINORS = [
  'lm.mount-davidson-cross', 'lm.dolores-park', 'lm.haight-ashbury', 'lm.flower-conservatory', 'lm.park-bandshell', 'lm.cliff-house',
  'lm.crissy-field', 'lm.powell-turntable', 'lm.lands-end-lookout', 'lm.candlestick-point', 'lm.treasure-island', 'lm.un-plaza',
  'lm.rail-terminus', 'lm.peace-pagoda', 'lm.opera-house', 'lm.saint-mary-cathedral',
];
const REST = [...MAJORS, ...MINORS];
const seeds = new Map(loadContentWorld().landmarks.map((l) => [l.id, l] as const));
const budgets = readJson<{ rows: BudgetRow[] }>(path.join(toolsRoot, 'config/asset-budgets.json')).rows;
const rowFor = (cls: string): BudgetRow => budgets.find((r) => r.tag === `lm-class:${cls}`) as BudgetRow;
const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;

describe('the 25 recipes of rows 13 to 37', () => {
  it('are rows 13 to 37 of the section 7 table, in order, after the twelve of M02d1', () => {
    expect(RECIPES).toHaveLength(37);
    expect(RECIPES.slice(12).map((r) => r.id)).toEqual(REST);
    expect(seeds.size).toBe(37);
    expect(validateLandmarkSeeds().filter((f) => f.level === 'fail')).toEqual([]);
    for (const id of MAJORS) expect(seeds.get(id)?.cls, id).toBe('major');
    for (const id of MINORS) expect(seeds.get(id)?.cls, id).toBe('minor');
  });

  it('build inside the triangle and render-object budgets of their class, with falling counts', async () => {
    for (const id of REST) {
      const seed = seeds.get(id) as LandmarkSeed;
      const row = rowFor(seed.cls);
      const tris: number[] = [];
      for (const [i, f] of FIDELITIES.entries()) {
        const { stats } = await buildModel(recipe(id), seed.recipe as unknown as BaseParams, f);
        const cols = [row.fidelity.hi, row.fidelity.mid, row.fidelity.lo][i]!;
        expect(stats.tris, `${id} ${f} tris`).toBeLessThanOrEqual(cols.tris!);
        expect(stats.primitives, `${id} ${f} objects`).toBeLessThanOrEqual(cols.maxObjects!);
        expect(stats.tris, `${id} ${f} has geometry`).toBeGreaterThan(100);
        tris.push(stats.tris);
      }
      expect(tris[0], `${id} hi > mid`).toBeGreaterThan(tris[1] as number);
      expect(tris[1], `${id} mid > lo`).toBeGreaterThan(tris[2] as number);
    }
  }, 180_000);

  it('keep the model inside a believable footprint and above the ground line (no part sunk deeper than the 2 m skirt)', () => {
    for (const id of REST) {
      const seed = seeds.get(id) as LandmarkSeed;
      const g = new Geo(rulesOf('hi'));
      g.setYaw((((seed.recipe as unknown as BaseParams).yawDeg ?? 0) * Math.PI) / 180);
      (recipe(id) as unknown as { build(g: Geo, p: BaseParams): void }).build(g, seed.recipe as unknown as BaseParams);
      let minY = Infinity, maxY = -Infinity, reach = 0;
      for (const c of g.classes()) {
        for (let i = 0; i < c.pos.length; i += 3) {
          minY = Math.min(minY, c.pos[i + 1] as number);
          maxY = Math.max(maxY, c.pos[i + 1] as number);
          reach = Math.max(reach, Math.hypot(c.pos[i] as number, c.pos[i + 2] as number));
        }
      }
      expect(minY, `${id} lowest vertex`).toBeGreaterThanOrEqual(-9.5);
      expect(maxY, `${id} has height`).toBeGreaterThan(4);
      // a landmark must not spill over its neighbours: a few hundred metres at most
      expect(reach, `${id} reach`).toBeLessThan(260);
      expect(g.triangles(), id).toBeGreaterThan(100);
    }
  });

  it('build the same bytes twice (a pure function of the parameters)', async () => {
    for (const id of ['lm.hunters-point-yard', 'lm.park-bandshell', 'lm.saint-mary-cathedral']) {
      const seed = seeds.get(id) as LandmarkSeed;
      const a = await buildModel(recipe(id), seed.recipe as unknown as BaseParams, 'mid');
      const b = await buildModel(recipe(id), seed.recipe as unknown as BaseParams, 'mid');
      expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes)), id).toBe(true);
      expect(a.stats).toEqual(b.stats);
    }
  });

  it('keep ids brand-free and in the id rule (names go through place.<slug>; the recipes draw architecture only)', () => {
    for (const id of REST) expect(id).toMatch(/^lm\.[a-z0-9-]{2,60}$/);
    // the fictional venues of section 7 rule 6 keep their generic ids
    for (const id of ['lm.china-basin-ballpark', 'lm.mission-bay-arena', 'lm.transit-center-park', 'lm.rail-terminus']) expect(REST).toContain(id);
  });
});

describe('the kit parts M02d2 added', () => {
  const geo = (f: 'hi' | 'mid' | 'lo' = 'hi'): Geo => new Geo(rulesOf(f));

  it('a vault is closed by two end walls by default and open without them', () => {
    const closed = geo(), open = geo();
    vault(closed, 0, 0, 0, 10, 20, 4, { color: 'steelGrey', segs: 8 });
    vault(open, 0, 0, 0, 10, 20, 4, { color: 'steelGrey', segs: 8, caps: false });
    expect(closed.triangles()).toBeGreaterThan(open.triangles());
    // 9 profile points (6 arc segments... ) x 2 triangles per wall quad, plus the floor
    expect(open.triangles()).toBe(2 * 8 + 2);
  });

  it('a glass hall puts its vault in the glass class and its frame in the metal class; `lo` merges the glass into the matte object', () => {
    const hi = geo('hi'), lo = geo('lo');
    glassHall(hi, 0, 0, 0, 10, 20, 4, { wallH: 2, ribs: 5 });
    glassHall(lo, 0, 0, 0, 10, 20, 4, { wallH: 2, ribs: 5 });
    expect(hi.classes().map((c) => c.cls)).toEqual(['metal', 'glass']);
    expect(lo.classes().map((c) => c.cls)).toEqual(['matte']);
    expect(hi.triangles()).toBeGreaterThan(lo.triangles());
  });

  it('a tiled roof has 4 sides, a soffit and a pinched ridge: pyramid 4 x 2 + 2, ridge adds the two end faces', () => {
    const p = geo(), r = geo();
    tiledRoof(p, 0, 0, 0, 10, 10, 3, { color: 'tileGreen', curl: 0.5 });
    tiledRoof(r, 0, 0, 0, 12, 6, 3, { color: 'tileGreen', curl: 0.5, ridge: 6 });
    expect(p.triangles()).toBe(4 * 2 + 2);
    expect(r.triangles()).toBeGreaterThan(p.triangles());
  });

  it('a tier stack returns the apex height and every tier is narrower than the one below', () => {
    const g = geo();
    const top = tiers(g, 0, 0, 0, { wall: 'whiteConcrete', roof: 'slate', w: 10, shrink: 0.8, tiers: 4, tierH: 4, roofRise: 2, curl: 0.4, overhang: 1 });
    expect(top).toBe(4 * (4 + 2));
    expect(g.triangles()).toBeGreaterThan(4 * 10);
  });

  it('a gantry crane draws a leg pair, a girder, a boom and a cab; the detail layer adds bracing at mid and hi only', () => {
    const counts = FIDELITIES.map((f) => {
      const g = geo(f);
      gantryCrane(g, 0, 0, 0, { gauge: 12, legH: 30, boom: 30, boomRise: 5, back: 12, color: 'bridgeRed', accent: 'white' });
      return g.triangles();
    });
    expect(counts[0]).toBeGreaterThanOrEqual(counts[1] as number);
    expect(counts[1]).toBeGreaterThan(counts[2] as number);
    expect(counts[2]).toBeGreaterThan(40);
  });

  it('landscape parts follow the fidelity rules: trees, palms, fences and rings thin out toward lo', () => {
    const run = (f: 'hi' | 'mid' | 'lo'): number => {
      const g = geo(f);
      tree(g, 0, 0, 0, 10, 4);
      tree(g, 10, 0, 0, 10, 4, { cone: true });
      palm(g, 20, 0, 0, 16);
      fence(g, 0, 0, 10, 30, 10, 1.2, 2);
      annulus(g, 0, 0, 10, 10, 0, 20, 20, 4, 24, 'lawn');
      flatDisc(g, 0, 0.1, 0, 5, 5, 16, 'water', 'glass');
      flatRect(g, 0, 0.1, 0, 4, 4, 'sand');
      return g.triangles();
    };
    const [hi, mid, lo] = [run('hi'), run('mid'), run('lo')];
    expect(hi).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(lo);
  });
});

describe('the catalog completeness gate (map:landmarks, content mode)', () => {
  it('passes on the committed assets: 37 building/lm.* assets, one per landmark entry', () => {
    expect(validateLandmarkAssets()).toEqual([]);
    const onDisk = readdirSync(path.join(toolsRoot, 'assets/src/building')).filter((n) => n.startsWith('lm.'));
    expect(onDisk).toHaveLength(37);
  });

  it('fails when a landmark entry has no asset, and when an asset has no landmark entry', () => {
    const seed = seeds.get('lm.coit-tower') as LandmarkSeed;
    const extra: LandmarkSeed = { ...seed, id: 'lm.not-built' };
    const missing = validateLandmarkAssets([...seeds.values(), extra]);
    expect(missing.map((f) => f.id)).toEqual(['landmarks.asset-missing']);
    expect(missing[0]?.detail).toContain('lm.not-built');
    const fewer = validateLandmarkAssets([...seeds.values()].filter((s) => s.id !== 'lm.opera-house'));
    expect(fewer.map((f) => f.id)).toEqual(['landmarks.asset-extra']);
    expect(fewer[0]?.detail).toContain('lm.opera-house');
  });

  it('fails when a variant file is gone or the class tag is wrong', () => {
    const root = tempDir('dv-lm-');
    try {
      const dir = path.join(root, 'assets/src/building/lm.coit-tower');
      mkdirSync(dir, { recursive: true });
      cpSync(path.join(toolsRoot, 'assets/src/building/lm.coit-tower'), dir, { recursive: true });
      const seed = seeds.get('lm.coit-tower') as LandmarkSeed;
      expect(validateLandmarkAssets([seed], root)).toEqual([]);
      rmSync(path.join(dir, 'mobile.glb'));
      expect(validateLandmarkAssets([seed], root).map((f) => f.id)).toEqual(['landmarks.asset-file']);
      expect(validateLandmarkAssets([{ ...seed, cls: 'minor' }], root).map((f) => f.id)).toContain('landmarks.asset-class');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
