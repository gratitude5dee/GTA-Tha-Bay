import { describe, expect, it } from 'vitest';
import { jobKey, type JobKeyInput } from '../src/index.ts';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

function input(over: Partial<JobKeyInput> = {}): JobKeyInput {
  return {
    kind: 'cutscene_shot',
    endpointId: 'minimax/h3/image-to-video',
    pinnedUpdatedAt: null,
    params: { seed: 7, durationS: 6 },
    inputSha256: [H1, H2],
    promptTemplate: 'mock@1',
    promptSha256: H1,
    recipe: 'cut@1',
    ...over,
  };
}

describe('jobKey', () => {
  it('is a lowercase SHA-256 hex string', () => {
    expect(jobKey(input())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on key order or input order', () => {
    const a = jobKey(input());
    const b = jobKey(input({ params: { durationS: 6, seed: 7 }, inputSha256: [H2, H1.toUpperCase()] }));
    expect(b).toBe(a);
  });

  it('changes with the seed, the endpoint pin and the recipe', () => {
    const base = jobKey(input());
    expect(jobKey(input({ params: { seed: 8, durationS: 6 } }))).not.toBe(base);
    expect(jobKey(input({ pinnedUpdatedAt: '2026-10-18' }))).not.toBe(base);
    expect(jobKey(input({ recipe: 'cut@2' }))).not.toBe(base);
  });

  it('rejects a missing seed and a bad input hash', () => {
    expect(() => jobKey(input({ params: { durationS: 6 } }))).toThrow(/seed/);
    expect(() => jobKey(input({ params: { seed: 1.5 } }))).toThrow(/seed/);
    expect(() => jobKey(input({ inputSha256: ['not-a-hash'] }))).toThrow(/SHA-256/);
  });
});
