/**
 * The gate the pedestrian kit loads behind (M10d4; BD-REPAIR-M10d4-03). The kit is background art: it may not take the asset worker, the
 * fetch lanes or the main thread from the world's own work (11-platform-pwa.md section 5; the `idle` lane of 05-assets). The world view
 * hands the gate one reading of what the world is doing per frame (`WorldLoad`, the `art-hook:peds` line of `world-view.ts`). The world
 * is quiet on a frame when
 *
 *  - no cutscene holds the world (a clip resolving, pre-rolling or playing);
 *  - no streaming unit is requested or waiting for a retry;
 *  - the streaming store asked for nothing new since the frame before (its `want` pass runs on every 4th frame and a ring streams in
 *    small batches, `inFlight` of `config/world/streaming.json`, so a unit held back by the cap is asked for on a later pass);
 *  - no mesh job (chunk, tile or landmark prepare) is in the asset worker, and every landmark is settled;
 *  - the world's own art (the surface textures of M10d0) is settled.
 *
 * The gate opens after `ART_QUIET_FRAMES` quiet frames in a row and shuts on the first frame that is not quiet. The kit takes a step
 * (a request, a parse, the build, the swap) only while it is open, and a request carries the gate's `signal`, which aborts as the gate
 * shuts: the asset-worker read stops before its next file and answers the files it has, the files not yet parsed wait, and the rest is
 * asked for in the next quiet window. So the kit fills the gaps between the world's streaming batches and yields at once when the world
 * asks for more: it holds at most one of the two `idle` fetch slots, for one file, when a `want` pass asks for a batch. It does not wait
 * for the whole ring: on software GL at desktop the outer L1/L2 rings take minutes to fill (BD-REPAIR-M10d4-03 measured 172 s on
 * webkit-webgl2, and more than the 300 s of `@art-peds` on chromium-webgl2), and all that time the kit would draw mannequins.
 * `dispose` rejects every waiter and aborts the step in flight.
 */

/** One frame's reading of the world (all counts at the moment of the frame). */
export interface WorldLoad {
  /** A cutscene holds the world (`RendererHost.worldHeld`). */
  held: boolean;
  /** Streaming units in state `requested` or `retrying`. */
  unsettled: number;
  /** Requests the streaming store has made so far (`ChunkStore.stats.requests`); a change means a `want` pass found more to stream. */
  requests: number;
  /** Mesh jobs in the asset worker (L0 chunks, L1/L2 tiles, landmark prepares). */
  meshing: number;
  /** Every landmark is settled (`LandmarkLayer.idle`). */
  landmarksIdle: boolean;
  /** The world's own art is still loading (the surface textures of the tier, when it has them, not settled). */
  artLoading: boolean;
}

/** Quiet frames in a row before the gate opens (one frame alone may sit between a batch's last answer and its last mesh job). */
export const ART_QUIET_FRAMES = 2;

/** Units in a streaming store that are not settled: requested, or waiting for a retry. */
export function unsettledUnits(units: Iterable<{ state: string }>): number {
  let n = 0;
  for (const u of units) if (u.state === 'requested' || u.state === 'retrying') n++;
  return n;
}

/** The part of the gate the kit's loader uses (`loadPedKit`). */
export interface KitGate {
  /** True while the world is quiet (the gate is open). */
  readonly open: boolean;
  /** Resolves once the gate is open (at once when it is); rejects when the gate is disposed. */
  wait(): Promise<void>;
  /** A signal that aborts on the first frame the world is not quiet (already aborted when the gate is shut). */
  signal(): AbortSignal;
}

/** A gate that is always open (no world to wait for: the unit tests' default, a renderer without `worldLoad`). */
export const OPEN_GATE: KitGate = {
  open: true,
  wait: () => Promise.resolve(),
  signal: () => new AbortController().signal,
};

const quietOf = (w: WorldLoad): boolean => !w.held && w.unsettled === 0 && w.meshing === 0 && w.landmarksIdle && !w.artLoading;

export class ArtGate implements KitGate {
  private readonly read: (() => WorldLoad) | null;
  private quietFrames = 0;
  private lastRequests: number | null = null;
  private readonly waiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  private step: AbortController | null = null;
  private disposed = false;

  /** `read` null: no world to wait for, the gate is open until `dispose` (which still stops the step in flight). */
  constructor(read: (() => WorldLoad) | null) {
    this.read = read;
  }

  get open(): boolean {
    return !this.disposed && (this.read === null || this.quietFrames >= ART_QUIET_FRAMES);
  }

  /** Quiet frames in a row so far (QA and tests). */
  get quiet(): number {
    return this.quietFrames;
  }

  /** Once a frame: reads the world, counts the quiet frames, aborts the step in flight on a busy frame, opens for the waiters. */
  frame(): void {
    if (this.disposed || !this.read) return;
    const w = this.read();
    const asked = this.lastRequests !== null && w.requests !== this.lastRequests;
    this.lastRequests = w.requests;
    if (quietOf(w) && !asked) this.quietFrames++;
    else {
      this.quietFrames = 0;
      this.step?.abort();
      this.step = null;
    }
    if (this.open && this.waiters.length > 0) for (const x of this.waiters.splice(0)) x.resolve();
  }

  wait(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('the art gate is disposed'));
    if (this.open) return Promise.resolve();
    return new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  signal(): AbortSignal {
    if (!this.open) {
      const shut = new AbortController();
      shut.abort();
      return shut.signal;
    }
    this.step ??= new AbortController();
    return this.step.signal;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.step?.abort();
    this.step = null;
    const e = new Error('the art gate is disposed');
    for (const x of this.waiters.splice(0)) x.reject(e);
  }
}
