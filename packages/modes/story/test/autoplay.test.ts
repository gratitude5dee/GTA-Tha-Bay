/**
 * M05a2: the story autoplayer. Goals from objectives, the control values of each policy, the `InputFrame` edges, the event probes
 * (photo shutter, drift score), and the end-to-end run of m.dev.sample, including a run that shows the bot is what passes it.
 */
import path from 'node:path';
import { SimButton, type ObjectiveDef } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { createCanonicalRunner } from '../../../engine/src/qa/runner.ts';
import { readFixturePacks } from '../../../engine/src/qa/node.ts';
import { readBundle } from '../../../../tools/ci/missions/bundle.ts';
import { photo, defineMission, at, circle, stage, pickup } from '../src/authoring/index.ts';
import { deriveGoal, nearestUsableVehicle, pickObjective } from '../src/autoplay/goals.ts';
import { createStoryAutoplayer } from '../src/autoplay/driver.ts';
import type { CastView, MissionObs, ObjView } from '../src/autoplay/observe.ts';
import { CONTEXT_PHOTO, CONTEXT_VEHICLE, decide, newMem, type Tools } from '../src/autoplay/policies.ts';
import { encodeBundle, missionSpec, registerStoryQa } from '../src/qa.ts';
import { PHOTO_CONTEXT, slipDeg } from '../src/vm/probes.ts';
import { ll, makeHarness } from './harness.ts';

const root = path.resolve(new URL(import.meta.url).pathname, '../../../../..');

function obs(over: Partial<MissionObs> = {}): MissionObs {
  return {
    tick: 100,
    phase: 'stage',
    stage: 0,
    stageId: 's',
    sec: 1,
    heat: 0,
    me: { pos: [0, 0, 0], yaw: 0, speed: 0, vehicle: null },
    units: [],
    others: [],
    objectives: [],
    zones: {},
    cast: {},
    hookStubs: {},
    child: null,
    landmarks: {},
    ray: () => null,
    groundY: () => 0,
    route: () => null,
    ...over,
  };
}

const ov = (def: ObjectiveDef, extra: Partial<ObjView> = {}): ObjView => ({ id: def.id, def, optional: def.optional === true, ageTicks: 0, ...extra });
const tools = (tick = 100): Tools => ({ tick, rng: () => 0.25 });
const veh = (pos: [number, number, number], over: Partial<CastView> = {}): CastView => ({ pos, speed: 0, yaw: 0, carried: false, kind: 'vehicle', usable: true, occupied: false, ...over });

