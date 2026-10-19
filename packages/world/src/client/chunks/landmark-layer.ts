/**
 * LandmarkLayer (02-world.md section 3; 02-world-bake.md section 7 rules 3 and 5; C08 rule 12; M02d1). Landmark glTFs are not chunk
 * objects: they live here, outside the chunk `BundleGroup`s, with their own cap and swap distance per tier
 * (`config/world/landmarks-runtime.json`).
 *
 *  - A landmark whose seed lies within `swapM` of the focus is loaded, nearest first, one model in flight at a time, as long as
 *    the tier's cap of resident landmarks allows it; when the cap is reached the farthest resident landmark is released first,
 *    and only for a nearer one.
 *  - When the model is up (and the ground under it is known), the chunks that hold its baked extrusion proxies (`proxyOf`) are
 *    meshed again with those proxies left out: one `remesh` request each, which goes through the `ChunkUploadGate` and counts as
 *    one re-record request in `ChunkRenderer` (`bundleRerecords`).
 *  - Beyond `swapM x unloadFactor` the proxies are meshed back first and the model is removed when the last chunk is back (or after
 *    a short timeout): never a hole. A load that fails leaves the proxy meshed and is tried again after `retryMs`.
 *
 * The layer is plain logic over injected ports (model loader, scene mount, chunk port), so it runs in Node tests; `landmark-view.ts`
 * supplies the three objects and `world-view.ts` the ports. The meshes of the models are counted by `RenderBudgetMeter` like any
 * other object of the scene.
 */
import type { ChunkKey, QualityTierId } from '@dv/shared';
import runtimeJson from '../../../../../config/world/landmarks-runtime.json';
import type { LandmarkModelData } from './landmark-glb.ts';
import { chunksHolding, proxyIdOf, staleChunks, type ChunkProxyState } from './proxy-mask.ts';

export interface LandmarkTierRuntime { resident: number; swapM: number }
export interface LandmarksRuntimeConfig {
  schema: 'world-landmarks-runtime/1';
  unloadFactor: number;
  retryMs: number;
  inFlight: number;
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
  dispose(): void;
}

export interface LandmarkChunkPort {
  /** The resident L0 chunks that hold at least one proxy, with the proxies their current mesh leaves out. */
  states(): ChunkProxyState[];
  /** Asks for the chunk to be meshed again leaving out exactly these proxies (empty: meshed back). */
  remesh(key: ChunkKey, mask: number[]): void;
  /** Re-record requests of the chunk's bundle so far (for the QA report). */
  rerecords(key: ChunkKey): number;
}

export interface LandmarkDeps {
  tier: QualityTierId;
  spots: readonly LandmarkSpot[];
  /** Tier row and global knobs; the committed config by default. */
  config?: LandmarksRuntimeConfig;
  /** Reads and decodes the model of a spot for the tier (rejects when it cannot). */
  load(spot: LandmarkSpot): Promise<LandmarkModelData>;
  /** Puts the model in the scene at height y; `nowSec` starts its fade-in. */
  mount(spot: LandmarkSpot, model: LandmarkModelData, y: number, nowSec: number): LandmarkHandle;
  chunks: LandmarkChunkPort;
  /** Terrain height under a point; null until a chunk there is up. */
  groundY(x: number, z: number): number | null;
  /** Height of the water: the `sea` anchor. */
  waterY: number;
  /** Milliseconds, any origin. */
  now(): number;
  /** Frames between chunk reconciliations (default 4). */
  reconcileEvery?: number;
}

export type LandmarkPhase = 'idle' | 'loading' | 'shown' | 'leaving' | 'failed';

