import type { MissionIR, Op, StageDef } from '@dv/shared';
import { Transform } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import {
  all, ambient, at, beat, camera, clock, defineMission, despawn, emit, fade, fail, heat, ifOp, loop, marker, npc, pass, prop, race, say, setFlag, spawn, stage, task, text, trust, give,
  wait, waitEvent, waitFor, waitUntil, circle, walkTo, inVehicle, flagIs, eventSeen,
} from '../src/authoring/index.ts';
import { ll, makeHarness } from './harness.ts';

const ID = 'm.t.ops';

/** A mission with one long stage whose `onEnter` is `ops`; the stage only ends by its ops, a command or a fail. */
function ops(onEnter: Op[], extra: Partial<Parameters<typeof defineMission>[0]> = {}): MissionIR {
  return defineMission({
    id: ID,
    version: 1,
    district: 'd1',
    cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)), spawnAt: 'manual' }), box: prop({ prefab: 'prop.crate', spawn: at(...ll(20, 0)) }) },
    zones: { z: circle(...ll(50, 0), 5) },
    stages: [stage('a', [waitFor(600, { id: 'long' })], { onEnter })],
    ...extra,
  });
}

const flag = (h: ReturnType<typeof makeHarness>, k: string): unknown => h.story.flags[k];
const count = (h: ReturnType<typeof makeHarness>, name: string): number => h.rt.eventCount(name);

