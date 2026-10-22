import type { MissionIR, Pred } from '@dv/shared';
import { Health, Transform, VehicleDamage } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import {
  actAtLeast, and, at, busted, chase, circle, collect, defeat, defineMission, deliver, destroyed, enterVehicle, escape, eventSeen, far, flagIs, follow, goto, health, heatIs,
  hasCash, hasItem, hour, inVehicle, inZone, ko, modeResult, near, not, npc, objectiveIs, or, passed, photo, prop, protect, score, speed, stage, stealth, stageTime, survive,
  talk, talkDef, trustOf, unlocked, vehicle, waitFor, weatherIs, always,
} from '../src/authoring/index.ts';
import { evalPred, hourIn, type PredEnv } from '../src/vm/predicates.ts';
import { ll, makeHarness, seatPlayer, type Harness } from './harness.ts';

const baseEnv = (over: Partial<PredEnv> = {}): PredEnv => ({
  inZone: () => false,
  inVehicle: () => false,
  distance: () => Infinity,
  health: () => null,
  ko: () => false,
  destroyed: () => false,
  busted: () => false,
  heat: () => ({ level: 0, phase: 'clear' }),
  speed: () => 0,
  hour: () => 12,
  weather: () => 'clear',
  flag: () => undefined,
  trust: () => 0,
  itemCount: () => 0,
  cashCents: () => 0,
  objective: () => 'pending',
  stageSeconds: () => 0,
  eventSeen: () => false,
  modeResult: () => undefined,
  passed: () => false,
  act: () => 1,
  unlocked: () => false,
  ...over,
});

const run = (p: Pred, over: Partial<PredEnv> = {}): { v: boolean; cost: number } => {
  const cost = { n: 0 };
  const v = evalPred(p, baseEnv(over), cost);
  return { v, cost: cost.n };
};