describe('goals from objectives (C9)', () => {
  const goto = (zone: string, extra: object = {}): ObjectiveDef => ({ id: 'g', text: 't', k: 'goto', zone, ...extra }) as ObjectiveDef;

  it('goto aims inside the zone, on foot when asked, in the named vehicle when asked', () => {
    const o = obs({ zones: { z: { c: [100, 0, 0], r: 10 } } });
    expect(deriveGoal(o, ov(goto('z')))).toMatchObject({ k: 'reach', at: [100, 0, 0], mode: 'free', stop: false });
    expect(deriveGoal(o, ov(goto('z', { onFoot: true })))).toMatchObject({ mode: 'foot' });
    expect(deriveGoal(o, ov(goto('z', { inVehicle: 'car', stopped: true })))).toMatchObject({ mode: 'vehicle', vehicle: 'car', stop: true });
    expect(deriveGoal(obs(), ov(goto('nowhere')))).toEqual({ k: 'idle' });
    const g = deriveGoal(o, ov(goto('z')));
    expect(g.k === 'reach' && g.r).toBeLessThan(10);
  });

  it('follow keeps the middle of the band, chase aims at the target, collect and deliver go to the item and then the zone', () => {
    const o = obs({ zones: { park: { c: [50, 0, 50], r: 15 } }, cast: { pal: veh([30, 0, 0], { kind: 'npc', usable: false }), crate: veh([5, 0, 5], { kind: 'pickup', usable: false }) } });
    expect(deriveGoal(o, ov({ id: 'f', text: 't', k: 'follow', target: 'pal', band: [6, 40], loseAfterSec: 15, untilZone: 'park' }))).toMatchObject({ k: 'follow', target: 'pal', mid: 23, zone: [50, 0, 50] });
    expect(deriveGoal(o, ov({ id: 'c', text: 't', k: 'chase', target: 'pal', catchDist: 5 }))).toEqual({ k: 'chase', target: 'pal' });
    expect(deriveGoal(o, ov({ id: 'c', text: 't', k: 'collect', cast: 'crate' }))).toMatchObject({ k: 'reach', at: [5, 0, 5], mode: 'foot' });
    const dl: ObjectiveDef = { id: 'd', text: 't', k: 'deliver', cast: 'crate', to: 'park' };
    expect(deriveGoal(o, ov(dl))).toMatchObject({ at: [5, 0, 5] });
    const carried = obs({ zones: o.zones, cast: { crate: veh([5, 0, 5], { kind: 'pickup', usable: false, carried: true }) } });
    expect(deriveGoal(carried, ov(dl))).toMatchObject({ k: 'reach', at: [50, 0, 50], mode: 'free' });
  });

  it('photo, stealth, score, enterVehicle and the waiting kinds', () => {
    const o = obs({ cast: { crate: veh([9, 0, 9], { kind: 'pickup', usable: false }), car: veh([3, 0, 3]) }, landmarks: { 'lm.city-hall': [1, 2, 3] } });
    expect(deriveGoal(o, ov({ id: 'p', text: 't', k: 'photo', subject: 'crate', maxDistM: 20 }))).toEqual({ k: 'photo', subject: [9, 0, 9], maxDistM: 20 });
    expect(deriveGoal(o, ov({ id: 'p', text: 't', k: 'photo', subject: 'lm.city-hall' } as ObjectiveDef))).toMatchObject({ k: 'photo', subject: [1, 2, 3] });
    const st = deriveGoal(o, ov({ id: 's', text: 't', k: 'stealth', zone: 'z', detectBudget: 2, autoplayPath: [[37.7793, -122.4193], [37.7794, -122.4192]] }));
    expect(st.k === 'path' && st.points).toHaveLength(2);
    expect(deriveGoal(o, ov({ id: 's', text: 't', k: 'score', metric: 'drift', target: 30, withinSec: 60 }))).toEqual({ k: 'pattern', name: 'drift' });
    expect(deriveGoal(o, ov({ id: 'e', text: 't', k: 'enterVehicle', vehicle: 'any' }))).toEqual({ k: 'enter', vehicle: 'car' });
    for (const k of ['survive', 'wait'] as const) expect(deriveGoal(o, ov({ id: 'w', text: 't', k, sec: 5 } as ObjectiveDef))).toEqual({ k: 'idle' });
    expect(deriveGoal(o, ov({ id: 'm', text: 't', k: 'mode', hook: 'race1' }))).toEqual({ k: 'idle' });
  });

  it('works the first required objective and falls back to an optional one', () => {
    const a = ov({ id: 'b', text: 't', k: 'wait', sec: 1, optional: true });
    const b = ov({ id: 'c', text: 't', k: 'wait', sec: 1 });
    expect(pickObjective(obs({ objectives: [a, b] }))?.id).toBe('c');
    expect(pickObjective(obs({ objectives: [a] }))?.id).toBe('b');
    expect(pickObjective(obs())).toBeNull();
  });

  it('nearestUsableVehicle ignores vehicles that are taken, not usable or too far', () => {
    const o = obs({ cast: { a: veh([100, 0, 0]), b: veh([10, 0, 0], { occupied: true }), c: veh([20, 0, 0], { usable: false }), d: veh([30, 0, 0]) } });
    expect(nearestUsableVehicle(o, 60)).toBe('d');
    expect(nearestUsableVehicle(o, 20)).toBeNull();
  });
});

