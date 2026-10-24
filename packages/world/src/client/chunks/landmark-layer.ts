/**
 * LandmarkLayer (02-world.md section 3; 02-world-bake.md section 7 rules 3 to 5; C08 rule 12; M02d1, M02d2). Landmark glTFs are not
 * chunk objects: they live here, outside the chunk `BundleGroup`s, with their own cap and swap distance per tier
 * (`config/world/landmarks-runtime.json`).
 *
 * Full-fidelity landmarks (the tier's fidelity, capped per tier):
 *  - A landmark whose seed lies within `swapM` of the focus is loaded, nearest first, one model in flight at a time, as long as the
 *    tier's cap of resident landmarks allows it; when the cap is reached the farthest resident landmark is released first, and only
 *    for a nearer one.
 *  - The swap is staged so there is never a frame with neither the proxy nor the model (M02d2): the model is decoded in
 *    `asset.worker`, the chunks that hold its extrusion proxies (`proxyOf`) are meshed again there with the proxy left out
 *    (`prepare`), and only when the model and every one of those meshes are ready does the swap commit. The commit is a task in the
 *    `ChunkUploadGate`: the model joins the scene in the frame the gate releases it (one upload that frame, like any chunk), and the
 *    prepared chunk meshes follow through the same gate, one per frame, right behind it. The model always comes first, so a proxy
 *    is never removed before the model that replaces it is up; for the few frames of the hand-over both are drawn.
 *  - Beyond `swapM x unloadFactor` the proxies are meshed back first and the model is removed when the last chunk is back (or after
 *    a short timeout): never a hole. A load that fails leaves the proxy meshed and is tried again after `retryMs`.
 *
 * The skyline (02-world-bake.md section 7 rule 4; M02d2): a fixed set of far silhouettes (the two bridges, the towers) at the `lo`
 * fidelity. Each is read when within `loadFactor x` the tier's building draw distance (`skylineRangeM`, the streaming r2), put in
 * the scene within `mountFactor x` and parked beyond `releaseFactor x`, so every skyline landmark inside the draw distance is up
 * before it is needed. The skyline sits outside the resident caps. While a skyline model is up it owns its landmark's proxy mask
 * (the proxies are never drawn under it); when the same landmark is resident at full fidelity the skyline instance is hidden, one
 * model per landmark, and it comes back in the frame the full model is removed.
 *
 * The layer is plain logic over injected ports (model loader, scene mount, chunk port, upload queue), so it runs in Node tests;
 * `landmark-view.ts` supplies the three objects and `world-view.ts` the ports. The meshes of the models are counted by
 * `RenderBudgetMeter` like any other object of the scene.
 */
import type { ChunkKey, QualityTierId } from '@dv/shared';
import runtimeJson from '../../../../../config/world/landmarks-runtime.json';
import type { LandmarkModelData } from './landmark-glb.ts';
import { chunksHolding, desiredMask, proxyIdOf, staleChunks, type ChunkProxyState } from './proxy-mask.ts';
import { inSkylineRange, nextSkylineLoad, skylineRings, type SkylineRings, type SkylineRuntime } from './skyline.ts';

export type { SkylineRuntime } from './skyline.ts';

export interface LandmarkTierRuntime { resident: number; swapM: number }
export interface LandmarksRuntimeConfig {
  schema: 'world-landmarks-runtime/1';
  unloadFactor: number;
  retryMs: number;
  inFlight: number;
  skyline: SkylineRuntime;
  tiers: Record<QualityTierId, LandmarkTierRuntime>;
}
export const LANDMARKS_RUNTIME: LandmarksRuntimeConfig = runtimeJson as unknown as LandmarksRuntimeConfig;

/** A landmark that has a model: its place in the world index and the asset to load. */
export interface LandmarkSpot {
  /** `lm.coit-tower` */
  id: string;
  /** Index in `WorldIndex.landmarks`: the chunks' `proxyOf` is this + 1. */
  index: number;
  x: number;
  z: number;
  /** `building/lm.coit-tower` */
  asset: string;
}

/** What the layer needs of a mounted model. */
export interface LandmarkHandle {
  readonly objects: number;
  readonly triangles: number;
  /** Shows or hides the model without freeing it (the skyline instance under a full-fidelity one). */
  setVisible?(visible: boolean): void;
  /** Moves the model to a new ground height (the terrain it stands on was refined from a coarse level to the exact chunk). */
  setHeight?(y: number): void;
  dispose(): void;
}

