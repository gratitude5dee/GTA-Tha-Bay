/**
 * M02g1 AC-8 / AC-9: the `clock` op of C09 1.1 and the burn-off of m.a1.01 v2.
 *
 *  - `unlock` together with a `lock` that names only a weather means: release, then blend to that weather over the clock's default blend
 *    (`defaultBlendGameMinutes` x 60 seconds, 16 s of real time); every other combination is what it was;
 *  - m.a1.01 holds the clock at 06:30 in fog from `to_gate` and releases it at `truck`;
 *  - a checkpoint restore (a retry, a saved game resumed after a load) runs the `clock` ops of the stages before the checkpoint stage in
 *    order, so a resume at `tow_home` is released and blending to clear, never fogged; a fail-retry to `'start'` locks the dawn again.
 */
import type { MissionCheckpointV1, MissionIR, Op } from '@dv/shared';
import { CLOCK_CONFIG } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import { at, circle, clock, defineMission, failWhen, npc, setFlag, stage, flagIs, waitFor } from '../src/authoring/index.ts';
import { restoreCheckpoint } from '../src/vm/checkpoint.ts';
import mission from '../../../../content/missions/m.a1.01/mission.ts';
import { flatResolver, ll, makeHarness } from './harness.ts';

const ID = 'm.t.clock';
const BLEND_SEC = CLOCK_CONFIG.defaultBlendGameMinutes * 60;

function one(onEnter: Op[]): MissionIR {
  return defineMission({
    id: ID,
    version: 1,
    district: 'd1',
    cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)) }) },
    zones: { z: circle(...ll(50, 0), 5) },
    stages: [stage('a', [waitFor(600, { id: 'long' })], { onEnter })],
  });
}

function opsOf(onEnter: Op[]): string[] {
  const h = makeHarness();
  h.start(one(onEnter));
  h.step(3);
  return h.calls.clockOps;
}

describe('the clock op (C09 1.1)', () => {
  it('the default blend is 8 game minutes: 480 game seconds, 16 s of real time at 30 game seconds per second', () => {
    expect(CLOCK_CONFIG.defaultBlendGameMinutes).toBe(8);
    expect(BLEND_SEC).toBe(480);
    expect(BLEND_SEC / 30).toBe(16);
  });

  it('unlock with a weather-only lock releases, then blends over the default blend; it does not lock again', () => {
    expect(opsOf([clock({ unlock: true, lock: { weather: 'clear' } })])).toEqual(['unlock', `force:clear:${BLEND_SEC}`]);
  });

  it('every other combination is unchanged', () => {
    expect(opsOf([clock({ lock: { hour: 6.5, weather: 'karl-fog' } })])).toEqual(['lock:6.5:karl-fog']);
    expect(opsOf([clock({ lock: { hour: 5 } })])).toEqual(['lock:5:-']);
    expect(opsOf([clock({ lock: { weather: 'clear' } })])).toEqual(['lock:-:clear']);
    expect(opsOf([clock({ unlock: true })])).toEqual(['unlock']);
    expect(opsOf([clock({ unlock: true, lock: { hour: 7, weather: 'clear' } })])).toEqual(['unlock', 'lock:7:clear']);
    expect(opsOf([clock({ unlock: true, lock: { hour: 7 } })])).toEqual(['unlock', 'lock:7:-']);
  });
});

