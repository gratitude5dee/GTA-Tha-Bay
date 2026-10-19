import type { QualityTierId } from '@dv/shared';
import { AssetClient, type WorkerPort } from './client.ts';
import type { InitParams } from './rpc.ts';

/**
 * Creates asset.worker. The `new Worker(new URL(...))` form is what Vite recognises and bundles as a module worker
 * (`worker.format: 'es'` in apps/web/vite.config.ts), the same pattern as `spawnSimWorker`.
 */
export function spawnAssetWorker(): WorkerPort {
  return new Worker(new URL('../workers/asset.worker.ts', import.meta.url), { type: 'module', name: 'asset' }) as unknown as WorkerPort;
}

export const ASSET_OPEN_TIMEOUT_MS = 5000;

/**
 * Starts the asset worker and waits for the store to open. Returns null when workers are unavailable, the worker fails, or
 * `open()` takes longer than the timeout; the platform then reports `store: 'memory'` and the game runs without packs.
 */
export async function startAssets(o: {
  init: InitParams;
  tier: () => QualityTierId;
  onTelemetry?: (name: 'err.asset', props: { reason: string; kind: string }) => void;
  spawn?: () => WorkerPort;
  timeoutMs?: number;
}): Promise<AssetClient | null> {
  if (!o.spawn && typeof Worker === 'undefined') return null;
  let port: WorkerPort;
  try {
    port = (o.spawn ?? spawnAssetWorker)();
  } catch {
    return null;
  }
  const client = new AssetClient(port, { tier: o.tier, ...(o.onTelemetry ? { onTelemetry: o.onTelemetry } : {}) });
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('asset worker open timed out')), o.timeoutMs ?? ASSET_OPEN_TIMEOUT_MS));
    const r = await Promise.race([client.call('init', o.init), timeout]);
    client.applyInit(r);
    return client;
  } catch {
    client.dispose();
    return null;
  }
}
