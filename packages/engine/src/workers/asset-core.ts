/// <reference lib="webworker" />
import type { ToWorker } from '../assets/rpc.ts';
import { AssetService, memoryPorts, type AssetJob, type Ports } from '../assets/service.ts';
import { IdbIndexStore } from '../assets/store/idb-index.ts';
import { OpfsFileStore } from '../assets/store/opfs-files.ts';
import type { ChannelLike } from '../assets/store/tab-lock.ts';

/**
 * The asset.worker body (M01e), extracted in M02b1 so that the app can compose a worker with domain jobs: the only context
 * that touches OPFS. Owns the world-pack store, the fetch layer and the catalog client (`AssetService`) and answers the typed
 * RPC from `AssetClient`. `jobs` are served by the `job` op (the world mesher and the sim pack channel register theirs from
 * `apps/web/src/workers/asset.worker.ts`). Module worker, spawned as in `sim.worker`.
 */
async function makePorts(force: 'memory' | undefined): Promise<Ports> {
  if (force === 'memory' || typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function' || typeof indexedDB === 'undefined') {
    return memoryPorts();
  }
  return { files: new OpfsFileStore(), index: new IdbIndexStore(), kind: 'opfs' };
}

export function runAssetWorker(ctx: DedicatedWorkerGlobalScope, jobs?: Readonly<Record<string, AssetJob>>): AssetService {
  const service = new AssetService({
    post: (msg, transfer) => ctx.postMessage(msg, transfer ?? []),
    makePorts,
    fetch: (url, init) => fetch(url, init),
    channel: typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel('dv-instance') as unknown as ChannelLike),
    tabId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random()),
    estimate: async () => {
      const e = await navigator.storage?.estimate?.();
      return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
    },
    persisted: async () => (typeof navigator.storage?.persisted === 'function' ? navigator.storage.persisted() : null),
    qa: import.meta.env.VITE_DV_QA === '1' ? async (svc, name, args) => (await import('../assets/qa-ops.ts')).handleQa(svc, name, args) : null,
    jobs,
  });

  ctx.onmessage = (e: MessageEvent<ToWorker>) => {
    void service.handle(e.data);
  };
  return service;
}
