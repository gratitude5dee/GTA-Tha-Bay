import type { ChunkKey, QualityTierId, TeleportKind, TeleportResult, WeatherPreset } from '@dv/shared';
import type { Level } from '../sim/streaming/chunk-store.ts';
import type { StreamingPlan } from '../sim/streaming/plan.ts';
import type { BackdropInfo } from './backdrop/backdrop-layer.ts';
import type { LandmarksReport, LandmarkSwapEvent } from './chunks/landmark-layer.ts';
import type { LumaOptions, LumaSample, SkyInfo } from './sky/sky-view.ts';
import { mountWorldControls } from './world-controls.ts';
import type { BootReport, ChunksReport, WorldView } from './world-view.ts';
import type { TrafficInfo } from './traffic/instances.ts';

/**
 * `window.__dvBridge.world` (QA builds only; 02-world.md section 4, M02b1). Reachable only through a dynamic import behind
 * `import.meta.env.VITE_DV_QA === '1'`, so a production dist contains neither it nor the string "__dvBridge"
 * (apps/web/scripts/verify-dist.mjs). Results are JSON-friendly.
 */
export interface WorldBridge {
  /** Resident keys per level (uploaded), `bundleRerecords` per unit, upload cadence and bytes, failed tiles, cover masks. */
  chunks(): ChunksReport;
  /** The backdrop of the tier: ring and cards distance, massing, render objects, uploads at boot (R-MAP-02, AC-14). */
  backdrop(): BackdropInfo;
  /** Whether the world is revealed, when, and the bytes downloaded before the reveal (AC-8). */
  boot(): BootReport;
  /** The units the current focus and plan want at a level. */
  wanted(level: Level): ChunkKey[];
  plan(): StreamingPlan;
  tier(): QualityTierId;
  /** Streams around this point instead of the player; `clearFocus` returns to the player. */
  focus(x: number, z: number, vx?: number, vz?: number): void;
  clearFocus(): void;
  /** Resolves when nothing is requested, queued or rebuilding for a few frames in a row. */
  settle(timeoutMs?: number): Promise<{ settled: boolean; pending: number; queued: number }>;
  /** Terrain height under a point from the uploaded meshes; null where none is resident. */
  groundY(x: number, z: number): number | null;
  /** Drops the GPU copies as a device loss would and rebuilds them from the resident meshes (one unit per frame). */
  loseGpu(): Promise<void>;
  /** Memory pressure response of the stream (11-platform.md 5.6). */
  pressure(level: 'none' | 'soft' | 'hard'): void;
  /** Sets the hour of the game day (0..24) and, by default, freezes the clock there so a readback sees a fixed sky (M02b2). */
  setHour(h: number, freeze?: boolean): boolean;
  /** Blends to a weather preset over `blendSec` game seconds (0 is as fast as the sim takes it). */
  setWeather(w: WeatherPreset, blendSec?: number): boolean;
  /** Blackout on or off for the owner `debug`. */
  blackout(on: boolean): boolean;
  /** Freezes or releases the clock (and with it the weather schedule). */
  freeze(on: boolean): boolean;
  /** Forces rain streaks on (0..255) whatever the preset says; null returns to the preset. */
  rain(intensity: number | null): void;
  /** The sky of the last frame: the shared uniforms, the tier configuration, the wet level, the window factor, counts. Null without a sky. */
  sky(): SkyInfo | null;
  /** Renders the scene into a 128 x 72 target looking `pitchDeg` up along `yawDeg` and reads back the mean and variance of its luminance. */
  luma(pitchDeg: number, yawDeg?: number, opts?: LumaOptions): Promise<LumaSample>;
  /**
   * The world services of the sim (M02c1): one call into `WorldApi` inside sim.worker, answered as JSON. `op` is one of `teleport`,
   * `route`, `resolve`, `snap`, `find`, `pois`, `pedRoute`, `query`, `portals`, `portal`, `release`, `closeEdges`, `density`,
   * `shore`, `waterWall`, `map`, `state`, `candidates` (packages/world/src/sim/api/debug.ts). Resolves null after `timeoutMs`.
   */
  call(op: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  /** Teleports the player (kind `debug`) to a landmark id (`lm.coit-tower`), a transit node id, or a point; resolves with the result. */
  teleport(to: string | { x: number; z: number; yaw?: number }, kind?: TeleportKind): Promise<TeleportResult | null>;
  /**
   * The route between two places (a landmark id, a POI id, or `{x, z}`) on the topology graph, as the sim computes it:
   * `{edges, count, lengthM, etaS, complete, expanded}`, or null when there is none.
   */
  route(a: RoutePlace, b: RoutePlace, opts?: { useTopology?: boolean; allowWrongWay?: boolean; maxExpand?: number }): Promise<RouteReply | null>;
  /** The edge and the distance along it of the road nearest to a latitude and longitude. */
  resolve(lat: number, lng: number): Promise<{ edge: number; s: number } | null>;
  /** The newest `world.boundary` event (`{tick, s: 'countyLine'}`) the page received, or null; `boundaryEvents()` counts them. */
  lastBoundaryEvent(): { tick: number; s: string } | null;
  boundaryEvents(): number;
  /** The teleport fade: the directions asked so far (`out`, `in`) and where the veil is now. */
  fade(): { log: ('out' | 'in')[]; state: string; opacity: number };
  /** The newest map patch the sim published (blips and the GPS route), or null. */
  map(): { rev: number; blips: unknown[]; route: unknown } | null;
  /**
   * The landmark layer (M02d1): the tier's cap and swap distance, the resident landmark models with their fidelity, distance and the
   * chunks that hold their proxies (masked or not, with each chunk's `bundleRerecords`), the ones that failed to load, and the objects
   * and triangles of the mounted models. Null when the catalog holds no landmark models. M02d2 adds the skyline set (each model's
   * phase, whether it is drawn and what hides it), the latest `landmark.swap` commits (frame, main-thread ms, uploads that frame,
   * whether a model and the proxies are drawn after it) and the per-frame counters of holes (a proxy masked with no model drawn) and
   * double draws.
   */
  landmarks(): LandmarksReport | null;
  /** The `landmark.swap` events so far (QA builds only; not telemetry), oldest first; empty without a landmark layer. */
  swaps(): LandmarkSwapEvent[];
  /**
   * The instanced traffic (M03b1): instances in use, draws, instances per archetype and the cap of the tier; null before the world is
   * attached. `traffic.sim()` asks the sim for its own counts (agents, near bodies, promotions, honks, stalls, witness events).
   */
  traffic(): TrafficInfo | null;
  /** Counts of the ambient traffic inside sim.worker (`debug.world` op `traffic`); null after `timeoutMs`. */
  trafficSim(timeoutMs?: number): Promise<unknown>;
  /** Starts the landmark frame counters and the swap log again (a test warms the scene up, then measures a run). */
  resetLandmarkStats(): void;
}

export type RoutePlace = string | { x: number; z: number };
export interface RouteReply {
  edges: number[];
  count: number;
  lengthM: number;
  etaS: number;
  complete: boolean;
  expanded: number;
}

/** `lm.coit-tower` and the other ids of the world index as the sim's `Spot` argument. */
function spotArg(p: RoutePlace): Record<string, unknown> {
  if (typeof p !== 'string') return { x: p.x, z: p.z };
  if (p.startsWith('lm.')) return { landmark: p };
  if (p.startsWith('poi.')) return { poi: p };
  return { landmark: p };
}

type EngineAct = { engine?: { act(cmd: unknown): boolean; qa?: Record<string, unknown> } };
const act = (cmd: unknown): boolean => ((window as unknown as { __dvBridge?: EngineAct }).__dvBridge?.engine?.act(cmd) ?? false);

let callId = 0;
/** One `debug.world` command and the wait for its qa reply `world.reply.<id>`. */
async function call(op: string, args?: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
  const id = ++callId;
  if (!act({ t: 'debug.world', id, op, ...(args ? { args } : {}) })) return null;
  const name = `world.reply.${id}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const qa = (window as unknown as { __dvBridge?: EngineAct }).__dvBridge?.engine?.qa;
    if (qa && name in qa) return qa[name];
    await new Promise<void>((r) => setTimeout(r, 15));
  }
  return null;
}

export function installWorldBridge(view: WorldView, tier: QualityTierId): WorldBridge {
  const bridge: WorldBridge = {
    chunks: () => view.chunks(),
    backdrop: () => view.backdropInfo(),
    boot: () => view.bootReport(),
    wanted: (level) => view.wanted(level),
    plan: () => view.store.plan,
    tier: () => tier,
    focus: (x, z, vx = 0, vz = 0) => view.setFocus({ x, z, vx, vz }),
    clearFocus: () => view.setFocus(null),
    settle: (t) => view.settle(t),
    groundY: (x, z) => view.groundY(x, z),
    loseGpu: () => view.renderer.onRendererReplaced(null as never, null),
    pressure: (level) => view.store.setPressure(level),
    setHour: (h, freeze = true) => act(freeze ? { t: 'debug.hour', h, pause: true } : { t: 'debug.hour', h }),
    setWeather: (w, blendSec = 0) => act({ t: 'debug.weather', w, blendSec }),
    blackout: (on) => act({ t: 'debug.blackout', on }),
    freeze: (on) => act({ t: 'debug.clock.pause', on }),
    rain: (v) => view.sky?.setRainOverride(v),
    sky: () => view.skyInfo(),
    luma: (pitch, yaw, opts) => view.sampleLuma(pitch, yaw, opts),
    call: (op, args, timeoutMs = 30_000) => call(op, args, timeoutMs),
    teleport: async (to, kind = 'debug') => {
      const target = typeof to === 'string' ? (to.startsWith('lm.') ? { landmark: to } : { node: to }) : to;
      return (await call('teleport', { ...target, kind }, 60_000)) as TeleportResult | null;
    },
    route: async (a, b, opts = {}) => (await call('route', { from: spotArg(a), to: spotArg(b), ...opts })) as RouteReply | null,
    resolve: async (lat, lng) => (await call('resolve', { lat, lng })) as { edge: number; s: number } | null,
    lastBoundaryEvent: () => view.lastBoundary,
    boundaryEvents: () => view.boundaryCount,
    fade: () => ({ log: [...view.fade.log], state: view.fade.state, opacity: Number(view.fade.el.style.opacity || '0') }),
    map: () => view.lastMap,
    landmarks: () => view.landmarksReport(),
    swaps: () => view.landmarksReport()?.swaps ?? [],
    traffic: () => view.trafficReport(),
    trafficSim: (timeoutMs) => call('traffic', undefined, timeoutMs),
    resetLandmarkStats: () => view.landmarks?.resetStats(),
  };
  // the perf scenarios' way into the sim's traffic: fire-and-forget commands (id 0: the reply slot is overwritten, not accumulated)
  view.trafficLink = {
    focus: (f) => void act({ t: 'debug.world', id: 0, op: 'traffic', args: f ? { x: f.x, z: f.z, vx: f.vx, vz: f.vz } : { clearFocus: true } }),
    density: (mult) => void act({ t: 'debug.world', id: 0, op: 'density', args: { kind: 'traffic', mult, by: 'perf' } }),
    probe: async () => {
      const r = (await call('traffic', undefined, 5_000)) as { agents?: number; filled?: boolean } | null;
      return r ? { agents: Number(r.agents ?? 0), filled: r.filled === true } : null;
    },
  };
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  w.__dvBridge = { ...w.__dvBridge, world: bridge };
  // With ?debug=1 the teleport, GPS and world-edge controls sit under the sky controls (M02c1).
  if (new URLSearchParams(location.search).get('debug') === '1') mountWorldControls(document.body, bridge);
  return bridge;
}
