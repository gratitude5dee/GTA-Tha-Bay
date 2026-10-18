import { describe, expect, it } from 'vitest';
import { Rng, SimStage, fnv32, type SimProfile, type SystemDef } from '@dv/shared';
import { EcsWorld, SchedulerError, SimCore, createSimServices } from '../src/sim/index.ts';
import { testConfig } from './helpers.ts';

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = new Rng(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextU32() % (i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

type Spec = { id: string; stage: SimStage; order: number; rateDivisor?: 1 | 2 | 4; profiles?: SimProfile[] };

const SPECS: Spec[] = [
  { id: 'engine.control.owner', stage: SimStage.Control, order: 10 },
  { id: 'engine.control.input', stage: SimStage.Control, order: 5 },
  { id: 'world.zebra', stage: SimStage.Control, order: 10 },
  { id: 'world.alpha', stage: SimStage.Control, order: 10 },
  { id: 'story.script', stage: SimStage.Script, order: 0 },
  { id: 'ai.brain', stage: SimStage.AI, order: 0, rateDivisor: 2 },
  { id: 'ai.slow', stage: SimStage.AI, order: 1, rateDivisor: 4 },
  { id: 'phys.pre', stage: SimStage.PhysicsPre, order: -3 },
  { id: 'phys.step', stage: SimStage.PhysicsStep, order: 0 },
  { id: 'rules.damage', stage: SimStage.Rules, order: 2 },
  { id: 'rules.economy', stage: SimStage.Rules, order: 2 },
  { id: 'commands.apply', stage: SimStage.Commands, order: 0 },
  { id: 'publish.snapshot', stage: SimStage.Publish, order: 100 },
  { id: 'publish.telemetry', stage: SimStage.Publish, order: 100 },
  { id: 'streaming.interest', stage: SimStage.Streaming, order: 0 },
  { id: 'phys.post', stage: SimStage.PhysicsPost, order: 0 },
  { id: 'canonical.only', stage: SimStage.Rules, order: 0, profiles: ['canonical'] },
  { id: 'local.only', stage: SimStage.Rules, order: 0, profiles: ['local'] },
];

function expectedLog(profile: SimProfile, ticks: number): string[] {
  const out: string[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const active = SPECS.filter((s) => !s.profiles || s.profiles.includes(profile)).filter(
      (s) => !s.rateDivisor || (tick + (fnv32(s.id) % s.rateDivisor)) % s.rateDivisor === 0,
    );
    active.sort((a, b) => a.stage - b.stage || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const s of active) out.push(`${tick}:${s.stage}:${s.id}`);
  }
  return out;
}

function runLog(profile: SimProfile, registrationSeed: number, ticks = 8): string[] {
  const log: string[] = [];
  const core = new SimCore(testConfig({ profile }), new EcsWorld(), createSimServices(1));
  for (const s of shuffled(SPECS, registrationSeed)) {
    const def: SystemDef = {
      id: s.id, owner: 'S01', stage: s.stage, order: s.order,
      ...(s.rateDivisor ? { rateDivisor: s.rateDivisor } : {}),
      ...(s.profiles ? { profiles: s.profiles } : {}),
      run: (ctx) => { log.push(`${ctx.tick}:${s.stage}:${s.id}`); },
    };
    core.addSystem(def);
  }
  for (let i = 0; i < ticks; i++) core.stepOnce();
  return log;
}

describe('system scheduler (C02)', () => {
  it('runs systems sorted by stage, then order, then id, whatever the registration order', () => {
    const want = expectedLog('canonical', 8);
    for (const seed of [1, 2, 3, 99, 1234]) expect(runLog('canonical', seed)).toEqual(want);
    // Spot checks of the tie-breaks.
    const tick0 = want.filter((l) => l.startsWith('0:')).map((l) => l.split(':')[2]);
    expect(tick0.indexOf('engine.control.input')).toBeLessThan(tick0.indexOf('world.alpha'));
    expect(tick0.indexOf('engine.control.owner')).toBeLessThan(tick0.indexOf('world.alpha'));
    expect(tick0.indexOf('world.alpha')).toBeLessThan(tick0.indexOf('world.zebra'));
  });

  it('a rateDivisor 2 system runs exactly when (tick + fnv32(id) % 2) % 2 === 0', () => {
    const log = runLog('canonical', 7, 8);
    const ran = log.filter((l) => l.endsWith(':ai.brain')).map((l) => Number(l.split(':')[0]));
    const want = [0, 1, 2, 3, 4, 5, 6, 7].filter((t) => (t + (fnv32('ai.brain') % 2)) % 2 === 0);
    expect(ran).toEqual(want);
    expect(ran.length).toBe(4);
    const slow = log.filter((l) => l.endsWith(':ai.slow')).map((l) => Number(l.split(':')[0]));
    expect(slow).toEqual([0, 1, 2, 3, 4, 5, 6, 7].filter((t) => (t + (fnv32('ai.slow') % 4)) % 4 === 0));
    expect(slow.length).toBe(2);
  });

  it('profile-limited systems run only in their profiles', () => {
    expect(runLog('canonical', 1, 2).some((l) => l.endsWith('canonical.only'))).toBe(true);
    expect(runLog('canonical', 1, 2).some((l) => l.endsWith('local.only'))).toBe(false);
    expect(runLog('local', 1, 2).some((l) => l.endsWith('local.only'))).toBe(true);
    expect(runLog('local', 1, 2).some((l) => l.endsWith('canonical.only'))).toBe(false);
    expect(runLog('local', 3, 8)).toEqual(expectedLog('local', 8));
  });

  it('rejects duplicate ids and invalid rate divisors; unregister removes', () => {
    const core = new SimCore(testConfig(), new EcsWorld(), createSimServices(1));
    const base = { owner: 'S01', stage: SimStage.Rules, order: 0, run: () => {} } as const;
    core.addSystem({ ...base, id: 'x' });
    expect(() => core.addSystem({ ...base, id: 'x' })).toThrow(SchedulerError);
    expect(() => core.addSystem({ ...base, id: 'y', rateDivisor: 3 as 2 })).toThrow(SchedulerError);
    expect(() => core.addSystem({ ...base, id: 'z', order: NaN })).toThrow(SchedulerError);
    expect(core.scheduler.plan(SimStage.Rules, 0)).toEqual(['x']);
    expect(core.removeSystem('x')).toBe(true);
    expect(core.removeSystem('x')).toBe(false);
    expect(core.scheduler.plan(SimStage.Rules, 0)).toEqual([]);
  });

  it('every system sees the tick number and SIM_DT; ticks are consecutive', () => {
    const core = new SimCore(testConfig(), new EcsWorld(), createSimServices(1));
    const seen: number[] = [];
    core.addSystem({
      id: 't', owner: 'S01', stage: SimStage.Publish, order: 0,
      run: (ctx) => { seen.push(ctx.tick); expect(ctx.dt).toBe(1 / 60); },
    });
    for (let i = 0; i < 5; i++) core.stepOnce();
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });
});
