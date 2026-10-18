import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createHeadlessSim } from '../src/headless/index.ts';
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
