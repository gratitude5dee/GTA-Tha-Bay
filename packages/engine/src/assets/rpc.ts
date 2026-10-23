import type { QualityTierId } from '@dv/shared';
import type { Priority } from './store/lanes.ts';
import type { TabMode } from './store/tab-lock.ts';
import type { PackFailure, PackRef, StorageUsage } from './store/types.ts';

/**
 * The typed RPC between `AssetClient` (main thread) and `asset.worker`. Not a contract. Every request carries a numeric id
 * and gets exactly one response; progress and state changes arrive as separate event messages.
 *
 * A target is an `AssetRef` string (resolved through the catalog for the caller's tier), a 64-character SHA-256 (only for
 * `has`), or a ready `PackRef`.
 */
export type Target = string | PackRef;

export interface InitParams {
  /** The page origin: the worker has no `location` of its own that is useful in tests. */
  origin: string;
  /** Path of the same-origin media mirror in QA builds (`/media-local`), else null. */
  localMedia: string | null;
  /** Mobile and XR devices: soft cap 600 MB and 8 `soon` lanes. */
  mobileOrXr: boolean;
}

export interface InitResult {
  store: 'opfs' | 'memory-fallback';
  mode: TabMode;
}

export interface StatsResult {
  network: number;
  hits: number;
  retries: number;
  evictions: number;
  /** Body bytes received from the network since the worker started. */
  bytes: number;
}

export type CatalogStateName = 'idle' | 'loading' | 'ready' | 'invalid' | 'disabled' | 'unavailable';

/** Operation name to `[params, result]`. */
export interface RpcOps {
  init: [InitParams, InitResult];
  get: [{ target: Target; tier: QualityTierId; priority?: Priority }, ArrayBuffer];
  reportDecodeFailure: [{ target: Target; tier: QualityTierId }, ArrayBuffer];
  has: [{ target: Target; tier: QualityTierId }, boolean];
  resolve: [{ ref: string; tier: QualityTierId }, PackRef];
  prefetch: [{ targets: Target[]; tier: QualityTierId; priority: 'soon' | 'idle' }, null];
  pin: [{ targets: Target[]; tier: QualityTierId }, null];
  unpinAll: [Record<string, never>, null];
  gc: [Record<string, never>, { removed: number; freedMB: number }];
  usage: [Record<string, never>, StorageUsage];
  evictByTag: [{ tag: string }, { removed: number }];
  downloadAll: [{ tier: QualityTierId }, null];
  clear: [Record<string, never>, null];
  mode: [Record<string, never>, TabMode];
  catalog: [Record<string, never>, CatalogStateName];
  stats: [Record<string, never>, StatsResult];
  /** QA builds only; the worker answers `not-supported` otherwise. */
  qa: [{ name: string; args: unknown }, unknown];
  /** A domain job registered by the composed worker (`runAssetWorker(scope, jobs)`, M02b1: the world mesher and pack channel). */
  job: [{ name: string; args: unknown }, unknown];
}
export type OpName = keyof RpcOps;

export interface RpcRequest<K extends OpName = OpName> {
  t: 'req';
  id: number;
  op: K;
  p: RpcOps[K][0];
}
export interface RpcAbort {
  t: 'abort';
  id: number;
}

export interface WireError {
  name: string;
  message: string;
  /** `PackUnavailable` only. */
  reason?: PackFailure;
  ref?: PackRef;
}
/**
 * `bytes` is the worker's running count of network bytes (`StatsResult.bytes`) when it posted the reply, so that the main thread knows,
 * without a round trip, how much had been downloaded by the time it handled a reply (the world's bytes-before-reveal, M02b1 AC-8).
 * Optional: an in-process loopback may leave it out.
 */
export type RpcResponse =
  | { t: 'res'; id: number; ok: true; result: unknown; bytes?: number }
  | { t: 'res'; id: number; ok: false; error: WireError; bytes?: number };

export type WorkerEvent =
  | { t: 'event'; name: 'mode'; mode: TabMode }
  | { t: 'event'; name: 'progress'; id: number; done: number; total: number }
  | { t: 'event'; name: 'telemetry'; event: 'err.asset'; props: { reason: string; kind: string } };

export type ToWorker = RpcRequest | RpcAbort;
export type FromWorker = RpcResponse | WorkerEvent;

/** The reasons the `err.asset` telemetry event may carry: the store's `PackFailure` plus catalog problems. */
export const ERR_ASSET_MAX_PER_REASON = 5;
