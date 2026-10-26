/**
 * M05c2 AC-4 (unit side): the Act 1 release index over the repository's refs. Nine Act 1 entries, each with a fallback DirectorScript and
 * cues; the keys are identical across two builds and equal the committed index; no input names `previs/`; the Worker catalog lists every
 * key. (`pnpm assets:cutscene-index -- --release act1 --check` is the file-level proof.)
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CutsceneIndex } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import { planCutsceneIndex, CATALOG_PATH } from '../cutscene-index/cli.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const AT = 1_792_697_781_070;

describe('Act 1 cutscene index', () => {
  it('has nine Act 1 entries with fallbacks and cues, stable keys equal to the committed index, and nothing from previs/', async () => {
    const a = await planCutsceneIndex({ root, release: 'act1', builtAt: AT, env: {} });
    const b = await planCutsceneIndex({ root, release: 'act1', builtAt: AT, env: {} });
    expect(a.result.problems).toEqual([]);
    const act1 = a.result.index.entries.filter((e) => e.ref.startsWith('cut.story.m.a1.'));
    expect(act1).toHaveLength(9);
    for (const e of act1) {
      expect(e.fallback, e.ref).toBeTruthy();
      expect(e.cues.length, e.ref).toBeGreaterThan(0);
    }
    expect(a.result.index.entries.map((e) => [e.ref, e.key])).toEqual(b.result.index.entries.map((e) => [e.ref, e.key]));
    const committed = JSON.parse(readFileSync(path.join(root, 'assets/src/data/cutscene-index/index.json'), 'utf8')) as CutsceneIndex;
    expect(Object.fromEntries(committed.entries.map((e) => [e.ref, e.key]))).toEqual(Object.fromEntries(a.result.index.entries.map((e) => [e.ref, e.key])));
    for (const r of a.result.requests) expect(JSON.stringify(r.keyInput.inputHashes), r.ref).not.toContain('previs/');
    const catalog = JSON.parse(readFileSync(path.join(root, CATALOG_PATH), 'utf8')) as { keys: string[] };
    for (const e of act1) expect(catalog.keys, e.ref).toContain(e.key);
    expect(existsSync(path.join(root, 'content/cutscenes/beats.lock.json'))).toBe(true);
  });
});