describe('predicates: every Pred kind', () => {
  it('logic: true, and, or, not, with short-circuit costs of 1 per node evaluated', () => {
    expect(run(always())).toEqual({ v: true, cost: 1 });
    expect(run(and(always(), not(always()), always()))).toEqual({ v: false, cost: 4 });
    expect(run(or(not(always()), always(), always()))).toEqual({ v: true, cost: 4 });
    expect(run(and())).toEqual({ v: true, cost: 1 });
    expect(run(or())).toEqual({ v: false, cost: 1 });
  });

  it('inZone, inVehicle, near, far read the world', () => {
    expect(run(inZone('player', 'z'), { inZone: (w, z) => w === 'player' && z === 'z' }).v).toBe(true);
    expect(run(inVehicle('player', 'car'), { inVehicle: (_w, v) => v === 'car' }).v).toBe(true);
    expect(run(near('player', 'pal', 5), { distance: () => 5 }).v).toBe(true);
    expect(run(near('player', 'pal', 5), { distance: () => 5.1 }).v).toBe(false);
    expect(run(far('player', 'pal', 5), { distance: () => 5 }).v).toBe(true);
    expect(run(far('player', 'pal', 5), { distance: () => 4.9 }).v).toBe(false);
  });

  it('health, ko, destroyed, busted', () => {
    expect(run(health('player', 0.5), { health: () => 0.4 }).v).toBe(true);
    expect(run(health('player', 0.5), { health: () => 0.5 }).v).toBe(false);
    expect(run(health('player', 0.5), { health: () => null }).v).toBe(false);
    expect(run(ko('pal'), { ko: (w) => w === 'pal' }).v).toBe(true);
    expect(run(destroyed('car'), { destroyed: (c) => c === 'car' }).v).toBe(true);
    expect(run(busted(), { busted: () => true }).v).toBe(true);
  });

  it('heat compares level bounds and phase', () => {
    const e = { heat: () => ({ level: 3, phase: 'search' as const }) };
    expect(run(heatIs({ min: 3 }), e).v).toBe(true);
    expect(run(heatIs({ min: 4 }), e).v).toBe(false);
    expect(run(heatIs({ max: 2 }), e).v).toBe(false);
    expect(run(heatIs({ min: 1, max: 3, phase: 'search' }), e).v).toBe(true);
    expect(run(heatIs({ phase: 'pursuit' }), e).v).toBe(false);
  });

  it('speed, hour (wrapping), weather', () => {
    expect(run(speed('player', { minMps: 5, maxMps: 10 }), { speed: () => 7 }).v).toBe(true);
    expect(run(speed('player', { minMps: 5 }), { speed: () => 4 }).v).toBe(false);
    expect(run(speed('player', { maxMps: 1 }), { speed: () => 4 }).v).toBe(false);
    expect(run(hour(8, 18), { hour: () => 12 }).v).toBe(true);
    expect(run(hour(22, 5), { hour: () => 23 }).v).toBe(true);
    expect(run(hour(22, 5), { hour: () => 3 }).v).toBe(true);
    expect(run(hour(22, 5), { hour: () => 12 }).v).toBe(false);
    expect(hourIn(5, 5, 6)).toBe(true);
    expect(hourIn(6, 5, 6)).toBe(false);
    expect(run(weatherIs('rain', 'smoke'), { weather: () => 'rain' }).v).toBe(true);
    expect(run(weatherIs('rain'), { weather: () => 'clear' }).v).toBe(false);
  });

  it('flag: eq, gte, or plain truthiness', () => {
    expect(run(flagIs('k', { eq: 'a' }), { flag: () => 'a' }).v).toBe(true);
    expect(run(flagIs('k', { eq: 2 }), { flag: () => 3 }).v).toBe(false);
    expect(run(flagIs('k', { gte: 3 }), { flag: () => 3 }).v).toBe(true);
    expect(run(flagIs('k', { gte: 3 }), { flag: () => 'x' }).v).toBe(false);
    expect(run(flagIs('k'), { flag: () => true }).v).toBe(true);
    expect(run(flagIs('k'), { flag: () => 0 }).v).toBe(false);
    expect(run(flagIs('k')).v).toBe(false);
  });

  it('trust, item, cash', () => {
    expect(run(trustOf('npc', { gte: 10 }), { trust: () => 12 }).v).toBe(true);
    expect(run(trustOf('npc', { lte: -10 }), { trust: () => 12 }).v).toBe(false);
    expect(run(trustOf('npc', { gte: 0, lte: 20 }), { trust: () => 12 }).v).toBe(true);
    expect(run(hasItem('x', 2), { itemCount: () => 2 }).v).toBe(true);
    expect(run(hasItem('x', 3), { itemCount: () => 2 }).v).toBe(false);
    expect(run(hasCash(500), { cashCents: () => 499 }).v).toBe(false);
  });

  it('objective, stageTime, event, modeResult', () => {
    expect(run(objectiveIs('o', 'done'), { objective: () => 'done' }).v).toBe(true);
    expect(run(objectiveIs('o', 'active'), { objective: () => 'done' }).v).toBe(false);
    expect(run(stageTime({ gteSec: 5 }), { stageSeconds: () => 5 }).v).toBe(true);
    expect(run(stageTime({ lteSec: 5 }), { stageSeconds: () => 6 }).v).toBe(false);
    expect(run(eventSeen('e', 'stage'), { eventSeen: (_n, s) => s === 'stage' }).v).toBe(true);
    expect(run(eventSeen('e', 'mission'), { eventSeen: (_n, s) => s === 'stage' }).v).toBe(false);
    expect(run(modeResult('h', ['win', 'finish']), { modeResult: () => 'finish' }).v).toBe(true);
    expect(run(modeResult('h', ['win']), { modeResult: () => 'lose' }).v).toBe(false);
    expect(run(modeResult('h', ['win'])).v).toBe(false);
  });

  it('passed, act, unlocked', () => {
    expect(run(passed('m.a1.01'), { passed: (m) => m === 'm.a1.01' }).v).toBe(true);
    expect(run(actAtLeast(2), { act: () => 1 }).v).toBe(false);
    expect(run(actAtLeast(2), { act: () => 3 }).v).toBe(true);
    expect(run(unlocked('unlock.racing'), { unlocked: (id) => id === 'unlock.racing' }).v).toBe(true);
  });
});

