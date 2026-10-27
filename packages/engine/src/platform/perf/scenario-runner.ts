import { Rng, C13_VERSION, type DeviceProfile, type PerfReport, type PerfScenario, type QualityTier, type QualityTierId } from '@dv/shared';
import type { Camera, Object3D, PerspectiveCamera } from 'three/webgpu';
import grayboxWalk from '../../../../../config/perf/paths/graybox-walk.json';
import walkCivicCenter from '../../../../../config/perf/paths/walk-civic-center.json';
import routeFerryOceanBeach from '../../../../../config/perf/paths/route-ferry-ocean-beach.json';
import downtownRush from '../../../../../config/perf/paths/downtown-rush.json';
import bootCityhall from '../../../../../config/perf/paths/boot-cityhall.json';
import storyChase from '../../../../../config/perf/paths/story-chase.json';
import npcMissionCrowd from '../../../../../config/perf/paths/npc-mission-crowd.json';
import fightStage from '../../../../../config/perf/paths/fight-stage.json';
import { buildBenchmarkScene } from '../benchmark.ts';
import type { FrameListener, RendererHost } from '../renderer-host.ts';
import { RenderBudgetMeter } from './meter.ts';
import { PerfProbe, round2, readMemory, type ByteSource, type RendererInfoLike } from './probe.ts';

/**
 * PerfScenarioRunner (11-platform-perf.md section 3): runs a canned camera path with a seeded start and writes a `PerfReport`.
 * Until the gray-box block of M01b2 and the Civic Center chunk of M02b1 exist, `graybox-walk` draws the synthetic benchmark
 * group (a TSL chunk group at 80 % of the tier's render-object and triangle budget) on the shared canvas through the host's
 * menu-scene slot (Builder decision BD-M01c-05).
 */
export interface OrbitPath {
  id: string;
  kind: 'orbit';
  centerEnu: [number, number, number];
  radiusM: number;
  heightM: number;
  lookAtEnu: [number, number, number];
  periodS: number;
  durationS: number;
  warmupS: number;
  seed: number;
  density: 'off' | 'nominal';
}

/**
 * A world path (M02b1): the camera follows a polyline of ENU waypoints on the streamed city at `speedMps`, `eyeHeightM` above the
 * ground, looking `lookAheadM` along the heading. The position depends on the elapsed time only (clamped at the end), so a short
 * CI run covers the first part of the route and a 120 s device run the whole of it. Needs a world; `WorldScenarioDriver` supplies it.
 */
export interface RoutePath {
  id: string;
  kind: 'route';
  /** [x, z] ENU metres, +X east, -Z north. */
  waypointsEnu: [number, number][];
  speedMps: number;
  eyeHeightM: number;
  lookAheadM: number;
  durationS: number;
  warmupS: number;
  seed: number;
  density: 'off' | 'nominal';
}
/**
 * A stage path (M08a2): no camera of the runner's own. The mode that the page started (the fight arena, driven by its own camera
 * directive) frames the shot, and the run counts what that frame draws. Needs no world driver.
 */
export interface StagePath {
  id: string;
  kind: 'stage';
  durationS: number;
  warmupS: number;
  seed: number;
  density: 'off' | 'nominal';
}
export type ScenarioPath = OrbitPath | RoutePath | StagePath;

/**
 * The world half of a route scenario, implemented by the app over `@dv/world` (the engine never imports it): it moves the stream focus
 * with the camera and answers the ground height. Registered with the platform bridge through `ScenarioRunnerDeps.worldDriver`.
 */
export interface WorldScenarioDriver {
  /** Places the focus at the start of the path and resolves when the streaming around it is idle (bounded wait). */
  prepare(startXz: [number, number], opts?: { density: 'off' | 'nominal' }): Promise<void>;
  /** Every frame, after the engine hand-off: the camera pose the runner chose. Returns the ground height under it, or null while unknown. */
  frame(pose: { x: number; y: number; z: number; vx: number; vz: number }): { groundY: number | null };
  /** End of the run: figures for the report. */
  finish(): {
    coldDownloadMB: number | null;
    /** M02f1: the boot figures once known (requests, bytes, ms to reveal, waves, peak in flight); the runner copies them into `PerfReport.boot`. */
    boot?: { requests: number; bytes: number; revealMs: number; waves: number; inflightPeak: number };
  };
}

