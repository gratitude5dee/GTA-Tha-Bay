/**
 * The pack channel between sim.worker and asset.worker (DL-678): one `MessageChannel`, one port transferred to each worker at
 * boot. `ChunkStore` posts `{seq, ref, priority}` requests in request order; asset.worker answers through the `WorldPackStore`
 * with `{seq, bytes}` (transferred) or `{seq, error}`; sim.worker queues the replies and applies them only at the start of the
 * next tick's `SimStage.Streaming`, in `seq` order, never mid-tick (a later `seq` waits for an earlier one).
 *
 * Types only, so both workers and the tests share them.
 */

import type { WorldIndex } from '@dv/shared';

/** C13 1.1 `PackRef`, structurally (the sim tsconfig has no DOM lib, so the engine's store types are not imported here). */
export interface PackRef {
  url: string;
  sha256: string;
  bytes: number;
  kind: 'chunk' | 'tex' | 'mesh' | 'audio' | 'data';
  tags?: string[];
}

export interface PackRequest {
  /** 1, 2, 3 ... in request order; every request gets exactly one reply. */
  seq: number;
  ref: PackRef;
  priority: 'now' | 'soon' | 'idle';
  /** The sim could not decode the bytes it got: purge the cached pack and fetch it once more. */
  refetch?: boolean;
}

/** Why a pack did not arrive: the store's `PackFailure`, or `other` for an unexpected error in the handler. */
export type PackErrorReason = 'offline' | 'http' | 'hash-mismatch' | 'quota' | 'aborted' | 'other';

export type PackReply =
  | { seq: number; bytes: ArrayBuffer }
  | { seq: number; error: { reason: PackErrorReason; message?: string } };

/** The init-message port name (`InitMessage.p.ports`) and the asset-job argument that carry the channel. */
export const WORLD_PORT = 'world';

/** The slice of the world index the sim worker needs, sent in `BootPayload.config.world`. */
export interface WorldSimConfig {
  bakeId: string;
  /** `p0` host tiles of the bake, `x-y`. */
  p0Tiles: string[];
  /**
   * `world_pack/p0-x-y` to its `PackRef`; also `map_data/sf-graph.v1` and `data/district-grid.v1` when the catalog has them
   * (M02c1: the always-resident road topology and the neighbourhood raster, requested through the same channel).
   */
  refs: Record<string, PackRef>;
  /** Feet of the player at spawn (the first focus, before the first snapshot). */
  spawn: [number, number, number];
  /** The world index (`data/world-index`) for the world services of M02c1: landmarks, POIs, portals, transit, districts. Absent: no services. */
  index?: WorldIndex;
}
