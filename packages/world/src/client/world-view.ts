/**
 * WorldView: the page half of a streamed world (M02b1). It is the engine's `WorldLayer`: `bootEngine({ world })` calls `attach`
 * once the engine view exists and `frame` every frame. It owns
 *
 *  - the render-level `ChunkStore` (l0, l1, l2: the same pure ranking the sim uses for `p0`), whose requests are mesh jobs in
 *    asset.worker (`world.mesh`), and the `ChunkRenderer` the meshes go to through the upload gate;
 *  - the backdrop pass (`BackdropLayer`), the lights, and the veil that lifts after the first L0 upload;
 *  - the failure overlays ("re-downloading district", the offline message), the `world.stream` telemetry and the QA bridge.
 *
 * Failure handling (02-world.md 5.6): a pack that is unavailable retries with backoff while the overlay shows; a pack whose hash is
 * wrong or that does not decode was purged and fetched once more by the worker, and then the unit is `failed` (the sim puts an
 * invisible wall on a failed `p0` chunk; a failed render unit is simply not drawn); `p0` missing at the spawn while offline blocks
 * the session with the offline message; a lost GPU device rebuilds the objects from the meshes held here, without a refetch.
 */
import { DirectionalLight, Frustum, HemisphereLight, Matrix4, type PerspectiveCamera } from 'three/webgpu';
import type { SimEvent } from '@dv/engine/sim';
import type { WorldFrame, WorldLayer } from '@dv/engine/client/boot/world-layer';
import type { RendererHost } from '@dv/engine/platform/renderer-host';
import type { WorldScenarioDriver } from '@dv/engine/platform/perf';
import { CHUNK_EDGE_M, GRID_MIN_M, packRefOf, type ChunkKey, type QualityTierId, type WorldIndex } from '@dv/shared';
import { ChunkStore, LEVEL_Z, type FailReason, type Level, type LoadRequest } from '../sim/streaming/chunk-store.ts';
import { STREAMING, basePlan, type StreamingPlan } from '../sim/streaming/plan.ts';
import { rankUnits, type Focus } from '../sim/streaming/priority.ts';
import { tileSets, unitExists, type TileSets } from '../sim/streaming/boot.ts';
import { BackdropLayer, type BackdropInfo, type JobClient } from './backdrop/backdrop-layer.ts';
import { ChunkRenderer, type RenderLevel } from './chunks/chunk-renderer.ts';
import { createWorldMaterials, type WorldMaterials } from './chunks/materials.ts';
import { profileOf } from './chunks/mesher.ts';
import type { UnitMesh } from './chunks/mesh-types.ts';
import type { MeshJobArgs, MeshJobResult } from './jobs.ts';

export interface WorldViewLabels {
  /** "Re-downloading district" overlay text. */
  redownload: string;
  /** Blocking message: the spawn tiles are missing and the device is offline. */
  offline: string;
}

export interface AssetsLike extends JobClient {
  stats(): Promise<{ bytes: number; network: number; retries: number }>;
}

export interface WorldViewOptions {
  tier: QualityTierId;
  index: Pick<WorldIndex, 'bakeId' | 'tiles'>;
  assets: AssetsLike;
  /** `world.cards` and `world.massing` of config/platform-flags.json. */
  flags: { cards: boolean; massing: boolean };
  spawn: { x: number; z: number };
  labels: WorldViewLabels;
  /** Where the overlays go. */
  container: HTMLElement;
  /** `stats().bytes` before the boot downloads started; the cold-download figure counts from here. */
  bytesBase?: number;
  /** Telemetry: `world.stream` once a minute (the platform samples 10 %). */
  emit?: (name: 'world.stream', props: { residentL0: number; missCount: number; uploadP95Ms: number; bytesMB: number }) => void;
  /** Epoch-free millisecond clock (`performance.now`). */
  now?: () => number;
  /** QA builds: the bridge and the focus override are live. */
  qa?: boolean;
}