describe('mission VM: control ops (AC-4)', () => {
  it('seq runs its body in order and a wait holds for sec x 60 ticks of the mission clock', () => {
    const h = makeHarness();
    h.start(ops([setFlag({ 't.first': 1 }), wait(1), setFlag({ 't.second': 1 })]));
    h.step(3);
    expect(flag(h, 't.first')).toBe(1);
    expect(flag(h, 't.second')).toBeUndefined();
    h.step(55);
    expect(flag(h, 't.second')).toBeUndefined();
    h.step(10);
    expect(flag(h, 't.second')).toBe(1);
  });

  it('all forks its branches and joins after the last one', () => {
    const h = makeHarness();
    h.start(ops([all([wait(1), setFlag({ 't.fast': 1 })], [wait(3), setFlag({ 't.slow': 1 })]), setFlag({ 't.after': 1 })]));
    h.step(70);
    expect(flag(h, 't.fast')).toBe(1);
    expect(flag(h, 't.slow')).toBeUndefined();
    expect(flag(h, 't.after')).toBeUndefined();
    h.step(130);
    expect(flag(h, 't.slow')).toBe(1);
    expect(flag(h, 't.after')).toBe(1);
  });

  it('race continues after the first branch to finish and cancels the rest', () => {
    const h = makeHarness();
    h.start(ops([race([wait(3), setFlag({ 't.slow': 1 })], [wait(1), setFlag({ 't.fast': 1 })]), setFlag({ 't.after': 1 })]));
    h.step(70);
    expect(flag(h, 't.fast')).toBe(1);
    expect(flag(h, 't.after')).toBe(1);
    h.step(150);
    expect(flag(h, 't.slow')).toBeUndefined();
  });

  it('race: a same-tick finish keeps the lowest branch index (branch 0 passes before branch 1 fails)', () => {
    const h = makeHarness();
    h.start(ops([race([wait(1), pass()], [wait(1), fail('mission.t.lost')])]));
    h.step(80);
    expect(h.rt.phase).toBe('passed');
    expect(count(h, 'fail')).toBe(0);
    const h2 = makeHarness();
    h2.start(ops([race([wait(1), fail('mission.t.lost')], [wait(1), pass()])]));
    h2.step(80);
    expect(h2.rt.phase).toBe('failed');
  });

  it('loop stops at max, or when `until` holds', () => {
    const h = makeHarness();
    h.start(ops([loop(5, [emit('ping')]), loop(100, [emit('pong'), setFlag({ 't.n': 1 })], flagIs('t.stop', { eq: true }))]));
    h.step(1);
    expect(count(h, 'ping')).toBe(5);
    h.step(1);
    expect(count(h, 'pong')).toBe(100);
    const h2 = makeHarness();
    h2.start(ops([loop(1000, [emit('tick'), wait(0.05)], eventSeen('stop', 'mission'))]));
    h2.step(30);
    const n = count(h2, 'tick');
    expect(n).toBeGreaterThan(3);
    h2.emit({ t: 'stop', tick: h2.tickNo.n });
    h2.step(10);
    expect(count(h2, 'tick')).toBeLessThanOrEqual(n + 5);
  });

  it('if takes then or else', () => {
    const h = makeHarness();
    h.start(ops([setFlag({ 't.x': 2 }), ifOp(flagIs('t.x', { gte: 2 }), [setFlag({ 't.then': 1 })], [setFlag({ 't.else': 1 })]), ifOp(flagIs('t.x', { eq: 9 }), [setFlag({ 't.no': 1 })])]));
    h.step(2);
    expect(flag(h, 't.then')).toBe(1);
    expect(flag(h, 't.else')).toBeUndefined();
    expect(flag(h, 't.no')).toBeUndefined();
  });

  it('waitUntil resumes when its condition holds, or after its timeout and runs onTimeout', () => {
    const h = makeHarness();
    h.start(ops([waitUntil(flagIs('t.go', { eq: true }), { timeoutSec: 2, onTimeout: [setFlag({ 't.timeout': 1 })] }), setFlag({ 't.done': 1 })]));
    h.step(60);
    expect(flag(h, 't.done')).toBeUndefined();
    h.step(80);
    expect(flag(h, 't.timeout')).toBe(1);
    expect(flag(h, 't.done')).toBe(1);

    const g = makeHarness();
    g.start(ops([waitUntil(flagIs('t.go', { eq: true }), { timeoutSec: 30, onTimeout: [setFlag({ 't.timeout': 1 })] }), setFlag({ 't.done': 1 })]));
    g.step(10);
    g.story.flags['t.go'] = true;
    g.step(3);
    expect(flag(g, 't.done')).toBe(1);
    expect(flag(g, 't.timeout')).toBeUndefined();
  });

  it('waitEvent resumes on the event (a mission event or a sim event) or after its timeout', () => {
    const h = makeHarness();
    h.start(ops([waitEvent('horn'), setFlag({ 't.heard': 1 }), waitEvent('never', 1), setFlag({ 't.timeout': 1 })]));
    h.step(20);
    expect(flag(h, 't.heard')).toBeUndefined();
    h.emit({ t: 'horn', tick: h.tickNo.n });
    h.step(3);
    expect(flag(h, 't.heard')).toBe(1);
    expect(flag(h, 't.timeout')).toBeUndefined();
    h.step(80);
    expect(flag(h, 't.timeout')).toBe(1);
  });

  it('a thread yields after 2,000 ops and 60 ticks in a row at the budget end the mission in failed with script_error', () => {
    const h = makeHarness();
    h.start(ops([loop(10_000, [loop(10_000, [emit('spin')])])]));
    h.step(1);
    const first = count(h, 'spin');
    expect(first).toBeGreaterThan(900);
    expect(first).toBeLessThanOrEqual(2000);
    h.step(1);
    expect(count(h, 'spin')).toBeGreaterThan(first);
    expect(h.rt.phase).toBe('stage');
    h.step(70);
    expect(h.rt.phase).toBe('failed');
    expect(h.vm.get('hud.mission')).toMatchObject({ failKey: 'fail.reason.script_error' });
    expect(h.calls.telemetry.some((t) => t.name === 'err.sim' && t.props['code'] === 'E_BUDGET')).toBe(true);
  });

  it('every wait is a wait on the mission clock, which a beat stops', () => {
    const h = makeHarness({ directors: new Map([['d.beat', { schema: 'director/1', id: 'd.beat', durationSec: 2, seed: 1, marks: {}, actors: [], shots: [{ atSec: 0, preset: 'establish', subject: 'player', lens: 'wide' }], actions: [], cues: [], xrVantage: { mark: 'm', yawDeg: 0 }, letterbox: true }]]) });
    h.start(ops([wait(1), setFlag({ 't.after_wait': 1 })], { threads: { b: [wait(0.5), beat({ director: 'd.beat' }), setFlag({ 't.beat_done': 1 })] } }));
    h.step(40);
    expect(h.rt.beating).toBe(true);
    const clock = h.rt.clock;
    h.step(60);
    expect(h.rt.clock).toBe(clock);
    expect(flag(h, 't.after_wait')).toBeUndefined();
    h.step(90);
    expect(h.rt.beating).toBe(false);
    expect(flag(h, 't.beat_done')).toBe(1);
    expect(h.calls.camera).toEqual(['direct', 'release']);
    h.step(40);
    expect(flag(h, 't.after_wait')).toBe(1);
  });
});

