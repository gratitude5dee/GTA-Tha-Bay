/**
 * sim.worker, engine entry: the sim without domain modules (engine tests and the default `spawnSimWorker`). The body is
 * `runSimWorker` in `sim-worker-core.ts`; `apps/web/src/workers/sim.worker.ts` calls it with the world streaming module (DL-651).
 */
import { runSimWorker, type WorkerScope } from './sim-worker-core.ts';

runSimWorker(globalThis as unknown as WorkerScope, []);
