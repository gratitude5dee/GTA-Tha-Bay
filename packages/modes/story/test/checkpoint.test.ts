import type { MissionCheckpointV1, MissionIR } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import { Transform } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import {
  ambient, at, circle, clock, defineMission, failWhen, flagIs, give, goto, heat, npc, setFlag, stage, talk, talkDef, wait, waitFor, beat, vehicle, prop, fleeTask, task,
} from '../src/authoring/index.ts';
import { readCheckpoint } from '../src/vm/checkpoint.ts';
import { ll, makeHarness, type Harness } from './harness.ts';

const ID = 'm.t.cp';

const director = (sec: number): DirectorScript => ({
  schema: 'director/1', id: 'd.three', durationSec: sec, seed: 1, marks: {}, actors: [], shots: [{ atSec: 0, preset: 'establish', subject: 'player', lens: 'wide' }], actions: [],
  cues: [], xrVantage: { mark: 'm', yawDeg: 0 }, letterbox: true,
});

function twoStages(): MissionIR {
  return defineMission({
    id: ID,
    version: 3,
    district: 'd1',
    cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)) }), box: prop({ prefab: 'prop.crate', spawn: at(...ll(20, 0)) }) },
    zones: { z: circle(...ll(50, 0), 5) },
    stages: [
      stage('one', [goto('z', { id: 'g1' })], { onComplete: [setFlag({ 't.one': true })] }),
      stage('two', [waitFor(600, { id: 'long' })], {
        checkpoint: true,
        onEnter: [wait(0.5), give('bonus', { cashCents: 5000 }), setFlag({ 't.two': true }), beat({ director: 'd.three' }), setFlag({ 't.after_beat': true })],
      }),
    ],
    fail: [failWhen(flagIs('t.die', { eq: true }), 'mission.t.died')],
  });
}

function reachStageTwo(h: Harness): void {
  h.start(twoStages());
  h.step(3);
  h.put(h.player, 50, 0);
  h.step(6);
  expect(h.rt.stage?.id).toBe('two');
}

describe('checkpoints and retry (AC-5)', () => {
  it('writes a checkpoint on entry to a stage with `checkpoint` and asks for a save', () => {
    const h = makeHarness({ directors: new Map([['d.three', director(3)]]) });
    reachStageTwo(h);
    const saved = h.story.activeMission;
    expect(saved?.id).toBe(ID);
    expect(saved?.checkpoint.schema).toBe(1);
    expect((saved?.checkpoint.data as { stage: number }).stage).toBe(1);
    expect(h.calls.saves.filter((s) => s === 'checkpoint').length).toBeGreaterThanOrEqual(2);
    expect(readCheckpoint(saved ?? null, ID, 3, 'test-bake')?.stage).toBe(1);
    expect(readCheckpoint(saved ?? null, ID, 4, 'test-bake')).toBeNull();
    expect(readCheckpoint(saved ?? null, ID, 3, 'other-bake')).toBeNull();
  });

  it('retry puts the wallet delta, flags, cast, player pose and RNG back; the clock did not move during the 3 s beat', () => {
    const h = makeHarness({ directors: new Map([['d.three', director(3)]]) });
    reachStageTwo(h);
    const cp = h.story.activeMission?.checkpoint.data as unknown as MissionCheckpointV1;
    expect(cp.walletDeltaCents).toBe(0);
    expect(cp.stage).toBe(1);
    h.put(h.player, 50, 0);
    // run on until the give has happened and the beat plays; change everything the checkpoint holds
    h.step(40);
    expect(h.story.wallet.cashCents).toBe(5000);
    expect(h.rt.walletDelta).toBe(5000);
    h.step(5);
    expect(h.rt.beating).toBe(true);
    const beatClock = h.rt.clock;
    h.step(120);
    expect(h.rt.clock).toBe(beatClock);
    h.step(100);
    expect(h.rt.beating).toBe(false);
    h.rt.rng.nextU32();
    h.rt.rng.nextU32();
    h.put(h.player, 70, 3);
    h.put(h.at(`mis:${ID}:pal`), 90, 90);
    h.rt.setFlag('t.die', true);
    h.step(2);
    expect(h.rt.phase).toBe('failed');

    h.rt.command({ name: 'mission.retry' });
    h.step(1);
    expect(h.rt.phase).toBe('stage');
    expect(h.rt.attempt).toBe(2);
    expect(h.rt.walletDelta).toBe(cp.walletDeltaCents);
    expect(h.story.wallet.cashCents).toBe(0);
    expect(h.story.flags['t.two']).toBeUndefined();
    expect(h.story.flags['t.die']).toBeUndefined();
    expect(h.story.flags['t.one']).toBe(true);
    expect(h.rt.rng.getState()).toEqual(cp.rng);
    const tr = h.ecs.store(Transform);
    const pid = h.ecs.resolve(h.player) as number;
    expect([tr.px[pid], tr.pz[pid]]).toEqual([cp.player.x, cp.player.z]);
    const pal = h.ecs.resolve(h.at(`mis:${ID}:pal`)) as number;
    expect([tr.px[pal], tr.pz[pal]]).toEqual([cp.cast['pal']?.x, cp.cast['pal']?.z]);
    expect(h.rt.clock).toBe(Math.round(cp.elapsedSec * 60));
    expect(h.rt.stage?.id).toBe('two');
    expect(h.calls.saves).toContain('checkpoint');

    // the stage runs again from its first op, and the give is credited again under a new key
    h.step(60);
    expect(h.story.wallet.cashCents).toBe(5000);
    expect(h.rt.walletDelta).toBe(5000);
  });

  it('retry: start restarts at stage 0', () => {
    const ir = twoStages();
    ir.fail = [failWhen(flagIs('t.die', { eq: true }), 'mission.t.died', 'start')];
    const h = makeHarness({ directors: new Map([['d.three', director(1)]]) });
    h.start(ir);
    h.step(3);
    h.put(h.player, 50, 0);
    h.step(150);
    expect(h.rt.beating).toBe(false);
    h.rt.setFlag('t.die', true);
    h.step(2);
    expect(h.rt.phase).toBe('failed');
    h.rt.command({ name: 'mission.retry' });
    h.step(1);
    expect(h.rt.stage?.id).toBe('one');
    expect(h.story.flags['t.one']).toBeUndefined();
  });

  it('quit goes back to available and clears the saved mission', () => {
    const h = makeHarness({ directors: new Map([['d.three', director(3)]]) });
    reachStageTwo(h);
    h.rt.command({ name: 'mission.quit' });
    h.step(1);
    expect(h.rt.phase).toBe('available');
    expect(h.story.activeMission).toBeNull();
    expect(h.vm.get('hud.mission')).toBeNull();
  });
});

