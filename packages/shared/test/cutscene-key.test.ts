import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CutsceneKeyInput } from '../src/contracts/c09-cutscene.ts';
import { cutsceneKey, normalizeKeyInput } from '../src/genai/cutscene-key.ts';
import { sha256Hex } from '../src/hash.ts';
import { canonicalize } from '../src/json.ts';

interface Vectors {
  schema: string;
  base: CutsceneKeyInput;
  baseKey: string;
  cases: { name: string; input: CutsceneKeyInput; expect: 'same' | 'different' | 'throws' }[];
}

const vectors = JSON.parse(readFileSync(path.join(import.meta.dirname, 'cutscene-key.vectors.json'), 'utf8')) as Vectors;

describe('cutsceneKey (A-03 v1)', () => {
  it('has at least the seven vectors of section D3.6 and the golden key of the base input', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(7);
    expect(cutsceneKey(vectors.base)).toBe(vectors.baseKey);
    expect(vectors.baseKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is sha256Hex(canonicalize(normalizeKeyInput(i)))', () => {
    expect(cutsceneKey(vectors.base)).toBe(sha256Hex(canonicalize(normalizeKeyInput(vectors.base))));
  });

  for (const c of vectors.cases) {
    it(c.name, () => {
      if (c.expect === 'throws') {
        expect(() => cutsceneKey(c.input)).toThrow(/cutsceneKey/);
        return;
      }
      const key = cutsceneKey(c.input);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      if (c.expect === 'same') expect(key).toBe(vectors.baseKey);
      else expect(key).not.toBe(vectors.baseKey);
    });
  }

  it('normalises: characters sorted by id, hashes sorted and lowercased', () => {
    const n = normalizeKeyInput({ ...vectors.base, characters: [...vectors.base.characters].reverse(), inputHashes: ['B'.repeat(64), 'a'.repeat(64)] });
    expect(n.characters.map((c) => c.id)).toEqual(['npc_test', 'standin_founder']);
    expect(n.inputHashes).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });

  it('does not mutate its input', () => {
    const input: CutsceneKeyInput = JSON.parse(JSON.stringify(vectors.base)) as CutsceneKeyInput;
    input.characters.reverse();
    const before = JSON.stringify(input);
    cutsceneKey(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