/** A chunk mesh made in the worker with a mask, waiting to go up; the port knows what is inside. */
export interface PreparedRemesh {
  key: ChunkKey;
  mask: number[];
}

export interface LandmarkChunkPort {
  /** The resident L0 chunks that hold at least one proxy, with the proxies their current mesh leaves out. */
  states(): ChunkProxyState[];
  /** Meshes the chunk again leaving out exactly `mask`, in the worker, and holds the result; null when there is none (the chunk is gone). */
  prepare(key: ChunkKey, mask: number[]): Promise<PreparedRemesh | null>;
  /** Queues a prepared mesh for upload through the gate; it replaces the chunk's mesh. */
  apply(p: PreparedRemesh): void;
  /** Asks for the chunk to be meshed again leaving out exactly these proxies (empty: meshed back) and uploads it when it is ready. */
  remesh(key: ChunkKey, mask: number[]): void;
  /** Re-record requests of the chunk's bundle so far (for the QA report). */
  rerecords(key: ChunkKey): number;
}

/** A unit of GPU work the `ChunkUploadGate` releases, at most one per frame together with the chunk uploads. */
export interface SwapTask {
  id: string;
  /** Lower first; the commit goes ahead of the chunk uploads. */
  priority: number;
  bytes: number;
  /** Runs in the frame the gate releases the task; `uploads` is the number of uploads that frame so far, this one included. */
  run(info: { uploads: number }): void;
}

export interface LandmarkLoadOpts {
  /** The `lo` model, read for the skyline and pinned in the pack store. */
  skyline: boolean;
}

export interface LandmarkDeps {
  tier: QualityTierId;
  spots: readonly LandmarkSpot[];
  /** Tier row and global knobs; the committed config by default. */
  config?: LandmarksRuntimeConfig;
  /** Reads and decodes the model of a spot for the tier (rejects when it cannot). */
  load(spot: LandmarkSpot, opts: LandmarkLoadOpts): Promise<LandmarkModelData>;
  /** Puts the model in the scene at height y; `nowSec` starts its fade-in. */
  mount(spot: LandmarkSpot, model: LandmarkModelData, y: number, nowSec: number): LandmarkHandle;
  chunks: LandmarkChunkPort;
  /** Hands a commit to the upload gate. */
  queue(task: SwapTask): void;
  /**
   * Terrain height under a point; null until terrain there is up. `exact` asks for the L0 chunk only; without it the coarse levels
   * (L1 tile, L2 block) answer too, so a far skyline landmark can be placed before any L0 chunk is near it, and is moved to the exact
   * height when the chunk arrives.
   */
  groundY(x: number, z: number, exact?: boolean): number | null;
  /** Height of the water: the `sea` anchor. */
  waterY: number;
  /** Milliseconds, any origin. */
  now(): number;
  /** The tier's building draw distance (the streaming r2M); 0 or absent turns the skyline off. */
  skylineRangeM?: number;
  /** The skyline waits for this (the world's first reveal); true when absent. */
  ready?: () => boolean;
  /** The frame number the host counts (events carry it); the layer's own count when absent. */
  frameNo?: () => number;
  /** Records the per-frame hole and double-draw counters and the swap events (QA builds). */
  qa?: boolean;
  /** Frames between chunk reconciliations (default 4). */
  reconcileEvery?: number;
}

export type LandmarkPhase = 'idle' | 'loading' | 'ready' | 'preparing' | 'shown' | 'leaving' | 'parked' | 'failed';

interface Prep {
  at: number;
  /** The chunks asked for a prepared mesh: the reconciliation leaves them alone until the swap has gone up. */
  keys: Set<ChunkKey>;
  pending: number;
  results: PreparedRemesh[];
  queued: boolean;
}

interface Entry {
  kind: 'full' | 'sky';
  spot: LandmarkSpot;
  phase: LandmarkPhase;
  distM: number;
  /** Bumped when a load or a prepare is cancelled: a late reply is dropped. */
  gen: number;
  model: LandmarkModelData | null;
  handle: LandmarkHandle | null;
  visible: boolean;
  retryAt: number;
  leaveAt: number;
  error: string | null;
  prep: Prep | null;
  /** Skyline only: inside the mount ring (with hysteresis). */
  inRange: boolean;
  /** The ground height the model was placed at, and whether that was the exact L0 height. */
  y: number;
  exact: boolean;
}