describe('policies: the control values of a tick', () => {
  const east = 49152;
  const north = 0;

  it('on foot the stick is pushed forward and camYaw is the heading to the target', () => {
    const c = decide(obs(), { k: 'reach', at: [50, 0, 0], r: 2, mode: 'foot' }, newMem(), tools());
    expect(c.moveY).toBe(-127);
    expect(c.camYaw).toBe(east);
    expect(c.context).toBe(0);
    const n = decide(obs(), { k: 'reach', at: [0, 0, -50], r: 2, mode: 'foot' }, newMem(), tools());
    expect(n.camYaw).toBe(north);
    const arrived = decide(obs(), { k: 'reach', at: [1, 0, 0], r: 2, mode: 'foot' }, newMem(), tools());
    expect(arrived.moveY).toBe(0);
  });

  it('bends around a collider with the ray fan', () => {
    let blocked = true;
    const o = obs({ ray: (_from, dir) => (blocked && Math.abs(dir[0]) > 0.99 ? 2 : null) });
    const mem = newMem();
    const c = decide(o, { k: 'reach', at: [50, 0, 0], r: 2, mode: 'foot' }, mem, tools());
    expect(c.camYaw).not.toBe(east);
    blocked = false;
    expect(decide(obs(), { k: 'reach', at: [50, 0, 0], r: 2, mode: 'foot' }, newMem(), tools()).camYaw).toBe(east);
  });

  it('in a vehicle a target on the right steers right, on the left steers left, and the stop point holds with the handbrake at rest', () => {
    const inCar = (yaw = 0, speed = 8) => obs({ me: { pos: [0, 0, 0], yaw, speed, vehicle: { cast: 'car', pos: [0, 0, 0], yaw, speed } } });
    const right = decide(inCar(), { k: 'reach', at: [40, 0, -40], r: 3, mode: 'vehicle' }, newMem(), tools());
    const left = decide(inCar(), { k: 'reach', at: [-40, 0, -40], r: 3, mode: 'vehicle' }, newMem(), tools());
    expect(right.steer).toBeGreaterThan(0);
    expect(left.steer).toBeLessThan(0);
    expect(right.context).toBe(CONTEXT_VEHICLE);
    // a corner is taken slower than 8 m/s; from 3 m/s it accelerates
    expect(right.throttle).toBe(0);
    expect(decide(inCar(0, 3), { k: 'reach', at: [40, 0, -40], r: 3, mode: 'vehicle' }, newMem(), tools()).throttle).toBeGreaterThan(0);
    // heading east (yaw -pi/2), the same target is straight ahead
    const ahead = decide(inCar(-Math.PI / 2), { k: 'reach', at: [40, 0, 0], r: 3, mode: 'vehicle' }, newMem(), tools());
    expect(Math.abs(ahead.steer)).toBeLessThan(10);
    // at the stop point: the brake while rolling, the handbrake (never the brake) once slow, because a brake at rest reverses
    const rolling = decide(inCar(0, 6), { k: 'reach', at: [0, 0, -1], r: 3, mode: 'vehicle', stop: true }, newMem(), tools());
    expect(rolling.brake).toBe(127);
    const still = decide(inCar(0, 0.2), { k: 'reach', at: [0, 0, -1], r: 3, mode: 'vehicle', stop: true }, newMem(), tools());
    expect(still.brake).toBe(0);
    expect(still.buttons & (1 << SimButton.Handbrake)).not.toBe(0);
    const idle = decide(inCar(0, 0.1), { k: 'idle' }, newMem(), tools());
    expect(idle.brake).toBe(0);
  });

  it('walks to a car, then presses Enter once per pulse; leaves a car only when slow', () => {
    const car = obs({ cast: { car: veh([1.5, 0, 0]) } });
    const mem = newMem();
    const a = decide(car, { k: 'enter', vehicle: 'car' }, mem, tools(100));
    const b = decide(car, { k: 'enter', vehicle: 'car' }, mem, tools(101));
    expect(a.buttons & (1 << SimButton.Enter)).not.toBe(0);
    expect(b.buttons & (1 << SimButton.Enter)).toBe(0);
    const far = decide(obs({ cast: { car: veh([30, 0, 0]) } }), { k: 'enter', vehicle: 'car' }, newMem(), tools());
    expect(far.moveY).toBe(-127);
    expect(far.buttons & (1 << SimButton.Enter)).toBe(0);
    const driving = obs({ me: { pos: [0, 0, 0], yaw: 0, speed: 9, vehicle: { cast: 'car', pos: [0, 0, 0], yaw: 0, speed: 9 } } });
    const out = decide(driving, { k: 'reach', at: [5, 0, 5], r: 2, mode: 'foot' }, newMem(), tools());
    expect(out.buttons & (1 << SimButton.Enter)).toBe(0);
    expect(out.brake).toBe(127);
  });

  it('takes a usable vehicle only for a far goal', () => {
    const o = obs({ cast: { car: veh([20, 0, 0]) } });
    const far = decide(o, { k: 'reach', at: [400, 0, 0], r: 3, mode: 'free' }, newMem(), tools());
    expect(far.camYaw).toBe(49152);   // toward the car, which is east, before anything else
    const near = decide(obs({ cast: { car: veh([20, 0, 90]) } }), { k: 'reach', at: [60, 0, 0], r: 3, mode: 'free' }, newMem(), tools());
    expect(near.camYaw).toBe(49152);  // on foot toward the goal, not the car
  });

  it('photo walks to a vantage with a clear line, then fires the shutter in the photo context every 45 ticks', () => {
    const o = obs({ me: { pos: [0, 0, 0], yaw: 0, speed: 0, vehicle: null } });
    const mem = newMem();
    const walk = decide(o, { k: 'photo', subject: [30, 0, 0], maxDistM: 20 }, mem, tools(100));
    expect(walk.moveY).toBe(-127);
    const there = obs({ me: { pos: mem.vantage as [number, number, number], yaw: 0, speed: 0, vehicle: null } });
    const shot = decide(there, { k: 'photo', subject: [30, 0, 0], maxDistM: 20 }, mem, tools(200));
    expect(shot.context).toBe(CONTEXT_PHOTO);
    expect(shot.buttons & (1 << SimButton.Interact)).not.toBe(0);
    const next = decide(there, { k: 'photo', subject: [30, 0, 0], maxDistM: 20 }, mem, tools(201));
    expect(next.buttons & (1 << SimButton.Interact)).toBe(0);
    expect(CONTEXT_PHOTO).toBe(PHOTO_CONTEXT);
    // a wall hides one side of the subject: the vantage is on a side with a clear line
    const wall = obs({ ray: (from) => (from[0] > 30 ? 1 : null) });
    const m2 = newMem();
    decide(wall, { k: 'photo', subject: [30, 0, 0], maxDistM: 20 }, m2, tools());
    expect((m2.vantage as number[])[0]).toBeLessThanOrEqual(30);
  });

  it('is deterministic: the same observation gives the same control', () => {
    const o = obs({ cast: { pal: veh([30, 0, 20], { kind: 'npc', usable: false }) } });
    const g = { k: 'follow', target: 'pal', mid: 23, zone: null, zoneR: 0 } as const;
    expect(decide(o, g, newMem(), tools())).toEqual(decide(o, g, newMem(), tools()));
  });
});

