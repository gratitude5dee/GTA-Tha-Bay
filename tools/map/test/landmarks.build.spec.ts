/**
 * M02d1: the twelve landmark recipes, their committed files and the build command. AC-2 (byte-identical rebuild), AC-3 (budgets),
 * AC-4 (authored provenance, no image decoder in the recipes).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, toolsRoot } from '../../ci/lib/common.ts';
import type { BudgetRow } from '../../assets/src/verify.ts';
import { loadContentWorld } from '../src/content.ts';
import { buildModel, diffPlan, paramFindings, planAsset, type BaseParams } from '../src/landmarks/kit/build.ts';
import { FIDELITIES, variantOf } from '../src/landmarks/kit/fidelity.ts';
import { RECIPES } from '../src/landmarks/index.ts';
import { buildLandmarks, validateLandmarkSeeds } from '../src/verify/landmarks.ts';

const TWELVE = [
  'lm.city-hall', 'lm.golden-gate-bridge', 'lm.bay-bridge-ybi', 'lm.coit-tower', 'lm.ferry-building', 'lm.pyramid-tower',
  'lm.crown-tower', 'lm.sutro-tower', 'lm.palace-fine-arts', 'lm.alcatraz', 'lm.twin-peaks', 'lm.lombard-crooked',
];
const seeds = new Map(loadContentWorld().landmarks.map((l) => [l.id, l] as const));
const budgets = readJson<{ rows: BudgetRow[] }>(path.join(toolsRoot, 'config/asset-budgets.json')).rows;
const rowFor = (cls: string): BudgetRow => budgets.find((r) => r.tag === `lm-class:${cls}`) as BudgetRow;

describe('the twelve recipes', () => {
  it('are the first twelve landmarks of the section 7 table, in order', () => {
    expect(RECIPES.map((r) => r.id)).toEqual(TWELVE);
    expect(validateLandmarkSeeds().filter((f) => f.level === 'fail')).toEqual([]);
  });

  it('read the parameters of their entry in content/world/landmarks.json: same keys, same types', () => {
    for (const r of RECIPES) {
      const seed = seeds.get(r.id);
      expect(seed?.recipe, r.id).toBeDefined();
      expect(paramFindings(r, seed?.recipe), r.id).toEqual([]);
    }
    expect(paramFindings(RECIPES[0] as never, { yawDeg: 0 })).not.toEqual([]);
    expect(paramFindings(RECIPES[0] as never, { ...(RECIPES[0] as { defaults: object }).defaults, extra: 1 })).toEqual([expect.stringContaining('extra is not used')]);
  });

  it('build within the triangle and render-object budgets of their class, with falling triangle counts', async () => {
    for (const r of RECIPES) {
      const seed = seeds.get(r.id)!;
      const row = rowFor(seed.cls);
      const tris: number[] = [];
      for (const [i, f] of FIDELITIES.entries()) {
        const { stats } = await buildModel(r, seed.recipe as unknown as BaseParams, f);
        const cols = [row.fidelity.hi, row.fidelity.mid, row.fidelity.lo][i]!;
        expect(stats.tris, `${r.id} ${f} tris`).toBeLessThanOrEqual(cols.tris!);
        expect(stats.primitives, `${r.id} ${f} objects`).toBeLessThanOrEqual(cols.maxObjects!);
        expect(stats.tris, `${r.id} ${f} has geometry`).toBeGreaterThan(20);
        tris.push(stats.tris);
      }
      expect(tris[0], `${r.id} hi > mid`).toBeGreaterThan(tris[1] as number);
      expect(tris[1], `${r.id} mid > lo`).toBeGreaterThan(tris[2] as number);
    }
  }, 120_000);
});

describe('the committed landmark files (AC-2)', () => {
  it('rebuild byte-identically: all 36 .glb files, their asset.json stats and their provenance records', async () => {
    const r = await buildLandmarks({ check: true });
    expect(r.findings).toEqual([]);
    expect(r.plans).toHaveLength(12);
    expect(r.plans.flatMap((p) => p.files)).toHaveLength(36);
  }, 120_000);

  it('check fails on a changed file, a missing file and a stale provenance record', async () => {
    const def = RECIPES.find((x) => x.id === 'lm.coit-tower')!;
    const plan = await planAsset(def, seeds.get(def.id)!.recipe as unknown as BaseParams, 'hero');
    expect(diffPlan(toolsRoot, plan)).toEqual([]);
    const other = { ...plan, files: plan.files.map((f, i) => (i === 0 ? { ...f, bytes: Buffer.from('x') } : f)) };
    expect(diffPlan(toolsRoot, other)).toEqual([{ path: plan.files[0]!.path, why: 'differs' }]);
    const missing = { ...plan, dir: 'assets/src/building/lm.not-there', files: plan.files.map((f) => ({ ...f, path: f.path.replace('lm.coit-tower', 'lm.not-there') })) };
    expect(diffPlan(toolsRoot, missing).map((d) => d.why)).toContain('missing');
  });

  it('each asset has desktop, mobile and mobile-low variants and records VariantStats equal to a fresh build', () => {
    for (const id of TWELVE) {
      const dir = path.join(toolsRoot, 'assets/src/building', id);
      const spec = JSON.parse(readFileSync(path.join(dir, 'asset.json'), 'utf8')) as { variants: Record<string, string>; stats: Record<string, { tris: number; verts: number; primitives: number; materials: number }>; tags: string[]; codec: { mesh: string } };
      expect(Object.keys(spec.variants).sort(), id).toEqual(['desktop', 'mobile', 'mobile-low']);
      expect(Object.keys(spec.stats).sort(), id).toEqual(['desktop', 'mobile', 'mobile-low']);
      expect(spec.tags, id).toContain(`lm-class:${seeds.get(id)!.cls}`);
      expect(spec.codec).toEqual({ mesh: 'meshopt' });
      for (const f of FIDELITIES) expect(existsSync(path.join(toolsRoot, spec.variants[variantOf(f)] as string)), `${id} ${f}`).toBe(true);
    }
  });
});

describe('provenance and IP (AC-4)', () => {
  it('every landmark .glb has an authored record under LicenseRef-DeeVerse-Owned', async () => {
    const r = await buildLandmarks({ check: true });
    for (const p of r.plans) {
      for (const rec of p.records) {
        const doc = JSON.parse(readFileSync(path.join(toolsRoot, rec.path), 'utf8')) as { origin: string; license: string; kind: string; ai_generated: boolean; paths: string[]; tool: { name: string }; derived_from: string[] };
        expect(doc.origin, rec.path).toBe('authored');
        expect(doc.license, rec.path).toBe('LicenseRef-DeeVerse-Owned');
        expect(doc.kind).toBe('building');
        expect(doc.ai_generated).toBe(false);
        expect(doc.tool.name).toBe('tools/map landmarks');
        expect(doc.derived_from).toEqual([]);
        expect(doc.paths[0]).toMatch(/^assets\/src\/building\/lm\.[a-z-]+\/(desktop|mobile|mobile-low)\.glb$/);
      }
    }
  }, 120_000);

  it('no recipe module imports an image decoder or reads an image file', () => {
    const dir = path.join(toolsRoot, 'tools/map/src/landmarks');
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|mts)$/.test(n)) files.push(p);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThanOrEqual(20);
    // the dev-only preview rasteriser writes a PNG (pngjs); it is not a recipe and nothing in the pipeline reads it
    const recipeFiles = files.filter((f) => !f.endsWith('preview.ts'));
    const banned = /from ['"](?:pngjs|sharp|jimp|upng-js|jpeg-js|canvas|@napi-rs\/canvas|image-size|node:fs|fs)['"]|\.(?:png|jpe?g|webp|ktx2|tga|bmp|gif)['"`]|readFile|createReadStream|fetch\(/;
    for (const f of recipeFiles) {
      const text = readFileSync(f, 'utf8');
      // the build module is the only one allowed to touch the file system (it writes the .glb files)
      if (f.endsWith(path.join('kit', 'build.ts'))) continue;
      expect(banned.test(text), path.relative(toolsRoot, f)).toBe(false);
    }
    const build = readFileSync(path.join(dir, 'kit/build.ts'), 'utf8');
    expect(/\.(?:png|jpe?g|webp|ktx2|tga|bmp|gif)['"`]/.test(build)).toBe(false);
    expect(/pngjs|sharp|jimp/.test(build)).toBe(false);
  });

  it('the models carry no text: no recipe has a string that could be lettering, and the file names pass the id rule', () => {
    for (const id of TWELVE) expect(id).toMatch(/^lm\.[a-z0-9-]{2,60}$/);
    const dir = path.join(toolsRoot, 'tools/map/src/landmarks');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && n !== 'index.ts')) {
      const text = readFileSync(path.join(dir, f), 'utf8');
      // text, logo or lettering would need a font or a canvas
      expect(/fillText|strokeText|TextGeometry|FontLoader|font/i.test(text.replace(/\/\*[\s\S]*?\*\//g, '')), f).toBe(false);
    }
  });
});
