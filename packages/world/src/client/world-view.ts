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
import type { WorldFrame, WorldLayer, WorldLayerDebug } from '@dv/engine/client/boot/world-layer';
import type { RendererHost } from '@dv/engine/platform/renderer-host';
import type { WorldScenarioDriver } from '@dv/engine/platform/perf';
import { CHUNK_EDGE_M, GRID_MIN_M, packRefOf, type ChunkKey, type QualityTierId, type RenderBackend, type WorldIndex } from '@dv/shared';
import type { PostLevel } from '@dv/engine/platform/post';
import { ChunkStore, LEVEL_Z, type FailReason, type Level, type LoadRequest } from '../sim/streaming/chunk-store.ts';
import { STREAMING, basePlan, type StreamingPlan } from '../sim/streaming/plan.ts';
import { rankUnits, type Focus } from '../sim/streaming/priority.ts';
import { tileSets, unitExists, type TileSets } from '../sim/streaming/boot.ts';
import { BackdropLayer, type BackdropInfo, type JobClient } from './backdrop/backdrop-layer.ts';
import { ChunkRenderer, type RenderLevel } from './chunks/chunk-renderer.ts';
import { createWorldMaterials, type WorldMaterials } from './chunks/materials.ts';
import { LandmarkLayer, type LandmarkSpot, type LandmarksReport, type PreparedRemesh } from './chunks/landmark-layer.ts';
import { mountLandmark } from './chunks/landmark-view.ts';
import { MESHER, profileOf, wantNearStride } from './chunks/mesher.ts';
import type { UnitMesh } from './chunks/mesh-types.ts';
import type { LandmarkJobArgs, LandmarkJobResult, MeshJobArgs, MeshJobResult } from './jobs.ts';
import { LOOK, LOOK_LAYERS, lookProfileFor, type LookLayer } from './look/config.ts';
import { LookView, markingsReportOf, type LookReport, type ShotCamera } from './look/look-view.ts';
import { lookShot, shotQuaternion, type LookShot } from './look/shots.ts';
// art-hook:textures begin (M10d0)
import { TEXTURES_FLAG } from './textures/config.ts';
import { SurfaceTextures, installSurfaceTextures, installedSurfaceTextures } from './textures/surface-textures.ts';
// art-hook:textures end
import { createSkyNodes, type SkyNodes } from './sky/nodes.ts';
import { SkyView, type LumaOptions, type LumaSample, type SkyInfo } from './sky/sky-view.ts';
import { TeleportFade } from './teleport-fade.ts';
import { trafficCap } from '../sim/traffic/density.ts';
import { TrafficRenderer, type TrafficInfo } from './traffic/instances.ts';
// art-hook:vehicles begin (M10d1)
import { art, type ArtLoader } from '@dv/engine/client/vehicle/art';
import { artMaterialFactory } from './traffic/materials.ts';
import { artVariantOf, type VehicleJobArgs, type VehicleJobResult } from './vehicles/vehicle-job.ts';
// art-hook:vehicles end
import { NEAR_PED_CAP, pedCap } from '../sim/peds/density.ts';
import { PedRenderer, type PedInfo } from './peds/instances.ts';
import { TransitRenderer, type TransitInfo } from './transit/render.ts';
import { MapLayer } from './map/layer.ts';
import type { AreaBannerPatch } from './map/banner.ts';

export interface WorldViewLabels {
  /** "Re-downloading district" overlay text. */
  redownload: string;
  /** Blocking message: the spawn tiles are missing and the device is offline. */
  offline: string;
}

export interface AssetsLike extends JobClient {
  stats(o?: { resetPeak?: boolean }): Promise<{ bytes: number; network: number; retries: number; waves?: number; inflightPeak?: number }>;
  /**
   * Network bytes downloaded as of the latest asset reply handled on this thread (`AssetClient.bytesSeen`), read synchronously at the
   * reveal. Absent: the reveal asks `stats()`, whose answer comes a worker round trip later and counts what arrived in between.
   */
  bytesSeen?(): number;
}

// art-hook:vehicles begin (M10d1)
export interface ArtReport {
  profile: string;
  families: string[];
  objects: number;
  refs: string[];
  materialKind: 'physical' | 'standard';
  loaded: number;
  pool: { variant: string; loaded: string[]; pending: string[]; failed: string[] };
  renderKeys: string[];
}
// art-hook:vehicles end

/** The ambient traffic as the perf scenarios drive it (QA builds): see `WorldView.trafficLink`. */
export interface TrafficLink {
  /** The point the traffic follows (and the sim's streaming wants), or null for the player. */
  focus(f: { x: number; z: number; vx: number; vz: number } | null): void;
  /** Density multiplier of the `traffic` kind, 0 to 1.5 (1 = the model's own). */
  density(mult: number): void;
  /** Agents alive and whether the initial fill is over; null if the sim did not answer. */
  probe(): Promise<{ agents: number; filled: boolean } | null>;
}

