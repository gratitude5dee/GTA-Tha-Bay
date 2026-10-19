/** M00f AC-2 (subset half): the subset tool refuses excluded columns by class and name-like values. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { toolsRoot } from '../lib/common.ts';
import { extractSubset, parseCsv } from '../third-party-subset.ts';
import { buildCase, cleanupCases, DATA_PATH, ENTRY, NAME_LIKE, SUBSET_CSV } from './third-party-fixtures.ts';

afterAll(cleanupCases);

function withFields(root: string, fields: string[]): void {
  const file = path.join(root, 'docs/legal/third-party-reuse.json');
  const reg = JSON.parse(readFileSync(file, 'utf8')) as { entries: Array<{ allowedPaths: Array<{ path: string; fields?: unknown }> }> };
  reg.entries[0]!.allowedPaths.find((i) => i.path === DATA_PATH)!.fields = fields.map((name) => ({ name, note: 'n' }));
  writeFileSync(file, JSON.stringify(reg));
}

const run = (root: string, real = null as Parameters<typeof extractSubset>[0]['real']) =>
  extractSubset({ root, entry: ENTRY, allowedPath: DATA_PATH, upstreamFile: SUBSET_CSV, real });

describe('reuse:subset (M00f)', () => {
  it('parses the fixture CSV', () => {
    expect(parseCsv(readFileSync(SUBSET_CSV, 'utf8'))).toHaveLength(3);
  });

  it('keeps only the allowed columns and writes under the given root, never the repository', () => {
    const c = buildCase('clean');
    const res = run(c.root);
    expect(res.file.startsWith(c.root)).toBe(true);
    const rows = JSON.parse(readFileSync(res.file, 'utf8')) as Array<Record<string, string>>;
    expect(rows.map((r) => Object.keys(r).sort())).toEqual([['category', 'sector'], ['category', 'sector'], ['category', 'sector']]);
    expect(rows.map((r) => r.category)).toEqual(['tools', 'apps', 'tools']);
    expect(existsSync(path.join(toolsRoot, 'third_party'))).toBe(false);
  });

  it('refuses every excluded column of subset.csv, naming its class', () => {
    const cols = ['name', 'url', 'coordinate', 'address', 'neighbourhood', 'osm_id', 'person', 'logo', 'tagline', 'city', 'building_id', 'footprint_link'];
    const classes = ['name', 'URL', 'coordinate', 'address', 'neighbourhood', 'OSM id', 'person', 'logo', 'tagline', 'city', 'building id', 'footprint link'];
    for (const [i, col] of cols.entries()) {
      const c = buildCase('clean');
      withFields(c.root, ['category', col]);
      expect(() => run(c.root), col).toThrow(new RegExp(`"${col}" is an excluded .*`));
      try {
        run(c.root);
      } catch (e) {
        expect((e as Error).message).toContain(`excluded ${classes[i]} field`);
      }
    }
  });

  it('refuses the name-like enumeration value when the stub real-side list is set', () => {
    const c = buildCase('clean');
    withFields(c.root, ['category', 'segment']);
    expect(() => run(c.root, { schema: 'names/1', entries: [{ id: 'fx-1', real: NAME_LIKE }] })).toThrow(/real-side name registry/);
    expect(run(c.root).rows).toBe(3);
  });

  it('refuses a field with more than 32 distinct values', () => {
    const c = buildCase('clean');
    const big = path.join(c.root, 'big.json');
    writeFileSync(big, JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ category: `v${i}`, sector: 's' }))));
    expect(() => extractSubset({ root: c.root, entry: ENTRY, allowedPath: DATA_PATH, upstreamFile: big })).toThrow(/distinct values/);
  });
});
