/** AC-4 and AC-5 of M01d: each asset-gate rule on a temp-copy fixture, and the repository itself passes. */
import { rmSync, unlinkSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readLock } from '../../assets/src/lock.ts';
import { addAsset, put, tempRepo } from '../../assets/test/helpers.ts';
import { runCheckAssets } from '../check-assets.ts';
import { toolsRoot } from '../lib/common.ts';
import { runProvenanceCheck } from '../provenance-check.ts';
import { writeThirdPartyLicences } from '../third-party-licenses.ts';

const roots: string[] = [];
function repo(): string {
  const r = tempRepo();
  roots.push(r);
  return r;
}
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const MIB = 1024 * 1024;
const POINTER = '{\n  "schema": "asset-catalog-pointer/1",\n  "sha256": "SHA",\n  "key": "manifests/assets-SHA.json",\n  "bytes": 10\n}\n';
function putPointers(root: string): void {
  const text = POINTER.replaceAll('SHA', 'a'.repeat(64));
  put(root, 'apps/web/public/asset-catalog.json', text);
  put(root, 'services/edge/src/generated/asset-catalog.json', text);
}
function run(root: string, baseline = readLock(root)) {
  const dist = path.join(root, 'no-dist');
  return runCheckAssets({ root, dist, verify: { baseline } }).findings;
}
const rules = (f: { rule: string }[]): string[] => f.map((x) => x.rule);

