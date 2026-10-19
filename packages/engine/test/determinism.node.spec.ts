import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createHeadlessSim } from '../src/headless/index.ts';
import { Control, LocalPlayer, Transform } from '../src/sim/ecs/components.ts';
import { walkDropBot } from '../src/sim/scenarios/walk-drop-bot.ts';
import { WALK_DROP, walkDropConfig, walkDropScenario } from '../src/sim/scenarios/walk-drop.ts';
import { createPhysicsSim } from '../src/sim/sim-factory.ts';
import { ECS_CHURN, ecsChurnConfig, setupEcsChurn, type ChurnOptions } from './scenarios/ecs-churn.ts';
import { PHYSICS_DROP, physicsDropConfig, physicsDropScenario } from './scenarios/physics-drop.ts';

const GOLDEN = new URL('./golden/determinism.ecs-churn.json', import.meta.url);

interface Golden {
  scenario: 'ecs-churn';
  seed: number;
  entities: number;
  ticks: number;
  checkpointEvery: number;
  checkpoints: Record<string, string>;
  final: string;
}

function run(opts: ChurnOptions = {}): { checkpoints: Record<string, string>; final: string; nanCount: number; live: number } {
  const sim = createHeadlessSim(ecsChurnConfig(), (s) => setupEcsChurn(s, opts));
  const checkpoints: Record<string, string> = {};
  while (sim.tick + ECS_CHURN.checkpointEvery <= ECS_CHURN.ticks) {
    sim.step(ECS_CHURN.checkpointEvery);
    checkpoints[String(sim.tick)] = sim.hash();
  }
  sim.step(ECS_CHURN.ticks - sim.tick);
  expect(sim.tick).toBe(ECS_CHURN.ticks);
  return { checkpoints, final: sim.hash(), nanCount: sim.stats.nanCount, live: sim.ecs.entityCount };
}

describe('determinism: ecs-churn, 10,000 ticks, seed 0xC0FFEE', () => {
  type Result = ReturnType<typeof run>;
  let a: Result;
  let b: Result;
  beforeAll(() => {
    a = run();
    b = run();
  }, 300_000);

  it('two runs give identical hashes at every 600th tick and at the end', () => {
    expect(Object.keys(a.checkpoints).length).toBe(16);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.final).toBe(b.final);
    expect(a.live).toBe(ECS_CHURN.entities + 1);
    expect(a.nanCount).toBe(0);
    console.log(`ecs-churn final hash after ${ECS_CHURN.ticks} ticks: ${a.final}`);
  }, 60_000);

  it('the hashes equal determinism.ecs-churn.json', () => {
    const data: Golden = {
      scenario: 'ecs-churn',
      seed: ECS_CHURN.seed,
      entities: ECS_CHURN.entities,
      ticks: ECS_CHURN.ticks,
      checkpointEvery: ECS_CHURN.checkpointEvery,
      checkpoints: a.checkpoints,
      final: a.final,
    };
    if (process.env['DV_UPDATE_GOLDEN'] === '1' || !existsSync(GOLDEN)) {
      if (process.env['DV_UPDATE_GOLDEN'] !== '1') {
        throw new Error('determinism.ecs-churn.json is missing; create it with DV_UPDATE_GOLDEN=1 and review the diff');
      }
      writeFileSync(GOLDEN, `${JSON.stringify(data, null, 2)}\n`);
    }
    expect(JSON.parse(readFileSync(GOLDEN, 'utf8'))).toEqual(data);
  }, 60_000);

  it('changing one field at tick 5,000 changes every later checkpoint and the final hash', () => {
    const p = run({ perturbAtTick: 5000 });
    for (const [tick, hash] of Object.entries(a.checkpoints)) {
      if (Number(tick) <= 5000) expect(p.checkpoints[tick], `tick ${tick}`).toBe(hash);
      else expect(p.checkpoints[tick], `tick ${tick}`).not.toBe(hash);
    }
    expect(p.final).not.toBe(a.final);
    expect(Object.keys(p.checkpoints).filter((t) => Number(t) > 5000).length).toBe(8);
  }, 300_000);
});