export interface ChunksReport {
  resident: Record<RenderLevel, ChunkKey[]>;
  /** Meshed (CPU) units per level, uploaded or not (units with nothing to draw included). */
  meshed: Record<RenderLevel, number>;
  /** Units whose pack holds nothing to draw (open sea, an unbuilt block): settled, never uploaded. */
  empty: Record<RenderLevel, ChunkKey[]>;
  bundleRerecords: Record<string, number>;
  uploads: { perFrameMax: number; perFrameLast: number; lastBytes: number; maxBytes: number; total: number; oversize: number; queued: number };
  failed: ChunkKey[];
  unavailable: number;
  sim: { unavailable: number; failed: number; ready: number; reason: string };
  masks: Record<string, number>;
  objects: number;
  triangles: number;
  frame: number;
}

export interface BootReport {
  revealed: boolean;
  revealMs: number | null;
  /** Bytes downloaded (network) from the start of the world boot to the reveal. */
  bytesBeforeReveal: number | null;
  tier: QualityTierId;
}

/** L0 chunks this close to the focus upload before anything coarse (about the first ring of chunks). */
const NEAR_L0_M = 400;

const mapFail = (e: unknown): FailReason => {
  const err = e as { name?: string; reason?: string } | null;
  if (err?.name === 'DecodeError') return 'decode';
  if (err?.name === 'PackUnavailable') {
    switch (err.reason) {
      case 'offline': return 'offline';
      case 'quota': return 'quota';
      case 'aborted': return 'aborted';
      case 'hash-mismatch': return 'corrupt';
      default: return 'unavailable';
    }
  }
  return 'unavailable';
};

const TELEMETRY_EVERY_MS = 60_000;
const SETTLE_QUIET_FRAMES = 6;

export class WorldView implements WorldLayer {
  readonly plan: StreamingPlan;
  store!: ChunkStore<UnitMesh>;
  renderer!: ChunkRenderer;
  backdrop!: BackdropLayer;
  materials!: WorldMaterials;

  private readonly o: WorldViewOptions;
  private readonly sets: TileSets;
  private host: RendererHost | null = null;
  private lights: [HemisphereLight, DirectionalLight] | null = null;
  private frames = 0;
  private focusOverride: Focus | null = null;
  private lastFocus: Focus = { x: 0, z: 0, vx: 0, vz: 0 };
  private veil: HTMLElement | null = null;
  private redownload: HTMLElement | null = null;
  private offline: HTMLElement | null = null;
  private simStatus = { unavailable: 0, failed: 0, ready: 0, reason: 'ok' };
  private revealed = false;
  private revealMs: number | null = null;
  private startMs = 0;
  private bytesAtStart = 0;
  private bytesBeforeReveal: number | null = null;
  private commitMs: number[] = [];
  private lastTelemetry = 0;
  private bytesAtTelemetry = 0;
  private missAtTelemetry = 0;
  private disposed = false;
  private inflight = 0;

  constructor(o: WorldViewOptions) {
    this.o = o;
    this.plan = basePlan(o.tier);
    this.sets = tileSets(o.index);
  }

  private now(): number {
    return (this.o.now ?? (() => performance.now()))();
  }

  // ---- WorldLayer --------------------------------------------------------------------------------------------------------