export interface LandmarkReportEntry {
  id: string;
  phase: LandmarkPhase;
  fidelity: string;
  distM: number;
  objects: number;
  triangles: number;
  /** The chunks that hold its proxies: the ones whose mesh leaves them out now, and the bundle re-record count of each. */
  chunks: { key: ChunkKey; masked: boolean; bundleRerecords: number }[];
}

export interface SkylineReportEntry {
  id: string;
  phase: LandmarkPhase;
  distM: number;
  /** One visible model: this instance is drawn. */
  visible: boolean;
  /** Why it is not drawn while it is up: the full-fidelity model of the same landmark, or the range. */
  hiddenBy: 'full' | 'range' | null;
  fidelity: string;
  objects: number;
  triangles: number;
}

/** One commit of a swap: the model joining the scene (`model`, `skyline`) or a prepared chunk replacing its mesh (`chunk`). */
export interface LandmarkSwapEvent {
  id: string;
  step: 'model' | 'skyline' | 'chunk';
  key?: ChunkKey;
  /** The host's frame number. */
  frame: number;
  /** Main-thread milliseconds of the commit. */
  ms: number;
  /** Uploads in that frame, this one included (the gate's contract: at most 1). */
  uploads: number;
  /** After the commit, a model of the landmark is drawn. */
  model: boolean;
  /** After the commit, every chunk that holds a proxy of the landmark draws it. */
  proxy: boolean;
}

export interface LandmarkFrameStats {
  sampled: number;
  /** Frames in which a proxy was masked while no model of its landmark was drawn: must stay 0. */
  holes: number;
  /** Frames in which a model and an unmasked proxy of the same landmark were both drawn (the hand-over). */
  doubles: number;
  /** Frames in which a skyline landmark inside the draw distance had no model drawn (skyline or full). */
  skylineMissing: number;
}

export interface LandmarksReport {
  tier: QualityTierId;
  cap: number;
  swapM: number;
  /** Landmarks with a model that are loading, preparing, shown or leaving (the skyline is not counted). */
  resident: LandmarkReportEntry[];
  failed: { id: string; error: string }[];
  skyline: { rangeM: number; mountM: number; entries: SkylineReportEntry[] };
  /** The latest swap commits (QA builds), oldest first. */
  swaps: LandmarkSwapEvent[];
  frames: LandmarkFrameStats;
  objects: number;
  triangles: number;
  /** Most landmarks resident at once since the start (never above `cap`). */
  maxResident: number;
  loads: number;
  frame: number;
}

/** A leaving landmark is removed after this long even when a chunk has not come back. */
const LEAVE_TIMEOUT_MS = 2500;
/** A remesh request is asked again after this long without an answer. */
const REMESH_TIMEOUT_MS = 6000;
/** A swap whose prepared meshes have not all come back after this long gives up (the load is tried again after `retryMs`). */
const PREPARE_TIMEOUT_MS = 8000;
/** Remesh requests in flight at once. */
const REMESH_IN_FLIGHT = 4;
/** Swap events kept for the report. */
const EVENTS_KEPT = 120;
/** Rough GPU bytes of a landmark commit: 32 bytes per vertex (position, normal, colour, ao, birth) and 4 per index. */
const bytesOf = (m: LandmarkModelData): number => m.vertices * 32 + m.triangles * 12;

export class LandmarkLayer {
  private readonly o: LandmarkDeps;
  private readonly cfg: LandmarksRuntimeConfig;
  private readonly tierRow: LandmarkTierRuntime;
  private readonly slots: Entry[];
  private readonly sky: Entry[];
  private readonly remeshing = new Map<ChunkKey, { mask: number[]; at: number }>();
  /** Chunks whose prepared mesh is on its way up: the commit event is recorded when it lands. */
  private readonly applying = new Map<ChunkKey, string>();
  private readonly events: LandmarkSwapEvent[] = [];
  private stats: LandmarkFrameStats = { sampled: 0, holes: 0, doubles: 0, skylineMissing: 0 };
  private frame = 0;
  private loadsStarted = 0;
  private maxResident = 0;
  private lastNowSec = 0;
  private disposed = false;