// ---- objectives, one mission per kind --------------------------------------------------------------------------------------------

const ID = 'm.t.obj';
type Obj = Parameters<typeof stage>[1][number];

function one(objective: Obj, cast: Record<string, ReturnType<typeof npc>> = {}, extra: Partial<Parameters<typeof defineMission>[0]> = {}): MissionIR {
  return defineMission({
    id: ID,
    version: 1,
    district: 'd1',
    cast: {
      pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)) }),
      box: prop({ prefab: 'prop.crate', spawn: at(...ll(20, 0)) }),
      car: vehicle({ prefab: 'vehicle.compact', spawn: at(...ll(30, 0)), playerUsable: true }),
      ...cast,
    },
    zones: { z: circle(...ll(50, 0), 5), far: circle(...ll(500, 500), 5) },
    stages: [stage('a', [objective])],
    ...extra,
  });
}

const objState = (h: Harness, id: string): string | undefined => h.rt.objectives.get(id)?.state;
const hpOf = (h: Harness, key: string, frac: number): void => {
  const id = h.ecs.resolve(h.at(key)) as number;
  const hp = h.ecs.store(Health);
  hp.hp[id] = (hp.max[id] as number) * frac;
  hp.ko[id] = frac <= 0 ? 1 : 0;
};
const posOf = (h: Harness, key: string): [number, number] => {
  const id = h.ecs.resolve(h.at(key)) as number;
  const tr = h.ecs.store(Transform);
  return [tr.px[id] as number, tr.pz[id] as number];
};

