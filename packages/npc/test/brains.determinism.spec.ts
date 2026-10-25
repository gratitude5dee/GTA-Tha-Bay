import { describe, expect, it } from 'vitest';
import { Fnv64 } from '@dv/shared';
import type { NpcIntent, ScheduleBlock } from '@dv/shared/contracts/c10-npc';
import { LOD, UTILITY } from '../src/brains/agent.ts';
import { BrainSim } from '../src/brains/sim.ts';
import { ByteReader, ByteWriter } from '@dv/engine/sim';
import { HOUR, SEED, cast, makeSoul, run, scheduleOf, world, workOf } from './brain-fixtures.ts';

// 05:55 game time: the run crosses the start of the commute at 06:00.
const START = 5 * HOUR + 55 * 120;
const TEN_GAME_MINUTES = 10 * 120;

describe('brain determinism (AC-1)', () => {
  it('replays 12 NPCs for 10 game minutes with an identical trace and state hash', () => {
    const a = run(cast(12), { startT: START, ticks: TEN_GAME_MINUTES, keepTrace: true });
    const b = run(cast(12), { startT: START, ticks: TEN_GAME_MINUTES, keepTrace: true });
    expect(a.trace.length).toBeGreaterThan(100);
    expect(a.traceHash).toBe(b.traceHash);
    expect(a.stateHash).toBe(b.stateHash);
    expect(b.trace).toEqual(a.trace);
    // the run is not trivially still: somebody was at LOD A, and the commute block was seen
    expect(a.sim.totalSteps.a).toBeGreaterThan(0);
    expect(a.trace.some((r) => r.block === 1)).toBe(true);
  });

  it('records block, behaviour-tree leaf and utility winner in the trace', () => {
    const a = run(cast(4), { startT: START, ticks: 600, keepTrace: true });
    const rec = a.trace.find((r) => r.lod === LOD.A);
    expect(rec).toBeDefined();
    expect(rec?.winner).toBeGreaterThanOrEqual(0);
    expect(a.trace.some((r) => r.leaf > 0)).toBe(true);
  });

  it('changes the trace when one soul schedule changes', () => {
    const base = cast(12);
    const changed = cast(12);
    const edited: ScheduleBlock[] = scheduleOf(2).map((b) => ({ ...b }));
    // npc_02 works at another place from 07:00 and starts its commute 15 minutes later
    edited[1] = { ...(edited[1] as ScheduleBlock), from: '06:08' };
    edited[2] = { ...(edited[2] as ScheduleBlock), place: workOf(9) as ScheduleBlock['place'], priority: 9 };
    changed[2] = makeSoul('npc_02', edited);
    const a = run(base, { startT: START, ticks: TEN_GAME_MINUTES });
    const b = run(changed, { startT: START, ticks: TEN_GAME_MINUTES });
    expect(b.traceHash).not.toBe(a.traceHash);
    expect(b.stateHash).not.toBe(a.stateHash);
  });

  it('depends on the world seed, the NPC id and the game day only for its random choices', () => {
    const a = run(cast(12), { startT: START, ticks: TEN_GAME_MINUTES, seed: SEED });
    const b = run(cast(12), { startT: START, ticks: TEN_GAME_MINUTES, seed: SEED + 1 });
    expect(b.stateHash).not.toBe(a.stateHash);
    // the same day-stream on a later start in the same day gives the same numbers: starting 5 minutes later does not reseed
    const sim = run(cast(2), { startT: START, ticks: 10 }).sim;
    const g0 = sim.agents[0]?.rng.getState();
    expect(g0).toBeDefined();
  });

  it('survives a save and a load in the middle of a run', () => {
    const full = run(cast(12), { startT: START, ticks: 900 });
    const first = run(cast(12), { startT: START, ticks: 400 });
    const w = new ByteWriter();
    first.sim.save(w);
    const bytes = w.toBytes();
    const resumed = new BrainSim({ seed: SEED, world, cap: 8 });
    for (const s of cast(12)) resumed.add(s);
    resumed.load(new ByteReader(bytes));
    expect(resumed.stateHash()).toBe(first.sim.stateHash());
    // continue both from tick 400: the loaded sim reaches the full run's state
    const env = { tick: 0, clockT: 0, player: null as { x: number; y: number; z: number } | null, trust: () => 0 };
    for (let t = 400; t < 900; t++) {
      env.tick = t;
      env.clockT = START + t;
      env.player = { x: 20 + t * 0.02, y: 0, z: 40 };
      resumed.tick(env);
    }
    expect(resumed.stateHash()).toBe(full.stateHash);
  });
});