// --- physics-drop (M01a2 AC-5) ---------------------------------------------------------------------------------

const DROP_GOLDEN = new URL('./golden/determinism.physics-drop.json', import.meta.url);

interface DropGolden {
  scenario: 'physics-drop';
  profile: 'canonical';
  physicsBuild: 'deterministic-compat';
  seed: number;
  ticks: number;
  checkpointEvery: number;
  checkpoints: Record<string, string>;
  final: string;
}

interface DropRun {
  checkpoints: Record<string, string>;
  final: string;
  nanCount: number;
  rebases: number;
}

async function runDrop(profile: 'canonical' | 'local'): Promise<DropRun> {
  const sim = await createPhysicsSim(physicsDropConfig(profile), physicsDropScenario);
  const checkpoints: Record<string, string> = {};
  while (sim.tick + PHYSICS_DROP.checkpointEvery <= PHYSICS_DROP.ticks) {
    sim.step(PHYSICS_DROP.checkpointEvery);
    checkpoints[String(sim.tick)] = sim.hash();
  }
  sim.step(PHYSICS_DROP.ticks - sim.tick);
  expect(sim.tick).toBe(PHYSICS_DROP.ticks);
  const run = { checkpoints, final: sim.hash(), nanCount: sim.stats.nanCount, rebases: sim.backend.rebases };
  sim.dispose();
  return run;
}

describe('determinism: physics-drop, 10,000 ticks, seed 0xC0FFEE', () => {
  let a: DropRun;
  let b: DropRun;
  let s1: DropRun;
  let s2: DropRun;
  beforeAll(async () => {
    a = await runDrop('canonical');
    b = await runDrop('canonical');
    s1 = await runDrop('local');
    s2 = await runDrop('local');
  }, 300_000);

  it('canonical (deterministic-compat): two runs give 17 identical hashes (every 600 ticks plus the final one)', () => {
    expect(Object.keys(a.checkpoints).length).toBe(16);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.final).toBe(b.final);
    expect(a.nanCount).toBe(0);
    expect(a.rebases).toBe(1);
    console.log(`physics-drop final hash (canonical) after ${PHYSICS_DROP.ticks} ticks: ${a.final}`);
  });

  it('the hashes equal determinism.physics-drop.json', () => {
    const data: DropGolden = {
      scenario: 'physics-drop',
      profile: 'canonical',
      physicsBuild: 'deterministic-compat',
      seed: PHYSICS_DROP.seed,
      ticks: PHYSICS_DROP.ticks,
      checkpointEvery: PHYSICS_DROP.checkpointEvery,
      checkpoints: a.checkpoints,
      final: a.final,
    };
    if (process.env['DV_UPDATE_GOLDEN'] === '1') writeFileSync(DROP_GOLDEN, `${JSON.stringify(data, null, 2)}\n`);
    else if (!existsSync(DROP_GOLDEN)) throw new Error('determinism.physics-drop.json is missing; create it with DV_UPDATE_GOLDEN=1 and review the diff');
    expect(JSON.parse(readFileSync(DROP_GOLDEN, 'utf8'))).toEqual(data);
  });

  it('local (simd-compat): two runs are identical to each other', () => {
    expect(s1.checkpoints).toEqual(s2.checkpoints);
    expect(s1.final).toBe(s2.final);
    expect(s1.nanCount).toBe(0);
    console.log(`physics-drop final hash (local, simd-compat) after ${PHYSICS_DROP.ticks} ticks: ${s1.final}`);
  });

  it('records whether simd-compat agrees with deterministic-compat in Node (informational, not asserted)', () => {
    const same = s1.final === a.final;
    console.log(`simd-compat final hash ${same ? 'equals' : 'differs from'} deterministic-compat in Node`);
    expect(typeof same).toBe('boolean');
  });
});

// --- walk-drop (M01b1 AC-9) ---------------------------------------------------------------------------------------

