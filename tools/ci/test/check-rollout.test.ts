import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkRollout, currentBranch, ROOMS_BRANCH_RE } from '../check-rollout.ts';
import { repoRoot } from '../run.ts';

const fx = (name: string): string => path.join(repoRoot, 'tools', 'ci', 'fixtures', 'rollout', name);
const ROOMS = 'm12b1-rooms-core-protocol-v2';

describe('check:rollout fixtures (AC-12)', () => {
  it('not-done (M05c2 READY) fails naming M05c2 and the missing status', () => {
    const r = checkRollout({ branch: ROOMS, root: fx('not-done') });
    expect(r.ok).toBe(false);
    expect(r.messages.join('\n')).toMatch(/M05c2 is READY, not DONE/);
  });

  it('no-report (DONE, no staging report) fails naming the report path', () => {
    const r = checkRollout({ branch: ROOMS, root: fx('no-report') });
    expect(r.ok).toBe(false);
    expect(r.messages.join('\n')).toContain('docs/staging-runs/M05c2/report.json is missing');
  });

  it('failed-ac (one AC fail) fails naming the AC', () => {
    const r = checkRollout({ branch: ROOMS, root: fx('failed-ac') });
    expect(r.ok).toBe(false);
    expect(r.messages.join('\n')).toContain('AC-2 = fail');
  });

  it('ok passes', () => {
    const r = checkRollout({ branch: ROOMS, root: fx('ok') });
    expect(r.ok).toBe(true);
    expect(r.roomsBranch).toBe(true);
  });

  it('a non-rooms branch exits 0 whatever the state', () => {
    const r = checkRollout({ branch: 'm11b4-x', root: fx('not-done') });
    expect(r).toMatchObject({ ok: true, roomsBranch: false, messages: ['rollout: not a rooms branch'] });
  });

  it('matches m12b through m12e only', () => {
    for (const b of ['m12b1-a', 'm12b2-a', 'm12c1-a', 'm12c2-a', 'm12d-a', 'm12e-a']) expect(ROOMS_BRANCH_RE.test(b), b).toBe(true);
    for (const b of ['m12a1-a', 'm12-a', 'm11b4-x', 'claude/build-m00d', 'main']) expect(ROOMS_BRANCH_RE.test(b), b).toBe(false);
  });
});

describe('check:rollout over the repository (AC-12)', () => {
  it('exits 0 on this branch', () => {
    const r = checkRollout({ branch: currentBranch() });
    expect(r.ok).toBe(true);
  });

  it('would fail a rooms branch today (M05c2 is not DONE)', () => {
    expect(checkRollout({ branch: ROOMS }).ok).toBe(false);
  });
});
