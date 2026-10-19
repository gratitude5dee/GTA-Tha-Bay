/// <reference lib="webworker" />
import { runAssetWorker } from './asset-core.ts';

/**
 * asset.worker, engine entry (M01e): the pack store, fetch layer and catalog client without domain jobs. The body is
 * `runAssetWorker` in `asset-core.ts`; `apps/web/src/workers/asset.worker.ts` registers the world jobs (M02b1).
 */
runAssetWorker(self as unknown as DedicatedWorkerGlobalScope);
