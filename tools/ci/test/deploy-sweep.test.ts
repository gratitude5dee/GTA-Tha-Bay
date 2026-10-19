import { afterEach, describe, expect, it, vi } from 'vitest';
import { branchSlug, main, sweepClosed, type SweepRunner } from '../deploy.ts';
import { mapPkgFilter } from '../run.ts';

describe('run.ts --pkg filter (known defect: package test scripts honour -- <name>)', () => {
  it('maps name filters to paths inside the package test directory', () => {
    expect(mapPkgFilter(['--pkg', 'packages/shared', 'detmath'])).toEqual(['packages/shared/test/detmath']);
    expect(mapPkgFilter(['--pkg', 'packages/engine/', 'a', 'b'])).toEqual(['packages/engine/test/a', 'packages/engine/test/b']);
  });
  it('without names the whole package test directory runs; other flags pass through', () => {
    expect(mapPkgFilter(['--pkg', 'packages/shared'])).toEqual(['packages/shared/test/']);
    expect(mapPkgFilter(['--pkg', 'packages/shared', '--reporter=dot', 'world'])).toEqual(['--reporter=dot', 'packages/shared/test/world']);
  });
  it('leaves argument lists without --pkg untouched', () => {
    expect(mapPkgFilter(['packages/ui'])).toEqual(['packages/ui']);
  });
});

describe('deploy:preview --sweep-closed (AC-10, DL-658)', () => {
  afterEach(() => vi.restoreAllMocks());

  const prs = JSON.stringify([
    { number: 7, headRefName: 'm01c-device-spike' },
    { number: 9, headRefName: 'Feature/Odd_Name!' },
  ]);

  function runner(opts: { gh?: SweepRunner['gh']; result?: (name: string) => { status: number; out: string } }): { r: SweepRunner; deleted: string[] } {
    const deleted: string[] = [];
    const r: SweepRunner = {
      gh: opts.gh ?? (() => ({ status: 0, out: prs })),
      wrangler: (a) => {
        expect(a.slice(0, 2)).toEqual(['preview', 'delete']);
        expect(a).toContain('--skip-confirmation');
        expect(a.slice(a.indexOf('--env'), a.indexOf('--env') + 2)).toEqual(['--env', 'staging']);
        const name = a[a.indexOf('--name') + 1] as string;
        deleted.push(name);
        return opts.result ? opts.result(name) : { status: 0, out: '' };
      },
    };
    return { r, deleted };
  }

  it('prints the SKIP line naming both variables and exits 0 without Cloudflare credentials', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['preview', '--sweep-closed'], {})).toBe(0);
    expect(log).toHaveBeenCalledWith('SKIP deploy:preview: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set');
  });

  it('deletes pr-<N> and the branch slug of every closed PR', () => {
    const { r, deleted } = runner({});
    expect(sweepClosed(r, () => {})).toBe(0);
    expect(deleted).toEqual(['pr-7', 'm01c-device-spike', 'pr-9', 'feature-odd-name']);
    expect(branchSlug('Feature/Odd_Name!')).toBe('feature-odd-name');
  });

  it('counts "not found" as success and continues after another failure', () => {
    const { r, deleted } = runner({ result: (n) => (n === 'pr-7' ? { status: 1, out: 'Error: preview not found' } : n === 'pr-9' ? { status: 1, out: 'boom' } : { status: 0, out: '' }) });
    const lines: string[] = [];
    expect(sweepClosed(r, (l) => lines.push(l))).toBe(0);
    expect(deleted.length).toBe(4);
    expect(lines.join('\n')).toContain('1 not found, 1 failed');
  });

  it('exits non-zero only when every delete failed for a reason other than "not found"', () => {
    const { r } = runner({ result: () => ({ status: 1, out: 'permission denied' }) });
    expect(sweepClosed(r, () => {})).toBe(1);
  });

  it('SKIPs when gh is not installed', () => {
    const lines: string[] = [];
    const { r } = runner({ gh: () => null });
    expect(sweepClosed(r, (l) => lines.push(l))).toBe(0);
    expect(lines).toEqual(['SKIP deploy:preview --sweep-closed: gh not found']);
  });
});