describe('the driver (BotDriver story.autoplayer)', () => {
  it('writes a pressed edge only on the tick a button first goes down, and finishes with the mission', () => {
    const d = createStoryAutoplayer();
    let phase = 'stage';
    const o = obs({ cast: { car: veh([1, 0, 0]) }, objectives: [ov({ id: 'e', text: 't', k: 'enterVehicle', vehicle: 'car' })] });
    d.init({ observe: () => ({ ...o, phase }), rng: () => () => 0.5 }, {});
    const f0 = d.frame(0);
    expect(f0.device).toBe(7);
    expect(f0.buttons & (1 << SimButton.Enter)).not.toBe(0);
    expect(f0.pressed & (1 << SimButton.Enter)).not.toBe(0);
    const f1 = d.frame(1);
    expect(f1.pressed).toBe(0);
    expect(d.done()).toEqual({ done: false });
    phase = 'passed';
    d.frame(2);
    expect(d.done()).toEqual({ done: true, outcome: 'pass' });
    phase = 'failed';
    d.frame(3);
    expect(d.done()).toEqual({ done: true, outcome: 'fail' });
  });

  it('stays neutral outside the stage phase and for the first `skip` ticks', () => {
    const d = createStoryAutoplayer();
    const o = obs({ cast: { car: veh([1, 0, 0]) }, objectives: [ov({ id: 'e', text: 't', k: 'enterVehicle', vehicle: 'car' })], phase: 'intro' });
    d.init({ observe: () => o as unknown as Record<string, unknown>, rng: () => () => 0.5 }, { skip: 10 });
    expect(d.frame(0)).toMatchObject({ buttons: 0, moveY: 0, throttle: 0 });
    const d2 = createStoryAutoplayer();
    d2.init({ observe: () => ({ ...o, phase: 'stage' }), rng: () => () => 0.5 }, { skip: 10 });
    expect(d2.frame(5).buttons).toBe(0);
    expect(d2.frame(12).buttons).not.toBe(0);
  });
});