interface Slot {
  spot: LandmarkSpot;
  phase: LandmarkPhase;
  distM: number;
  /** Bumped when a load is cancelled: a late reply is dropped. */
  gen: number;
  model: LandmarkModelData | null;
  handle: LandmarkHandle | null;
  retryAt: number;
  leaveAt: number;
  error: string | null;
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

export interface LandmarksReport {
  tier: QualityTierId;
  cap: number;
  swapM: number;
  /** Landmarks with a model that are loading, shown or leaving. */
  resident: LandmarkReportEntry[];
  failed: { id: string; error: string }[];
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
/** Remesh requests in flight at once. */
const REMESH_IN_FLIGHT = 4;

export class LandmarkLayer {
  private readonly o: LandmarkDeps;
  private readonly cfg: LandmarksRuntimeConfig;
  private readonly tierRow: LandmarkTierRuntime;
  private readonly slots: Slot[];
  private readonly remeshing = new Map<ChunkKey, { mask: number[]; at: number }>();
  private frame = 0;
  private loadsStarted = 0;
  private maxResident = 0;
  private lastNowSec = 0;
  private disposed = false;

  constructor(o: LandmarkDeps) {
    this.o = o;
    this.cfg = o.config ?? LANDMARKS_RUNTIME;
    this.tierRow = this.cfg.tiers[o.tier];
    this.slots = o.spots.map((spot) => ({ spot, phase: 'idle', distM: Infinity, gen: 0, model: null, handle: null, retryAt: 0, leaveAt: 0, error: null }));
  }

  get cap(): number {
    return this.tierRow.resident;
  }
  get swapM(): number {
    return this.tierRow.swapM;
  }

  private resident(): Slot[] {
    return this.slots.filter((s) => s.phase === 'loading' || s.phase === 'shown' || s.phase === 'leaving');
  }

  /** The `proxyOf` values of the landmarks whose models are up and staying. */
  private shownProxyIds(): Set<number> {
    const out = new Set<number>();
    for (const s of this.slots) if (s.phase === 'shown') out.add(proxyIdOf(s.spot.index));
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

    // Phase moves that depend on distance alone.
    for (const s of this.slots) {
      if (s.phase === 'shown' && s.distM > release) {
        s.phase = 'leaving';
        s.leaveAt = now;
      } else if (s.phase === 'leaving' && s.distM <= this.swapM) {
        s.phase = 'shown';
      } else if (s.phase === 'loading' && s.distM > release) {
        s.gen++;
        s.phase = 'idle';
        s.model = null;
      }
    }

    // A loaded model waits here for the ground under it.
    for (const s of this.slots) if (s.phase === 'loading' && s.model) this.tryMount(s, nowSec);

    this.startLoads(now);
    this.maxResident = Math.max(this.maxResident, this.resident().length);

    if (this.frame % (this.o.reconcileEvery ?? 4) === 0) this.reconcile(now);
  }

  private startLoads(now: number): void {
    const inFlight = this.slots.filter((s) => s.phase === 'loading' && !s.model).length;
    if (inFlight >= this.cfg.inFlight) return;
    const wanted = this.slots
      .filter((s) => (s.phase === 'idle' || (s.phase === 'failed' && now >= s.retryAt)) && s.distM <= this.swapM)
      .sort((a, b) => a.distM - b.distM || (a.spot.id < b.spot.id ? -1 : 1));
    const next = wanted[0];
    if (!next) return;
    if (this.resident().length >= this.cap) {
      // The cap is full: release the farthest resident landmark, and only for a nearer one.
      const farthest = this.resident().sort((a, b) => b.distM - a.distM)[0] as Slot;
      if (farthest.distM <= next.distM) return;
      if (farthest.phase === 'loading') {
        farthest.gen++;
        farthest.phase = 'idle';
        farthest.model = null;
      } else if (farthest.phase === 'shown') {
        farthest.phase = 'leaving';
        farthest.leaveAt = now;
      }
      // A leaving landmark still counts against the cap until its model is gone; the load starts then.
      if (this.resident().length >= this.cap) return;
    }
    this.load(next);
  }