describe('m.a1.01 v2: the fog burns off at the truck stage', () => {
  const ir = mission as MissionIR;

  it('is version 2, locks 06:30 in Karl fog at to_gate and releases and blends to clear at truck', () => {
    expect(ir.version).toBe(2);
    expect(ir.stages.map((s) => s.id)).toEqual(['to_gate', 'truck', 'to_stall', 'hook', 'truck_again', 'tow_home']);
    const ops = (i: number): Op[] => (ir.stages[i]?.onEnter ?? []).filter((o) => o.op === 'clock');
    expect(ops(0)).toEqual([{ op: 'clock', lock: { hour: 6.5, weather: 'karl-fog' } }]);
    expect(ops(1)).toEqual([{ op: 'clock', unlock: true, lock: { weather: 'clear' } }]);
    for (const i of [2, 3, 4, 5]) expect(ops(i)).toEqual([]);
    // the hour stays in the dawn band
    expect(6.5).toBeGreaterThanOrEqual(6);
    expect(6.5).toBeLessThanOrEqual(7);
  });

  it('the clock is held at to_gate and unlocked at the truck start, with the blend to clear asked once', () => {
    const h = makeHarness();
    h.start(ir, {}, flatResolver());
    h.step(5);
    expect(h.rt.phase).toBe('stage');
    expect(h.rt.stage?.id).toBe('to_gate');
    expect(h.calls.clockOps).toEqual(['lock:6.5:karl-fog']);
    const before = h.calls.clockOps.length;
    h.rt.jumpTo(1);
    h.step(3);
    // released, then one blend to clear; no new lock (the hold of to_gate is gone)
    expect(h.calls.clockOps.slice(before, before + 2)).toEqual(['unlock', `force:clear:${BLEND_SEC}`]);
    expect(h.calls.clockOps.slice(before).some((o) => o.startsWith('lock:'))).toBe(false);
    expect(h.calls.clockOps.slice(before).filter((o) => o.startsWith('force:'))).toHaveLength(1);
  });

  it('a checkpoint restore at tow_home (a retry or a resumed save) runs the earlier clock ops in order: released and blending to clear', () => {
    for (const load of [false, true]) {
      const h = makeHarness();
      h.start(ir, {}, flatResolver());
      h.step(5);
      h.rt.jumpTo(5);
      h.step(3);
      const cp = h.story.activeMission?.checkpoint.data as unknown as MissionCheckpointV1 | undefined;
      expect(cp?.stage, 'tow_home writes a checkpoint on entry').toBe(5);
      h.calls.clockOps.length = 0;
      restoreCheckpoint(h.rt, cp as MissionCheckpointV1, load);
      expect(h.calls.clockOps, `load=${load}`).toEqual(['lock:6.5:karl-fog', 'unlock', `force:clear:${BLEND_SEC}`]);
    }
  });
});

describe('the retry of a mission with an earlier clock op', () => {
  it('re-applies the ops of the stages before the checkpoint stage and not the checkpoint stage\'s own', () => {
    const ir = defineMission({
      id: ID,
      version: 1,
      district: 'd1',
      cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)) }) },
      zones: { z: circle(...ll(50, 0), 5) },
      stages: [
        stage('a', [waitFor(600, { id: 'first' })], { onEnter: [clock({ lock: { hour: 5, weather: 'karl-fog' } })] }),
        stage('b', [waitFor(600, { id: 'second' })], { onEnter: [clock({ unlock: true, lock: { weather: 'clear' } })] }),
        stage('c', [waitFor(600, { id: 'third' })], { checkpoint: true, onEnter: [clock({ lock: { hour: 9 } }), setFlag({ 't.c': true })] }),
      ],
      fail: [failWhen(flagIs('t.die', { eq: true }), 'mission.t.died')],
    });
    const h = makeHarness();
    h.start(ir);
    h.step(3);
    h.rt.jumpTo(2);
    h.step(3);
    const cp = h.story.activeMission?.checkpoint.data as unknown as MissionCheckpointV1;
    h.calls.clockOps.length = 0;
    restoreCheckpoint(h.rt, cp, false);
    expect(h.calls.clockOps).toEqual(['lock:5:karl-fog', 'unlock', `force:clear:${BLEND_SEC}`]);
  });

  it('a fail-retry to start re-runs stage 0 and so locks the dawn again', () => {
    const ir = defineMission({
      id: ID,
      version: 1,
      district: 'd1',
      cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)) }) },
      zones: { z: circle(...ll(50, 0), 5) },
      stages: [
        stage('a', [waitFor(600, { id: 'first' })], { onEnter: [clock({ lock: { hour: 6.5, weather: 'karl-fog' } })] }),
        stage('b', [waitFor(600, { id: 'second' })], { checkpoint: true, onEnter: [clock({ unlock: true, lock: { weather: 'clear' } })] }),
      ],
      fail: [failWhen(flagIs('t.die', { eq: true }), 'mission.t.died', 'start')],
    });
    const h = makeHarness();
    h.start(ir);
    h.step(3);
    h.rt.jumpTo(1);
    h.step(3);
    h.rt.setFlag('t.die', true);
    h.step(2);
    expect(h.rt.phase).toBe('failed');
    h.calls.clockOps.length = 0;
    h.rt.command({ name: 'mission.retry' });
    h.step(2);
    expect(h.rt.stage?.id).toBe('a');
    expect(h.calls.clockOps).toContain('lock:6.5:karl-fog');
    expect(h.calls.clockOps.some((o) => o.startsWith('force:'))).toBe(false);
  });
});