  constructor(o: LandmarkDeps) {
    this.o = o;
    this.cfg = o.config ?? LANDMARKS_RUNTIME;
    this.tierRow = this.cfg.tiers[o.tier];
    const entry = (spot: LandmarkSpot, kind: 'full' | 'sky'): Entry => ({
      kind, spot, phase: 'idle', distM: Infinity, gen: 0, model: null, handle: null, visible: false, retryAt: 0, leaveAt: 0, error: null, prep: null, inRange: false, y: 0, exact: false,
    });
    this.slots = o.spots.map((s) => entry(s, 'full'));
    const rangeOn = (o.skylineRangeM ?? 0) > 0;
    this.sky = rangeOn ? o.spots.filter((s) => this.cfg.skyline.ids.includes(s.id)).map((s) => entry(s, 'sky')) : [];
  }

  get cap(): number {
    return this.tierRow.resident;
  }
  get swapM(): number {
    return this.tierRow.swapM;
  }
  private get rangeM(): number {
    return this.o.skylineRangeM ?? 0;
  }
  private get rings(): SkylineRings {
    return skylineRings(this.rangeM, this.cfg.skyline);
  }
  private get frameNo(): number {
    return this.o.frameNo ? this.o.frameNo() : this.frame;
  }

  private resident(): Entry[] {
    return this.slots.filter((s) => s.phase === 'loading' || s.phase === 'preparing' || s.phase === 'shown' || s.phase === 'leaving');
  }

  private fullOf(id: string): Entry | undefined {
    return this.slots.find((s) => s.spot.id === id);
  }

  private skyOf(id: string): Entry | undefined {
    return this.sky.find((s) => s.spot.id === id);
  }

  /** The other instance of the same landmark: the skyline entry of a full one and the full entry of a skyline one. */
  private otherOf(s: Entry): Entry | undefined {
    return s.kind === 'full' ? this.skyOf(s.spot.id) : this.fullOf(s.spot.id);
  }

  /** The full-fidelity model of the landmark is up and drawn (shown, or leaving until its chunks are back). */
  private fullDrawn(id: string): boolean {
    const f = this.fullOf(id);
    return f !== undefined && (f.phase === 'shown' || f.phase === 'leaving');
  }

  /** The `proxyOf` values whose masks the layer asks for: the landmarks whose full model is up and staying, and the skyline models up. */
  private owners(): Set<number> {
    const out = new Set<number>();
    for (const s of this.slots) if (s.phase === 'shown') out.add(proxyIdOf(s.spot.index));
    for (const s of this.sky) if (s.phase === 'shown') out.add(proxyIdOf(s.spot.index));
    return out;
  }

  /** One frame: `focus` is where the world streams around, `nowSec` the render clock. */
  update(focus: { x: number; z: number }, nowSec: number): void {
    if (this.disposed) return;
    this.frame++;
    this.lastNowSec = nowSec;
    const now = this.o.now();
    const release = this.swapM * this.cfg.unloadFactor;
    for (const s of this.slots) s.distM = Math.hypot(s.spot.x - focus.x, s.spot.z - focus.z);
    for (const s of this.sky) s.distM = Math.hypot(s.spot.x - focus.x, s.spot.z - focus.z);

    // Phase moves that depend on distance alone.
    for (const s of this.slots) {
      if (s.phase === 'shown' && s.distM > release) {
        s.phase = 'leaving';
        s.leaveAt = now;
      } else if (s.phase === 'leaving' && s.distM <= this.swapM) {
        s.phase = 'shown';
      } else if ((s.phase === 'loading' || s.phase === 'preparing') && s.distM > release) {
        this.cancel(s, 'idle');
      }
    }
    for (const s of this.slots) this.advance(s, now);

    this.updateSkyline(now);

    this.startLoads(now);
    this.maxResident = Math.max(this.maxResident, this.resident().length);

    if (this.frame % (this.o.reconcileEvery ?? 4) === 0) this.reconcile(now);
    if (this.frame % 15 === 0) this.reanchor();
    if (this.o.qa) this.sampleFrame();
  }

  // ---- loading --------------------------------------------------------------------------------------------------------------

