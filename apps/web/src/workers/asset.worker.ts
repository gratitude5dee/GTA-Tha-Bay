/// <reference lib="webworker" />
/**
 * asset.worker as the game runs it (M02b1): the pack store, fetch layer and catalog client of the engine plus the world jobs
 * (the sim pack channel, the L0/L1/L2 mesher, the backdrop). The engine's own entry registers no jobs.
 */
import { runAssetWorker } from '@dv/engine/workers/asset-core';
import { worldJobs } from '@dv/world/client/jobs';

runAssetWorker(self as unknown as DedicatedWorkerGlobalScope, worldJobs);