/** Scenario registry. Later milestones add their paths here. */
export const SCENARIO_PATHS: Readonly<Record<string, ScenarioPath>> & { readonly 'graybox-walk': OrbitPath } = {
  'graybox-walk': grayboxWalk as unknown as OrbitPath,
  'walk-civic-center': walkCivicCenter as unknown as RoutePath,
  'route-ferry-ocean-beach': routeFerryOceanBeach as unknown as RoutePath,
  'downtown-rush': downtownRush as unknown as RoutePath,
  'boot-cityhall': bootCityhall as unknown as RoutePath,
  'story-chase': storyChase as unknown as RoutePath,
  'npc-mission-crowd': npcMissionCrowd as unknown as RoutePath,
  'fight-stage': fightStage as unknown as StagePath,
};
export const SCENARIO_PATH_REFS: Readonly<Record<string, string>> = {
  'graybox-walk': 'config/perf/paths/graybox-walk.json',
  'walk-civic-center': 'config/perf/paths/walk-civic-center.json',
  'route-ferry-ocean-beach': 'config/perf/paths/route-ferry-ocean-beach.json',
  'downtown-rush': 'config/perf/paths/downtown-rush.json',
  'boot-cityhall': 'config/perf/paths/boot-cityhall.json',
  'story-chase': 'config/perf/paths/story-chase.json',
  'npc-mission-crowd': 'config/perf/paths/npc-mission-crowd.json',
  'fight-stage': 'config/perf/paths/fight-stage.json',
};

/** Position, unit heading and total length of a route at distance `s` from its start (clamped to the ends). */
export function routePose(path: RoutePath, s: number): { x: number; z: number; tx: number; tz: number; length: number } {
  const w = path.waypointsEnu;
  let total = 0;
  const cum: number[] = [0];
  for (let i = 1; i < w.length; i++) {
    total += Math.hypot((w[i] as [number, number])[0] - (w[i - 1] as [number, number])[0], (w[i] as [number, number])[1] - (w[i - 1] as [number, number])[1]);
    cum.push(total);
  }
  const d = Math.min(Math.max(s, 0), total);
  let i = 1;
  while (i < w.length - 1 && (cum[i] as number) < d) i++;
  const a = w[i - 1] as [number, number];
  const b = w[i] as [number, number];
  const seg = (cum[i] as number) - (cum[i - 1] as number);
  const t = seg > 0 ? (d - (cum[i - 1] as number)) / seg : 0;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / len, tz: (b[1] - a[1]) / len, length: total };
}

export function scenarioOf(path: ScenarioPath, durationS?: number, warmupS?: number): PerfScenario {
  return {
    id: path.id,
    pathRef: SCENARIO_PATH_REFS[path.id] ?? '',
    durationS: durationS ?? path.durationS,
    warmupS: warmupS ?? path.warmupS,
    seed: path.seed,
    density: path.density,
  };
}

/** Camera position on the orbit at time `tSec` (ENU metres equal three world units). */
export function orbitPosition(path: OrbitPath, tSec: number, phase: number): [number, number, number] {
  const a = phase + (2 * Math.PI * tSec) / path.periodS;
  return [path.centerEnu[0] + Math.cos(a) * path.radiusM, path.centerEnu[1] + path.heightM, path.centerEnu[2] + Math.sin(a) * path.radiusM];
}

/** Start phase of the orbit from the scenario seed. */
export function orbitPhase(seed: number): number {
  return new Rng(seed).nextFloat() * 2 * Math.PI;
}

/** Counts and maxima of one run that are not part of `PerfReport` (QA bridge `perf.info()`). */
export interface RunInfo {
  meterTrianglesMax: number;
  infoTrianglesMax: number;
  meterRenderObjectsMax: number;
  /** The counted objects of the frame with the most, by top-level scene node (QA diagnostics, M05c2). */
  breakdownAtMax?: Record<string, number>;
  infoDrawCallsMax: number;
  frames: number;
}