describe('the finally table (AC-6)', () => {
  const locking = (): MissionIR =>
    defineMission({
      id: ID,
      version: 1,
      district: 'd1',
      ambient: { traffic: 0.3, lock: { hour: 3 } },
      heatPolicy: { maxHeat: 2, clearOnPass: true, startHeat: 2 },
      cast: {},
      zones: { z: circle(...ll(50, 0), 5) },
      stages: [stage('a', [waitFor(600, { id: 'long' })], { onEnter: [clock({ lock: { hour: 5 } }), ambient({ peds: 0.3 }), heat({ set: 2 })] })],
    });

  const exits: [string, (h: Harness) => void][] = [
    ['pass', (h) => h.rt.command({ name: 'debug.pass' })],
    ['fail', (h) => h.rt.command({ name: 'debug.fail' })],
    ['quit', (h) => h.rt.command({ name: 'mission.quit' })],
    ['abort', (h) => h.rt.abort('error')],
    ['mode kill', (h) => h.rt.abort('kill')],
  ];

  for (const [name, exit] of exits) {
    it(`${name}: clock lock released, ambient multipliers 1, capHeat(5) applied, heat cleared`, () => {
      const h = makeHarness();
      h.start(locking());
      h.step(3);
      expect(h.calls.clockLocks).toContain(`mis:${ID}`);
      expect(h.calls.density.some((d) => d.kind === 'traffic' && d.mult === 0.3)).toBe(true);
      expect(h.calls.heat).toContain('cap:2');
      expect(h.calls.heat).toContain('set:2:mission');
      exit(h);
      h.step(2);
      expect(h.calls.clockUnlocks).toContain(`mis:${ID}`);
      const last = (kind: string): number | undefined => h.calls.density.filter((d) => d.kind === kind).at(-1)?.mult;
      expect(last('traffic')).toBe(1);
      expect(last('ped')).toBe(1);
      expect(h.calls.trafficReleased).toContain(`mis:${ID}`);
      expect(h.calls.heat.filter((c) => c === 'cap:5')).toHaveLength(1);
      expect(h.calls.heat).toContain('clear:mission');
      expect(h.ecs.byKey(`mis:${ID}:anything`)).toBe(0);
    });
  }
});

describe('determinism (AC-9)', () => {
  function talkMission(): MissionIR {
    const t = talkDef({ id: 'chat', npc: 'pal', intent: 'k.i', outcomes: { a: { label: 'k.a', flags: { 't.a': true } }, b: { label: 'k.b', trust: 5 } }, default: 'a' });
    return defineMission({
      id: ID,
      version: 1,
      district: 'd1',
      cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)) }), car: vehicle({ prefab: 'vehicle.compact', spawn: at(...ll(30, 0)) }) },
      zones: { z: circle(...ll(50, 0), 5) },
      stages: [
        stage('a', [talk(t, { id: 'tk' })], { onEnter: [wait(2), setFlag({ 't.early': 1 })], onComplete: [task('pal', fleeTask('player'))] }),
        stage('b', [waitFor(5, { id: 'rest' })]),
      ],
    });
  }

  function run(seed: number, outcome: string): string {
    const h = makeHarness();
    h.start(talkMission(), { seed });
    for (let t = 0; t < 600; t++) {
      if (t === 300) h.rt.command({ name: 'talk.result', talkId: 'chat', outcome, turns: 1, path: 'scripted' });
      h.step(1);
      h.rt.rng.nextU32();
    }
    return h.rt.stateHash();
  }

  it('the same mission, seed and scripted commands end with the same stateHash', () => {
    const a = run(5, 'a');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(run(5, 'a')).toBe(a);
    expect(run(5, 'b')).not.toBe(a);
    expect(run(6, 'a')).not.toBe(a);
  });

  it('the hash moves with the mission state, not with how it was observed', () => {
    const h = makeHarness();
    h.start(talkMission(), { seed: 5 });
    const before = h.rt.stateHash();
    expect(h.rt.stateHash()).toBe(before);
    h.step(5);
    expect(h.rt.stateHash()).not.toBe(before);
    expect(h.rt.debugState()['hash']).toBe(h.rt.stateHash());
  });
});