export interface WorldViewOptions {
  tier: QualityTierId;
  index: Pick<WorldIndex, 'bakeId' | 'tiles'>;
  assets: AssetsLike;
  /** `world.cards` and `world.massing` of config/platform-flags.json. */
  flags: { cards: boolean; massing: boolean };
  /** The sky (M02b2): `world.rain` and `world.atmosphere` of config/platform-flags.json; `enabled` false is the QA `?sky=0` comparison. Absent: rain on, atmosphere off, sky on. */
  sky?: { rain: boolean; atmosphere: boolean; enabled: boolean };
  /** The governor's `atmosphereLevel` at boot (the tier's ceiling when absent). */
  atmosphereLevel?: number;
  /** M02e: the look pass. Absent: the legacy materials only (the M02b1/M02b2 look). `enabled` is the `world.look` flag. */
  look?: { enabled: boolean; browser: string; backend: RenderBackend; postLevel: number };
  spawn: { x: number; z: number };
  /** The landmarks that have a model in the catalog (M02d1): the `LandmarkLayer` swaps their baked proxies for the glTF within the tier's swap distance. */
  landmarks?: readonly LandmarkSpot[];
  labels: WorldViewLabels;
  /** Where the overlays go. */
  container: HTMLElement;
  /** `stats().bytes` before the boot downloads started; the cold-download figure counts from here. */
  bytesBase?: number;
  /** M02f1: `performance.now()` when `prepareWorld` started; `BootReport.bootRevealMs` counts from here (the world index request is inside it). */
  bootStartMs?: number;
  /** M02f1: the `stats({ resetPeak: true })` answer taken at that start: requests and waves of the boot are the change since it. */
  statsBase?: { network: number; waves: number };
  /** Telemetry: `world.stream` once a minute (the platform samples 10 %). */
  emit?: (name: 'world.stream', props: { residentL0: number; missCount: number; uploadP95Ms: number; bytesMB: number }) => void;
  /** Epoch-free millisecond clock (`performance.now`). */
  now?: () => number;
  /** QA builds: the bridge and the focus override are live. */
  qa?: boolean;
  /** M02c2: the maps (HUD minimap, the neighbourhood banner and the full map of the phone). `false` leaves them out (the perf scenarios do not need them). */
  map?: boolean;
  /** M02c2: called for each neighbourhood banner (`nhood.<slug>`, at most once per 3 s); the app patches `hud.area`. */
  onArea?: (p: AreaBannerPatch) => void;
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

/** The held-camera rig of a look shot (`WorldView.shotRig`). */
export interface ShotRig {
  holdShot(id: string): LookShot;
  placeShot(id: string, groundY: number): void;
  /** Moves the held camera to another shot's x and z, keeping its height (M02h1). */
  shiftShot(id: string): void;
  releaseShot(): void;
  freezeClock(on: boolean): void;
  refreshEnvironment(): boolean;
  envBakes(): number;
  held(): boolean;
}

export interface BootReport {
  revealed: boolean;
  revealMs: number | null;
  /** Bytes downloaded (network) from the start of the world boot to the reveal. */
  bytesBeforeReveal: number | null;
  tier: QualityTierId;
  /** M02f1: from the start of `prepareWorld` (before the world index request) to the reveal; null until revealed or without a start time. */
  bootRevealMs: number | null;
  /** M02f1: network requests since the boot started; null until the stats answer after the reveal arrives. */
  requests: number | null;
  /** M02f1: the boot's body bytes; equals `bytesBeforeReveal`. */
  bytes: number | null;
  /** M02f1: busy periods of the fetch layer since the boot started (sequential round trips that nothing overlapped). */
  waves: number | null;
  /** M02f1: most requests in flight at once since the boot started. */
  inflightPeak: number | null;
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
  /** M02e: the look pass (post stack, shadows, physical sky); null in a view built without `look`. */
  lookView: LookView | null = null;
  /** M10d0: the tiled PBR surface textures of the ground; null in a view built without `look`. */
  textures: SurfaceTextures | null = null;
  /** The landmark models of the world (M02d1); null when the catalog holds none. */
  landmarks: LandmarkLayer | null = null;
  /** The sky of the world path (M02b2); set in `attach`. */
  sky: SkyView | null = null;
  /** The instanced ambient traffic (M03b1); set in `attach`. */
  traffic: TrafficRenderer | null = null;
  /** The instanced pedestrians (M03b2); set in `attach`. */
  peds: PedRenderer | null = null;
  /** Buses, trains, cable cars, ferries, airliners and station entrances (M03b2); set in `attach`. */
  transit: TransitRenderer | null = null;
  /** The teleport fade (M02c1): the veil the sim's `world.teleport` events drive. */
  readonly fade: TeleportFade;
  /** The maps of the world (M02c2): the HUD minimap, the banner and the full map; null when the view was built with `map: false`. */
  readonly map: MapLayer | null;
  /** The newest `world.boundary` event (M02c1) and how many arrived; the QA bridge reads them. */
  lastBoundary: { tick: number; s: string } | null = null;
  boundaryCount = 0;
  /** The newest map patch (`world.map`, M02c1): the blips and the GPS route; M02c2 draws them. */
  lastMap: { rev: number; blips: unknown[]; route: unknown } | null = null;
  readonly skyNodes: SkyNodes = createSkyNodes();
  /** QA hooks the debug panel's sky controls use (the engine's `WorldLayer.debug`). */
  readonly debug: WorldLayerDebug = {
    setRainOverride: (rain) => this.sky?.setRainOverride(rain),
    rainOverride: () => this.sky?.getRainOverride() ?? null,
    look: {
      available: () => this.lookView?.available ?? false,
      isOn: () => this.lookView?.on ?? false,
      setOn: (on) => this.setLook(on),
      nodes: () => this.lookView?.report().postNodes ?? [],
      markings: {
        available: () => this.materials?.markings.base != null,
        aaOn: () => this.materials?.markings.aaOn() ?? true,
        setAA: (on) => this.materials?.markings.setAA(on),
      },
    },
  };

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
  private readonly revealWaiters: (() => void)[] = [];
  private startMs = 0;
  private bytesAtStart = 0;
  private bytesBeforeReveal: number | null = null;
  private bootRevealMs: number | null = null;
  private bootFigures: { requests: number; waves: number; inflightPeak: number } | null = null;
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
    this.fade = new TeleportFade(o.container);
    this.map = o.map === false ? null : new MapLayer({
      assets: o.assets, tier: o.tier, doc: o.container.ownerDocument ?? null, ...(o.onArea ? { onArea: o.onArea } : {}), now: () => this.now(),
    });
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
    const profile = this.o.look ? lookProfileFor(this.o.tier, this.o.look.enabled) : 'legacy';
    // art-hook:textures begin (M10d0): built before the materials, which read it; the files load after the reveal (`startTextures`)
    if (this.o.look) {
      const off = this.o.qa === true && new URLSearchParams(globalThis.location?.search ?? '').get('textures') === '0';
      this.textures = new SurfaceTextures({ tier: this.o.tier, profile, enabled: TEXTURES_FLAG && !off, backend: this.o.look.backend, browser: this.o.look.browser });
      installSurfaceTextures(this.textures);
      host.register({
        onRendererReplaced: () => {
          this.textures?.onRendererReplaced(this.o.assets, () => (host.ready ? host.renderer : null));
          return Promise.resolve();
        },
      });
    }
    // art-hook:textures end
    // M02h1: an XR tier (the look profile `legacy` in look.json) keeps the legacy materials and draws the flat street paint on its roads
    const xrMarkings = this.o.look?.enabled === true && lookProfileFor(this.o.tier, true) === 'legacy';
    this.materials = createWorldMaterials({ fadeSeconds: fade, sky: this.skyNodes, look: { profile, config: LOOK }, depthPolicy: host.depthPolicy, xrMarkings });
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
      treeDrawM: MESHER.tree.drawM[profileOf(this.o.tier).id],
      treeHysteresis: MESHER.tree.drawHysteresis,
    });
    host.register(this.renderer);
    // A renderer replaced after a device loss may have the other depth buffer: the polygon offsets follow it (M02g2).
    host.register({
      onRendererReplaced: () => {
        this.materials.setDepthPolicy(host.depthPolicy);
        return Promise.resolve();
      },
    });

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

    const spots = this.o.landmarks ?? [];
    if (spots.length > 0) {
      this.landmarks = new LandmarkLayer({
        tier: this.o.tier,
        spots,
        load: async (spot, opts) => {
          const args: LandmarkJobArgs = { asset: spot.asset, tier: this.o.tier, ...(opts.skyline ? { skyline: true } : {}) };
          return ((await this.o.assets.job('world.landmark', args)) as LandmarkJobResult).model;
        },
        mount: (spot, model, y, nowSec) => mountLandmark(host.scene, this.materials, spot, model, y, nowSec),
        chunks: {
          states: () => this.landmarkChunkStates(),
          prepare: (key, mask) => this.prepareChunk(key, mask),
          apply: (p) => this.applyPrepared(p),
          remesh: (key, mask) => this.remeshChunk(key, mask),
          rerecords: (key) => this.renderer.rerecordsOf('l0', key),
        },
        // The commit takes one upload slot, like a chunk: the gate never lets two through in a frame.
        queue: (task) => this.renderer.enqueueTask(task.id, task.priority, task.bytes, { run: (info) => task.run(info) }),
        groundY: (x, z, exact) => (exact ? this.groundY(x, z) : (this.groundY(x, z) ?? this.coarseGroundY(x, z))),
        waterY: MESHER.lod.waterLevelM,
        now: () => this.now(),
        // The skyline: the tier's building draw distance (the streaming r2), once the world is revealed (after the spawn p0 set).
        skylineRangeM: this.plan.r2M,
        ready: () => this.revealed,
        frameNo: () => this.frames,
        ...(this.o.qa ? { qa: true } : {}),
      });
    }

    this.backdrop = new BackdropLayer({ tier: this.o.tier, jobs: this.o.assets, flags: this.o.flags, spawn: this.o.spawn });
    host.backdrop = { scene: this.backdrop.scene, camera: this.backdrop.camera };
    // The look pass (M02e) starts before the sky: the dome of the `full` profile is blended over the physical sky it builds.
    if (this.o.look && profile !== 'legacy') {
      const look = new LookView({
        host,
        tier: this.o.tier,
        look: LOOK,
        profile,
        materials: this.materials,
        chunks: this.renderer,
        lights: { hemi: this.lights[0], sun: this.lights[1] },
        backdrop: this.backdrop,
        browser: this.o.look.browser,
        backend: this.o.look.backend,
        postLevel: this.o.look.postLevel as PostLevel,
        focus: () => ({ x: this.lastFocus.x, z: this.lastFocus.z }),
        freezeSkyTime: (on) => this.sky?.freezeTime(on),
        fog: this.skyNodes.look,
        traffic: () => this.traffic,
        blobCap: (host.tier?.budget.crowd.maxTrafficInstances ?? trafficCap(this.o.tier)) + (host.tier?.budget.crowd.maxPedInstances ?? pedCap(this.o.tier)) + 16,
      });
      this.lookView = look;
      look.start();
      host.register({
        onRendererReplaced: (next) => {
          look.onRendererReplaced(next);
          return Promise.resolve();
        },
      });
    }
    const lookView = this.lookView;
    this.sky = new SkyView({
      host,
      nodes: this.skyNodes,
      tier: this.o.tier,
      ...(this.o.atmosphereLevel !== undefined ? { atmosphereLevel: this.o.atmosphereLevel } : {}),
      lights: { hemi: this.lights[0], sun: this.lights[1] },
      backdrop: { scene: this.backdrop.scene, camera: this.backdrop.camera, hemi: this.backdrop.lights[0], sun: this.backdrop.lights[1] },
      flags: { rain: this.o.sky?.rain ?? true, atmosphere: this.o.sky?.atmosphere ?? false },
      lamps: () => this.collectLamps(),
      disabled: this.o.sky?.enabled === false,
      now: () => this.now(),
      ...(lookView
        ? {
            look: {
              domeBlend: lookView.domeBlend,
              after: (u, input, nowMs) => lookView.after(u, input, nowMs),
              pinClouds: () => lookView.sky?.pinClouds() ?? (() => {}),
            },
          }
        : {}),
    });
    // The backdrop's render programs compile as soon as it has its objects, in every direction (DL-715): a mission beat that cuts to a
    // shot facing another way would otherwise link them on its first frame (the skyline cards on chromium-webgl2).
    void this.backdrop
      .load()
      .then(() => host.warm())
      .catch((e: unknown) => console.warn('world backdrop failed to load', e));

    // art-hook:vehicles begin (M10d1): the vehicle and prop models load through asset.worker; the traffic and the object pool draw them.
    // The QA switch `?art=0` keeps the gray-box stand-ins (one legacy family, no model requests): the baseline of the M10d1 ledger.
    const artOff = this.o.qa === true && new URLSearchParams(globalThis.location?.search ?? '').get('art') === '0';
    const artProfile = this.o.look && !artOff ? lookProfileFor(this.o.tier, this.o.look.enabled) : 'legacy';
    const artLoader: ArtLoader | undefined = artOff
      ? undefined
      : async (ref, variant) => {
          const r = (await this.o.assets.job('world.vehicle', { ref, variant } satisfies VehicleJobArgs)) as VehicleJobResult;
          return 'model' in r ? r.model : null;
        };
    art.configure({ loader: artLoader ?? null, profile: artProfile, variant: artVariantOf(this.o.tier), factory: artMaterialFactory(artProfile, this.skyNodes) });
    this.traffic = new TrafficRenderer({
      parent: host.scene, sky: this.skyNodes, cap: host.tier?.budget.crowd.maxTrafficInstances ?? trafficCap(this.o.tier), profile: artProfile, ...(artLoader ? { load: artLoader } : {}),
    });
    // art-hook:vehicles end
    this.peds = new PedRenderer({ parent: host.scene, cap: host.tier?.budget.crowd.maxPedInstances ?? pedCap(this.o.tier), nearCap: NEAR_PED_CAP[this.o.tier] });
    this.transit = new TransitRenderer({
      parent: host.scene,
      trafficCap: host.tier?.budget.crowd.maxTrafficInstances ?? trafficCap(this.o.tier),
      carsDrawn: () => this.traffic?.instances ?? 0,
      ...(artLoader ? { load: artLoader, sky: this.skyNodes, profile: artProfile, variant: artVariantOf(this.o.tier) } : {}), // art-hook:vehicles (M10d1)
    });
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

  frame(frameIn: WorldFrame): void {
    if (this.disposed) return;
    this.frames++;
    let f = frameIn;
    const held = this.lookView?.shotCamera ?? this.legacyHeld;
    if (held && this.host) {
      // A look shot holds the camera: the host's camera, the culling and the sky all see the shot's pose.
      const cam = this.host.camera as PerspectiveCamera;
      cam.position.set(held.x, held.y, held.z);
      cam.quaternion.set(held.quat[0], held.quat[1], held.quat[2], held.quat[3]);
      if (cam.fov !== held.fovDeg) {
        cam.fov = held.fovDeg;
        cam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements;
      f = { ...frameIn, camera: { pos: [held.x, held.y, held.z], dir: [-(e[8] as number), -(e[9] as number), -(e[10] as number)] } };
    }
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
      const ms = this.now() - t0;
      this.commitMs.push(ms);
      if (this.commitMs.length > 240) this.commitMs.shift();
      if (up.level === 'l0') this.landmarks?.onChunkCommitted(up.key, ms, this.renderer.uploadsThisFrame);
      if (!this.revealed && up.level === 'l0') this.reveal();
    }
    this.landmarks?.update(focus, tSec);
    if (this.frames % 30 === 0) {
      this.remeshFiltered();
      this.remeshNear();
    }
    if (this.host) this.backdrop.sync(this.host.camera as PerspectiveCamera);
    this.sky?.update(f);
    this.traffic?.update(f, tSec);
    this.lastPoseKeys = f.poseKeys ?? null; // art-hook:vehicles (M10d1)
    if (this.lookView && this.host) this.lookView.frame(f.dtSec, this.host.camera as PerspectiveCamera);
    this.peds?.update(f, tSec);
    // M02g1: the blob shadows follow the poses the traffic, the pedestrians and the object pool just drew.
    this.lookView?.feedBlobs(f);
    this.transit?.update(f);
    this.updateOverlays();
    this.map?.frame(f);
    this.telemetry();
  }

  onSimEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.t === 'world.status') this.simStatus = { unavailable: e.n ?? 0, failed: e.a ?? 0, ready: e.b ?? 0, reason: e.s ?? 'ok' };
      else if (e.t === 'world.teleport') {
        if (e.s === 'out') this.fade.out();
        else if (e.s === 'in') this.fade.in();
      } else if (e.t === 'world.boundary') {
        this.lastBoundary = { tick: e.tick, s: e.s ?? '' };
        this.boundaryCount++;
      } else if (e.t === 'world.map' && e.s) {
        try {
          this.lastMap = JSON.parse(e.s) as NonNullable<WorldView['lastMap']>;
          this.map?.setPatch(this.lastMap);
        } catch {
          // a damaged patch is dropped; the next one replaces it
        }
      }
    }
  }

  /** The governor moved `atmosphereLevel` (C13 `DynamicQuality`): the sky follows. */
  setAtmosphereLevel(level: number): void {
    this.sky?.setAtmosphereLevel(level);
  }

  /** World positions (x, y, z triples) of the street lamps of the resident L0 chunks. */
  private collectLamps(): Float32Array {
    if (!this.store) return new Float32Array(0);
    const parts: Float32Array[] = [];
    let total = 0;
    for (const key of this.store.residentKeys('l0')) {
      const mesh = this.store.unit('l0', key)?.payload;
      if (!mesh || mesh.lamps.length === 0) continue;
      const out = new Float32Array(mesh.lamps.length);
      for (let i = 0; i < mesh.lamps.length; i += 3) {
        out[i] = mesh.originX + (mesh.lamps[i] as number);
        out[i + 1] = mesh.lamps[i + 1] as number;
        out[i + 2] = mesh.originZ + (mesh.lamps[i + 2] as number);
      }
      parts.push(out);
      total += out.length;
    }
    const all = new Float32Array(total);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return all;
  }

  skyInfo(): SkyInfo | null {
    return this.sky?.info() ?? null;
  }

  sampleLuma(pitchDeg: number, yawDeg?: number, opts?: LumaOptions): Promise<LumaSample> {
    if (!this.sky) return Promise.reject(new Error('the sky is not mounted'));
    return this.sky.sampleLuma(pitchDeg, yawDeg, opts);
  }

  dispose(): void {
    this.disposed = true;
    this.lookView?.dispose();
    this.lookView = null;
    // art-hook:textures begin (M10d0)
    if (installedSurfaceTextures() === this.textures) installSurfaceTextures(null);
    this.textures?.dispose();
    this.textures = null;
    // art-hook:textures end
    this.sky?.dispose();
    this.sky = null;
    this.traffic?.dispose();
    this.traffic = null;
    art.reset(); // art-hook:vehicles (M10d1)
    this.peds?.dispose();
    this.peds = null;
    this.transit?.dispose();
    this.transit = null;
    this.landmarks?.dispose();
    this.landmarks = null;
    this.renderer?.dispose();
    this.backdrop?.dispose();
    this.materials?.dispose();
    if (this.host) {
      this.host.backdrop = null;
      if (this.lights) this.host.scene.remove(...this.lights);
    }
    this.map?.dispose();
    this.fade.dispose();
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
      // A chunk that streams in while a landmark model stands in its proxies' place arrives without them (no second upload, no overlap).
      ...(level === 'l0' && this.landmarks && this.landmarks.maskList().length > 0 ? { maskProxies: this.landmarks.maskList() } : {}),
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
      const mask = this.landmarks?.maskFor(mesh.proxies) ?? [];
      const args: MeshJobArgs = { level: 'l0', key, tier: this.o.tier, distM: this.store.distanceTo(key), priority: 'soon', ...(mask.length > 0 ? { maskProxies: mask } : {}) };
      void this.o.assets
        .job('world.mesh', args)
        .then((res) => {
          const result = res as MeshJobResult;
          if ('mesh' in result && this.store.ready(key, 'l0') && !this.disposed) this.renderer.enqueue(result.mesh, this.priorityOf(key, 'l0'));
        })
        .catch(() => undefined);
    }
  }

  /**
   * M02g2: a profile with a finer terrain stride around the focus (`nearStride`): a resident L0 chunk that crossed the near ring is
   * meshed again, once, through asset.worker and the upload gate. A chunk enters the ring under `terrain.nearRingM` and leaves it over
   * `nearRingM x leaveFactor`, so one that hovers at the edge is not meshed back and forth; at most two requests per pass, nearest first.
   * The mesher decides the stride from the `distM` it is given, which is why the request carries the distance now.
   */
  private remeshNear(): void {
    const profile = profileOf(this.o.tier).profile;
    if (profile.nearStride >= profile.terrainStride) return;
    const due: { key: ChunkKey; d: number; mesh: UnitMesh; want: boolean }[] = [];
    for (const key of this.store.residentKeys('l0')) {
      const mesh = this.store.unit('l0', key)?.payload;
      if (!mesh || mesh.stats.near === undefined) continue;
      const d = this.store.distanceTo(key);
      const want = wantNearStride(mesh.stats.near, d);
      if (want !== mesh.stats.near) due.push({ key, d, mesh, want });
    }
    due.sort((a, b) => a.d - b.d);
    for (const { key, mesh, want } of due.slice(0, 2)) {
      // Marked first: one pass requests a chunk once; the result below records what the new mesh really is.
      mesh.stats.near = want;
      const mask = this.landmarks?.maskFor(mesh.proxies) ?? [];
      const args: MeshJobArgs = { level: 'l0', key, tier: this.o.tier, distM: this.store.distanceTo(key), priority: 'soon', ...(mask.length > 0 ? { maskProxies: mask } : {}) };
      void this.o.assets
        .job('world.mesh', args)
        .then((res) => {
          const result = res as MeshJobResult;
          if (!('mesh' in result) || !this.store.ready(key, 'l0') || this.disposed) return;
          mesh.stats.near = result.mesh.stats.near === true;
          this.renderer.enqueue(result.mesh, this.priorityOf(key, 'l0'));
        })
        .catch(() => undefined);
    }
  }

  // ---- landmarks (M02d1) ---------------------------------------------------------------------------------------------------

  /** The resident L0 chunks that hold landmark proxies, with the proxies their current mesh leaves out. */
  private landmarkChunkStates(): { key: ChunkKey; proxies: number[]; masked: number[] }[] {
    const out: { key: ChunkKey; proxies: number[]; masked: number[] }[] = [];
    for (const u of this.renderer.units.values()) if (u.level === 'l0' && u.mesh.proxies.length > 0) out.push({ key: u.key, proxies: u.mesh.proxies, masked: u.mesh.masked });
    return out;
  }

  /** Meshes an uploaded chunk again with `mask` (proxy ids) left out; the new mesh goes through the upload gate ahead of everything else. */
  private remeshChunk(key: ChunkKey, mask: number[]): void {
    const args: MeshJobArgs = { level: 'l0', key, tier: this.o.tier, distM: this.store ? this.store.distanceTo(key) : 0, priority: 'now', maskProxies: mask };
    this.inflight++;
    void this.o.assets
      .job('world.mesh', args)
      .then((res) => {
        const result = res as MeshJobResult;
        if ('mesh' in result && this.store.ready(key, 'l0') && !this.disposed) this.renderer.enqueue(result.mesh, -1);
      })
      .catch(() => undefined)
      .finally(() => void this.inflight--);
  }

  /**
   * The first half of a landmark swap (M02d2): the chunk is meshed again in `asset.worker` with `mask` left out and the mesh is held,
   * not uploaded. The layer queues it through the upload gate after the model it belongs to has joined the scene.
   */
  private prepareChunk(key: ChunkKey, mask: number[]): Promise<PreparedRemesh | null> {
    const args: MeshJobArgs = { level: 'l0', key, tier: this.o.tier, distM: this.store ? this.store.distanceTo(key) : 0, priority: 'now', maskProxies: mask };
    this.inflight++;
    return this.o.assets
      .job('world.mesh', args)
      .then((res): PreparedRemesh | null => {
        const result = res as MeshJobResult;
        return 'mesh' in result && !this.disposed ? ({ key, mask, mesh: result.mesh } as PreparedRemesh & { mesh: UnitMesh }) : null;
      })
      .catch(() => null)
      .finally(() => void this.inflight--);
  }

  /** The second half: the prepared mesh goes through the upload gate (one unit per frame, the model's own commit went first). */
  private applyPrepared(p: PreparedRemesh): void {
    const mesh = (p as PreparedRemesh & { mesh?: UnitMesh }).mesh;
    if (!mesh || this.disposed || !this.store.ready(p.key, 'l0')) return;
    this.renderer.enqueue(mesh, -1);
  }

  /** The instanced traffic's counts for the QA bridge (`__dvBridge.world.traffic()`); null before `attach`. */
  trafficReport(): TrafficInfo | null {
    return this.traffic?.info() ?? null;
  }

  // art-hook:vehicles begin (M10d1)
  /** The newest snapshot's render keys by record (set every frame, read only by `artReport`). */
  private lastPoseKeys: ReadonlyMap<number, string> | null = null;

  /**
   * The final vehicle and prop art for the QA bridge (`__dvBridge.world.art()`): the look profile, the traffic families and their base
   * models, the render objects of the traffic, the material class, the object pool's models (loaded, pending, failed) and the distinct
   * asset keys of the newest snapshot. Null before `attach`.
   */
  artReport(): ArtReport | null {
    const t = this.traffic;
    if (!t) return null;
    const info = t.info();
    const st = art.status();
    return {
      profile: t.profile,
      families: t.familyNames,
      objects: info.objects,
      refs: t.refs,
      materialKind: t.materialKind,
      loaded: info.loaded,
      pool: { variant: st.variant, loaded: st.loaded, pending: st.pending, failed: st.failed },
      renderKeys: this.lastPoseKeys ? [...new Set(this.lastPoseKeys.values())].sort() : [],
    };
  }
  // art-hook:vehicles end

  /** The instanced pedestrians' counts for the QA bridge (`__dvBridge.world.peds()`); null before `attach`. */
  pedsReport(): PedInfo | null {
    return this.peds?.info() ?? null;
  }

  /** Transit instances for the QA bridge (`__dvBridge.world.transit()`); null before `attach`. */
  transitReport(): TransitInfo | null {
    return this.transit?.info() ?? null;
  }

  /** The landmark layer's state for the QA bridge (`__dvBridge.world.landmarks()`); null when the world has no landmark models. */
  landmarksReport(): LandmarksReport | null {
    return this.landmarks?.report() ?? null;
  }

  /**
   * Terrain height under (x, z) from the coarse levels: the L1 tile (posts every 16 m or more), else the L2 block (64 m), sampled
   * bilinearly on the regular grid that starts each terrain object (the skirt vertices follow it). Null until one is up. A far
   * skyline landmark is placed with it before any L0 chunk is near, and moved to the exact height when the chunk arrives.
   */
  coarseGroundY(x: number, z: number): number | null {
    for (const [level, zoom] of [['l1', 7], ['l2', 5]] as const) {
      const edge = CHUNK_EDGE_M[zoom];
      const cx = Math.floor((x - GRID_MIN_M) / edge);
      const cy = Math.floor((z - GRID_MIN_M) / edge);
      const u = this.store?.unit(level, `${zoom}/${cx}/${cy}` as ChunkKey);
      const mesh = u?.state === 'ready' ? u.payload : null;
      const t = mesh?.objects.find((o) => o.kind === 'terrain');
      if (!mesh || !t) continue;
      // positions = verts x verts grid + 4 (verts - 1) skirt vertices
      const verts = Math.round(-2 + Math.sqrt(t.positions.length / 3 + 8));
      if (verts < 2) continue;
      const step = edge / (verts - 1);
      const fx = Math.min(verts - 1.000001, Math.max(0, (x - mesh.originX) / step));
      const fz = Math.min(verts - 1.000001, Math.max(0, (z - mesh.originZ) / step));
      const i = Math.floor(fx), j = Math.floor(fz);
      const tx = fx - i, tz = fz - j;
      const h = (a: number, b: number): number => t.positions[(b * verts + a) * 3 + 1] as number;
      const n0 = h(i, j) + (h(i + 1, j) - h(i, j)) * tx;
      const n1 = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * tx;
      return n0 + (n1 - n0) * tz;
    }
    return null;
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
    // Bytes before the reveal (M02b1 AC-8) are read in the same task as the reveal: the boot report never says `revealed` without them,
    // and they do not count what arrived while a `stats()` round trip waited behind the first frames' long tasks (BD-FIX-CI9-T01).
    const seen = this.o.assets.bytesSeen?.();
    if (seen !== undefined) this.bytesBeforeReveal = Math.max(0, seen - this.bytesAtStart);
    else void this.o.assets.stats().then((s) => void (this.bytesBeforeReveal = Math.max(0, s.bytes - this.bytesAtStart))).catch(() => undefined);
    if (this.veil) {
      this.veil.style.opacity = '0';
      setTimeout(() => this.veil?.remove(), 700);
    }
    document.documentElement.dataset.dvWorld = 'revealed';
    if (this.o.bootStartMs !== undefined) this.bootRevealMs = Math.max(1, Math.round(this.now() - this.o.bootStartMs));
    // art-hook:textures begin (M10d0): after the boot figures are read, so the textures add nothing to the boot's request counts
    void this.readBootFigures().finally(() => this.startTextures());
    // art-hook:textures end
    for (const w of this.revealWaiters.splice(0)) w();
  }

  private startTextures(): void {
    const host = this.host;
    if (!this.textures || !host || this.disposed) return;
    this.textures.start(this.o.assets, () => (host.ready ? host.renderer : null));
  }

  /**
   * M02f1: after the reveal, asks the asset worker for the request counts and writes the boot figures into `data-dv-boot` (every build:
   * tier and counts only, no ids, no positions). The answer arrives a round trip after the reveal; every consumer treats the figures as
   * bounds, so that skew changes none of them.
   */
  private async readBootFigures(): Promise<void> {
    const base = this.o.statsBase;
    if (!base || this.bootRevealMs === null) return;
    try {
      const s = await this.o.assets.stats();
      if (this.disposed) return;
      this.bootFigures = {
        requests: Math.max(0, s.network - base.network),
        waves: Math.max(0, (s.waves ?? base.waves) - base.waves),
        inflightPeak: s.inflightPeak ?? 0,
      };
      const bytes = this.bytesBeforeReveal ?? Math.max(0, s.bytes - this.bytesAtStart);
      if (this.bytesBeforeReveal === null) this.bytesBeforeReveal = bytes;
      document.documentElement.dataset['dvBoot'] = JSON.stringify({
        tier: this.o.tier,
        requests: this.bootFigures.requests,
        bytes,
        revealMs: this.bootRevealMs,
        waves: this.bootFigures.waves,
        inflightPeak: this.bootFigures.inflightPeak,
      });
    } catch {
      /* the figures stay null */
    }
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

  /** M02e: what the look pass is doing now (the bridge's `look()`). A view without a look reports `legacy`. */
  /**
   * QA only (M02e): stops (`true`) or restarts (`false`) the render loop. A stopped loop leaves the last presented frame on the canvas, so
   * a capture on a slow software renderer does not wait on new frames (an element screenshot waits for the canvas to stay still).
   */
  holdRender(on: boolean): void {
    if (!this.host) return;
    if (on) this.host.stopLoop();
    else this.host.startLoop();
  }

  /** M02h1 QA: the camera a shot holds on a tier without a look view (the XR tiers on the flat canvas). */
  private legacyHeld: ShotCamera | null = null;

  /**
   * The rig the bridge's `shot()` drives: the look view's when there is one; on a tier without a look view (the XR tiers, which still draw
   * the flat street paint) a held camera and the frozen sky clock, with no look clock and no environment bake. Null without a look config.
   */
  shotRig(): ShotRig | null {
    const lv = this.lookView;
    if (lv) {
      return {
        holdShot: (id) => lv.holdShot(id),
        placeShot: (id, gy) => lv.placeShot(id, gy),
        shiftShot: (id) => lv.shiftShot(id),
        releaseShot: () => lv.releaseShot(),
        freezeClock: (on) => lv.freezeClock(on),
        refreshEnvironment: () => lv.refreshEnvironment(),
        envBakes: () => lv.report().envBakes,
        held: () => lv.shotCamera !== null,
      };
    }
    if (!this.o.look || !this.host) return null;
    return {
      holdShot: (id) => {
        const s = lookShot(id);
        this.legacyHeld = { x: s.x, y: 40 + s.y, z: s.z, quat: shotQuaternion(s.yawDeg, s.pitchDeg), fovDeg: s.fovDeg };
        return s;
      },
      placeShot: (id, gy) => {
        if (this.legacyHeld) this.legacyHeld.y = gy + lookShot(id).y;
      },
      shiftShot: (id) => {
        const s = lookShot(id);
        if (this.legacyHeld) {
          this.legacyHeld.x = s.x;
          this.legacyHeld.z = s.z;
        }
      },
      releaseShot: () => void (this.legacyHeld = null),
      freezeClock: (on) => this.sky?.freezeTime(on),
      refreshEnvironment: () => false,
      envBakes: () => 0,
      held: () => this.legacyHeld !== null,
    };
  }

  lookReport(): LookReport | null {
    if (this.lookView) return this.lookView.report();
    if (!this.o.look || !this.host) return null;
    // A tier without a look (the XR tiers, or `world.look` off): the legacy materials, the tier's own pipeline, nothing else.
    return {
      profile: 'legacy', on: false, postNodes: [], postMode: 'none', postLevel: 0, shadowMode: 'none', shadowPath: 'off', shadowPasses: 0,
      casters: 0, casterKinds: [], exposure: this.host.ready ? this.host.renderer.toneMappingExposure : 1, envMap: false, sky: 'dome',
      windowEmissive: 0, backend: this.o.look.backend, tier: this.o.tier, fallbacks: [], envBakes: 0, envBakeMs: 0,
      pipeline: this.host.tier?.features.pipeline ?? 'direct', sun: null,
      layers: [], blobs: 0, dynamicCasters: [], skyReflect: false, gradeOn: null, windowLit: [0.55, 0.85],
      vegetation: this.renderer.vegetationReport(),
      markings: markingsReportOf(this.materials, this.renderer),
    };
  }

  /** M02e QA: the look on or off at runtime; false when the tier has none. */
  setLook(on: boolean): boolean {
    return this.lookView ? this.lookView.setOn(on) : !on;
  }

  /** M02g1 QA: one layer of the look's profile on or off; false when the profile has no such layer (or the look is off). */
  setLookLayer(id: string, on: boolean): boolean {
    // art-hook:textures begin (M10d0): the surface textures are a layer of the look that has no entry in look.json
    if (id === 'textures') return this.textures?.setOn(on) ?? false;
    // art-hook:textures end
    // M02h1: the debug toggle of the street paint's antialiasing, and the paint layer of a tier without a look view (the XR tiers)
    if (id === 'markings.aa') {
      if (this.materials.markings.base === null) return false;
      this.materials.markings.setAA(on);
      return true;
    }
    if (id === 'markings' && !this.lookView) return this.materials.markings.setLayer(on);
    if (!this.lookView || !(LOOK_LAYERS as readonly string[]).includes(id)) return false;
    return this.lookView.setLayer(id as LookLayer, on);
  }

  backdropInfo(): BackdropInfo {
    return this.backdrop.info();
  }

  /** Resolves once the world is revealed (the first L0 upload at the spawn); at once when it already is. */
  whenRevealed(): Promise<void> {
    if (this.revealed) return Promise.resolve();
    return new Promise((resolve) => this.revealWaiters.push(resolve));
  }

  bootReport(): BootReport {
    const f = this.bootFigures;
    return {
      revealed: this.revealed,
      revealMs: this.revealMs,
      bytesBeforeReveal: this.bytesBeforeReveal,
      tier: this.o.tier,
      bootRevealMs: this.bootRevealMs,
      requests: f?.requests ?? null,
      bytes: f ? this.bytesBeforeReveal : null,
      waves: f?.waves ?? null,
      inflightPeak: f?.inflightPeak ?? null,
    };
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
        const idle = this.store.pending() === 0 && this.renderer.gate.size === 0 && this.renderer.rebuilding === 0 && this.inflight === 0 && (this.landmarks?.idle ?? true);
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

  /**
   * QA/perf: the way into the sim's ambient traffic (set by the bridge, which owns the command channel to sim.worker): the point it
   * follows instead of the player, its density, and a probe of its fill. Null where there is no channel.
   */
  trafficLink: TrafficLink | null = null;

  /** The route scenarios' world half (`PerfScenarioRunner`): the focus follows the camera the runner places. */
  scenarioDriver(): WorldScenarioDriver {
    let frames = 0;
    return {
      prepare: async (start, opts) => {
        const link = this.trafficLink;
        const nominal = opts?.density === 'nominal';
        this.setFocus({ x: start[0], z: start[1], vx: 0, vz: 0 });
        link?.density(nominal ? 1 : 0);
        if (nominal) link?.focus({ x: start[0], z: start[1], vx: 0, vz: 0 });
        await this.settle(45_000);
        if (nominal && link) {
          // the sim streams the packs around the start itself; the traffic fills in once the roads there are resident
          const until = this.now() + 60_000;
          for (;;) {
            const p = await link.probe();
            if (p && p.agents > 0 && p.filled) break;
            if (this.now() > until) break;
            await new Promise<void>((r) => setTimeout(r, 100));
          }
        }
        frames = 0;
      },
      frame: (pose) => {
        this.setFocus({ x: pose.x, z: pose.z, vx: pose.vx, vz: pose.vz });
        // a command to the sim a few times a second is enough for a focus that moves at car speed
        if (this.trafficLink && frames++ % 8 === 0) this.trafficLink.focus({ x: pose.x, z: pose.z, vx: pose.vx, vz: pose.vz });
        return { groundY: this.groundY(pose.x, pose.z) };
      },
      finish: () => {
        this.setFocus(null);
        this.trafficLink?.focus(null);
        this.trafficLink?.density(1);
        const f = this.bootFigures;
        return {
          coldDownloadMB: this.bytesBeforeReveal === null ? null : Math.round((this.bytesBeforeReveal / 1_000_000) * 100) / 100,
          ...(f && this.bootRevealMs !== null && this.bytesBeforeReveal !== null
            ? { boot: { requests: f.requests, bytes: this.bytesBeforeReveal, revealMs: this.bootRevealMs, waves: f.waves, inflightPeak: f.inflightPeak } }
            : {}),
        };
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