export interface ScenarioRunnerDeps {
  host: RendererHost;
  tier: () => QualityTier;
  profile: DeviceProfile;
  build: string;
  /** Epoch ms. */
  now: () => number;
  wasm: ReadonlyMap<string, ByteSource>;
  /** Counts of errors seen this session, for the report. */
  errors: () => { gpuLost: number; uncaptured: number; js: number };
  governor?: 'on' | 'off';
  /** The world half of the route scenarios; null while no world is booted. */
  worldDriver?: () => WorldScenarioDriver | null;
}

export class PerfScenarioRunner {
  private lastReport: PerfReport | null = null;
  private lastInfo: RunInfo | null = null;
  private running = false;

  constructor(private readonly d: ScenarioRunnerDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  report(): PerfReport | null {
    return this.lastReport;
  }

  info(): RunInfo | null {
    return this.lastInfo;
  }

  async run(id: string, opts: { durationS?: number; warmupS?: number } = {}): Promise<PerfReport> {
    const path = SCENARIO_PATHS[id];
    if (!path) throw new Error(`perf: unknown scenario "${id}"`);
    if (this.running) throw new Error('perf: a scenario is already running');
    this.running = true;
    const host = this.d.host;
    const tier = this.d.tier();
    const scenario = scenarioOf(path, opts.durationS, opts.warmupS);
    const route = path.kind === 'route' ? path : null;
    const orbit = path.kind === 'orbit' ? path : null;
    const stage = path.kind === 'stage';
    const driver = route ? (this.d.worldDriver?.() ?? null) : null;
    if (route && !driver) {
      this.running = false;
      throw new Error(`perf: scenario "${id}" needs the world (QA build with DV_WORLD, no ?world= flag)`);
    }
    const bench = orbit ? buildBenchmarkScene(tier) : null;
    const camera: PerspectiveCamera = bench ? bench.camera : host.camera;
    const scene: Object3D = bench ? bench.scene : host.scene;
    const canvas = host.currentCanvas;
    camera.aspect = Math.max(1, canvas.clientWidth || 640) / Math.max(1, canvas.clientHeight || 360);
    camera.updateProjectionMatrix();
    const phase = orbit ? orbitPhase(orbit.seed) : 0;
    if (route && driver) {
      const start = routePose(route, 0);
      try {
        await driver.prepare([start.x, start.z], { density: route.density });
      } catch (e) {
        this.running = false;
        throw e;
      }
    }
    let lastY = 0;
    const meter = new RenderBudgetMeter(Math.max(1000, Math.ceil(scenario.durationS * 240)));
    meter.trace = true;
    const probe = new PerfProbe(Math.max(1000, Math.ceil(scenario.durationS * 240)));
    const info = (host.renderer as unknown as { info: RendererInfoLike }).info;

    let t0 = -1;
    let last = -1;
    let measuring = false;
    let infoTrianglesMax = 0;
    let infoDrawMax = 0;
    let texMax = 0;
    let gpuMax = 0;
    let heapMax = 0;
    let measureT0 = -1;
    let done: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      done = resolve;
    });

