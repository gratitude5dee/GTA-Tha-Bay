/**
 * M02d1 AC-3: the stats columns of config/asset-budgets.json are enforced for every asset whose budget row exists. A fixture
 * landmark one triangle over its `lo` budget fails; the 12 committed landmarks pass.
 */
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { VariantId, VariantStats } from '../../../packages/shared/src/assets/c07.ts';
import { readLock } from '../../assets/src/lock.ts';
import { statsFindings, type BudgetRow } from '../../assets/src/verify.ts';
import { addAsset, put, tempRepo } from '../../assets/test/helpers.ts';
import { runCheckAssets } from '../check-assets.ts';
import { readJson, toolsRoot } from '../lib/common.ts';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const POINTER = '{\n  "schema": "asset-catalog-pointer/1",\n  "sha256": "SHA",\n  "key": "manifests/assets-SHA.json",\n  "bytes": 10\n}\n';

function repoWithLandmark(cls: 'hero' | 'major' | 'minor', stats: Partial<Record<VariantId, VariantStats>> | null): string {
  const root = tempRepo();
  roots.push(root);
  const text = POINTER.replaceAll('SHA', 'a'.repeat(64));
  put(root, 'apps/web/public/asset-catalog.json', text);
  put(root, 'services/edge/src/generated/asset-catalog.json', text);
  addAsset(root, {
    kind: 'building',
    id: 'lm.fixture',
    variants: { desktop: { ext: 'glb', bytes: 'hi-model' }, mobile: { ext: 'glb', bytes: 'mid-model' }, 'mobile-low': { ext: 'glb', bytes: 'lo-model' } },
    tags: ['landmark', `lm-class:${cls}`],
  });
  const specFile = 'assets/src/building/lm.fixture/asset.json';
  const spec = JSON.parse(readFileSync(path.join(root, specFile), 'utf8')) as Record<string, unknown>;
  if (stats) spec['stats'] = stats;
  put(root, specFile, `${JSON.stringify(spec, null, 2)}\n`);
  return root;
}

const run = (root: string) => runCheckAssets({ root, dist: path.join(root, 'no-dist'), verify: { baseline: readLock(root) } }).findings;
const rules = (f: { rule: string }[]): string[] => f.map((x) => x.rule);
const ok = (tris: number, primitives = 2): VariantStats => ({ tris, verts: tris * 2, primitives, materials: primitives });

describe('asset budgets: stats columns (M02d1)', () => {
  it('a fixture landmark exactly on its lo budget passes and one triangle over it fails', () => {
    const onLimit = repoWithLandmark('minor', { desktop: ok(5000, 3), mobile: ok(2200, 3), 'mobile-low': ok(800, 2) });
    expect(rules(run(onLimit)).filter((r) => r.startsWith('budget') || r === 'stats-missing')).toEqual([]);
    const over = repoWithLandmark('minor', { desktop: ok(5000, 3), mobile: ok(2200, 3), 'mobile-low': ok(801, 2) });
    const f = run(over).filter((x) => x.rule === 'budget-tris');
    expect(f).toHaveLength(1);
    expect(f[0]?.detail).toContain('801 tris exceeds the landmark-minor budget of 800');
  });

  it('more render objects than the row allows fails: 4 at hi, 3 at lo', () => {
    const root = repoWithLandmark('major', { desktop: ok(1000, 4), mobile: ok(1000, 3), 'mobile-low': ok(1000, 3) });
    const f = run(root).filter((x) => x.rule === 'budget-objects');
    expect(f.map((x) => x.detail.split(':')[0])).toEqual([
      expect.stringContaining('desktop'),
      expect.stringContaining('mobile-low'),
    ]);
  });

  it('an asset whose budget row lists a stats column and records none fails with stats-missing', () => {
    const root = repoWithLandmark('hero', null);
    const f = run(root).filter((x) => x.rule === 'stats-missing');
    // tris and render objects are mandatory in each of the three variants
    expect(f).toHaveLength(6);
  });

  it('a recorded texture size over the row fails, an unrecorded one is not required', () => {
    const root = repoWithLandmark('minor', { desktop: { ...ok(100), texMaxPx: 2048 }, mobile: ok(100), 'mobile-low': ok(100) });
    const f = run(root).filter((x) => x.rule === 'budget-tex');
    expect(f).toHaveLength(1);
  });

  it('statsFindings on a row without stats columns reports nothing', () => {
    const row: BudgetRow = { id: 'x', kind: 'building', fidelity: { hi: { fileBytes: 1 }, mid: { fileBytes: 1 }, lo: { fileBytes: 1 } } };
    expect(statsFindings(row, 'building/x', 'desktop', 'f', undefined)).toEqual([]);
  });

  it('the repository budgets have the landmark rows of 02-world-bake.md section 7', () => {
    const cfg = readJson<{ rows: BudgetRow[] }>(path.join(toolsRoot, 'config/asset-budgets.json'));
    const row = (id: string): BudgetRow => cfg.rows.find((r) => r.id === id) as BudgetRow;
    expect([row('landmark-hero').fidelity.hi.tris, row('landmark-hero').fidelity.mid.tris, row('landmark-hero').fidelity.lo.tris]).toEqual([30000, 12000, 4000]);
    expect([row('landmark-major').fidelity.hi.tris, row('landmark-major').fidelity.mid.tris, row('landmark-major').fidelity.lo.tris]).toEqual([12000, 5000, 1800]);
    expect([row('landmark-minor').fidelity.hi.tris, row('landmark-minor').fidelity.mid.tris, row('landmark-minor').fidelity.lo.tris]).toEqual([5000, 2200, 800]);
    for (const id of ['landmark-hero', 'landmark-major', 'landmark-minor']) {
      expect(['hi', 'mid', 'lo'].map((k) => row(id).fidelity[k as 'hi'].maxObjects)).toEqual([3, 3, 2]);
      expect(['hi', 'mid', 'lo'].map((k) => row(id).fidelity[k as 'hi'].maxTexPx)).toEqual([1024, 512, 256]);
    }
  });

  it('the 12 committed landmarks pass the repository gates', () => {
    const res = runCheckAssets({ root: toolsRoot, dist: path.join(toolsRoot, 'no-dist') });
    expect(res.findings).toEqual([]);
  });
});