  private startLoads(now: number): void {
    const inFlight = this.slots.filter((s) => s.phase === 'loading' && !s.model).length;
    if (inFlight < this.cfg.inFlight) {
      const wanted = this.slots
        .filter((s) => (s.phase === 'idle' || (s.phase === 'failed' && now >= s.retryAt)) && s.distM <= this.swapM)
        .sort((a, b) => a.distM - b.distM || (a.spot.id < b.spot.id ? -1 : 1));
      const next = wanted[0];
      if (next) this.startFull(next, now);
    }
    if (this.sky.length > 0 && (this.o.ready ? this.o.ready() : true)) {
      const skyInFlight = this.sky.filter((s) => s.phase === 'loading').length;
      if (skyInFlight === 0) {
        const next = nextSkylineLoad(this.sky.map((e) => ({ e, id: e.spot.id, phase: e.phase, distM: e.distM, retryAt: e.retryAt })), this.rings, now);
        if (next) this.load(next.e);
      }
    }
  }

  private startFull(next: Entry, now: number): void {
    if (this.resident().length >= this.cap) {
      // The cap is full: release the farthest resident landmark, and only for a nearer one.
      const farthest = this.resident().sort((a, b) => b.distM - a.distM)[0] as Entry;
      if (farthest.distM <= next.distM) return;
      if (farthest.phase === 'loading' || farthest.phase === 'preparing') this.cancel(farthest, 'idle');
      else if (farthest.phase === 'shown') {
        farthest.phase = 'leaving';
        farthest.leaveAt = now;
      }
      // A leaving landmark still counts against the cap until its model is gone; the load starts then.
      if (this.resident().length >= this.cap) return;
    }
    this.load(next);
  }

  private load(s: Entry): void {
    s.phase = 'loading';
    s.model = null;
    s.error = null;
    const gen = ++s.gen;
    this.loadsStarted++;
    this.o.load(s.spot, { skyline: s.kind === 'sky' }).then(
      (model) => {
        if (this.disposed || s.gen !== gen || s.phase !== 'loading') return;
        s.model = model;
        if (s.kind === 'sky') s.phase = 'ready';
        else this.beginPrepare(s);
      },
      (e: unknown) => {
        if (this.disposed || s.gen !== gen || s.phase !== 'loading') return;
        this.fail(s, e);
      },
    );
  }

  private fail(s: Entry, e: unknown): void {
    this.dropPrep(s);
    s.phase = 'failed';
    s.model = null;
    s.error = e instanceof Error ? e.message : String(e);
    s.retryAt = this.o.now() + this.cfg.retryMs;
  }

  /** Cancels a load or a swap in preparation: a late reply is dropped. */
  private cancel(s: Entry, to: 'idle' | 'ready'): void {
    s.gen++;
    this.dropPrep(s);
    s.phase = to;
    if (to === 'idle') s.model = null;
  }

  private dropPrep(s: Entry): void {
    s.prep = null;
  }

  // ---- the staged swap ------------------------------------------------------------------------------------------------------

  /** The model is decoded: mesh the chunks that hold its proxies again, in the worker, with the proxy left out. */
  private beginPrepare(s: Entry): void {
    s.phase = 'preparing';
    // The other instance of the same landmark (its skyline model, or its full one) is already preparing the same chunks: wait for
    // its commit, which leaves the chunks masked or on their way up, so each chunk is replaced once.
    if (this.otherOf(s)?.phase === 'preparing') {
      s.prep = null;
      return;
    }
    const id = proxyIdOf(s.spot.index);
    const states = this.o.chunks.states();
    const want = this.owners();
    want.add(id);
    const todo: { key: ChunkKey; mask: number[] }[] = [];
    for (const st of states) {
      // already masked, or on its way up from a commit that just happened (the other instance owns it): nothing to redo
      if (!st.proxies.includes(id) || st.masked.includes(id) || this.remeshing.get(st.key)?.mask.includes(id)) continue;
      todo.push({ key: st.key, mask: desiredMask(st.proxies, want) });
    }
    const prep: Prep = { at: this.o.now(), keys: new Set(todo.map((t) => t.key)), pending: todo.length, results: [], queued: false };
    s.prep = prep;
    const gen = s.gen;
    for (const t of todo) {
      const settle = (p: PreparedRemesh | null): void => {
        if (this.disposed || s.gen !== gen || s.prep !== prep) return;
        if (p) prep.results.push(p);
        prep.pending--;
      };
      this.o.chunks.prepare(t.key, t.mask).then(settle, () => settle(null));
    }
  }

