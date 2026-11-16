/** M10d2 AC-2 and AC-3: the placeholder scan `artFinal` on three fixture trees and on the repository (`final.repo`). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { toolsRoot } from '../../ci/lib/common.ts';
import { artFinal, atPointer, repoInput, type ArtFinalInput } from '../src/final.ts';
import { readRegistry, type PlaceholderRegistry } from '../src/placeholders.ts';

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** A small repository tree: a registry, one prefab, one asset spec, one config file. */
function tree(o: { prefabAsset: string; replacedBy: string[] }): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dv-final-'));
  made.push(root);
  const w = (rel: string, body: unknown): void => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
  };
  const reg: PlaceholderRegistry = {
    schema: 'art-placeholders/1',
    rows: [{ id: 'vehicles', what: 'Gray-box sedans for the fixture', owner: 'M10d1', match: '^vehicle/graybox\\.', replacedBy: o.replacedBy }],
  };
  w('config/art-placeholders.json', reg);
  w('assets/prefabs/vehicle.sedan.json', { id: 'vehicle.sedan', render: { asset: o.prefabAsset } });
  w('assets/src/vehicle/traffic.sedan/asset.json', {
    kind: 'vehicle', id: 'traffic.sedan', variants: { default: 'assets/src/vehicle/traffic.sedan/default.glb' }, deps: [], tags: [], status: 'active', visibility: 'public',
  });
  w('assets/src/vehicle/traffic.sedan/default.glb', 'glTF');
  w('config/world/example.json', { note: 'no stand-ins here' });
  return root;
}

describe('artFinal on fixture trees (AC-2)', () => {
  it('fails a vehicle/graybox.sedan ref under rule 1, naming file and ref', () => {
    const res = artFinal(repoInput(tree({ prefabAsset: 'vehicle/graybox.sedan', replacedBy: ['vehicle/traffic.sedan'] })));
    expect(res.status).toBe('pending');
    expect(res.findings).toEqual([{ file: 'assets/prefabs/vehicle.sedan.json', ref: 'vehicle/graybox.sedan', rule: 1, row: 'vehicles' }]);
  });

  it('fails an empty replacedBy under rule 2, naming the entry', () => {
    const res = artFinal(repoInput(tree({ prefabAsset: 'vehicle/traffic.sedan', replacedBy: [] })));
    expect(res.status).toBe('pending');
    expect(res.findings).toEqual([{ file: 'config/art-placeholders.json', ref: 'vehicles', rule: 2, row: 'vehicles' }]);
  });

  it('passes the clean tree', () => {
    const res = artFinal(repoInput(tree({ prefabAsset: 'vehicle/traffic.sedan', replacedBy: ['vehicle/traffic.sedan'] })));
    expect(res).toEqual({ status: 'pass', findings: [] });
  });

  it('fails a replacedBy ref missing from the catalog under rule 2', () => {
    const res = artFinal(repoInput(tree({ prefabAsset: 'vehicle/traffic.sedan', replacedBy: ['vehicle/traffic.coupe'] })));
    expect(res.findings).toEqual([{ file: 'config/art-placeholders.json', ref: 'vehicle/traffic.coupe', rule: 2, row: 'vehicles' }]);
  });

  it('checks rule 3: a row with holds must find its refs at the JSON pointer', () => {
    const base: ArtFinalInput = {
      registry: {
        schema: 'art-placeholders/1',
        rows: [{ id: 'cards', what: 'The card atlas of the fixture', owner: 'M10d2', match: '^texture/cards$', replacedBy: ['texture/cards'], holds: { file: 'config/b.json', pointer: '/atlas/asset' } } as PlaceholderRegistry['rows'][number]],
      },
      files: [],
      catalog: [{ ref: 'texture/cards', file: 'assets/world/x.lock.json' }],
    };
    expect(artFinal({ ...base, readJson: () => ({ atlas: { asset: 'texture/cards' } }) }).status).toBe('pass');
    const bad = artFinal({ ...base, readJson: () => ({ atlas: { asset: 'texture/old' } }) });
    expect(bad.findings).toEqual([{ file: 'config/b.json#/atlas/asset', ref: 'texture/cards', rule: 3, row: 'cards' }]);
    expect(atPointer({ a: [{ 'b/c': 1 }] }, '/a/0/b~1c')).toBe(1);
  });

  it('resolves code/<name> refs only through the modules that exist', () => {
    const input: ArtFinalInput = {
      registry: { schema: 'art-placeholders/1', rows: [{ id: 'sky', what: 'A code placeholder of the fixture', owner: 'M10d2', match: 'code:sky', replacedBy: ['code/atmosphere-takram'] }] },
      files: [],
      catalog: [],
    };
    expect(artFinal(input).findings.map((f) => f.rule)).toEqual([2]);
    expect(artFinal({ ...input, codeRefs: new Set(['code/atmosphere-takram']) }).status).toBe('pass');
  });
});

describe('final.repo (AC-3)', () => {
  const owners = new Map(readRegistry(toolsRoot).rows.map((r) => [r.id, r.owner]));

  it('names only rows owned by M10d3 in every finding on the repository', () => {
    const res = artFinal(repoInput(toolsRoot));
    // M10d3 runs last and turns this case to zero findings (its AC-10).
    for (const f of res.findings) {
      expect(f.row, `${f.file} ${f.ref} (rule ${f.rule}) names no registry row`).toBeDefined();
      expect(owners.get(f.row as string), `${f.file} ${f.ref}`).toBe('M10d3');
    }
    for (const owner of ['M10d1', 'M10d4', 'M10d5', 'M10d2']) {
      expect(res.findings.filter((f) => owners.get(f.row ?? '') === owner)).toEqual([]);
    }
  });
});
