/** AC-8 / T-02: replay is exact, `verifyRun` classifies a claim as ok, mismatch or contentVersion; the policy recorder agrees with the replay. */
import { describe, expect, it } from 'vitest';
import { RAW_CONTENT, testContent } from './__fixtures__/content.ts';
import { playPolicy } from './__fixtures__/policy.ts';
import { buildContent } from './content.ts';
import { policyView, replay, ReplayError, verifyRun } from './replay.ts';
import { setupFromSeed } from './setup.ts';
import type { ChoiceRecord, RunResult } from './types.ts';

const c = testContent();
const finished = (seed: number) => {
  const setup = setupFromSeed(seed, undefined, c);
  const run = playPolicy(setup, c, 150);
  // the recorder gives up at an unanswered pause; a quit makes every list end in a RunResult
  const choices: ChoiceRecord[] = run.state.result ? run.choices : [...run.choices, { week: run.state.week, seq: 99, cmd: { t: 'endRun', reason: 'quit' } }];
  return { setup, choices };
};

describe('replay and verifyRun', () => {
  it('two replays of a finished run give the identical hash and RunResult', () => {
    const { setup, choices } = finished(0xc0ffee);
    const a = replay(setup, choices, c);
    const b = replay(setup, choices, c);
    expect(a.result).not.toBeNull();
    expect(a.hash).toBe(b.hash);
    expect(a.result).toEqual(b.result);
    expect(a.result?.stateHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('the live policy run and its replay end in the same state', () => {
    const setup = setupFromSeed(1, undefined, c);
    const run = playPolicy(setup, c, 90);
    const out = replay(setup, run.choices, c, 90);
    expect(out.hash).toBe(run.hashes[run.hashes.length - 1]);
    expect(out.state.week).toBe(run.state.week);
  });

  it('verifyRun: ok for the true result, mismatch when one field changes, contentVersion for other content', () => {
    const { setup, choices } = finished(2);
    const result = replay(setup, choices, c).result as RunResult;
    expect(verifyRun(setup, choices, result, c)).toBe('ok');
    expect(verifyRun(setup, choices, { ...result, score: result.score + 1 }, c)).toBe('mismatch');
    expect(verifyRun(setup, choices, { ...result, stateHash: '0000000000000000' }, c)).toBe('mismatch');
    const other = buildContent({ ...RAW_CONTENT, balance: { ...RAW_CONTENT.balance, founder: { ...RAW_CONTENT.balance.founder, rest: 7 } } });
    expect(verifyRun(setup, choices, result, other)).toBe('contentVersion');
    const patched = { ...setup, contentVersion: 'aaaaaaaaaaaa' };
    expect(verifyRun(patched, choices, result, c)).toBe('contentVersion');
  });

  it('verifyRun: a forged choice list that cannot be replayed is a mismatch, not an exception', () => {
    const { setup, choices } = finished(3);
    const result = replay(setup, choices, c).result as RunResult;
    const forged: ChoiceRecord[] = [...choices, { week: 1, seq: 50, cmd: { t: 'setAllocation', features: 1, refactor: 1, infra: 1 } }];
    expect(() => replay(setup, forged, c)).toThrow(ReplayError);
    expect(verifyRun(setup, forged, result, c)).toBe('mismatch');
  });

  it('a run that has not ended has no result to claim', () => {
    const setup = setupFromSeed(4, undefined, c);
    const out = replay(setup, [{ week: 0, seq: 0, cmd: { t: 'setAllocation', features: 70, refactor: 20, infra: 10 } }], c, 10);
    expect(out.result).toBeNull();
    expect(out.state.week).toBe(10);
  });

  it('choices apply in (week, seq) order whatever the order of the list', () => {
    const { setup, choices } = finished(0xbeef);
    const shuffled = [...choices].reverse();
    expect(replay(setup, shuffled, c).hash).toBe(replay(setup, choices, c).hash);
  });

  it('policyView reads the state without changing it', () => {
    const setup = setupFromSeed(5, undefined, c);
    const run = playPolicy(setup, c, 40);
    const before = JSON.stringify(run.state);
    const v = policyView(run.state, c);
    expect(JSON.stringify(run.state)).toBe(before);
    expect(v.week).toBe(run.state.week);
    expect(v.cash).toBe(run.state.cash);
  });
});