  /** A swap whose model and prepared meshes are all ready is handed to the upload gate once the ground under it is known. */
  private advance(s: Entry, now: number): void {
    if (s.phase === 'preparing' && !s.prep && s.model) {
      if (this.otherOf(s)?.phase !== 'preparing') this.beginPrepare(s);
      return;
    }
    if (s.phase !== 'preparing' || !s.prep || s.prep.queued || !s.model) return;
    if (s.prep.pending > 0) {
      if (now - s.prep.at > PREPARE_TIMEOUT_MS) this.fail(s, new Error('the chunk meshes did not come back'));
      return;
    }
    if (this.anchorY(s) === null) return;
    s.prep.queued = true;
    const gen = s.gen;
    const model = s.model;
    this.o.queue({ id: `${s.kind}:${s.spot.id}`, priority: -2, bytes: bytesOf(model), run: (info) => this.commit(s, gen, info.uploads) });
  }

  private anchorY(s: Entry): number | null {
    if (!s.model) return null;
    return s.model.anchor === 'sea' ? this.o.waterY : this.o.groundY(s.spot.x, s.spot.z);
  }

  /** A model placed on coarse terrain moves to the exact height once the L0 chunk under it is up (checked every few frames). */
  private reanchor(): void {
    for (const s of [...this.slots, ...this.sky]) {
      if (!s.handle || s.exact || !s.model || s.model.anchor === 'sea') continue;
      const y = this.o.groundY(s.spot.x, s.spot.z, true);
      if (y === null) continue;
      s.exact = true;
      if (Math.abs(y - s.y) > 0.2) {
        s.y = y;
        s.handle.setHeight?.(y);
      }
    }
  }

  /** The gate released the commit: the model joins the scene, then the prepared chunk meshes are queued right behind it. */
  private commit(s: Entry, gen: number, uploads: number): void {
    const prep = s.prep;
    if (this.disposed || s.gen !== gen || s.phase !== 'preparing' || !s.model || !prep) return;
    const y = this.anchorY(s);
    if (y === null) {
      prep.queued = false; // the ground went away again: wait for it
      return;
    }
    s.y = y;
    s.exact = s.model.anchor === 'sea' || this.o.groundY(s.spot.x, s.spot.z, true) !== null;
    const t0 = this.o.now();
    try {
      s.handle = this.o.mount(s.spot, s.model, y, this.lastNowSec);
    } catch (e) {
      this.fail(s, e);
      return;
    }
    const ms = this.o.now() - t0;
    s.phase = 'shown';
    s.prep = null;
    // One model per landmark: a full model puts the skyline instance away in the same frame, and a skyline model that comes up
    // under a full one starts hidden.
    if (s.kind === 'full') {
      s.visible = true;
      this.syncSkylineVisibility(s.spot.id);
    } else {
      s.visible = !this.fullDrawn(s.spot.id);
      if (!s.visible) s.handle.setVisible?.(false);
    }
    const now = this.o.now();
    for (const p of prep.results) {
      this.o.chunks.apply(p);
      this.remeshing.set(p.key, { mask: p.mask, at: now });
      this.applying.set(p.key, s.spot.id);
    }
    this.record({ id: s.spot.id, step: s.kind === 'full' ? 'model' : 'skyline', frame: this.frameNo, ms, uploads, model: s.visible, proxy: !this.proxyMasked(s.spot.id) });
  }

  private syncSkylineVisibility(id: string): void {
    const k = this.skyOf(id);
    if (!k || !k.handle) return;
    const visible = k.phase === 'shown' || k.phase === 'leaving' ? !this.fullDrawn(id) : false;
    if (visible !== k.visible) {
      k.handle.setVisible?.(visible);
      k.visible = visible;
    }
  }

  /** The renderer uploaded a chunk: when it is one of a swap's prepared meshes, the commit is recorded. */
  onChunkCommitted(key: ChunkKey, ms: number, uploads: number): void {
    const id = this.applying.get(key);
    if (id === undefined) return;
    this.applying.delete(key);
    this.record({ id, step: 'chunk', key, frame: this.frameNo, ms, uploads, model: this.modelDrawn(id), proxy: !this.proxyMasked(id) });
  }

  private record(e: LandmarkSwapEvent): void {
    this.events.push(e);
    if (this.events.length > EVENTS_KEPT) this.events.shift();
  }

  // ---- the skyline ----------------------------------------------------------------------------------------------------------

