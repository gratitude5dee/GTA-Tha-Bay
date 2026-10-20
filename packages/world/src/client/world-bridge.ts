import type { ChunkKey, QualityTierId, TeleportKind, TeleportResult, WeatherPreset } from '@dv/shared';
import type { Level } from '../sim/streaming/chunk-store.ts';
import type { StreamingPlan } from '../sim/streaming/plan.ts';
import type { BackdropInfo } from './backdrop/backdrop-layer.ts';
import type { LandmarksReport } from './chunks/landmark-layer.ts';
import type { LumaOptions, LumaSample, SkyInfo } from './sky/sky-view.ts';
import type { LookReport } from './look/look-view.ts';
import { mountWorldControls } from './world-controls.ts';
import type { BootReport, ChunksReport, WorldView } from './world-view.ts';

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
  /** M02e: what the look pass is doing (profile, post nodes, shadow mode and passes, casters, exposure, environment, sky, window glow). */
  look(): LookReport | null;
  /** QA only: the live objects, for debugging in the page (not JSON-friendly). */
  internals(): { view: WorldView; look: unknown };
  /** M02e: the look on or off at runtime (materials, post stack, shadows; one re-record per resident chunk). False when the tier has none. */
  setLook(on: boolean): boolean;
  /**
   * M02e: applies a shot of `config/world/look-shots.json`: pauses the sim, locks the hour and weather with a zero-second blend,
   * freezes the look clock, holds the camera, waits for `settle()` and the fade, and resolves once a frame with all of it has been
   * presented (the spec then screenshots the canvas; no extra offscreen render). `clearShot` releases the camera and the clock.
   */
  shot(id: string): Promise<{ id: string; hour: number; weather: string }>;
  clearShot(): void;
  /** M02e QA: stops or restarts the render loop; the canvas keeps its last frame while stopped (for captures on a slow renderer). */
  hold(on: boolean): void;
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
   * and triangles of the mounted models. Null when the catalog holds no landmark models.
   */
  landmarks(): LandmarksReport | null;
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

const nextFrames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    let left = n;
    const tick = (): void => {
      if (--left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const until = async (ok: () => boolean, timeoutMs: number, what: string): Promise<void> => {
  const t0 = performance.now();
  while (!ok()) {
    if (performance.now() - t0 > timeoutMs) throw new Error(`look shot: timed out waiting for ${what}`);
    await nextFrames(1);
  }
};
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
    look: () => view.lookReport(),
    internals: () => ({ view, look: view.lookView }),
    setLook: (on) => view.setLook(on),
    shot: async (id) => {
      const lv = view.lookView;
      if (!lv) throw new Error('look shot: this view has no look');
      const s = lv.holdShot(id);
      view.setFocus({ x: s.x, z: s.z, vx: 0, vz: 0 });
      // Pause the clock at the shot's hour and weather (the sim applies the commands on its next tick).
      act({ t: 'debug.clock.pause', on: true });
      bridge.setHour(s.hour, true);
      bridge.setWeather(s.weather, 0);
      await until(() => {
        const k = view.skyInfo();
        return !!k && Math.abs(k.hour - s.hour) < 0.05 && k.weather === s.weather && k.next === s.weather;
      }, 120_000, `the sky at ${s.hour}:00 ${s.weather}`);
      lv.freezeClock(true);
      await view.settle(600_000);
      // The camera stands on the ground now that the chunk under it is resident.
      const gy = view.groundY(s.x, s.z);
      if (gy !== null) lv.placeShot(id, gy);
      // The camera moved to its height: whatever that asks the streamer for (the plan, finer levels in view) must be resident too.
      await nextFrames(2);
      await view.settle(600_000);
      // The dither fade (0.5 s) and a few frames with everything in place, then one more presented frame.
      const t0 = performance.now();
      await until(() => performance.now() - t0 > 900, 30_000, 'the fade');
      await nextFrames(4);
      return { id: s.id, hour: s.hour, weather: s.weather };
    },
    hold: (on) => view.holdRender(on),
    clearShot: () => {
      view.lookView?.releaseShot();
      view.lookView?.freezeClock(false);
      view.setFocus(null);
    },
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
  };
  const w = window as unknown as { __dvBridge?: Record<string, unknown> };
  w.__dvBridge = { ...w.__dvBridge, world: bridge };
  // With ?debug=1 the teleport, GPS and world-edge controls sit under the sky controls (M02c1).
  if (new URLSearchParams(location.search).get('debug') === '1') mountWorldControls(document.body, bridge);
  return bridge;
}