const WALK_GOLDEN = new URL('./golden/determinism.walk-drop.json', import.meta.url);

interface WalkGolden {
  scenario: 'walk-drop';
  profile: 'canonical';
  physicsBuild: 'deterministic-compat';
  seed: number;
  ticks: number;
  checkpointEvery: number;
  checkpoints: Record<string, string>;
  final: string;
}

interface WalkRun {
  checkpoints: Record<string, string>;
  final: string;
  nanCount: number;
  states: Set<number>;
  travelled: number;
  minY: number;
  maxY: number;
}

/** 10,000 ticks of `walk-drop` with the seeded bot driving player 0. */
async function runWalk(): Promise<WalkRun> {
  const sim = await createPhysicsSim(walkDropConfig('canonical'), walkDropScenario);
  const bot = walkDropBot();
  const input = (tick: number) => bot.frame(tick);
  const id = sim.ecs.query([LocalPlayer])[0] as number;
  const tr = sim.ecs.store(Transform);
  const co = sim.ecs.store(Control);
  const states = new Set<number>();
  const checkpoints: Record<string, string> = {};
  let travelled = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let lx = tr.px[id] as number;
  let lz = tr.pz[id] as number;
  for (let t = 0; t < WALK_DROP.ticks; t++) {
    sim.step(1, input);
    states.add(co.state[id] as number);
    const x = tr.px[id] as number;
    const z = tr.pz[id] as number;
    travelled += Math.hypot(x - lx, z - lz);
    lx = x;
    lz = z;
    minY = Math.min(minY, tr.py[id] as number);
    maxY = Math.max(maxY, tr.py[id] as number);
    if (sim.tick % WALK_DROP.checkpointEvery === 0) checkpoints[String(sim.tick)] = sim.hash();
  }
  expect(sim.tick).toBe(WALK_DROP.ticks);
  const run = { checkpoints, final: sim.hash(), nanCount: sim.stats.nanCount, states, travelled, minY, maxY };
  sim.dispose();
  return run;
}

describe('determinism: walk-drop, 10,000 ticks, seed 0xC0FFEE', () => {
  let a: WalkRun;
  let b: WalkRun;
  beforeAll(async () => {
    a = await runWalk();
    b = await runWalk();
  }, 300_000);

  it('canonical: two runs give 17 identical hashes (every 600 ticks plus the final one)', () => {
    expect(Object.keys(a.checkpoints).length).toBe(16);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.final).toBe(b.final);
    expect(a.nanCount).toBe(0);
    console.log(`walk-drop final hash (canonical) after ${WALK_DROP.ticks} ticks: ${a.final}`);
  });

  it('the bot really walks: every on-foot state is visited, the player covers real distance and never leaves the ground', () => {
    for (const s of [100, 101, 102, 103, 110, 111, 112]) expect(a.states.has(s), `state ${s}`).toBe(true);
    expect(a.travelled).toBeGreaterThan(300);
    expect(a.minY).toBeGreaterThan(-0.05);
    expect(a.maxY).toBeLessThan(2);
  });

  it('the hashes equal determinism.walk-drop.json', () => {
    const data: WalkGolden = {
      scenario: 'walk-drop',
      profile: 'canonical',
      physicsBuild: 'deterministic-compat',
      seed: WALK_DROP.seed,
      ticks: WALK_DROP.ticks,
      checkpointEvery: WALK_DROP.checkpointEvery,
      checkpoints: a.checkpoints,
      final: a.final,
    };
    if (process.env['DV_UPDATE_GOLDEN'] === '1') writeFileSync(WALK_GOLDEN, `${JSON.stringify(data, null, 2)}\n`);
    else if (!existsSync(WALK_GOLDEN)) throw new Error('determinism.walk-drop.json is missing; create it with DV_UPDATE_GOLDEN=1 and review the diff');
    expect(JSON.parse(readFileSync(WALK_GOLDEN, 'utf8'))).toEqual(data);
  });
});
