import ctr from '../../../../shared/test/golden/ctr.v1.json';
import detmath from '../../../../shared/test/golden/detmath.v1.json';
import fnv from '../../../../shared/test/golden/fnv.v1.json';
import rng from '../../../../shared/test/golden/rng.v1.json';
import type { RetryEnv } from '../physics/rapier-backend.ts';
import { createPhysicsSim } from '../sim-factory.ts';
import { PHYSICS_DROP, physicsDropConfig, physicsDropScenario } from '../scenarios/physics-drop.ts';
import { walkDropBot } from '../scenarios/walk-drop-bot.ts';
import { WALK_DROP, walkDropConfig, walkDropScenario } from '../scenarios/walk-drop.ts';
import { runVectorChecks, type VectorGoldens, type VectorResult } from './vectors.ts';

/**
 * The cross-browser determinism run (M01a2 AC-6, AC-7; M01b1 AC-10): the shared golden vectors, then `physics-drop`
 * and `walk-drop` under the `canonical` profile for 10,000 ticks each with a hash every 600 ticks. QA builds only: the page
 * `apps/web/qa/determinism.html` runs it inside sim.worker and publishes the result on `__dvBridge.engine.qa`.
 * The test compares the checkpoints with `packages/engine/test/golden/determinism.physics-drop.json`.
 */
export interface DeterminismResult {
  vectors: VectorResult;
  scenario: string;
  profile: 'canonical';
  physicsBuild: 'deterministic-compat';
  ticks: number;
  checkpoints: Record<string, string>;
  final: string;
  /** The `walk-drop` run (M01b1): same checkpoints, with the seeded bot driving the player. */
  walkDrop: { scenario: string; ticks: number; checkpoints: Record<string, string>; final: string; runMs: number };
  /** Wall time of the physics-drop run, ms. */
  runMs: number;
  /** Rapier `init()` time, ms. */
  initMs: number;
}

export interface DeterminismEnv {
  now(): number;
  retry?: Partial<RetryEnv>;
  /** Called with a short label as the run moves along. */
  progress?(stage: string, done: number, total: number): void;
}

export async function runDeterminismSuite(env: DeterminismEnv): Promise<DeterminismResult> {
  env.progress?.('vectors', 0, 1);
  const vectors = runVectorChecks({ detmath, rng, ctr, fnv } as unknown as VectorGoldens);
  env.progress?.('vectors', 1, 1);

  const t0 = env.now();
  const sim = await createPhysicsSim(physicsDropConfig('canonical'), physicsDropScenario, {
    ...(env.retry ? { backend: { retry: env.retry } } : {}),
  });
  const initMs = env.now() - t0;
  const checkpoints: Record<string, string> = {};
  const t1 = env.now();
  while (sim.tick + PHYSICS_DROP.checkpointEvery <= PHYSICS_DROP.ticks) {
    sim.step(PHYSICS_DROP.checkpointEvery);
    checkpoints[String(sim.tick)] = sim.hash();
    env.progress?.('physics-drop', sim.tick, PHYSICS_DROP.ticks);
  }
  sim.step(PHYSICS_DROP.ticks - sim.tick);
  const final = sim.hash();
  const runMs = env.now() - t1;
  sim.dispose();

  const t2 = env.now();
  const walk = await createPhysicsSim(walkDropConfig('canonical'), walkDropScenario, {
    ...(env.retry ? { backend: { retry: env.retry } } : {}),
  });
  const bot = walkDropBot();
  const input = (tick: number) => bot.frame(tick);
  const walkCheckpoints: Record<string, string> = {};
  while (walk.tick + WALK_DROP.checkpointEvery <= WALK_DROP.ticks) {
    walk.step(WALK_DROP.checkpointEvery, input);
    walkCheckpoints[String(walk.tick)] = walk.hash();
    env.progress?.('walk-drop', walk.tick, WALK_DROP.ticks);
  }
  walk.step(WALK_DROP.ticks - walk.tick, input);
  const walkFinal = walk.hash();
  walk.dispose();
  const walkDrop = { scenario: WALK_DROP.id, ticks: WALK_DROP.ticks, checkpoints: walkCheckpoints, final: walkFinal, runMs: env.now() - t2 };

  return {
    vectors,
    scenario: PHYSICS_DROP.id,
    profile: 'canonical',
    physicsBuild: 'deterministic-compat',
    ticks: PHYSICS_DROP.ticks,
    checkpoints,
    final,
    walkDrop,
    runMs,
    initMs,
  };
}
