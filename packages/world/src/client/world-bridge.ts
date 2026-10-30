import type { ChunkKey, QualityTierId, TeleportKind, TeleportResult, WeatherPreset } from '@dv/shared';
import type { Level } from '../sim/streaming/chunk-store.ts';
import type { StreamingPlan } from '../sim/streaming/plan.ts';
import type { BackdropInfo } from './backdrop/backdrop-layer.ts';
import type { LandmarksReport, LandmarkSwapEvent } from './chunks/landmark-layer.ts';
import type { LumaOptions, LumaSample, SkyInfo } from './sky/sky-view.ts';
import type { LookReport } from './look/look-view.ts';
import { lookShot } from './look/shots.ts';
// art-hook:textures begin (M10d0)
import type { TexturesReport } from './textures/surface-textures.ts';
// art-hook:textures end
import { mountWorldControls } from './world-controls.ts';
import type { PrefetchReport } from './boot-prefetch.ts';
import type { ArtReport, BootReport, ChunksReport, WorldView } from './world-view.ts';
import type { TrafficInfo } from './traffic/instances.ts';
import type { PedInfo } from './peds/instances.ts';
import type { TransitInfo } from './transit/render.ts';

/**
 * `window.__dvBridge.world` (QA builds only; 02-world.md section 4, M02b1). Reachable only through a dynamic import behind
 * `import.meta.env.VITE_DV_QA === '1'`, so a production dist contains neither it nor the string "__dvBridge"
 * (apps/web/scripts/verify-dist.mjs). Results are JSON-friendly.
 */
export interface WorldMapBridge {
  (): { rev: number; blips: unknown[]; route: unknown } | null;
  /** Where the minimap draws the player: its pixel, the ENU point it stands for, the view radius and the metres per pixel; null while no frame was drawn. */
  minimapPlayerPx(): { px: number; py: number; x: number; z: number; yaw: number; radiusM: number; mPerPx: number; level: number; tilesDrawn: number; blipsDrawn: number; northUp: boolean } | null;
  /** The pixel on the minimap of an ENU point (what the view draws it at), or null before the first frame. */
  minimapProject(x: number, z: number): { px: number; py: number } | null;
  /** `nhoodAt` of the district grid the page holds: the index (255 none) and the slug. */
  nhoodAt(x: number, z: number): { index: number; slug: string | null };
  /** The offline geocoder (asset.worker): addresses, streets, landmarks, points of interest and neighbourhoods. */
  geocode(text: string, limit?: number): Promise<{ label: string; x: number; z: number; kind: string; cnn: number }[]>;
  /** The banners shown so far and the last one. */
  banner(): { count: number; last: { key: string; slug: string; index: number; tick: number } | null };
  /** The state of the HUD map layer (QA). */
  state(): unknown;
  /** Opens the north-up switch of the minimap. */
  setNorthUp(on: boolean): void;
}

