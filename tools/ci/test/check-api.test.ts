import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_DIR, compare, dtoNames, generate } from '../check-api.ts';
import { repoRoot } from '../run.ts';

describe('check:api (M05d)', () => {
  it('lists the exported interfaces and type aliases of a source, not its constants', () => {
    expect(dtoNames("export const X = 1;\nexport interface A { a: string }\nexport type B = 'x' | 'y';\ninterface Hidden {}\n")).toEqual(['A', 'B']);
  });

  it('the committed schemas match the types of api/v1.ts (no drift)', () => {
    const { files, errors } = generate();
    expect(errors).toEqual([]);
    expect(files.size).toBeGreaterThan(15);
    expect(compare(files, path.join(repoRoot, SCHEMA_DIR))).toEqual({ missing: [], changed: [], stale: [] });
  });

  it('reports a missing, a changed and a stale schema file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dv-api-'));
    writeFileSync(path.join(dir, 'Same.schema.json'), '{}\n');
    writeFileSync(path.join(dir, 'Changed.schema.json'), '{"old":true}\n');
    writeFileSync(path.join(dir, 'Gone.schema.json'), '{}\n');
    const generated = new Map([
      ['Same.schema.json', '{}\n'],
      ['Changed.schema.json', '{"new":true}\n'],
      ['New.schema.json', '{}\n'],
    ]);
    expect(compare(generated, dir)).toEqual({ missing: ['New.schema.json'], changed: ['Changed.schema.json'], stale: ['Gone.schema.json'] });
  });

  it('a field added to a DTO changes its schema', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dv-api-src-'));
    const src = path.join(dir, 'v1.ts');
    writeFileSync(src, 'export interface Req { a: string }\n');
    writeFileSync(path.join(dir, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    const before = generate(dir, 'v1.ts').files.get('Req.schema.json');
    writeFileSync(src, 'export interface Req { a: string; b?: number }\n');
    const after = generate(dir, 'v1.ts').files.get('Req.schema.json');
    expect(before).toBeDefined();
    expect(after).not.toBe(before);
    expect(after).toContain('"b"');
  });
});