describe('check:assets (M01d rules)', () => {
  it('passes on a clean copy of the seed assets', () => {
    const root = repo();
    putPointers(root);
    expect(run(root)).toEqual([]);
  });

  it('passes on the repository itself', () => {
    const res = runCheckAssets({ root: toolsRoot, dist: path.join(toolsRoot, 'no-dist') });
    expect(res.findings).toEqual([]);
  });

  it('reports a missing provenance record', () => {
    const root = repo();
    putPointers(root);
    expect(run(root)).toEqual([]);
    const h = readLock(root)?.entries['data/asset-smoke']?.variants.default as string;
    unlinkSync(path.join(root, `assets/provenance/${h.slice(0, 2)}/${h}.json`));
    expect(rules(run(root))).toContain('no-record');
  });

  it('reports spec hash ≠ lock', () => {
    const root = repo();
    putPointers(root);
    put(root, 'assets/src/data/asset-smoke/smoke.json', '{"changed":1}\n');
    const f = run(root);
    expect(rules(f)).toContain('spec-hash-mismatch');
    expect(f.find((x) => x.rule === 'spec-hash-mismatch')?.detail).toContain('spec hash ≠ lock');
  });

  it('reports a rev lower than the previous lock', () => {
    const root = repo();
    putPointers(root);
    const base = readLock(root);
    const tex = base?.entries['texture/asset-smoke'];
    expect(tex).toBeDefined();
    const higher = { ...base, schema: 'asset-lock/1' as const, entries: { ...base?.entries, 'texture/asset-smoke': { ...tex, rev: 5 } } } as NonNullable<typeof base>;
    expect(rules(run(root, higher))).toContain('rev-regression');
  });

  it('reports a world_pack of 4 MiB + 1 byte', () => {
    const root = repo();
    putPointers(root);
    addAsset(root, { kind: 'world_pack', id: 'big-pack', variants: { default: { ext: 'pack', bytes: Buffer.alloc(4 * MIB + 1, 7) } } });
    expect(rules(run(root))).toContain('pack-too-large');
    // exactly 4 MiB is allowed
    const ok = repo();
    putPointers(ok);
    addAsset(ok, { kind: 'world_pack', id: 'ok-pack', variants: { default: { ext: 'pack', bytes: Buffer.alloc(4 * MIB, 7) } } });
    expect(rules(run(ok))).not.toContain('pack-too-large');
  });

  it('reports a texture without mobile-low and without default', () => {
    const root = repo();
    putPointers(root);
    addAsset(root, { kind: 'texture', id: 'no-low', variants: { desktop: { ext: 'png', bytes: 'a1' }, mobile: { ext: 'png', bytes: 'a2' } } });
    const r = rules(run(root));
    expect(r).toContain('missing-fidelity');
    expect(r).toContain('tier-unresolved');
  });

  it('reports a dependency cycle, a missing dep and an inactive dep', () => {
    const root = repo();
    putPointers(root);
    addAsset(root, { kind: 'data', id: 'cyc-a', variants: { default: { ext: 'json', bytes: '{"a":1}' } }, deps: ['data/cyc-b'] });
    addAsset(root, { kind: 'data', id: 'cyc-b', variants: { default: { ext: 'json', bytes: '{"b":1}' } }, deps: ['data/cyc-a', 'data/nope', 'data/dead'] });
    addAsset(root, { kind: 'data', id: 'dead', variants: { default: { ext: 'json', bytes: '{"d":1}' } }, status: 'killed' });
    const r = rules(run(root));
    expect(r).toContain('dep-cycle');
    expect(r).toContain('dep-missing');
    expect(r).toContain('dep-inactive');
  });

  it('reports a killed entry that is still in the lock', () => {
    const root = repo();
    putPointers(root);
    addAsset(root, { kind: 'data', id: 'to-kill', variants: { default: { ext: 'json', bytes: '{"k":1}' } } });
    put(root, 'assets/src/data/to-kill/asset.json', JSON.stringify({ kind: 'data', id: 'to-kill', variants: { default: 'assets/src/data/to-kill/default.json' }, deps: [], tags: [], status: 'killed', visibility: 'public' }));
    expect(rules(run(root))).toContain('non-public-in-lock');
    const priv = repo();
    putPointers(priv);
    addAsset(priv, { kind: 'data', id: 'to-hide', variants: { default: { ext: 'json', bytes: '{"h":1}' } } });
    put(priv, 'assets/src/data/to-hide/asset.json', JSON.stringify({ kind: 'data', id: 'to-hide', variants: { default: 'assets/src/data/to-hide/default.json' }, deps: [], tags: [], status: 'active', visibility: 'private' }));
    expect(rules(run(priv))).toContain('non-public-in-lock');
  });

  it('reports differing pointer copies and a missing pointer', () => {
    const root = repo();
    putPointers(root);
    put(root, 'services/edge/src/generated/asset-catalog.json', POINTER.replaceAll('SHA', 'b'.repeat(64)));
    expect(rules(run(root))).toContain('pointer-copies-differ');
    const none = repo();
    expect(rules(run(none))).toContain('pointer-missing');
  });

  it('enforces the file-bytes budget and validates the budget config', () => {
    const root = repo();
    putPointers(root);
    addAsset(root, { kind: 'vehicle', id: 'big-car', tags: ['class:race'], variants: { desktop: { ext: 'glb', bytes: Buffer.alloc(8 * MIB + 1) }, mobile: { ext: 'glb', bytes: 'm' }, 'mobile-low': { ext: 'glb', bytes: 'l' } } });
    expect(rules(run(root))).toContain('budget-file-bytes');
    const bad = repo();
    putPointers(bad);
    put(bad, 'config/asset-budgets.json', '{"schema":"asset-budgets/2","rows":[]}');
    expect(rules(run(bad))).toContain('schema');
  });
});

describe('provenance:check with lock variants (AC-5)', () => {
  it('fails naming the hash when a lock variant has no record, and the repository passes', () => {
    const root = repo();
    const dist = mkdtempSync(path.join(os.tmpdir(), 'dv-dist-'));
    roots.push(dist);
    expect(runProvenanceCheck({ root, dist }).findings).toEqual([]);
    const lock = readLock(root);
    const h = lock?.entries['texture/asset-smoke']?.variants.desktop as string;
    unlinkSync(path.join(root, `assets/provenance/${h.slice(0, 2)}/${h}.json`));
    const f = runProvenanceCheck({ root, dist }).findings;
    expect(f.some((x) => x.rule === 'no-record' && x.detail.includes(h))).toBe(true);
    writeThirdPartyLicences(toolsRoot, path.join(dist, 'third-party-licenses.txt')); // as pnpm build does (M00f item 1)
    const real = runProvenanceCheck({ root: toolsRoot, dist });
    expect(real.findings).toEqual([]);
  });
});
