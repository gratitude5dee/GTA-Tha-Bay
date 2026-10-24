import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { CutsceneManifest } from '../src/contracts/c09-cutscene.ts';

const here = import.meta.dirname;
const root = path.resolve(here, '../../..');
const schema = JSON.parse(readFileSync(path.join(here, '../schemas/cutscene-manifest-1.schema.json'), 'utf8')) as { required: string[]; properties: Record<string, unknown> };
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const FIXTURES = ['fixture-a', 'fixture-b'] as const;
const dirOf = (id: string): string => path.join(root, 'tests/fixtures/cutscenes', id);
const load = (id: string): CutsceneManifest => JSON.parse(readFileSync(path.join(dirOf(id), 'manifest.json'), 'utf8')) as CutsceneManifest;

/** The keys of `interface CutsceneManifest` in the contract source, split by whether they are optional. */
function manifestKeys(): { required: string[]; optional: string[] } {
  const file = path.join(here, '../src/contracts/c09-cutscene.ts');
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const out = { required: [] as string[], optional: [] as string[] };
  sf.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'CutsceneManifest') {
      for (const m of n.members) {
        if (ts.isPropertySignature(m) && ts.isIdentifier(m.name)) (m.questionToken ? out.optional : out.required).push(m.name.text);
      }
    }
  });
  return out;
}

describe('cutscene-manifest-1.schema.json', () => {
  it('has the required keys of CutsceneManifest and describes every key', () => {
    const keys = manifestKeys();
    expect([...schema.required].sort()).toEqual([...keys.required].sort());
    expect(Object.keys(schema.properties).sort()).toEqual([...keys.required, ...keys.optional].sort());
  });

  for (const id of FIXTURES) {
    it(`${id}: the manifest validates and every rendition matches its file`, () => {
      const m = load(id);
      expect(validate(m), JSON.stringify(validate.errors)).toBe(true);
      expect(m.provenance.aiGenerated).toBe(true);
      expect(m.licence.status).toBe('pending');
      const renditions = Object.values(m.renditions);
      expect(renditions.length).toBeGreaterThan(0);
      for (const r of renditions) {
        const bytes = readFileSync(path.join(dirOf(id), r.file));
        expect(bytes.length, r.file).toBe(r.bytes);
        expect(createHash('sha256').update(bytes).digest('hex'), r.file).toBe(r.sha256);
      }
      for (const f of [m.poster, m.last, ...Object.values(m.subs)]) expect(existsSync(path.join(dirOf(id), f)), f).toBe(true);
    });
  }

  it('rejects a manifest without aiGenerated: true, one with an unknown key and one without renditions', () => {
    const m = load('fixture-a');
    expect(validate({ ...m, provenance: { ...m.provenance, aiGenerated: false } })).toBe(false);
    expect(validate({ ...m, extra: 1 })).toBe(false);
    const { renditions: _r, ...rest } = m;
    expect(validate(rest)).toBe(false);
  });
});