  private updateSkyline(now: number): void {
    if (this.sky.length === 0) return;
    const rings = this.rings;
    const releaseM = rings.releaseM;
    for (const s of this.sky) {
      s.inRange = inSkylineRange(s.inRange, s.distM, rings);
      switch (s.phase) {
        case 'shown':
          if (!s.inRange) {
            s.phase = 'leaving';
            s.leaveAt = now;
          }
          break;
        case 'leaving':
          if (s.inRange) s.phase = 'shown';
          break;
        case 'parked':
          if (s.inRange) s.phase = 'shown';
          break;
        case 'ready':
          if (s.inRange) this.beginPrepare(s);
          break;
        case 'preparing':
          if (!s.inRange) this.cancel(s, 'ready');
          break;
        case 'loading':
          if (s.distM > releaseM * 1.15) this.cancel(s, 'idle');
          break;
        default:
          break;
      }
      this.advance(s, now);
      this.syncSkylineVisibility(s.spot.id);
    }
  }

  // ---- chunks ---------------------------------------------------------------------------------------------------------------

  /** The chunks that hold proxies get the mask the layer asks for; leaving landmarks are removed once their chunks are back. */
  private reconcile(now: number): void {
    const states = this.o.chunks.states();
    const byKey = new Map(states.map((c) => [c.key, c] as const));
    for (const [key, r] of this.remeshing) {
      const c = byKey.get(key);
      if (!c || (c.masked.length === r.mask.length && c.masked.every((v, i) => v === r.mask[i])) || now - r.at > REMESH_TIMEOUT_MS) {
        this.remeshing.delete(key);
        this.applying.delete(key);
      }
    }
    const owners = this.owners();
    const changes = staleChunks(states, owners);
    const staged = new Set<ChunkKey>();
    for (const s of [...this.slots, ...this.sky]) if (s.phase === 'preparing' && s.prep) for (const k of s.prep.keys) staged.add(k);
    for (const ch of changes) {
      if (this.remeshing.size >= REMESH_IN_FLIGHT) break;
      // a chunk that a swap in preparation is meshing already gets its mask from that swap
      if (this.remeshing.has(ch.key) || staged.has(ch.key)) continue;
      this.remeshing.set(ch.key, { mask: ch.mask, at: now });
      this.o.chunks.remesh(ch.key, ch.mask);
    }
    for (const s of [...this.slots, ...this.sky]) {
      if (s.phase !== 'leaving') continue;
      const id = proxyIdOf(s.spot.index);
      // Back means: no chunk still hides this proxy although nobody asks for it (a skyline model that stays keeps the mask).
      const pending = !owners.has(id) && chunksHolding(states, id).some((k) => (byKey.get(k)?.masked ?? []).includes(id));
      if (!pending || now - s.leaveAt > LEAVE_TIMEOUT_MS) this.release(s);
    }
  }

  private release(s: Entry): void {
    if (s.kind === 'sky') {
      // Hidden only now, after the proxies are back: parked, ready to show again without a load.
      s.handle?.setVisible?.(false);
      s.visible = false;
      s.phase = 'parked';
      return;
    }
    s.handle?.dispose();
    s.handle = null;
    s.visible = false;
    s.model = null;
    s.phase = 'idle';
    s.gen++;
    // The skyline instance of the same landmark is drawn again in the frame the full model goes.
    this.syncSkylineVisibility(s.spot.id);
  }

  // ---- QA: per-frame invariants ---------------------------------------------------------------------------------------------

  private modelDrawn(id: string): boolean {
    if (this.fullDrawn(id)) return true;
    const k = this.skyOf(id);
    return k !== undefined && k.visible;
  }

  private proxyMasked(id: string): boolean {
    const pid = proxyIdOf((this.fullOf(id) ?? this.skyOf(id))?.spot.index ?? 0);
    return this.o.chunks.states().some((c) => c.proxies.includes(pid) && c.masked.includes(pid));
  }

  private sampleFrame(): void {
    const st = this.stats;
    st.sampled++;
    const states = this.o.chunks.states();
    const seen = new Set<string>();
    for (const e of [...this.slots, ...this.sky]) {
      if (seen.has(e.spot.id) || !e.handle) continue;
      seen.add(e.spot.id);
      const pid = proxyIdOf(e.spot.index);
      const holding = states.filter((c) => c.proxies.includes(pid));
      if (holding.length === 0) continue;
      const drawn = this.modelDrawn(e.spot.id);
      const masked = holding.some((c) => c.masked.includes(pid));
      const unmasked = holding.some((c) => !c.masked.includes(pid));
      if (masked && !drawn) st.holes++;
      if (drawn && unmasked) st.doubles++;
    }
    const range = this.rangeM;
    let missing = false;
    for (const k of this.sky) if (k.distM <= range && k.phase !== 'failed' && !this.modelDrawn(k.spot.id)) missing = true;
    if (missing) st.skylineMissing++;
  }