    const listener: FrameListener = {
      before: (time) => {
        if (t0 < 0) t0 = time;
        const t = (time - t0) / 1000;
        if (!measuring && t >= scenario.warmupS) {
          measuring = true;
          measureT0 = time;
        }
        if (orbit) {
          const [x, y, z] = orbitPosition(orbit, t, phase);
          camera.position.set(x, y, z);
          camera.lookAt(orbit.lookAtEnu[0], orbit.lookAtEnu[1], orbit.lookAtEnu[2]);
        }
        if (measuring && last >= 0) probe.push(time - last);
        last = time;
      },
      late: (time) => {
        // Route scenarios: the engine's camera rig has run; this frame's pose is the runner's.
        if (!route || !driver || t0 < 0) return;
        const t = (time - t0) / 1000;
        const here = routePose(route, route.speedMps * t);
        const y = lastY;
        const got = driver.frame({ x: here.x, y, z: here.z, vx: here.tx * route.speedMps, vz: here.tz * route.speedMps });
        if (got.groundY !== null) lastY = got.groundY;
        const eye = lastY + route.eyeHeightM;
        camera.position.set(here.x, eye, here.z);
        camera.lookAt(here.x + here.tx * route.lookAheadM, eye - 1, here.z + here.tz * route.lookAheadM);
      },
      after: (time) => {
        if (!measuring) return;
        // Stage paths (M08a2): the mode's arena is the host's menu scene, so what the loop draws is what counts.
        const drawn = stage ? host.active : { scene, camera };
        meter.measure(drawn.scene, drawn.camera, bench ? 0 : stage && host.menuActive ? 0 : host.shadowPasses, host.backdrop && !bench && !(stage && host.menuActive) ? [host.backdrop] : []);
        infoTrianglesMax = Math.max(infoTrianglesMax, info.render.triangles);
        infoDrawMax = Math.max(infoDrawMax, info.render.drawCalls);
        const m = readMemory(info, this.d.wasm);
        texMax = Math.max(texMax, m.texturesMB);
        gpuMax = Math.max(gpuMax, m.gpuMB);
        heapMax = Math.max(heapMax, m.wasmMB);
        if ((time - measureT0) / 1000 >= scenario.durationS) done();
      },
    };

    if (bench) host.setMenuScene(bench.scene as Object3D, camera as Camera);
    const remove = host.addFrameListener(listener);
    try {
      await finished;
    } finally {
      remove();
      if (bench) {
        host.clearMenuScene();
        bench.dispose();
      }
      this.running = false;
    }
    const worldFigures = driver ? driver.finish() : null;

    const budget = tier.budget.frame.frameBudgetMs;
    const frames = probe.stats(budget);
    const refreshHz = null;
    const p = this.d.profile;
    const adapter = p.signals.adapter;
    const report: PerfReport = {
      v: 1,
      build: this.d.build,
      c13: C13_VERSION,
      createdAt: this.d.now(),
      device: { class: p.class, browser: p.browser, uaHash: p.uaHash, adapter, displayMode: p.displayMode, refreshHz },
      tier: tier.id as QualityTierId,
      backend: host.backend,
      governor: this.d.governor ?? 'off',
      scenario,
      frames: {
        count: frames.count,
        medianMs: round2(frames.medianMs),
        p95Ms: round2(frames.p95Ms),
        p99Ms: round2(frames.p99Ms),
        maxMs: round2(frames.maxMs),
        over50ms: frames.over50ms,
        over2xBudget: frames.over2xBudget,
      },
      counts: {
        renderObjectsMax: meter.maxRenderObjects,
        renderObjectsP95: meter.objectsP95(),
        // renderer.info draw calls are authoritative on the WebGL2 backend only (11-platform-perf.md section 5).
        gpuDrawCmdsMax: host.backend === 'webgl2' ? infoDrawMax : null,
        trianglesMax: Math.round(meter.maxTriangles),
        texturesMB: round2(texMax),
        gpuResourcesMB: round2(gpuMax),
      },
      memory: { accountedHeapMBMax: round2(heapMax), mediaMBMax: 0, webContentEstMB: null },
      dynamic: { minRenderScale: 1, downgrades: 0, upgrades: 0, tierChanges: 0 },
      boot: { warmBootToPlayableS: null, coldDownloadMB: worldFigures?.coldDownloadMB ?? null, ...(worldFigures?.boot ?? {}) },
      errors: this.d.errors(),
    };
    this.lastReport = report;
    this.lastInfo = {
      meterTrianglesMax: Math.round(meter.maxTriangles),
      infoTrianglesMax: Math.round(infoTrianglesMax),
      meterRenderObjectsMax: meter.maxRenderObjects,
      ...(Object.keys(meter.breakdownAtMax).length > 0 ? { breakdownAtMax: meter.breakdownAtMax } : {}),
      infoDrawCallsMax: infoDrawMax,
      frames: frames.count,
    };
    return report;
  }
}