describe('mission VM: effect ops', () => {
  it('spawn and despawn create and remove cast entities under mis:<id>:<name>', () => {
    const h = makeHarness();
    h.start(ops([wait(0.1), spawn('pal'), wait(1), despawn('pal')]));
    expect(h.ecs.byKey(`mis:${ID}:pal`)).toBe(0);
    h.step(12);
    expect(h.ecs.byKey(`mis:${ID}:pal`)).not.toBe(0);
    expect(h.ecs.byKey(`mis:${ID}:box`)).not.toBe(0);
    h.step(80);
    expect(h.ecs.byKey(`mis:${ID}:pal`)).toBe(0);
  });

  it('task moves a walker toward a zone and it stops inside', () => {
    const h = makeHarness();
    h.start(ops([spawn('pal'), task('pal', walkTo('z'))]));
    h.step(3);
    const pal = h.at(`mis:${ID}:pal`);
    const px = (): number => h.ecs.store(Transform).px[h.ecs.resolve(pal) as number] as number;
    const x0 = px();
    h.step(120);
    expect(px()).toBeGreaterThan(x0 + 2);
    h.step(1500);
    expect(Math.abs(px() - 50)).toBeLessThan(6);
  });

  it('say patches the subtitle and waits for its duration when asked; text raises a toast', () => {
    const h = makeHarness({ lineText: () => 'x'.repeat(100) });
    h.start(ops([say('pal', 'line.t.a', true), setFlag({ 't.said': 1 }), text('npc_test', 'line.t.b')]));
    h.step(3);
    expect(h.vm.get('hud.subtitle')).toMatchObject({ speaker: 'pal', text: 'line.t.a' });
    expect(flag(h, 't.said')).toBeUndefined();
    h.step(400);
    expect(flag(h, 't.said')).toBe(1);
    expect(h.calls.toasts.some((t) => t.text === 'line.t.b')).toBe(true);
  });

  it('marker, camera, fade and the events they leave', () => {
    const h = makeHarness();
    h.start(ops([marker('z', 'destination'), camera('release'), fade(1, 0.5), emit('after_fade')]));
    h.step(3);
    expect([...h.calls.blips.keys()].some((k) => k.endsWith('op.z'))).toBe(true);
    expect(h.calls.camera).toContain('release');
    expect(h.vm.get('hud.fade')).toEqual({ to: 1, sec: 0.5 });
    expect(count(h, 'after_fade')).toBe(0);
    h.step(60);
    expect(count(h, 'after_fade')).toBe(1);
  });

  it('heat, clock and ambient act on the world and are undone on the way out', () => {
    const h = makeHarness();
    h.start(ops([heat({ set: 2 }), heat({ cap: 3 }), clock({ lock: { hour: 3 } }), ambient({ traffic: 0.3, peds: 0.1 })]));
    h.step(2);
    expect(h.calls.heat).toContain('set:2:mission');
    expect(h.calls.heat).toContain('cap:3');
    expect(h.calls.clockLocks).toEqual([`mis:${ID}`]);
    expect(h.calls.density.filter((d) => d.mult < 1).map((d) => `${d.kind}:${d.mult}`)).toEqual(['traffic:0.3', 'ped:0.1']);
    h.rt.abort('quit');
    expect(h.calls.clockUnlocks).toEqual([`mis:${ID}`]);
    expect(h.calls.density.slice(-2).map((d) => d.mult)).toEqual([1, 1]);
    expect(h.calls.trafficReleased).toEqual([`mis:${ID}`]);
  });

  it('flag, trust and give write the story slice; give is idempotent by key and trust is clamped', () => {
    const h = makeHarness();
    h.start(ops([setFlag({ 't.a': true, 't.n': 3 }), trust('pal', 150), trust('pal', -20), give('g1', { cashCents: 5000 }), give('g1', { cashCents: 5000 }), give('g2', { items: [{ id: 'item.x', qty: 2 }] })]));
    h.step(2);
    expect(flag(h, 't.a')).toBe(true);
    expect(flag(h, 't.n')).toBe(3);
    expect(h.story.npcRelations['npc_test']).toEqual({ trust: 80, met: true });
    expect(h.story.wallet.cashCents).toBe(5000);
    expect(h.rt.walletDelta).toBe(5000);
    expect(flag(h, 'item.item.x')).toBe(2);
  });

  it('emit records a mission event on the timeline as mis.<name>', () => {
    const h = makeHarness();
    h.start(ops([emit('hello')]));
    h.step(2);
    expect(count(h, 'hello')).toBe(1);
    expect(h.timeline.events().some((e) => e.t === 'mis.hello')).toBe(true);
  });

  it('pass ends the mission as passed (rewards, unlocks, a save, a medal) and fail ends it as failed', () => {
    const h = makeHarness();
    h.start(ops([wait(0.5), pass()], { rewards: { cashCents: 12_000, streetCred: 4 }, unlocks: ['unlock.district.d2'], medals: { silverSec: 100, goldSec: 50 } }));
    h.step(60);
    expect(h.rt.phase).toBe('passed');
    expect(h.story.wallet.cashCents).toBe(12_000);
    expect(h.story.wallet.streetCred).toBe(4);
    expect(h.story.missions[ID]).toMatchObject({ state: 'passed', medals: 3 });
    expect(h.calls.unlocks.map((u) => u.id)).toContain('unlock.district.d2');
    expect(h.calls.saves).toContain('missionPass');
    expect(h.calls.telemetry.map((t) => t.name)).toEqual(['mission.start', 'mission.complete']);
    expect(h.calls.telemetry[1]?.props).toMatchObject({ mid: ID, stage: 0, attempt: 1 });

    const f = makeHarness();
    f.start(ops([wait(0.2), fail('mission.t.nope')]));
    f.step(40);
    expect(f.rt.phase).toBe('failed');
    expect(f.vm.get('hud.mission')).toMatchObject({ failKey: 'mission.t.nope' });
    expect(f.calls.telemetry.at(-1)).toMatchObject({ name: 'mission.fail', props: { reason: 'mission.t.nope' } });
  });

  it('an unknown predicate target does not throw: a cast name that is gone is simply not in the zone', () => {
    const h = makeHarness();
    h.start(ops([waitUntil(inVehicle('pal'), { timeoutSec: 1 }), setFlag({ 't.ok': 1 })]));
    h.step(90);
    expect(flag(h, 't.ok')).toBe(1);
  });
});

describe('stage helpers', () => {
  it('the stage of the fixture is the stage the runtime reports', () => {
    const h = makeHarness();
    h.start(ops([]));
    const s = h.rt.stage as StageDef;
    expect(s.id).toBe('a');
    expect(h.rt.debugState()['stage']).toBe(0);
  });
});
