/**
 * AC-8 (the mode half): the story hook starts `bout.a5` with the bot flag; the bot plays slot 0 against the CPU Normal opponent, the
 * match ends, the results card closes itself and the mode asks to exit as `completed`, with a `ModeResult` of `win` or `lose`
 * (both pass the mission) and the rounds and street cred in its data. Two runs with the same seed end with the same hash. The mission
 * check (`pnpm check:missions -- --mission m.a1.05`) runs the same path inside the story.
 */
import { describe, expect, it } from 'vitest';
import { activeSession, fighterSim } from '../src/sim/mode.ts';
import { fakeCtx } from './helpers.ts';

function playBout(seed: number): { reason: string | undefined; outcome: string; hash: [number, number]; rounds: [number, number]; data: unknown } {
  const ctx = fakeCtx({ kind: 'story', missionId: 'm.a1.05', hookId: 'fight-a1-turntable' }, ['unlock.fighter']);
  fighterSim.enter(ctx, { defId: 'bout.a5', params: { kind: 'story', bot: true, missionId: 'm.a1.05', hookId: 'fight-a1-turntable' }, origin: { kind: 'story', missionId: 'm.a1.05', hookId: 'fight-a1-turntable' }, seed }, null);
  const s = activeSession();
  if (!s?.match) throw new Error('no match');
  const m = s.match;
  let t = 0;
  for (; t < 60 * 60 * 8 && !ctx.events.log.some((e) => e.t === 'mode.exit.request'); t++) { ctx.setTick(t); fighterSim.tick(ctx); }
  const req = ctx.events.log.find((e) => e.t === 'mode.exit.request');
  const hash = m.hash();
  const rounds = m.rounds;
  const res = fighterSim.exit(ctx, (req?.s ?? 'quit') as 'completed');
  return { reason: req?.s, outcome: res.outcome, hash, rounds, data: res.data };
}

describe('the story bout with the bot', () => {
  it('ends in a win or a loss, exits as completed and reports rounds in its ModeResult', () => {
    const r = playBout(11);
    expect(r.reason).toBe('completed');
    expect(['win', 'lose']).toContain(r.outcome);
    expect(Math.max(...r.rounds)).toBe(2);
    expect(r.data).toMatchObject({ rounds: [r.rounds[0], r.rounds[1]] });
  });

  it('the same seed ends with the same hash', () => {
    const a = playBout(12);
    const b = playBout(12);
    expect(b.hash).toEqual(a.hash);
    expect(b.outcome).toBe(a.outcome);
  });
});
