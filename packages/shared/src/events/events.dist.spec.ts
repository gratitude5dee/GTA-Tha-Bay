/** Distributions: clamps, moments, determinism; the engine sources stay inside the C02 lint. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { SIM_FILES, SIM_IGNORES, determinismConfig } from '../../../../config/eslint/determinism.mjs';
import { distBounds, sampleDist } from './dist.ts';
import type { Dist } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');

function stats(d: Dist, n = 20_000): { mean: number; sd: number; min: number; max: number } {
  let s = 0;
  let s2 = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = sampleDist(d, 11, `evd:${i}:0`);
    s += v;
    s2 += v * v;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const mean = s / n;
  return { mean, sd: Math.sqrt(s2 / n - mean * mean), min, max };
}

describe('events distributions', () => {
  it('fixed returns its value; uniform stays in [lo, hi] with the right mean', () => {
    expect(sampleDist({ k: 'fixed', v: 3.5 }, 1, 's')).toBe(3.5);
    const u = stats({ k: 'uniform', lo: 10, hi: 20 });
    expect(u.min).toBeGreaterThanOrEqual(10);
    expect(u.max).toBeLessThan(20);
    expect(Math.abs(u.mean - 15)).toBeLessThan(0.1);
  });

  it('normal (Irwin-Hall of 12) has mean mu and sd sigma, and clamps', () => {
    const n = stats({ k: 'normal', mu: 100, sigma: 10, clamp: [0, 1000] });
    expect(Math.abs(n.mean - 100)).toBeLessThan(0.3);
    expect(Math.abs(n.sd - 10)).toBeLessThan(0.3);
    const c = stats({ k: 'normal', mu: 100, sigma: 10, clamp: [95, 105] });
    expect(c.min).toBeGreaterThanOrEqual(95);
    expect(c.max).toBeLessThanOrEqual(105);
  });

  it('lognormal is positive, uses exp(mu + sigma z) and clamps', () => {
    const l = stats({ k: 'lognormal', mu: -0.07, sigma: 0.03, clamp: [0.85, 1] });
    expect(l.min).toBeGreaterThanOrEqual(0.85);
    expect(l.max).toBeLessThanOrEqual(1);
    expect(Math.abs(l.mean - Math.exp(-0.07))).toBeLessThan(0.002);
  });

  it('a sample is a pure function of (seed, stream)', () => {
    const d: Dist = { k: 'normal', mu: 0, sigma: 1, clamp: [-6, 6] };
    expect(sampleDist(d, 5, 'evd:1:0')).toBe(sampleDist(d, 5, 'evd:1:0'));
    expect(sampleDist(d, 5, 'evd:1:0')).not.toBe(sampleDist(d, 5, 'evd:1:1'));
    expect(sampleDist(d, 5, 'evd:1:0')).not.toBe(sampleDist(d, 6, 'evd:1:0'));
  });

  it('distBounds gives the extremes', () => {
    expect(distBounds({ k: 'uniform', lo: -3, hi: 4 })).toEqual([-3, 4]);
    expect(distBounds({ k: 'normal', mu: 0, sigma: 1, clamp: [-1, 2] })).toEqual([-1, 2]);
    expect(distBounds({ k: 'fixed', v: 7 })).toEqual([7, 7]);
  });

  it('packages/shared/src/events/** and tycoon/events/** pass the C02 determinism lint', async () => {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: true,
      overrideConfig: [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } }, determinismConfig(SIM_FILES, SIM_IGNORES)],
    });
    const results = await eslint.lintFiles(['packages/shared/src/events/**/*.ts', 'packages/shared/src/tycoon/events/**/*.ts']);
    const errors = results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line} ${m.message}`));
    expect(errors).toEqual([]);
    expect(results.some((r) => r.filePath.endsWith(path.join('events', 'engine.ts')))).toBe(true);
  });
});