  /** Starts the frame counters again (a test warms the scene up, then measures a run). */
  resetStats(): void {
    this.stats = { sampled: 0, holes: 0, doubles: 0, skylineMissing: 0 };
    this.events.length = 0;
  }

  // ---- numbers --------------------------------------------------------------------------------------------------------------

  /** Objects and triangles of the models that are drawn (a hidden skyline instance is not counted). */
  budget(): { objects: number; triangles: number } {
    let objects = 0, triangles = 0;
    for (const s of [...this.slots, ...this.sky]) {
      if (!s.handle || (s.kind === 'sky' && !s.visible)) continue;
      objects += s.handle.objects;
      triangles += s.handle.triangles;
    }
    return { objects, triangles };
  }

  /** Chunks asked to be meshed again and not yet confirmed. */
  get remeshPending(): number {
    return this.remeshing.size;
  }

  /** True when nothing is loading, preparing, leaving or waiting to be remeshed. */
  get idle(): boolean {
    const quiet = (s: Entry): boolean => s.phase === 'idle' || s.phase === 'shown' || s.phase === 'failed' || s.phase === 'parked' || (s.kind === 'sky' && s.phase === 'ready' && !s.inRange);
    return this.remeshing.size === 0 && this.slots.every(quiet) && this.sky.every(quiet);
  }

  report(): LandmarksReport {
    const states = this.o.chunks.states();
    const resident = this.resident().sort((a, b) => (a.spot.id < b.spot.id ? -1 : 1));
    const entries: LandmarkReportEntry[] = resident.map((s) => {
      const id = proxyIdOf(s.spot.index);
      return {
        id: s.spot.id,
        phase: s.phase,
        fidelity: s.model?.fidelity ?? '',
        distM: Math.round(s.distM * 10) / 10,
        objects: s.handle?.objects ?? 0,
        triangles: s.handle?.triangles ?? 0,
        chunks: chunksHolding(states, id).map((key) => ({
          key,
          masked: (states.find((c) => c.key === key)?.masked ?? []).includes(id),
          bundleRerecords: this.o.chunks.rerecords(key),
        })),
      };
    });
    const b = this.budget();
    const sky: SkylineReportEntry[] = this.sky
      .map((s) => {
        const drawn = s.visible && s.handle !== null;
        return {
          id: s.spot.id,
          phase: s.phase,
          distM: Math.round(s.distM * 10) / 10,
          visible: drawn,
          hiddenBy: s.handle && !drawn ? (this.fullDrawn(s.spot.id) ? ('full' as const) : ('range' as const)) : null,
          fidelity: s.model?.fidelity ?? '',
          objects: s.handle?.objects ?? 0,
          triangles: s.handle?.triangles ?? 0,
        };
      })
      .sort((a, b2) => (a.id < b2.id ? -1 : 1));
    return {
      tier: this.o.tier,
      cap: this.cap,
      swapM: this.swapM,
      resident: entries,
      failed: [...this.slots, ...this.sky].filter((s) => s.phase === 'failed').map((s) => ({ id: s.spot.id, error: s.error ?? '' })),
      skyline: { rangeM: this.rangeM, mountM: this.rings.mountM, entries: sky },
      swaps: [...this.events],
      frames: { ...this.stats },
      objects: b.objects,
      triangles: b.triangles,
      maxResident: this.maxResident,
      loads: this.loadsStarted,
      frame: this.frame,
    };
  }

  /** The mask the chunk should carry now (used by remeshes that are not the layer's own). */
  maskFor(proxies: readonly number[]): number[] {
    const own = this.owners();
    return proxies.filter((p) => own.has(p)).sort((a, b) => a - b);
  }

  /** Every proxy id whose footprints the layer asks to leave out now: a new chunk mesh is requested with this mask. */
  maskList(): number[] {
    return [...this.owners()].sort((a, b) => a - b);
  }

  dispose(): void {
    this.disposed = true;
    for (const s of [...this.slots, ...this.sky]) {
      s.handle?.dispose();
      s.handle = null;
    }
    this.remeshing.clear();
    this.applying.clear();
  }
}