  attach(host: RendererHost): void {
    this.host = host;
    this.startMs = this.now();
    if (this.o.bytesBase !== undefined) this.bytesAtStart = this.o.bytesBase;
    else void this.o.assets.stats().then((s) => void (this.bytesAtStart = s.bytes)).catch(() => undefined);

    const fade = STREAMING_FADE_SECONDS[this.o.tier];
    this.materials = createWorldMaterials({ fadeSeconds: fade });
    // The world pass draws over the backdrop pass: no scene background of its own.
    host.scene.background = null;
    const hemi = new HemisphereLight(0xdbe9ff, 0x6a6f64, 3.4);
    const sun = new DirectionalLight(0xfff1d6, 2.8);
    sun.position.set(120, 220, 80);
    host.scene.add(hemi, sun);
    this.lights = [hemi, sun];

    const tierBudget = host.tier?.budget.world;
    this.renderer = new ChunkRenderer({
      parent: host.scene,
      materials: this.materials,
      uploadBytes: tierBudget?.maxChunkUploadBytes ?? this.plan.uploadBytes,
      fadeSeconds: fade,
    });
    host.register(this.renderer);

    this.store = new ChunkStore<UnitMesh>({
      levels: ['l0', 'l1', 'l2'],
      tier: this.o.tier,
      exists: (level, key) => unitExists(this.sets, level, key),
      request: (r) => this.requestMesh(r),
      evicted: (level, key) => this.renderer.drop(level as RenderLevel, key),
      now: () => this.now(),
      retry: { firstDelay: STREAMING.retry.firstMs, maxDelay: STREAMING.retry.maxMs, maxAttempts: STREAMING.retry.maxAttempts },
      // The 16 chunks of an l0 tile come from one pack: they are down and back together.
      packOf: (level, key) => packRefOf(key, level as 'l0' | 'l1' | 'l2'),
    });

    this.backdrop = new BackdropLayer({ tier: this.o.tier, jobs: this.o.assets, flags: this.o.flags, spawn: this.o.spawn });
    host.backdrop = { scene: this.backdrop.scene, camera: this.backdrop.camera };
    void this.backdrop.load().catch((e: unknown) => console.warn('world backdrop failed to load', e));

    this.makeOverlays();
    this.lastFocus = { x: this.o.spawn.x, z: this.o.spawn.z, vx: 0, vz: 0 };
    // The first pass runs before the first frame so the spawn tile is already on its way.
    this.store.want(this.lastFocus);
  }

  private readonly frustum = new Frustum();
  private readonly viewProj = new Matrix4();

  /** The draw camera's view frustum, or null before the host exists. */
  private frustumOf(): Frustum | null {
    const cam = this.host?.camera as PerspectiveCamera | undefined;
    if (!cam) return null;
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    return this.frustum.setFromProjectionMatrix(this.viewProj);
  }

  frame(f: WorldFrame): void {
    if (this.disposed) return;
    this.frames++;
    const tSec = f.nowMs / 1000;
    const camDist = f.player ? Math.hypot(f.camera.pos[0] - f.player.pos[0], f.camera.pos[2] - f.player.pos[2]) : 0;
    let focus: Focus;
    if (this.focusOverride) focus = this.focusOverride;
    else if (f.player && camDist < 80) focus = { x: f.player.pos[0], z: f.player.pos[2], vx: f.player.vel[0], vz: f.player.vel[2] };
    else if (f.player) focus = { x: f.camera.pos[0], z: f.camera.pos[2], vx: 0, vz: 0 };
    else focus = this.lastFocus;
    this.lastFocus = focus;

    if (this.frames === 1 || this.frames % 4 === 0) {
      const ground = this.groundY(f.camera.pos[0], f.camera.pos[2]);
      this.store.want(focus, ground === null ? 0 : Math.max(0, f.camera.pos[1] - ground));
    }
    const t0 = this.now();
    const up = this.renderer.update(tSec, { pos: f.camera.pos, dir: f.camera.dir, frustum: this.frustumOf() });
    if (up) {
      this.commitMs.push(this.now() - t0);
      if (this.commitMs.length > 240) this.commitMs.shift();
      if (!this.revealed && up.level === 'l0') this.reveal();
    }
    if (this.frames % 30 === 0) this.remeshFiltered();
    if (this.host) this.backdrop.sync(this.host.camera as PerspectiveCamera);
    this.updateOverlays();
    this.telemetry();
  }

  onSimEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.t === 'world.status') this.simStatus = { unavailable: e.n ?? 0, failed: e.a ?? 0, ready: e.b ?? 0, reason: e.s ?? 'ok' };
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer?.dispose();
    this.backdrop?.dispose();
    this.materials?.dispose();
    if (this.host) {
      this.host.backdrop = null;
      if (this.lights) this.host.scene.remove(...this.lights);
    }
    this.veil?.remove();
    this.redownload?.remove();
    this.offline?.remove();
  }

  // ---- streaming ---------------------------------------------------------------------------------------------------------

  private requestMesh(r: LoadRequest): void {
    const level = r.level as RenderLevel;
    const key = r.key;
    const args: MeshJobArgs = {
      level,
      key,
      tier: this.o.tier,
      distM: this.store ? this.store.distanceTo(key) : 0,
      priority: r.priority,
    };
    this.inflight++;
    void this.o.assets
      .job('world.mesh', args)
      .then((res) => {
        const result = res as MeshJobResult;
        if ('empty' in result) {
          this.store.settle(level, key, { ok: true, empty: true });
          return;
        }
        this.store.settle(level, key, { ok: true, payload: result.mesh });
        if (this.store.ready(key, level) && !this.disposed) this.renderer.enqueue(result.mesh, this.priorityOf(key, level));
      })
      .catch((e: unknown) => this.store.settle(level, key, { ok: false, reason: mapFail(e) }))
      .finally(() => void this.inflight--);
  }

  /**
   * The upload rank of a unit now: lower is more urgent. The chunks around the player come first (the reveal waits for one), then
   * the coarse levels, so the horizon is whole before the detail fills in, and then the rest of L0 nearest first. A plain distance
   * ordering starves L1 and L2 behind a few hundred L0 chunks when uploads are slow (software GL, a loaded phone).
   */
  private priorityOf(key: ChunkKey, level: Level): number {
    const d = this.store.distanceTo(key);
    if (level === 'l0') return d <= NEAR_L0_M ? d : 3000 + d;
    return level === 'l2' ? 1000 + d / 100 : 2000 + d / 10;
  }

  /** A chunk that was meshed from afar (the profile's skip rule) and now lies within reach gets its small buildings. */
  private remeshFiltered(): void {
    const skip = profileOf(this.o.tier).profile.skip;
    if (!skip) return;
    for (const key of this.store.residentKeys('l0')) {
      const u = this.store.unit('l0', key);
      const mesh = u?.payload;
      if (!mesh || !mesh.stats.filtered) continue;
      if (this.store.distanceTo(key) > skip.beyondM * 0.8) continue;
      // Mark it handled first so one pass requests it once.
      mesh.stats.filtered = false;
      const args: MeshJobArgs = { level: 'l0', key, tier: this.o.tier, distM: this.store.distanceTo(key), priority: 'soon' };
      void this.o.assets
        .job('world.mesh', args)
        .then((res) => {
          const result = res as MeshJobResult;
          if ('mesh' in result && this.store.ready(key, 'l0') && !this.disposed) this.renderer.enqueue(result.mesh, this.priorityOf(key, 'l0'));
        })
        .catch(() => undefined);
    }
  }

  // ---- ground height for the camera ----------------------------------------------------------------------------------------

  /** Terrain height under (x, z) from the uploaded L0 terrain mesh (bilinear on its grid), else the L1 one; null before any. */
  groundY(x: number, z: number): number | null {
    const cx = Math.floor((x - GRID_MIN_M) / CHUNK_EDGE_M[9]);
    const cy = Math.floor((z - GRID_MIN_M) / CHUNK_EDGE_M[9]);
    const u = this.store?.unit('l0', `9/${cx}/${cy}` as ChunkKey);
    const mesh = u?.state === 'ready' ? u.payload : null;
    if (!mesh) return null;
    const t = mesh.objects.find((o) => o.kind === 'terrain');
    if (!t) return null;
    const verts = Math.round(Math.sqrt(t.positions.length / 3));
    const step = CHUNK_EDGE_M[9] / (verts - 1);
    const fx = Math.min(verts - 1.000001, Math.max(0, (x - mesh.originX) / step));
    const fz = Math.min(verts - 1.000001, Math.max(0, (z - mesh.originZ) / step));
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h = (a: number, b: number): number => t.positions[(b * verts + a) * 3 + 1] as number;
    const n0 = h(i, j) + (h(i + 1, j) - h(i, j)) * tx;
    const n1 = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * tx;
    return n0 + (n1 - n0) * tz;
  }

  // ---- reveal and overlays -------------------------------------------------------------------------------------------------

  private reveal(): void {
    this.revealed = true;
    this.revealMs = this.now() - this.startMs;
    void this.o.assets.stats().then((s) => void (this.bytesBeforeReveal = Math.max(0, s.bytes - this.bytesAtStart))).catch(() => undefined);
    if (this.veil) {
      this.veil.style.opacity = '0';
      setTimeout(() => this.veil?.remove(), 700);
    }
    document.documentElement.dataset.dvWorld = 'revealed';
  }

  private makeOverlays(): void {
    const doc = this.o.container.ownerDocument;
    const mk = (id: string, testid: string, text: string, extra: string): HTMLElement => {
      const el = doc.createElement('div');
      el.id = id;
      el.dataset['testid'] = testid;
      el.setAttribute('role', 'status');
      el.textContent = text;
      el.style.cssText = `position:fixed;z-index:50;pointer-events:none;font:600 14px system-ui,sans-serif;color:#fff;${extra}`;
      el.style.display = 'none';
      this.o.container.append(el);
      return el;
    };
    this.veil = doc.createElement('div');
    this.veil.id = 'dv-world-veil';
    this.veil.dataset['testid'] = 'world-veil';
    this.veil.style.cssText = 'position:fixed;inset:0;z-index:40;background:#0b0e14;opacity:1;transition:opacity .5s ease;pointer-events:none';
    this.o.container.append(this.veil);
    this.redownload = mk('dv-world-redownload', 'world-redownload', this.o.labels.redownload, 'left:50%;top:16px;transform:translateX(-50%);padding:8px 14px;border-radius:8px;background:rgba(20,24,32,.88)');
    this.offline = mk('dv-world-offline', 'world-offline', this.o.labels.offline, 'inset:0;display:flex;align-items:center;justify-content:center;background:#0b0e14;pointer-events:auto;font-size:18px;text-align:center;padding:24px');
  }

  private updateOverlays(): void {
    const renderUnavailable = this.store.unavailable().length;
    const simUnavailable = this.simStatus.unavailable;
    const any = renderUnavailable + simUnavailable > 0;
    // The session is blocked when the ground under the spawn cannot be had and the device is offline.
    const blocked = simUnavailable > 0 && this.simStatus.ready === 0 && this.simStatus.reason === 'offline';
    if (this.redownload) this.redownload.style.display = !any || blocked ? 'none' : 'block';
    if (this.offline) this.offline.style.display = blocked ? 'flex' : 'none';
  }

  // ---- telemetry -----------------------------------------------------------------------------------------------------------

  private telemetry(): void {
    if (!this.o.emit) return;
    const now = this.now();
    if (this.lastTelemetry === 0) {
      this.lastTelemetry = now;
      return;
    }
    if (now - this.lastTelemetry < TELEMETRY_EVERY_MS) return;
    this.lastTelemetry = now;
    const s = [...this.commitMs].sort((a, b) => a - b);
    const p95 = s.length ? (s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] as number) : 0;
    const miss = this.store.stats.retries + this.store.stats.failures;
    void this.o.assets
      .stats()
      .then((st) => {
        const bytes = st.bytes - this.bytesAtTelemetry;
        this.bytesAtTelemetry = st.bytes;
        const missDelta = miss - this.missAtTelemetry;
        this.missAtTelemetry = miss;
        this.o.emit?.('world.stream', {
          residentL0: this.renderer.uploadedKeys('l0').length,
          missCount: missDelta,
          uploadP95Ms: Math.round(p95 * 100) / 100,
          bytesMB: Math.round((bytes / 1_000_000) * 100) / 100,
        });
      })
      .catch(() => undefined);
  }

  // ---- QA bridge and the perf driver ---------------------------------------------------------------------------------------

  chunks(): ChunksReport {
    const r = this.renderer;
    const masks: Record<string, number> = {};
    for (const u of r.units.values()) if (u.level !== 'l0') masks[`${u.level}:${u.key}`] = u.mask;
    const t = r.totals();
    return {
      resident: { l0: r.uploadedKeys('l0'), l1: r.uploadedKeys('l1'), l2: r.uploadedKeys('l2') },
      meshed: { l0: this.store.residentKeys('l0').length, l1: this.store.residentKeys('l1').length, l2: this.store.residentKeys('l2').length },
      empty: { l0: this.store.emptyKeys('l0'), l1: this.store.emptyKeys('l1'), l2: this.store.emptyKeys('l2') },
      bundleRerecords: r.bundleRerecords(),
      uploads: {
        perFrameMax: r.maxUploadsInFrame,
        perFrameLast: r.uploadsThisFrame,
        lastBytes: r.lastUploadBytes,
        maxBytes: r.gate.stats.maxBytes,
        total: r.totalUploads,
        oversize: r.gate.stats.oversize,
        queued: r.gate.size,
      },
      failed: this.store.failed(),
      unavailable: this.store.unavailable().length,
      sim: { ...this.simStatus },
      masks,
      objects: t.objects,
      triangles: t.triangles,
      frame: this.frames,
    };
  }

  backdropInfo(): BackdropInfo {
    return this.backdrop.info();
  }

  bootReport(): BootReport {
    return { revealed: this.revealed, revealMs: this.revealMs, bytesBeforeReveal: this.bytesBeforeReveal, tier: this.o.tier };
  }

  /** The units the current focus and plan want at a level (the ring test of @world-route). */
  wanted(level: Level): ChunkKey[] {
    return rankUnits(LEVEL_Z[level], this.lastFocus, level === 'l0' ? this.store.plan.r0M : level === 'l1' ? this.store.plan.r1M : level === 'l2' ? this.store.plan.r2M : this.store.plan.ambientM, {
      exists: (k) => unitExists(this.sets, level, k),
      firstRing: false,
    }).map((r) => r.key);
  }

  /** QA: stream around this point instead of the player (camera-driven tests and the perf driver). */
  setFocus(f: Focus | null): void {
    this.focusOverride = f;
    if (f) this.lastFocus = f;
  }

  /** Resolves when nothing is requested, queued or rebuilding for a few frames in a row, or the timeout passes. */
  settle(timeoutMs = 30_000): Promise<{ settled: boolean; pending: number; queued: number }> {
    return new Promise((resolve) => {
      const t0 = this.now();
      let quiet = 0;
      let lastFrame = this.frames;
      const poll = (): void => {
        const idle = this.store.pending() === 0 && this.renderer.gate.size === 0 && this.renderer.rebuilding === 0 && this.inflight === 0;
        if (this.frames !== lastFrame) {
          lastFrame = this.frames;
          quiet = idle ? quiet + 1 : 0;
        }
        if (quiet >= SETTLE_QUIET_FRAMES) return resolve({ settled: true, pending: 0, queued: 0 });
        if (this.now() - t0 > timeoutMs) return resolve({ settled: false, pending: this.store.pending(), queued: this.renderer.gate.size });
        setTimeout(poll, 16);
      };
      poll();
    });
  }

  /** The route scenarios' world half (`PerfScenarioRunner`): the focus follows the camera the runner places. */
  scenarioDriver(): WorldScenarioDriver {
    return {
      prepare: async (start) => {
        this.setFocus({ x: start[0], z: start[1], vx: 0, vz: 0 });
        await this.settle(45_000);
      },
      frame: (pose) => {
        this.setFocus({ x: pose.x, z: pose.z, vx: pose.vx, vz: pose.vz });
        return { groundY: this.groundY(pose.x, pose.z) };
      },
      finish: () => {
        this.setFocus(null);
        return { coldDownloadMB: this.bytesBeforeReveal === null ? null : Math.round((this.bytesBeforeReveal / 1_000_000) * 100) / 100 };
      },
    };
  }
}

/** Fade-in seconds per tier: dithered over 0.5 s on the desktop tiers, a hard swap on `mobile-low` and Quest (02-world.md 5.3). */
export const STREAMING_FADE_SECONDS: Readonly<Record<QualityTierId, number>> = {
  'desktop-ultra': 0.5,
  desktop: 0.5,
  'xr-visionpro': 0.5,
  mobile: 0.5,
  'mobile-low': 0,
  'xr-quest': 0,
};

