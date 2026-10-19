/**
 * sim.worker as the game runs it (M02b1, DL-651): the engine's sim worker body plus the world streaming module. The engine's own
 * entry (`packages/engine/src/workers/sim.worker.ts`) passes no modules; this one adds the world, which stays inert until the
 * boot payload carries a world (`BootPayload.config.world`).
 */
import { runSimWorker, type WorkerScope } from '@dv/engine/workers/sim-worker-core';
import { worldStreamingModule } from '@dv/world/sim/module';

runSimWorker(self as unknown as WorkerScope, [worldStreamingModule]);