export interface WorldBridge {
  /** Resident keys per level (uploaded), `bundleRerecords` per unit, upload cadence and bytes, failed tiles, cover masks. */
  chunks(): ChunksReport;
  /** The backdrop of the tier: ring and cards distance, massing, render objects, uploads at boot (R-MAP-02, AC-14). */
  backdrop(): BackdropInfo;
  /** Whether the world is revealed, when, and the bytes downloaded before the reveal (AC-8). */
  boot(): BootReport;
  /** M02f2: the speculative boot download (state, skip reason, counts, promotion and the time from mode start to the first play); null before the world is prepared. */
  prefetch(): PrefetchReport | null;
  /** M02f2: the refs the boot prefetch plans (`now`: the rings, `soon`: l1, l2, far); null before the world is prepared. */
  prefetchPlan(): { now: string[]; soon: string[] } | null;
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
  look(): (LookReport & { textures: TexturesReport | null }) | null;
  /** QA only: the live objects, for debugging in the page (not JSON-friendly). */
  internals(): { view: WorldView; look: unknown };
  /** M02e: the look on or off at runtime (materials, post stack, shadows; one re-record per resident chunk). False when the tier has none. */
  setLook(on: boolean): boolean;
  /** M02g1: one layer of the look's profile (`grade`, `haze`, `blob`, `casters`, `skyReflect`, `windows`) on or off; false when the profile has no such layer. */
  setLookLayer(id: string, on: boolean): boolean;
  /**
   * M02e: applies a shot of `config/world/look-shots.json`: pauses the sim, locks the hour and weather with a zero-second blend,
   * freezes the look clock, holds the camera, waits for `settle()` and the fade, and resolves once a frame with all of it has been
   * presented (the spec then screenshots the canvas; no extra offscreen render). `clearShot` releases the camera and the clock.
   */
  shot(id: string): Promise<{ id: string; hour: number; weather: string }>;
  /**
   * M02g2 QA (BD-REPAIR-M02g2-03): moves the held shot camera to another shot of the same hour and weather, standing next to the
   * current one (the `-b` shot of a flicker pair, 0.05 m away), and resolves two presented frames later. It does not move the
   * stream focus, wait for `settle()` or bake the environment again: the streamer, the sky and the environment map are the ones of the
   * `shot` before it, so the two pictures of a pair differ by the camera alone. Throws without a look, without a held shot, or when the
   * sky is not at the new shot's hour and weather. `keepHeight` (M02h1) moves the camera over the ground without standing it on the ground
   * again: its height is the one of the first shot, so the pair is a sideways or forward step and nothing else (the ground under a
   * terrain cell edge can differ by centimetres between two points 5 cm apart, which is 2 % of a 1.6 m eye height).
   */
  shotMove(id: string, opts?: { keepHeight?: boolean }): Promise<{ id: string; hour: number; weather: string }>;
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
  /**
   * The newest map patch the sim published (blips and the GPS route), or null. M02c2 hangs the map QA calls on the function:
   * `minimapPlayerPx()`, `minimapProject(x, z)`, `nhoodAt(x, z)`, `geocode(text, limit)`, `banner()` (see `WorldMapBridge`).
   */
  map: WorldMapBridge;
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
  // art-hook:vehicles begin (M10d1)
  /** The final vehicle and prop art: profile, traffic families and base models, render objects, material class, the pool's models and the snapshot's asset keys; null before attach. */
  art(): ArtReport | null;
  // art-hook:vehicles end
  /** Counts of the ambient traffic inside sim.worker (`debug.world` op `traffic`); null after `timeoutMs`. */
  trafficSim(timeoutMs?: number): Promise<unknown>;
  /** The instanced pedestrians (M03b2): far and near-LOD instances, per body, draws and the caps of the tier; null before the world is attached. */
  peds(): PedInfo | null;
  /** Counts of the pedestrians inside sim.worker (`debug.world` op `peds`); `head` sets the XR head pose they keep clear of. */
  pedsSim(head?: { x: number; z: number } | null, timeoutMs?: number): Promise<unknown>;
  /** A `crowd.attract` source at (x, z): the pedestrians within 40 m gather (3 live at most). Returns its id, or 0 when 3 are live. */
  attract(x: number, z: number): Promise<{ id: number } | null>;
  releaseAttract(id: number): Promise<unknown>;
  /** Transit instances drawn per kind (buses count against the traffic cap); null before the world is attached. */
  transit(): TransitInfo | null;
  /** The transit counts, the fares charged so far and the robotaxi phase inside sim.worker (`debug.world` op `transit`). */
  transitSim(timeoutMs?: number): Promise<unknown>;
  /** Bay Rail from station `from` to station `to` (ids from the world index), resolved when the ride ends; the fare shows in `transitSim().fares`. */
  ride(from: string, to: string): Promise<unknown>;
  /** A robotaxi to the point (x, z): a car appears 120 m or more away, arrives, a short cut, then the teleport. */
  rideRobotaxi(x: number, z: number): Promise<unknown>;
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

export function installWorldBridge(view: WorldView, tier: QualityTierId, prefetch?: { report(): PrefetchReport; planned: { now: string[]; soon: string[] } }): WorldBridge {
  const bridge: WorldBridge = {
    chunks: () => view.chunks(),
    backdrop: () => view.backdropInfo(),
    boot: () => view.bootReport(),
    prefetch: () => prefetch?.report() ?? null,
    prefetchPlan: () => prefetch?.planned ?? null,
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
    // art-hook:textures begin (M10d0): `look().textures`, the surface textures of the tier (null in a view without a look)
    look: () => {
      const r = view.lookReport();
      return r ? { ...r, textures: view.textures?.report() ?? null } : null;
    },
    // art-hook:textures end
    internals: () => ({ view, look: view.lookView }),
    setLook: (on) => view.setLook(on),
    setLookLayer: (id, on) => view.setLookLayer(id, on),
    shot: async (id) => {
      const lv = view.shotRig();
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
      // One environment bake from the settled sky (see `PhysicalSky.refreshEnvironment`): without it the map was whatever the last bake of the
      // transition left, and a golden at `desktop` on Chromium differed from boot to boot.
      const bakes = lv.envBakes();
      if (lv.refreshEnvironment()) {
        await until(() => lv.envBakes() > bakes, 120_000, 'the environment bake');
        await nextFrames(2);
      }
      return { id: s.id, hour: s.hour, weather: s.weather };
    },
    shotMove: async (id, opts) => {
      const lv = view.shotRig();
      if (!lv) throw new Error('look shot: this view has no look');
      if (!lv.held()) throw new Error('look shot: no shot is held; call shot() first');
      const s = lookShot(id);
      const k = view.skyInfo();
      if (!k || Math.abs(k.hour - s.hour) >= 0.05 || k.weather !== s.weather || k.next !== s.weather) {
        throw new Error(`look shot: the sky is not at ${s.hour}:00 ${s.weather} for ${id}`);
      }
      if (opts?.keepHeight === true) {
        lv.shiftShot(id);
      } else {
        lv.holdShot(id);
        const gy = view.groundY(s.x, s.z);
        if (gy !== null) lv.placeShot(id, gy);
      }
      await nextFrames(2);
      return { id: s.id, hour: s.hour, weather: s.weather };
    },
    hold: (on) => view.holdRender(on),
    clearShot: () => {
      view.shotRig()?.releaseShot();
      view.shotRig()?.freezeClock(false);
      view.setFocus(null);
    },
    call: (op, args, timeoutMs = 30_000) => call(op, args, timeoutMs),
    teleport: async (to, kind = 'debug') => {
      const target = typeof to === 'string' ? (to.startsWith('lm.') ? { landmark: to } : { node: to }) : to;
      // The reply comes when the request resolves, and the request is tick-driven: it waits for the destination ring to upload, one chunk
      // per presented frame (M02b1), and a `desktop` frame on software GL takes 4 to 8 s once the look draws with the sky's environment map
      // (M02g2, BD-M02g2-09), so a landmark far away took 40 to 95 s. The wait outlasts the 8 s of ticks plus the move (BD-REPAIR-M02g2-02);
      // a reply that never comes is still null.
      return (await call('teleport', { ...target, kind }, 300_000)) as TeleportResult | null;
    },
    route: async (a, b, opts = {}) => (await call('route', { from: spotArg(a), to: spotArg(b), ...opts })) as RouteReply | null,
    resolve: async (lat, lng) => (await call('resolve', { lat, lng })) as { edge: number; s: number } | null,
    lastBoundaryEvent: () => view.lastBoundary,
    boundaryEvents: () => view.boundaryCount,
    fade: () => ({ log: [...view.fade.log], state: view.fade.state, opacity: Number(view.fade.el.style.opacity || '0') }),
    map: Object.assign(() => view.lastMap, {
      minimapPlayerPx: () => {
        const l = view.map;
        if (!l) return null;
        const q = l.qa().minimap.last;
        const half = 80;
        return { px: half, py: half, x: l.player.x, z: l.player.z, yaw: l.player.yaw, radiusM: q.radiusM, mPerPx: q.radiusM / half, level: q.level, tilesDrawn: q.tilesDrawn, blipsDrawn: q.blipsDrawn, northUp: l.northUpOn };
      },
      minimapProject: (x: number, z: number) => {
        const l = view.map;
        if (!l) return null;
        const q = l.qa().minimap.last;
        const k = 80 / q.radiusM;
        const yaw = l.northUpOn ? 0 : l.player.yaw;
        const rx = (x - l.player.x) * k, rz = (z - l.player.z) * k;
        return { px: 80 + rx * Math.cos(yaw) - rz * Math.sin(yaw), py: 80 + rx * Math.sin(yaw) + rz * Math.cos(yaw) };
      },
      nhoodAt: (x: number, z: number) => {
        const l = view.map;
        const index = l ? l.nhoodAt(x, z) : 255;
        return { index, slug: l?.nhoodSlugs[index] ?? null };
      },
      geocode: (text: string, limit = 8) => (view.map ? view.map.search(text, limit) : Promise.resolve([])),
      banner: () => ({ count: view.map?.bannerCount ?? 0, last: view.map?.lastBanner ?? null }),
      state: () => view.map?.qa() ?? null,
      setNorthUp: (on: boolean) => view.map?.setNorthUp(on),
    }),
    landmarks: () => view.landmarksReport(),
    swaps: () => view.landmarksReport()?.swaps ?? [],
    traffic: () => view.trafficReport(),
    art: () => view.artReport(), // art-hook:vehicles (M10d1)
    trafficSim: (timeoutMs) => call('traffic', undefined, timeoutMs),
    peds: () => view.pedsReport(),
    pedsSim: (head, timeoutMs) => call('peds', head === undefined ? undefined : head === null ? { clearHead: true } : { headX: head.x, headZ: head.z }, timeoutMs),
    attract: async (x, z) => (await call('attract', { x, z, by: 'qa' })) as { id: number } | null,
    releaseAttract: (id) => call('attract', { release: id }),
    transit: () => view.transitReport(),
    transitSim: (timeoutMs) => call('transit', undefined, timeoutMs),
    ride: (from, to) => call('ride', { from, to }, 120_000),
    rideRobotaxi: (x, z) => call('ride', { x, z }, 180_000),
    resetLandmarkStats: () => view.landmarks?.resetStats(),
  };
  // the perf scenarios' way into the sim's traffic: fire-and-forget commands (id 0: the reply slot is overwritten, not accumulated)
  view.trafficLink = {
    focus: (f) => void act({ t: 'debug.world', id: 0, op: 'traffic', args: f ? { x: f.x, z: f.z, vx: f.vx, vz: f.vz } : { clearFocus: true } }),
    density: (mult) => {
      void act({ t: 'debug.world', id: 0, op: 'density', args: { kind: 'traffic', mult, by: 'perf' } });
      // M03b2: the pedestrians follow the same switch
      void act({ t: 'debug.world', id: 0, op: 'density', args: { kind: 'ped', mult, by: 'perf' } });
    },
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
