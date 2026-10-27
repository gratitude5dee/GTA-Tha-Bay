/** assets:gen run guards (M10a1 AC-3): the dry run, the missing key, and CI; none reaches FalPort. */
import { describe, expect, it, vi } from 'vitest';
import { repoRoot } from '../../ci/run.ts';
import { main } from '../gen/cli.ts';
import { parseRunArgs } from '../gen/run.ts';

function harness() {
  const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in a guard test')));
  const buildLive = vi.fn(() => Promise.reject(new Error('the live ports must not be built')));
  const logs: string[] = [];
  const run = (argv: string[], env: NodeJS.ProcessEnv): Promise<number> => main(argv, env, fetchSpy as never, (l) => logs.push(l), { root: repoRoot, buildLive: buildLive as never });
  return { fetchSpy, buildLive, logs, run };
}

describe('assets:gen run guards (AC-3)', () => {
  it('without --live prints the dry-run estimate and exits 0', async () => {
    const h = harness();
    expect(await h.run(['run', '--slug', 'canary-mc', '--until', 'sheet'], { FAL_KEY: 'k' })).toBe(0);
    const text = h.logs.join('\n');
    expect(text).toMatch(/dry run, no vendor call/);
    expect(text).toMatch(/estimate \$3\.67 \(3,666,590 micros\)/);
    expect(h.buildLive).not.toHaveBeenCalled();
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it('with --live but no FAL_KEY prints the SKIP line and exits 0', async () => {
    const h = harness();
    expect(await h.run(['run', '--slug', 'canary-mc', '--until', 'sheet', '--live'], {})).toBe(0);
    expect(h.logs.join('\n')).toMatch(/SKIP assets:gen run --live: FAL_KEY not set/);
    expect(h.buildLive).not.toHaveBeenCalled();
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it('with --live while CI is set refuses with a non-zero exit, key or no key', async () => {
    for (const env of [{ CI: 'true' }, { CI: 'true', FAL_KEY: 'k' }]) {
      const h = harness();
      expect(await h.run(['run', '--slug', 'canary-mc', '--until', 'sheet', '--live'], env)).not.toBe(0);
      expect(h.logs.join('\n')).toMatch(/refused: --live does not run while CI is set/);
      expect(h.buildLive).not.toHaveBeenCalled();
      expect(h.fetchSpy).not.toHaveBeenCalled();
    }
  });

  it('a dry run is allowed in CI', async () => {
    const h = harness();
    expect(await h.run(['run', '--slug', 'canary-mc', '--until', 'rig'], { CI: 'true' })).toBe(0);
  });

  it('refuses an unknown slug, a draft entry and a slug whose research is pending', async () => {
    const h = harness();
    expect(await h.run(['run', '--slug', 'nobody'], {})).toBe(1);
    expect(await h.run(['run', '--slug', 'dev_hacker'], {})).toBe(1);
    expect(h.logs.join('\n')).toMatch(/no roster entry nobody/);
    expect(h.logs.join('\n')).toMatch(/dev_hacker is draft/);
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it('parses --until and rejects an unknown stage', () => {
    expect(parseRunArgs(['--slug', 'a', '--until', 'rig']).until).toBe('rig');
    expect(() => parseRunArgs(['--slug', 'a', '--until', 'fly'])).toThrow(/--until/);
    expect(() => parseRunArgs([])).toThrow(/--slug/);
  });
});