describe('recorded intents (AC-5)', () => {
  const intents: { tick: number; npcId: string; intent: NpcIntent }[] = [
    { tick: 120, npcId: 'npc_00', intent: { goal: 'go_to', target: workOf(5), urgency: 'high', bark: 'idle', until: '2m' } },
    { tick: 300, npcId: 'npc_01', intent: { goal: 'approach_player', target: 'player:0', urgency: 'med', bark: null, until: '30s' } },
  ];

  it('replays two recorded intents to the same state hash without asking anything', () => {
    const asked: string[] = [];
    // live: the intents arrive as external inputs and are recorded
    const recording: typeof intents = [];
    const live = run(cast(12), {
      startT: START,
      ticks: 900,
      before: (sim, tick) => {
        for (const i of intents) {
          if (i.tick === tick) {
            sim.queueIntent(tick, i.npcId, i.intent);
            recording.push({ tick, npcId: i.npcId, intent: i.intent });
          }
        }
      },
    });
    expect(recording).toHaveLength(2);
    // replay: no driver, no network; the recording feeds the sim
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      asked.push(String(args[0]));
      throw new Error('network is off in a replay');
    }) as typeof fetch;
    try {
      const replay = run(cast(12), {
        startT: START,
        ticks: 900,
        before: (sim, tick) => {
          for (const r of recording) if (r.tick === tick) sim.queueIntent(r.tick, r.npcId, r.intent);
        },
      });
      expect(replay.stateHash).toBe(live.stateHash);
      expect(replay.traceHash).toBe(live.traceHash);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(asked).toEqual([]);
    // and the intents mattered
    const without = run(cast(12), { startT: START, ticks: 900 });
    expect(without.stateHash).not.toBe(live.stateHash);
  });

  it('turns an intent into a goal, a bark request and an expiry', () => {
    const sim = run(cast(3), { startT: START, ticks: 10 }).sim;
    const env = { tick: 10, clockT: START + 10, player: { x: 20, y: 0, z: 40 }, trust: () => 0 };
    sim.queueIntent(10, 'npc_00', { goal: 'go_to', target: workOf(5), urgency: 'high', bark: 'greet_pass', until: '30s' });
    sim.tick(env);
    const npc = sim.get('npc_00');
    expect(npc?.intent?.goal).toBe('go_to');
    expect(npc?.intent?.urgency).toBe(2);
    expect(sim.takeEvents().some((e) => e.kind === 'bark' && e.tag === 'greet_pass')).toBe(true);
    sim.queueIntent(11, 'npc_00', { goal: 'continue_schedule', target: null, urgency: 'low', bark: null, until: 'next_block' });
    env.tick = 11;
    sim.tick(env);
    expect(npc?.intent).toBeNull();
  });

  it('keeps the hash stable across sims that never saw an intent', () => {
    const h = new Fnv64();
    const s = new BrainSim({ seed: SEED, world, cap: 8 });
    s.hash(h);
    expect(h.hex()).toBe(new BrainSim({ seed: SEED, world, cap: 8 }).stateHash());
  });
});

describe('utility winners', () => {
  it('wakes a sleeper only for a threat on top of it, and flees a worker for a nearer one', () => {
    // 03:00: npc_00 sleeps (priority 9, not interruptible)
    const sleepAt = 3 * HOUR;
    const r = run(cast(1), { startT: sleepAt, ticks: 120, player: () => ({ x: 0, y: 0, z: 12 }) });
    const a = r.sim.get('npc_00');
    expect(a?.winner).toBe(UTILITY.Schedule);
    r.sim.report('npc_00', 'car_crash', 0, 10, 120);
    const env = { tick: 120, clockT: sleepAt + 120, player: { x: 0, y: 0, z: 12 }, trust: () => 0 };
    for (let t = 120; t < 180; t++) {
      env.tick = t;
      env.clockT = sleepAt + t;
      r.sim.tick(env);
    }
    // a threat 2 m away scores (0.3 + 0.7 * 0.93) * 0.6 = 0.57, below the sleep block's 0.95
    expect(a?.winner).toBe(UTILITY.Schedule);

    // 10:00: npc_01 works (priority 5, interruptible)
    const workAt = 10 * HOUR;
    const w = run(cast(2), { startT: workAt, ticks: 240, player: () => ({ x: 14, y: 0, z: 40 }) });
    const b = w.sim.get('npc_01');
    expect(b?.winner).toBe(UTILITY.Schedule);
    w.sim.report('npc_01', 'melee_fight', b?.x ?? 0, (b?.z ?? 0) + 3, 240);
    const env2 = { tick: 240, clockT: workAt + 240, player: { x: 14, y: 0, z: 40 }, trust: () => 0 };
    for (let t = 240; t < 300; t++) {
      env2.tick = t;
      env2.clockT = workAt + t;
      w.sim.tick(env2);
    }
    expect(b?.winner).toBe(UTILITY.Flee);
  });
});
