/** AC-8: the four self-test fixtures trip B4, B5, B3 and B11, each with a non-zero exit code. */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolsRoot } from '../../lib/common.ts';
import { runSuite, type SuiteOptions } from '../cli.ts';
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

  // BD-FIX-CI6-B03: the five CLI runs are real `tycoon:sim` processes started together, so the test waits for the slowest one
  // instead of the sum (35 s on a loaded CI runner when they ran one after another in this worker), and it reads each process's
  // own exit code and band table. B10 replays 20 runs here, as in the runSuite tests above; determinism.spec.ts owns B10.
  it('the CLI exits non-zero on each fixture and zero on a clean B5/B11 control', async () => {
    const cli = (extra: string[]): Promise<{ code: number | null; out: string }> =>
      new Promise((resolve, reject) => {
        execFile(
          process.execPath,
          ['--import', 'tsx', path.join(toolsRoot, 'tools/ci/tycoon-sim/cli.ts'), '--runs', '120', '--determinism-runs', '20', ...extra, '--no-baseline', '--bands-only'],
          { cwd: toolsRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GITHUB_STEP_SUMMARY: '' } },
          (err, stdout, stderr) => {
            const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
            if (err && code === null) reject(err);
            else resolve({ code, out: `${stdout}${stderr}` });
          },
        );
      });
    const [easy, chain, dominant, bot, control] = await Promise.all([
      cli(['--policy', 'median', '--balance', fx('easy-mode.balance.json')]),
      cli(['--policy', 'median', '--events', fx('chain-death.events.json')]),
      cli(['--policy', 'median,frugal', '--balance', fx('dominant-strategy.balance.json')]),
      cli(['--policy', 'median', '--bot', fx('offer-out-of-band.bot.ts')]),
      cli(['--policy', 'median']),
    ]);
    expect([easy?.code, chain?.code, dominant?.code, bot?.code, control?.code], [easy, chain, dominant, bot, control].map((r) => r?.out).join('\n')).toEqual([1, 1, 1, 1, 0]);
    expect(easy?.out).toMatch(/^FAIL B3:/m);
    expect(chain?.out).toMatch(/^FAIL B5:/m);
    expect(dominant?.out).toMatch(/^FAIL B4:/m);
    expect(bot?.out).toMatch(/^FAIL B11:/m);
    expect(control?.out).toMatch(/^PASS B5:/m);
    expect(control?.out).toMatch(/^PASS B11:/m);
    expect(control?.out).not.toMatch(/^FAIL /m);
  });

  it('the control: without the fixtures B5 and B11 pass on the same runs', () => {
    const r = runSuite({ runs: RUNS, policies: ['median'], seedBase: 1, determinismRuns: 20 });
    expect(r.bands.find((b) => b.id === 'B5')?.pass).toBe(true);
    expect(r.bands.find((b) => b.id === 'B11')?.pass).toBe(true);
  });
});