  private load(s: Slot): void {
    s.phase = 'loading';
    s.model = null;
    s.error = null;
    const gen = ++s.gen;
    this.loadsStarted++;
    this.o.load(s.spot).then(
      (model) => {
        if (this.disposed || s.gen !== gen || s.phase !== 'loading') return;
        s.model = model;
        this.tryMount(s, this.lastNowSec);
      },
      (e: unknown) => {
        if (this.disposed || s.gen !== gen || s.phase !== 'loading') return;
        s.phase = 'failed';
        s.model = null;
        s.error = e instanceof Error ? e.message : String(e);
        s.retryAt = this.o.now() + this.cfg.retryMs;
      },
    );
  }

  private tryMount(s: Slot, nowSec: number): void {
    const model = s.model;
    if (!model || s.phase !== 'loading') return;
    const y = model.anchor === 'sea' ? this.o.waterY : this.o.groundY(s.spot.x, s.spot.z);
    if (y === null) return;
    try {
      s.handle = this.o.mount(s.spot, model, y, nowSec);
      s.phase = 'shown';
    } catch (e) {
      s.phase = 'failed';
      s.model = null;
      s.error = e instanceof Error ? e.message : String(e);
      s.retryAt = this.o.now() + this.cfg.retryMs;
    }
  }

  /** The chunks that hold proxies get the mask the shown landmarks ask for; leaving landmarks are removed once their chunks are back. */
  private reconcile(now: number): void {
    const states = this.o.chunks.states();
    const byKey = new Map(states.map((c) => [c.key, c] as const));
    for (const [key, r] of this.remeshing) {
      const c = byKey.get(key);
      if (!c || (c.masked.length === r.mask.length && c.masked.every((v, i) => v === r.mask[i])) || now - r.at > REMESH_TIMEOUT_MS) this.remeshing.delete(key);
    }
    const changes = staleChunks(states, this.shownProxyIds());
    for (const ch of changes) {
      if (this.remeshing.size >= REMESH_IN_FLIGHT) break;
      if (this.remeshing.has(ch.key)) continue;
      this.remeshing.set(ch.key, { mask: ch.mask, at: now });
      this.o.chunks.remesh(ch.key, ch.mask);
    }
    for (const s of this.slots) {
      if (s.phase !== 'leaving') continue;
      const id = proxyIdOf(s.spot.index);
      const pending = chunksHolding(states, id).some((k) => (byKey.get(k)?.masked ?? []).includes(id));
      if (!pending || now - s.leaveAt > LEAVE_TIMEOUT_MS) this.release(s);
    }
  }

  private release(s: Slot): void {
    s.handle?.dispose();
    s.handle = null;
    s.model = null;
    s.phase = 'idle';
    s.gen++;
  }

  // ---- numbers --------------------------------------------------------------------------------------------------------------

  /** Objects and triangles of the mounted models. */
  budget(): { objects: number; triangles: number } {
    let objects = 0, triangles = 0;
    for (const s of this.slots) {
      if (!s.handle) continue;
      objects += s.handle.objects;
      triangles += s.handle.triangles;
    }
    return { objects, triangles };
  }

  /** Chunks asked to be meshed again and not yet confirmed. */
  get remeshPending(): number {
    return this.remeshing.size;
  }

  /** True when nothing is loading, leaving or waiting to be remeshed. */
  get idle(): boolean {
    return this.remeshing.size === 0 && this.slots.every((s) => s.phase === 'idle' || s.phase === 'shown' || s.phase === 'failed');
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
    return {
      tier: this.o.tier,
      cap: this.cap,
      swapM: this.swapM,
      resident: entries,
      failed: this.slots.filter((s) => s.phase === 'failed').map((s) => ({ id: s.spot.id, error: s.error ?? '' })),
      objects: b.objects,
      triangles: b.triangles,
      maxResident: this.maxResident,
      loads: this.loadsStarted,
      frame: this.frame,
    };
  }

  /** The mask the chunk should carry now (used by remeshes that are not the layer's own). */
  maskFor(proxies: readonly number[]): number[] {
    const shown = this.shownProxyIds();
    return proxies.filter((p) => shown.has(p)).sort((a, b) => a - b);
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.slots) {
      s.handle?.dispose();
      s.handle = null;
    }
    this.remeshing.clear();
  }
}
