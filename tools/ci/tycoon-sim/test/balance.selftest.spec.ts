/** AC-8: the four self-test fixtures trip B4, B5, B3 and B11, each with a non-zero exit code. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolsRoot } from '../../lib/common.ts';
import { main, runSuite, type SuiteOptions } from '../cli.ts';
import type { Policy } from '../policies.ts';

const fx = (name: string): string => `tools/ci/tycoon-sim/fixtures/${name}`;
const RUNS = 300;

describe('tycoon harness self-tests (fixtures that must fail)', () => {
  it('dominant-strategy.balance.json trips B4', () => {
    const r = runSuite({ runs: RUNS, policies: ['median', 'frugal'], seedBase: 1, balanceFile: fx('dominant-strategy.balance.json'), determinismRuns: 20 });
    const b4 = r.bands.find((b) => b.id === 'B4');
    expect(b4?.pass, b4?.got).toBe(false);
    expect(r.ok).toBe(false);
    expect(b4?.got).toContain('frugal');
  });

  it('chain-death.events.json trips B5', () => {
    const r = runSuite({ runs: RUNS, policies: ['median'], seedBase: 1, extraEventFiles: [fx('chain-death.events.json')], determinismRuns: 20 });
    const b5 = r.bands.find((b) => b.id === 'B5');
    expect(b5?.pass, b5?.got).toBe(false);
    expect(b5?.got).toContain('biz.domino_root');
    expect(r.ok).toBe(false);
  });

  it('easy-mode.balance.json trips B3', () => {
    const r = runSuite({ runs: RUNS, policies: ['median'], seedBase: 1, balanceFile: fx('easy-mode.balance.json'), determinismRuns: 20 });
    const b3 = r.bands.find((b) => b.id === 'B3');
    expect(b3?.pass, b3?.got).toBe(false);
    expect(r.report.policies['median']?.unicornRate).toBeGreaterThan(0.08);
    expect(r.ok).toBe(false);
  });

  it('offer-out-of-band.bot.ts trips B11', async () => {
    const mod = (await import(path.join(toolsRoot, fx('offer-out-of-band.bot.ts')))) as { policy: Policy };
    const opts: SuiteOptions = { runs: RUNS, policies: ['median', mod.policy.id], seedBase: 1, extraPolicies: [mod.policy], determinismRuns: 20 };
    const r = runSuite(opts);
    const b11 = r.bands.find((b) => b.id === 'B11');
    expect(b11?.pass, b11?.got).toBe(false);
    expect(b11?.got).toContain('offer-out-of-band');
    expect(r.report.policies['median']?.violations.offersOutOfBand).toBe(0);
    expect(r.ok).toBe(false);
  });

  it('the CLI exits non-zero on each fixture and zero on a clean B5/B11 control', async () => {
    const quiet = console.log;
    console.log = (): void => undefined;
    try {
      const codes = [
        await main(['--runs', '120', '--policy', 'median', '--balance', fx('easy-mode.balance.json'), '--no-baseline', '--bands-only']),
        await main(['--runs', '120', '--policy', 'median', '--events', fx('chain-death.events.json'), '--no-baseline', '--bands-only']),
        await main(['--runs', '120', '--policy', 'median,frugal', '--balance', fx('dominant-strategy.balance.json'), '--no-baseline', '--bands-only']),
        await main(['--runs', '120', '--policy', 'median', '--bot', fx('offer-out-of-band.bot.ts'), '--no-baseline', '--bands-only']),
      ];
      expect(codes).toEqual([1, 1, 1, 1]);
    } finally {
      console.log = quiet;
    }
  });

  it('the control: without the fixtures B5 and B11 pass on the same runs', () => {
    const r = runSuite({ runs: RUNS, policies: ['median'], seedBase: 1, determinismRuns: 20 });
    expect(r.bands.find((b) => b.id === 'B5')?.pass).toBe(true);
    expect(r.bands.find((b) => b.id === 'B11')?.pass).toBe(true);
  });
});
