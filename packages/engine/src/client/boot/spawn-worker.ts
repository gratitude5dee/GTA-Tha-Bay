import type { WorkerLike } from '../../sim/sim-host.ts';

/**
 * Creates sim.worker. The `new Worker(new URL(...))` form is what Vite recognises and bundles as a module worker
 * (`worker.format: 'es'` in apps/web/vite.config.ts).
 */
export function spawnSimWorker(): WorkerLike {
  return new Worker(new URL('../../workers/sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

/** A sim worker that can be spawned before `bootEngine` asks for one (`earlySimWorker`). */
export interface EarlySimWorker {
  /**
   * Spawns the early worker now; only the first call spawns. Never throws: a worker that cannot be made leaves none waiting, and the
   * engine's own `spawn` tries again and fails where it always did (BD-FIX-WEBKIT-ATTACH-02).
   */
  start(): void;
  /** `BootEngineOptions.spawn`: the early worker if one is waiting, otherwise a fresh one (every restart takes a fresh one). */
  spawn(): WorkerLike;
  /** Terminates the early worker if no start has taken it (the platform or the engine failed first). */
  dispose(): void;
}

/**
 * Lets the page spawn sim.worker ahead of the heavy part of the boot (01-engine.md section 5 boot order: `asset.worker`, then
 * `sim.worker`, before heavy work) and hands that worker to the first start that asks (BD-FIX-WEBKIT-ATTACH-01). The worker fetches and
 * evaluates its script while the platform decides the tier and the world is prepared, then waits for its `init`, which carries the tier
 * and the world as before. Only the first start takes it: a restart (crash recovery, profile switch) gets a fresh worker, as
 * `SimHost.restart` needs.
 */
export function earlySimWorker(spawn: () => WorkerLike): EarlySimWorker {
  let started = false;
  let early: WorkerLike | null = null;
  return {
    start() {
      if (started) return;
      started = true;
      try {
        early = spawn();
      } catch (error) {
        console.warn('sim worker could not be spawned early', error);
      }
    },
    spawn() {
      started = true;
      const w = early;
      early = null;
      return w ?? spawn();
    },
    dispose() {
      started = true;
      early?.terminate();
      early = null;
    },
  };
}