describe('event probes', () => {
  it('slipDeg: the angle between velocity and heading, none when slow or reversing', () => {
    // heading north (yaw 0): forward is -z
    expect(slipDeg(0, -10, 0)?.slipDeg).toBeCloseTo(0, 5);
    expect(slipDeg(10, -10, 0)?.slipDeg).toBeCloseTo(45, 4);
    expect(slipDeg(10, 0, 0)).toBeNull();           // sideways at 90 degrees has no forward part: not a drift
    expect(slipDeg(0, -2, 0)).toBeNull();           // too slow
    expect(slipDeg(0, 10, 0)).toBeNull();           // backwards
    expect(slipDeg(-10, -10, 0)?.slipDeg).toBeCloseTo(45, 4);
  });

  it('the shutter: Interact pressed in the photo context while a photo objective is active is photo.taken', () => {
    const h = makeHarness();
    const ir = defineMission({
      id: 'm.t.photo',
      version: 1,
      district: 'd1',
      cast: { crate: pickup({ prefab: 'pickup.item', spawn: at(...ll(5, 5)) }) },
      zones: { z: circle(...ll(50, 0), 5) },
      stages: [stage('a', [photo('crate', { id: 'snap', maxDistM: 30 })])],
    });
    h.start(ir);
    let frame = { context: 0, pressed: 0 };
    (h.ctx.input as { frame: () => unknown }).frame = () => frame;
    h.step(3);
    expect(h.rt.eventCount('photo.taken')).toBe(0);
    frame = { context: 0, pressed: 1 << SimButton.Interact };
    h.step(1);
    expect(h.rt.eventCount('photo.taken')).toBe(0);   // pressed, but not in the photo context
    frame = { context: PHOTO_CONTEXT, pressed: 1 << SimButton.Interact };
    h.step(1);
    expect(h.rt.eventCount('photo.taken')).toBe(1);
    h.step(3);
    expect(h.rt.phase).toBe('passed');
  });
});

describe('m.dev.sample under the canonical runner', () => {
  it('the bot passes it inside the band on every seed, and a bot that does nothing does not', async () => {
    registerStoryQa();
    const bundle = readBundle(root, 'm.dev.sample');
    const packs = { ...readFixturePacks(root), mission: encodeBundle(bundle) };
    for (const seed of bundle.ir.autoplay.seeds.slice(0, 1)) {
      const spec = missionSpec({ id: 'm.dev.sample', seed, expectedSecMax: 900 });
      const t = await createCanonicalRunner({ packs, processEnv: {} }).run(spec);
      expect(t.end.outcome).toBe('pass');
      expect(t.end.tick / 60).toBeGreaterThan(120);
      expect(t.end.tick / 60).toBeLessThan(900);
    }
    // the same run with the bot held neutral for the whole budget: nothing happens, so the outcome is a timeout, not a pass
    const idle = missionSpec({ id: 'm.dev.sample', seed: 1, expectedSecMax: 20, params: { skip: 1_000_000 } });
    const t = await createCanonicalRunner({ packs, processEnv: {} }).run(idle);
    expect(t.end.outcome).toBe('timeout');
  }, 120_000);
});
