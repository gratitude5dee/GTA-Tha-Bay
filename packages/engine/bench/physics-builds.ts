/**
 * bench:physics (M01a2). Measures both Rapier builds on `physics-drop`: cold `init()`, the cost of building a second
 * session (restart, warm module), and the mean and p99 tick time over 3,000 ticks after a 300-tick warm-up.
 * It answers U-ENG-2 and Q-ENG-01 and asserts nothing. Results go to bench/results/physics-builds.json.
 *
 *   pnpm --filter @dv/engine bench:physics
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPhysicsSim } from '../src/sim/sim-factory.ts';
import { physicsDropConfig, physicsDropScenario } from '../src/sim/scenarios/physics-drop.ts';
import type { PhysicsBuild } from '../src/sim/physics/backend.ts';

const WARMUP_TICKS = 300;
const MEASURED_TICKS = 3000;

interface BuildResult {
  build: PhysicsBuild;
  initMs: number;
  restartWarmMs: number;
  tickMeanMs: number;
  tickP99Ms: number;
  tickMaxMs: number;
  ticks: number;
  bodies: number;
}

const now = (): number => performance.now();

async function measure(build: PhysicsBuild): Promise<BuildResult> {
  const profile = build === 'simd-compat' ? 'local' : 'canonical';
  const cfg = physicsDropConfig(profile);
  const t0 = now();
  const sim = await createPhysicsSim(cfg, physicsDropScenario, { now });
  const initMs = now() - t0;
  sim.step(WARMUP_TICKS);
  const samples: number[] = [];
  for (let i = 0; i < MEASURED_TICKS; i++) {
    const a = now();
    sim.step(1);
    samples.push(now() - a);
  }
  const bodies = sim.backend.bodyCount;
  sim.dispose();
  // More sessions with the module already loaded: what a restart costs after the first one. Median of five,
  // because the 25 MiB of ECS stores per session make a single sample depend on when the GC runs.
  const restarts: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r0 = now();
    const again = await createPhysicsSim(cfg, physicsDropScenario, { now });
    restarts.push(now() - r0);
    again.dispose();
  }
  restarts.sort((a, b) => a - b);
  const restartWarmMs = restarts[2] as number;
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  return {
    build,
    initMs,
    restartWarmMs,
    tickMeanMs: mean,
    tickP99Ms: sorted[Math.floor(0.99 * sorted.length)] as number,
    tickMaxMs: sorted[sorted.length - 1] as number,
    ticks: MEASURED_TICKS,
    bodies,
  };
}

const results: BuildResult[] = [];
// deterministic first: its module is cold when measured, then simd's.
for (const build of ['deterministic-compat', 'simd-compat'] as const) results.push(await measure(build));

const out = {
  scenario: 'physics-drop',
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  warmupTicks: WARMUP_TICKS,
  measuredTicks: MEASURED_TICKS,
  note: 'Node, single thread. initMs is the cold import plus init() plus scenario build. Browser numbers: tests/e2e/determinism.spec.ts logs init and run time per project.',
  results,
};
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'physics-builds.json');
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
for (const r of results) {
  console.log(
    `${r.build.padEnd(21)} init ${r.initMs.toFixed(0).padStart(5)} ms  restart(warm, median of 5) ${r.restartWarmMs.toFixed(0).padStart(4)} ms  tick mean ${r.tickMeanMs.toFixed(3)} ms  p99 ${r.tickP99Ms.toFixed(3)} ms  max ${r.tickMaxMs.toFixed(2)} ms`,
  );
}
console.log(`wrote ${path.relative(process.cwd(), file)}`);
