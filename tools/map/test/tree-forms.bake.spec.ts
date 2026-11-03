import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TREE_FORM_NAMES, decodeL0, decodeP0, sha256Hex } from '../../../packages/shared/src/index.ts';
import { TOOL_ID, TOOL_VERSION, loadTreeForms, mapSchema, rawDirOf } from '../src/config.ts';
import { runWater, treeRecord, type TreeRow } from '../src/stages/s3-water.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

/**
 * M02h4 AC-2 (bake half): `config/world/tree-forms.json` validates against its schema; S3 writes the form into the TREE byte (the scale
 * is unchanged); every tree byte of the `synth` and `civic-excerpt` bakes is 0..4, with all five forms in `synth`; the S3 tree output is
 * identical on a repeated run (`bake.repro.spec.ts` compares every byte of two civic bakes); both bakes carry `tools/map@0.4.0`, so their
 * `bakeId`s differ from the parent's; `bake-report.json` has `treeForms` and `treeUnmatched`.
 */
const TABLE = loadTreeForms();
/** The synth bakeId of the parent (M02h5: `docs/look/M02h4-render-ledger.json`, tools/map@0.4.0). */
const PARENT_SYNTH = 'f73a47b756ac5cb1358c40859d017811b1f556e5c28742df09da09107821ebe9';

describe('tree forms table (AC-2)', () => {
  it('validates against tools/map/schemas/tree-forms.schema.json, and a broken table does not', () => {
    expect(mapSchema('tree-forms')(TABLE)).toEqual([]);
    expect(mapSchema('tree-forms')({ ...TABLE, genus: { platanus: 'oak' } }).length).toBeGreaterThan(0);
    expect(mapSchema('tree-forms')({ ...TABLE, fallback: { planeShare: 2 } }).length).toBeGreaterThan(0);
    expect(TABLE.fallback.planeShare).toBe(0.6);
  });

  it('S3 writes the form; the scale is the same hash as before M02h4', () => {
    const r = treeRecord(37.7793, -122.4193, 'Phoenix canariensis :: Canary Island Date Palm', 4);
    expect(r[3]).toBe(4);
    expect(r[2]).toBeGreaterThanOrEqual(0.75);
    expect(r[2]).toBeLessThanOrEqual(1.25);
  });

  it('the S3 tree output of the synth raw rows is identical on a repeated run and every lane is a form', () => {
    const file = path.join(rawDirOf('synth'), 'tkzw-k3nq.jsonl');
    if (!existsSync(file)) {
      if (process.env['DV_REQUIRE_BAKE'] === '1') throw new Error('no synth raw rows (run pnpm map:build -- --area synth)');
      console.log('SKIP tree-forms.bake: no synth raw rows');
      return;
    }
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TreeRow);
    const grid = { minX: 0, minZ: 0, maxX: 256, maxZ: 256 } as never;
    const run = (): ReturnType<typeof runWater> => runWater({ grid, osm: [], parks: [], hoods: [], trees: rows, treeForms: TABLE, minRingKm2: 0, baseLandHint: () => true });
    const a = run();
    const b = run();
    expect(sha256Hex(new Uint8Array(new Float64Array(a.trees).buffer))).toBe(sha256Hex(new Uint8Array(new Float64Array(b.trees).buffer)));
    expect(a.treeReport).toEqual(b.treeReport);
    for (let i = 3; i < a.trees.length; i += 4) expect(a.trees[i]! >= 0 && a.trees[i]! <= 4).toBe(true);
    for (const n of TREE_FORM_NAMES) expect(a.treeReport.forms[n], `synth rows give ${n}`).toBeGreaterThan(0);
    expect(a.treeReport.unmatched).toEqual([]);
  });
});

describe('tree bytes of the baked worlds (AC-2)', () => {
  for (const area of ['synth', 'civic-excerpt'] as const) {
    // M02h5: a street tree's byte is still 0..4; a scatter record (bit 7) holds a tree form or Shrub 5 / Hedge 6 in its low bits
    it(`${area}: every street-tree byte is 0..4${area === 'synth' ? ' with all five forms' : ''}, every other byte a scatter record; the report has treeForms and treeUnmatched; the bakeId is a 0.5.0 one`, () => {
      const bake = requireBake(area, `tree-forms.bake ${area}`);
      if (!bake) return;
      const report = JSON.parse(readFileSync(path.join(bake.dir, 'bake-report.json'), 'utf8')) as {
        bakeId: string; toolVersion: string; counts: { trees: number }; treeForms?: Record<string, number>; treeUnmatched?: { name: string; count: number }[];
      };
      expect(mapSchema('bake-report')(report)).toEqual([]);
      expect(report.toolVersion).toBe(TOOL_ID);
      expect(TOOL_VERSION).toBe('0.5.0');
      if (area === 'synth') expect(report.bakeId).not.toBe(PARENT_SYNTH);
      expect(report.treeForms, 'bake-report.json treeForms').toBeDefined();
      expect(Array.isArray(report.treeUnmatched)).toBe(true);
      expect(Object.values(report.treeForms ?? {}).reduce((n, v) => n + v, 0)).toBe(report.counts.trees);
      let scatter = 0;
      const seen = [0, 0, 0, 0, 0];
      let trees = 0;
      const dir = path.join(bake.dir, 'packs');
      for (const name of readdirSync(dir).filter((n) => /^l0-\d+-\d+\.pack$/.test(n)).sort()) {
        const sims = decodeP0(new Uint8Array(readFileSync(path.join(dir, name.replace('l0-', 'p0-')))));
        for (const c of decodeL0(new Uint8Array(readFileSync(path.join(dir, name))), sims)) {
          for (let i = 3; i < c.trees.length; i += 4) {
            const b = c.trees[i] as number;
            if (b >= 128) {
              expect((b & 0x7f) <= 6 && Number.isInteger(b), `${c.key} scatter byte ${b}`).toBe(true);
              scatter++;
              continue;
            }
            expect(b >= 0 && b <= 4 && Number.isInteger(b), `${c.key} tree byte ${b}`).toBe(true);
            seen[b] = (seen[b] as number) + 1;
            trees++;
          }
        }
      }
      expect(trees).toBeGreaterThan(0);
      if (area === 'synth') expect(scatter, 'synth scatter records').toBeGreaterThan(0);
      if (area === 'synth') for (let f = 0; f < 5; f++) expect(seen[f], `synth form ${TREE_FORM_NAMES[f]}`).toBeGreaterThan(0);
      console.log(`tree-forms.bake ${area}: ${trees} baked trees by form ${seen.join('/')}; report ${JSON.stringify(report.treeForms)}; unmatched ${JSON.stringify(report.treeUnmatched?.slice(0, 5))}`);
    });
  }
});
