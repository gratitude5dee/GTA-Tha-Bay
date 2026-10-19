import { Rng, C13_VERSION, type DeviceProfile, type PerfReport, type PerfScenario, type QualityTier, type QualityTierId } from '@dv/shared';
import type { Camera, Object3D, PerspectiveCamera } from 'three/webgpu';
import grayboxWalk from '../../../../../config/perf/paths/graybox-walk.json';
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

/** Scenario registry. Later milestones add their paths here. */
export const SCENARIO_PATHS: Readonly<Record<string, OrbitPath>> = { 'graybox-walk': grayboxWalk as unknown as OrbitPath };
export const SCENARIO_PATH_REFS: Readonly<Record<string, string>> = { 'graybox-walk': 'config/perf/paths/graybox-walk.json' };

export function scenarioOf(path: OrbitPath, durationS?: number): PerfScenario {
  return {
    id: path.id,
    pathRef: SCENARIO_PATH_REFS[path.id] ?? '',
    durationS: durationS ?? path.durationS,
    warmupS: path.warmupS,
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

  async run(id: string, opts: { durationS?: number } = {}): Promise<PerfReport> {
    const path = SCENARIO_PATHS[id];
    if (!path) throw new Error(`perf: unknown scenario "${id}"`);
    if (this.running) throw new Error('perf: a scenario is already running');
    this.running = true;
    const host = this.d.host;
    const tier = this.d.tier();
    const scenario = scenarioOf(path, opts.durationS);
    const bench = buildBenchmarkScene(tier);
    const camera: PerspectiveCamera = bench.camera;
    const canvas = host.currentCanvas;
    camera.aspect = Math.max(1, canvas.clientWidth || 640) / Math.max(1, canvas.clientHeight || 360);
    camera.updateProjectionMatrix();
    const phase = orbitPhase(path.seed);
    const meter = new RenderBudgetMeter(Math.max(1000, Math.ceil(scenario.durationS * 240)));
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
        const [x, y, z] = orbitPosition(path, t, phase);
        camera.position.set(x, y, z);
        camera.lookAt(path.lookAtEnu[0], path.lookAtEnu[1], path.lookAtEnu[2]);
        if (measuring && last >= 0) probe.push(time - last);
        last = time;
      },
      after: (time) => {
        if (!measuring) return;
        meter.measure(bench.scene, camera);
        infoTrianglesMax = Math.max(infoTrianglesMax, info.render.triangles);
        infoDrawMax = Math.max(infoDrawMax, info.render.drawCalls);
        const m = readMemory(info, this.d.wasm);
        texMax = Math.max(texMax, m.texturesMB);
        gpuMax = Math.max(gpuMax, m.gpuMB);
        heapMax = Math.max(heapMax, m.wasmMB);
        if ((time - measureT0) / 1000 >= scenario.durationS) done();
      },
    };

    host.setMenuScene(bench.scene as Object3D, camera as Camera);
    const remove = host.addFrameListener(listener);
    try {
      await finished;
    } finally {
      remove();
      host.clearMenuScene();
      bench.dispose();
      this.running = false;
    }

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
      boot: { warmBootToPlayableS: null, coldDownloadMB: null },
      errors: this.d.errors(),
    };
    this.lastReport = report;
    this.lastInfo = {
      meterTrianglesMax: Math.round(meter.maxTriangles),
      infoTrianglesMax: Math.round(infoTrianglesMax),
      meterRenderObjectsMax: meter.maxRenderObjects,
      infoDrawCallsMax: infoDrawMax,
      frames: frames.count,
    };
    return report;
  }
}