describe('objectives: every kind completes, fails and reads the world', () => {
  it('goto: the zone, on foot, in a vehicle, stopped', () => {
    const h = makeHarness();
    h.start(one(goto('z', { id: 'g', onFoot: true })));
    h.step(3);
    expect(objState(h, 'g')).toBe('active');
    h.put(h.player, 50, 0);
    h.step(3);
    expect(h.rt.phase).toBe('passed');

    const v = makeHarness();
    v.start(one(goto('z', { id: 'g', inVehicle: 'car', stopped: true })));
    v.step(2);
    seatPlayer(v, v.at(`mis:${ID}:car`));
    v.put(v.at(`mis:${ID}:car`), 50, 0);
    v.put(v.player, 50, 0);
    v.step(3);
    expect(v.rt.phase).toBe('passed');

    const w = makeHarness();
    w.start(one(goto('z', { id: 'g', onFoot: true })));
    w.step(2);
    seatPlayer(w, w.at(`mis:${ID}:car`));
    w.put(w.at(`mis:${ID}:car`), 50, 0);
    w.put(w.player, 50, 0);
    w.step(3);
    expect(w.rt.phase).toBe('stage');
  });

  it('enterVehicle: the player at the wheel of the named or any vehicle', () => {
    const h = makeHarness();
    h.start(one(enterVehicle('car', { id: 'e' })));
    h.step(2);
    expect(objState(h, 'e')).toBe('active');
    seatPlayer(h, h.at(`mis:${ID}:car`));
    h.step(3);
    expect(h.rt.phase).toBe('passed');
  });

  it('follow: fails when the target stays beyond the band for loseAfterSec, completes in the end zone', () => {
    const h = makeHarness();
    h.start(one(follow('pal', [5, 40], 1, { id: 'f', untilZone: 'z' })));
    h.step(5);
    h.put(h.at(`mis:${ID}:pal`), 200, 200);
    h.step(100);
    expect(h.rt.phase).toBe('failed');
    expect(h.vm.get('hud.mission')).toMatchObject({ failKey: 'fail.reason.follow' });

    const g = makeHarness();
    g.start(one(follow('pal', [5, 40], 1, { id: 'f', untilZone: 'z' })));
    g.step(3);
    g.put(g.player, 50, 0);
    g.step(3);
    expect(g.rt.phase).toBe('passed');
  });

  it('chase: within catchDist for holdSec', () => {
    const h = makeHarness();
    h.start(one(chase('pal', 4, { id: 'c', holdSec: 0.5 })));
    h.step(3);
    h.put(h.at(`mis:${ID}:pal`), 2, 0);
    h.step(20);
    expect(objState(h, 'c')).toBe('active');
    h.step(30);
    expect(h.rt.phase).toBe('passed');
  });

  it('escape: done when the heat is gone', () => {
    const h = makeHarness();
    h.pursuit.level = 3;
    h.start(one(escape({ id: 'esc' })));
    h.step(5);
    expect(objState(h, 'esc')).toBe('active');
    h.pursuit.level = 0;
    h.step(3);
    expect(h.rt.phase).toBe('passed');
  });

  it('survive and wait: after their seconds on the mission clock', () => {
    const h = makeHarness();
    h.start(one(survive(1, { id: 's' })));
    h.step(50);
    expect(h.rt.phase).toBe('stage');
    h.step(20);
    expect(h.rt.phase).toBe('passed');
    const w = makeHarness();
    w.start(one(waitFor(0.5, { id: 'w' })));
    w.step(40);
    expect(w.rt.phase).toBe('passed');
  });

  it('collect: walking up to the entity picks it up and it leaves the world', () => {
    const h = makeHarness();
    h.start(one(collect('box', { id: 'c' })));
    h.step(3);
    expect(h.ecs.byKey(`mis:${ID}:box`)).not.toBe(0);
    h.put(h.player, 19.5, 0);
    h.step(3);
    expect(h.rt.isCarried('box') || h.rt.phase === 'passed').toBe(true);
    expect(h.ecs.byKey(`mis:${ID}:box`)).toBe(0);
  });

  it('deliver: carrying it into the zone, or a vehicle driven there; a fragile cargo that took damage fails', () => {
    const h = makeHarness();
    h.start(one(deliver('box', 'z', { id: 'd' })));
    h.step(3);
    h.rt.carry('box');
    h.step(3);
    expect(objState(h, 'd')).toBe('active');
    h.put(h.player, 50, 0);
    h.step(3);
    expect(h.rt.phase).toBe('passed');

    const v = makeHarness();
    v.start(one(deliver('car', 'z', { id: 'd', fragile: 0.3 })));
    v.step(3);
    v.put(v.at(`mis:${ID}:car`), 50, 0);
    v.step(3);
    expect(v.rt.phase).toBe('passed');

    const f = makeHarness();
    f.start(one(deliver('car', 'z', { id: 'd', fragile: 0.3 })));
    f.step(3);
    f.ecs.store(VehicleDamage).body[f.ecs.resolve(f.at(`mis:${ID}:car`)) as number] = 0.6;
    f.step(3);
    expect(f.rt.phase).toBe('failed');
  });

  it('protect: fails below minHealth, completes after sec', () => {
    const h = makeHarness();
    h.start(one(protect('pal', 0.5, { id: 'p', sec: 1 })));
    h.step(3);
    hpOf(h, `mis:${ID}:pal`, 0.3);
    h.step(3);
    expect(h.rt.phase).toBe('failed');
    const g = makeHarness();
    g.start(one(protect('pal', 0.5, { id: 'p', sec: 1 })));
    g.step(80);
    expect(g.rt.phase).toBe('passed');
  });

  it('talk: waits for talk.result (or applies the default under ?talk=scripted) and takes the outcome\'s flags, trust and jump', () => {
    const def = (): Obj => talk(talkDef({ id: 't', npc: 'pal', intent: 'k.i', outcomes: { yes: { label: 'k.y', flags: { 'dev.yes': true }, trust: 7 }, no: { label: 'k.n', stage: 'b' } }, default: 'yes' }), { id: 'tk' });
    const mk = (): MissionIR => one(def(), {}, { stages: [stage('a', [def()]), stage('b', [waitFor(600, { id: 'w' })])] });
    const h = makeHarness();
    h.start(mk());
    h.step(5);
    expect(h.vm.get('mode.story.talk')).toMatchObject({ talkId: 't', npc: 'npc_test' });
    h.rt.command({ name: 'talk.result', talkId: 't', outcome: 'yes', turns: 2, path: 'llm' });
    h.step(4);
    expect(h.story.flags['dev.yes']).toBe(true);
    expect(h.story.npcRelations['npc_test']?.trust).toBe(7);
    expect(h.rt.stage?.id).toBe('b');
    expect(h.vm.get('mode.story.talk')).toBeNull();
    expect(h.timeline.externals().map((e) => e.src)).toEqual(['talk']);

    const s = makeHarness({ flags: { talk: 'scripted' } });
    s.start(mk());
    s.step(8);
    expect(s.rt.talkResults['t']).toBe('yes');

    const j = makeHarness();
    j.start(one(def(), {}, { stages: [stage('a', [def()], { next: 'c' }), stage('b', [waitFor(600, { id: 'wb' })]), stage('c', [waitFor(600, { id: 'wc' })])] }));
    j.step(5);
    j.rt.command({ name: 'talk.result', talkId: 't', outcome: 'no', turns: 1, path: 'ink' });
    j.step(4);
    expect(j.rt.stage?.id).toBe('b');
  });

  it('photo: the shutter event, near enough to the subject', () => {
    const h = makeHarness();
    h.start(one(photo('box', { id: 'ph', maxDistM: 10 })));
    h.step(3);
    h.emit({ t: 'photo.taken', tick: 1 });
    h.step(3);
    expect(h.rt.phase).toBe('stage');
    h.put(h.player, 15, 0);
    h.emit({ t: 'photo.taken', tick: 2 });
    h.step(3);
    expect(h.rt.phase).toBe('passed');
  });

  it('stealth: reaching the zone within the detection budget; one detection too many fails', () => {
    const h = makeHarness();
    h.start(one(stealth('z', 1, [ll(0, 0)], { id: 'st' })));
    h.step(3);
    h.emit({ t: 'npc.detect', tick: 1 });
    h.put(h.player, 50, 0);
    h.step(3);
    expect(h.rt.phase).toBe('passed');
    const g = makeHarness();
    g.start(one(stealth('z', 1, [ll(0, 0)], { id: 'st' })));
    g.step(3);
    g.emit({ t: 'npc.detect', tick: 1 });
    g.emit({ t: 'npc.detect', tick: 2 });
    g.step(3);
    expect(g.rt.phase).toBe('failed');
  });

  it('defeat: every target knocked out', () => {
    const h = makeHarness();
    h.start(one(defeat(['pal'], { id: 'df' })));
    h.step(3);
    expect(objState(h, 'df')).toBe('active');
    hpOf(h, `mis:${ID}:pal`, 0);
    h.step(3);
    expect(h.rt.phase).toBe('passed');
  });

  it('score: the metric events add up to the target within the time, or the objective fails', () => {
    const h = makeHarness();
    h.start(one(score('drift', 30, 5, { id: 'sc' })));
    h.step(3);
    h.emit({ t: 'score.drift', tick: 1, n: 20 });
    h.step(3);
    expect(h.rt.phase).toBe('stage');
    h.emit({ t: 'score.drift', tick: 2, n: 15 });
    h.step(3);
    expect(h.rt.phase).toBe('passed');
    const g = makeHarness();
    g.start(one(score('airtime', 30, 1, { id: 'sc' })));
    g.step(90);
    expect(g.rt.phase).toBe('failed');
  });

  it('a destroyed cast entry and the cast-zone distance test', () => {
    const h = makeHarness();
    h.start(one(waitFor(600, { id: 'w' }), {}, { zones: { z: circle(...ll(50, 0), 5), nearpal: { k: 'cast', cast: 'pal', r: 6 } as never } }));
    h.step(3);
    expect(h.rt.zoneInside('player', 'nearpal')).toBe(false);
    h.put(h.player, 12, 11);
    expect(h.rt.zoneInside('player', 'nearpal')).toBe(true);
    expect(h.rt.predEnv.destroyed('pal')).toBe(false);
    hpOf(h, `mis:${ID}:pal`, 0);
    expect(h.rt.predEnv.destroyed('pal')).toBe(true);
    expect(posOf(h, `mis:${ID}:pal`)[0]).toBeGreaterThan(5);
  });
});
