/** M04d AC-7: the verifier lock. Fixtures always; the live pair rule when GITHUB_BASE_REF is set. */
import { describe, expect, it } from 'vitest';
import { changedPathsFromGit, labelsFromEnv } from '../golden-guard.ts';
import { checkHashes, readLock, reasonOf, VERIFIER_DEFS, verify } from '../verifiers-lock.ts';

const DRIVER = 'packages/engine/src/qa/drivers/lines.ts';
const GOLDEN = 'tests/golden/engine/walk-drive.json';

describe('verifier lock: the pair rule on fixtures', () => {
  it('a driver and a golden changed together fail without labels', () => {
    const r = verify([DRIVER, GOLDEN], [], '');
    expect(r.ok).toBe(false);
    expect(r.messages.join('\n')).toContain('golden-update');
  });

  it('the label with an empty reason still fails', () => {
    const r = verify([DRIVER, GOLDEN], ['golden-update'], '   ');
    expect(r.ok).toBe(false);
    expect(r.messages.join('\n')).toContain('reason');
  });

  it('the label and a reason pass', () => {
    expect(verify([DRIVER, GOLDEN], ['bug', 'golden-update'], 'lines driver now emits the neutral frame after the last run').ok).toBe(true);
  });

  it('a verifier alone, or a subject alone, passes', () => {
    expect(verify([DRIVER], [], '').ok).toBe(true);
    expect(verify(['packages/engine/src/sim/lines/player.ts'], [], '').ok).toBe(true);
  });

  it('a runner change with a sim change fails; the econ bands with a mode host change fail', () => {
    expect(verify(['packages/engine/src/qa/runner.ts', 'packages/engine/src/sim/loop/sim-core.ts'], [], '').ok).toBe(false);
    expect(verify(['config/econ-bands.json', 'packages/engine/src/sim/modes/economy.ts'], [], '').ok).toBe(false);
  });

  it('an empty changed list (a push to main) skips the pair rule and says so', () => {
    const r = verify([], [], '');
    expect(r.ok).toBe(true);
    expect(r.messages[0]).toContain('push to main');
  });

  it('reads the reason from a one-line value or a Golden-update line of the PR body', () => {
    expect(reasonOf('retuned the sedan brake torque')).toBe('retuned the sedan brake torque');
    expect(reasonOf('## Summary\nstuff\n\nGolden-update: new fixture block\nmore')).toBe('new fixture block');
    expect(reasonOf('## Summary\nstuff without a reason line')).toBe('');
    expect(reasonOf(undefined)).toBe('');
    expect(reasonOf('Golden-update:   ')).toBe('');
  });
});

describe('verifier lock: hashes', () => {
  it('verifiers.lock.json matches the repository hashes', () => {
    const r = checkHashes(readLock());
    expect(r.ok, r.messages.join('\n')).toBe(true);
  });

  it('every defined verifier is in the lock with subjects', () => {
    const lock = readLock();
    for (const id of Object.keys(VERIFIER_DEFS)) {
      expect(lock.verifiers[id]?.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      expect(lock.verifiers[id]?.subjects.length, id).toBeGreaterThan(0);
    }
  });

  it('a stale hash is reported', () => {
    const lock = readLock();
    const first = Object.keys(lock.verifiers)[0] as string;
    const stale = { ...lock, verifiers: { ...lock.verifiers, [first]: { ...(lock.verifiers[first] as object), sha256: '0'.repeat(64) } } } as typeof lock;
    const r = checkHashes(stale);
    expect(r.ok).toBe(false);
    expect(r.messages.join('\n')).toContain(first);
  });
});

describe('verifier lock: live check (when GITHUB_BASE_REF is set)', () => {
  const paths = changedPathsFromGit();
  it.skipIf(paths === null)('the diff against origin/$GITHUB_BASE_REF obeys the pair rule', () => {
    const r = verify(paths ?? [], labelsFromEnv(), reasonOf(process.env['DV_PR_REASON']));
    expect(r.ok, r.messages.join('\n')).toBe(true);
  });
});
