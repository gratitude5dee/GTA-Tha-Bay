import type { EdgeId, Portal, ShoreNode, WorldApi } from '@dv/shared';

/**
 * What the engine knows of the world's edges (M02c1, DL-691; engine-owned, not a C08 shape). The world package implements it
 * and registers it on `services.world` through the sim-module hook, so `@dv/engine` never imports `@dv/world`. The swim owner
 * (`control/swim.ts`) and, later, the vehicle water wall (M03a1), the barrier props of closures (M03a1) and the pursuit director
 * (M03c) reach the world only through it.
 */
export interface WorldBoundsPort {
  /** Every portal with its current state. */
  portals(): readonly Portal[];
  /**
   * Moves a portal to `closed`, `open` or `sealed`. `sealed` closes the portal's edges for planning (the router avoids them)
   * until the same owner calls `release` or sets the portal back. Returns false for an unknown portal.
   */
  setPortalState(id: string, state: Portal['state'], by: string): boolean;
  /** Restores every portal `by` sealed to `closed`, and drops the rest of what that owner holds in `TrafficControl`. */
  release(by: string): void;
  /** Ids of the sealed portals, ascending. */
  sealedPortals(): readonly string[];
  /** The shore node closest to (x, z); `roadAdjacent` keeps only those within reach of a road. */
  nearestShore(x: number, z: number, roadAdjacent: boolean): ShoreNode | null;
  /** Depth of the water over the terrain at (x, z), metres; 0 on land or where the ground is not loaded. */
  waterDepth(x: number, z: number): number;
  /** Called with `{edges, closed, by}` whenever an owner closes or reopens edges (barrier props, DL-663). Returns the unsubscribe. */
  onClosureChange(cb: (e: { edges: readonly EdgeId[]; closed: boolean; by: string }) => void): () => void;
}

/** The world services of a session, set by the world sim module on boot; both are null in a session without a baked world. */
export interface WorldHub {
  api: WorldApi | null;
  bounds: WorldBoundsPort | null;
}

export function createWorldHub(): WorldHub {
  return { api: null, bounds: null };
}
