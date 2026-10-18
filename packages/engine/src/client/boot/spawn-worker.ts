import type { WorkerLike } from '../../sim/sim-host.ts';

/**
 * Creates sim.worker. The `new Worker(new URL(...))` form is what Vite recognises and bundles as a module worker
 * (`worker.format: 'es'` in apps/web/vite.config.ts).
 */
export function spawnSimWorker(): WorkerLike {
  return new Worker(new URL('../../workers/sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}
