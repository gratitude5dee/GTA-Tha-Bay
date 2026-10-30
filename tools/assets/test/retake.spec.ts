/** Retakes (M10a2, DL-OWN-07, Q-26): a new seed is paid from the buffer line and only with the owner's sign-off; nothing reaches FalPort. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { repoRoot } from '../../ci/run.ts';
import { useTempDirs } from '../../ci/test-tmp.ts';
import { main } from '../gen/cli.ts';
import { parseLedger } from '../gen/ledger.ts';
import { LedgerBudget } from '../gen/ports.ts';
import { parseRunArgs } from '../gen/run.ts';

const tempDir = useTempDirs();
const clock = { now: (): number => Date.parse('2026-10-28T12:00:00Z') };

describe('run --retake needs the owner sign-off', () => {
  it('refuses a retake without --owner-signoff (dry run included), and accepts one with it', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network')));
    const buildLive = vi.fn(() => Promise.reject(new Error('the live ports must not be built')));
    const logs: string[] = [];
    const run = (argv: string[]): Promise<number> => main(argv, { FAL_KEY: 'k' }, fetchSpy as never, (l) => logs.push(l), { root: repoRoot, buildLive: buildLive as never });
    expect(await run(['run', '--slug', 'pc-coast', '--until', 'mesh', '--retake', 'mesh', '--attempt', '1'])).toBe(1);
    expect(logs.join('\n')).toMatch(/needs the owner's sign-off \(Q-26\)/);
    expect(await run(['run', '--slug', 'pc-coast', '--until', 'mesh', '--retake', 'mesh', '--attempt', '1', '--owner-signoff', ' '])).toBe(1);
    expect(await run(['run', '--slug', 'pc-coast', '--until', 'mesh', '--retake', 'mesh', '--attempt', '1', '--owner-signoff', 'owner, 2026-10-28, mesh 2 has no hood'])).toBe(0);
    expect(logs.join('\n')).toMatch(/dry run, no vendor call/);
    expect(buildLive).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(parseRunArgs(['--slug', 'a', '--retake', 'mesh', '--owner-signoff', 'x']).ownerSignoff).toBe('x');
  });
});

describe('the ledger books a retake on the buffer line', () => {
  it('reserves and settles a retake against the buffer cap with the sign-off in the row, and a normal job against the characters line', async () => {
    const file = path.join(tempDir('dv-retake-ledger-'), 'fal-spend.jsonl');
    const b = new LedgerBudget({ file, line: 'characters', clock, retakeNote: 'owner, 2026-10-28, mesh 2 has no hood' });
    b.tag('job-normal', 'pc-coast', 'mesh');
    expect((await b.reserve('fal', 2_400_000, 'job-normal')).ok).toBe(true);
    await b.settle('job-normal', 2_400_000, 'r1');
    b.tag('job-retake', 'pc-coast', 'mesh', true);
    expect((await b.reserve('fal', 2_400_000, 'job-retake')).ok, 'the buffer line holds 2,000,000 micros').toBe(false);
    b.tag('job-retake-2', 'pc-coast', 'sheet', true);
    expect((await b.reserve('fal', 1_200_000, 'job-retake-2')).ok).toBe(true);
    expect((await b.reserve('fal', 1_200_000, 'job-retake-3')).ok, 'a second reservation past the buffer while the first is in flight').toBe(true);
    await b.settle('job-retake-2', 1_200_000, 'r2');
    const rows = parseLedger(readFileSync(file, 'utf8'));
    expect(rows.map((r) => [r.ref, r.line, r.usdMicros])).toEqual([['job-normal', 'characters', 2_400_000], ['job-retake-2', 'buffer', 1_200_000]]);
    expect(rows[1]?.note).toBe('retake, owner sign-off (Q-26): owner, 2026-10-28, mesh 2 has no hood');
    expect(rows[1]).toMatchObject({ slug: 'pc-coast', stage: 'sheet' });
    expect(rows[0]?.note).toBeUndefined();
  });
});
