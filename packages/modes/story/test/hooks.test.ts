import type { MissionIR } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { defineMission, modeHook, modeObjective, stage, waitFor } from '../src/authoring/index.ts';
import { makeHarness } from './harness.ts';

const ID = 'm.t.hook';

function hooked(over: { retry?: 'hook' | 'checkpoint'; passOn?: ('win' | 'finish' | 'lose' | 'quit')[] } = {}): MissionIR {
  return defineMission({
    id: ID,
    version: 1,
    district: 'd1',
    cast: {},
    zones: {},
    stages: [stage('race', [modeObjective('race1', { id: 'mode_race1' })])],
    modeHooks: [
      modeHook({
        id: 'race1',
        mode: 'racing',
        defId: 'race.dev.loop',
        passOn: over.passOn ?? ['win', 'finish'],
        stub: waitFor(1, { id: 'race1_stub' }),
        unlockOnFirstEncounter: 'unlock.racing',
        retry: over.retry ?? 'hook',
      }),
    ],
  });
}

describe('mode hooks: the stub path (AC-7)', () => {
  it('a comingSoon mode runs the stub on both attempts; the unlock is new once and the ref names the hook', () => {
    const h = makeHarness();
    h.start(hooked(), { attempt: 1 });
    h.step(80);
    expect(h.rt.phase).toBe('passed');
    expect(h.calls.children).toHaveLength(1);
    expect(h.calls.unlocks).toEqual([{ id: 'unlock.racing', src: { kind: 'mission', ref: `${ID}:race1` }, isNew: true }]);

    // the second attempt: same mission again
    h.start(hooked(), { attempt: 2 });
    h.step(80);
    expect(h.rt.phase).toBe('passed');
    expect(h.calls.children).toHaveLength(2);
    expect(h.calls.unlocks.map((u) => u.isNew)).toEqual([true, false]);
    expect(h.calls.unlocks[1]?.src.ref).toBe(`${ID}:race1`);
  });

  it('?hooks=stub takes the stub even when the mode would start, and never asks for a child', () => {
    const h = makeHarness({ flags: { hooks: 'stub' } });
    h.childOk.value = true;
    h.start(hooked());
    h.step(80);
    expect(h.calls.children).toHaveLength(0);
    expect(h.rt.phase).toBe('passed');
    expect(h.calls.unlocks).toHaveLength(1);
  });

  it('the stub is a normal objective: it holds until it is done', () => {
    const h = makeHarness();
    h.start(hooked());
    h.step(30);
    expect(h.rt.phase).toBe('stage');
    expect([...h.rt.objectives.values()].map((o) => o.def.k)).toEqual(['mode']);
  });
});

describe('mode hooks: the real path', () => {
  const childExit = (h: ReturnType<typeof makeHarness>, outcomeIndex: number): void => h.emit({ t: 'mode.childExit', tick: h.tickNo.n, s: 'racing', n: outcomeIndex });

  it('startChild gets the hook\'s defId, the mission and hook ids and the unlock; the exit outcome decides', () => {
    const h = makeHarness();
    h.childOk.value = true;
    h.start(hooked());
    h.step(5);
    expect(h.calls.children).toHaveLength(1);
    const call = h.calls.children[0] as { id: string; args: { defId: string; params: Record<string, string>; seed: number } };
    expect(call.id).toBe('racing');
    expect(call.args.defId).toBe('race.dev.loop');
    expect(call.args.params).toMatchObject({ missionId: ID, hookId: 'race1', unlockOnFirstEncounter: 'unlock.racing' });
    expect(h.calls.unlocks).toHaveLength(0);
    h.step(30);
    expect(h.rt.phase).toBe('stage');
    childExit(h, 0);
    h.step(4);
    expect(h.rt.phase).toBe('passed');
    expect(h.rt.modeResults['race1']).toBe('win');
  });

  it('a loss retries the hook (a second startChild) when retry is hook, and fails the mission when it is checkpoint', () => {
    const h = makeHarness();
    h.childOk.value = true;
    h.start(hooked({ retry: 'hook' }));
    h.step(5);
    childExit(h, 1);
    h.step(5);
    expect(h.calls.children).toHaveLength(2);
    expect(h.rt.phase).toBe('stage');
    childExit(h, 2);
    h.step(5);
    expect(h.rt.phase).toBe('passed');

    const c = makeHarness();
    c.childOk.value = true;
    c.start(hooked({ retry: 'checkpoint' }));
    c.step(5);
    childExit(c, 1);
    c.step(5);
    expect(c.rt.phase).toBe('failed');
  });

  it('the objective keeps the story clock still while a child runs: only suspendedTick moves', () => {
    const h = makeHarness();
    h.childOk.value = true;
    h.start(hooked());
    h.step(5);
    const clock = h.rt.clock;
    for (let i = 0; i < 20; i++) h.rt.suspendedTick(h.ctx);
    expect(h.rt.clock).toBe(clock);
  });
});
