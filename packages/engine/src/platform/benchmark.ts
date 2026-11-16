import {
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
} from 'three/webgpu';
import type { BenchmarkResult, QualityTier } from '@dv/shared';
import type { RendererHost } from './renderer-host.ts';
import { BENCHMARK_TOLERANCE } from './tier-select.ts';
import type { UiHoldGate } from './ui-hold.ts';

/**
 * Tier benchmark (11-platform.md section 5.3): 3 s (at most 180 frames) of a synthetic TSL chunk group sized to 80 % of the
 * tier's render-object and triangle budget, orbited by a canned camera. Until M02b the scene is this one; afterwards it is
 * the Civic Center boot chunk.
 */
export const BENCHMARK_LOAD = 0.8;
export const BENCHMARK_MAX_MS = 3000;
export const BENCHMARK_MAX_FRAMES = 180;
/** Frames dropped from the start of a run (pipeline creation, first uploads). */
const WARMUP_FRAMES = 3;
/** Below this many measured frames the run is too short to judge; its p90 is the slowest frame. */
const MIN_FRAMES = 6;

export interface FrameSummary {
  medianMs: number;
  p90Ms: number;
}

/** Median and p90 (nearest rank) of frame intervals in ms. */
export function summarizeFrames(deltas: readonly number[]): FrameSummary {
  if (deltas.length === 0) return { medianMs: 0, p90Ms: 0 };
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] as number;
  return { medianMs: at(0.5), p90Ms: at(0.9) };
}

/** Triangle count of a three `SphereGeometry(widthSegments, heightSegments)`. */
export function sphereTriangles(widthSegments: number, heightSegments: number): number {
  return 2 * widthSegments * (heightSegments - 1);
}

export interface BenchmarkSceneInfo {
  objects: number;
  widthSegments: number;
  heightSegments: number;
  trianglesPerObject: number;
  triangles: number;
}

/** Object and triangle counts of the synthetic scene for a tier. */
export function benchmarkLoad(tier: QualityTier): BenchmarkSceneInfo {
  const r = tier.budget.render;
  const objects = Math.max(1, Math.floor(r.maxRenderObjects * BENCHMARK_LOAD));
  const target = (r.maxTriangles * BENCHMARK_LOAD) / objects;
  const h = Math.max(2, Math.round(Math.sqrt(target) / 2));
  const w = Math.max(3, 2 * h);
  const trianglesPerObject = sphereTriangles(w, h);
  return { objects, widthSegments: w, heightSegments: h, trianglesPerObject, triangles: objects * trianglesPerObject };
}

export interface BenchmarkScene extends BenchmarkSceneInfo {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Moves the canned camera to time `tSec`. */
  update(tSec: number): void;
  dispose(): void;
}

/** A synthetic chunk group: shared geometry and one TSL material, one render object per mesh, laid out on a grid. */
export function buildBenchmarkScene(tier: QualityTier): BenchmarkScene {
  const info = benchmarkLoad(tier);
  const geometry = new SphereGeometry(1, info.widthSegments, info.heightSegments);
  const material = new MeshStandardNodeMaterial({ color: 0xc09060, roughness: 0.8 });
  const scene = new Scene();
  const group = new Group();
  const side = Math.ceil(Math.sqrt(info.objects));
  const pitch = 60 / side;
  for (let i = 0; i < info.objects; i++) {
    const mesh = new Mesh(geometry, material);
    mesh.scale.setScalar(Math.min(1, pitch * 0.45));
    mesh.position.set((i % side) * pitch - 30, 0, Math.floor(i / side) * pitch - 30);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  scene.add(group);
  scene.add(new HemisphereLight(0xbfd4ff, 0x30343c, 1.4));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(30, 60, 20);
  scene.add(sun);
  const camera = new PerspectiveCamera(60, 1, 0.1, 400);
  return {
    ...info,
    scene,
    camera,
    update(tSec: number) {
      const a = tSec * 0.5;
      camera.position.set(Math.cos(a) * 70, 40, Math.sin(a) * 70);
      camera.lookAt(0, 0, 0);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export interface BenchmarkOptions {
  durationMs?: number;
  maxFrames?: number;
  /**
   * The page's UI goes first (BD-FIX-MENU-BOOT-01): while it holds, the run draws nothing, and the interval that spans the hold is left
   * out of the measurement and of the 3 s window. Without a hold the run is the same as without this option.
   */
  hold?: UiHoldGate | null;
}

/** The part of the renderer the measured loop drives (`WebGPURenderer`; tests pass a fake). */
export interface BenchmarkRenderer {
  info: { reset(): void };
  setAnimationLoop(cb: ((t: number) => void) | null): unknown;
  render(scene: Scene, camera: PerspectiveCamera): unknown;
}

/**
 * The measured part of a run: one frame per animation-frame callback until the window (`durationMs` of drawing), `maxFrames` measured
 * frames or a hopeless start ends it. Returns the intervals between consecutive drawn frames, warm-up frames included. A callback that
 * comes while `hold` holds draws nothing and forgets the last frame, so no interval spans a hold: the frame drawn after the hold starts a
 * new interval, and the camera path and the window go on from where they stopped.
 */
export function measureFrames(
  renderer: BenchmarkRenderer,
  bench: Pick<BenchmarkScene, 'scene' | 'camera' | 'update'>,
  o: { durationMs: number; maxFrames: number; limitMs: number; hold?: UiHoldGate | null },
): Promise<number[]> {
  const deltas: number[] = [];
  return new Promise<number[]>((resolve) => {
    let first = -1;
    let last = -1;
    let lastDrawn = -1;
    // The intervals left out because they span a hold; the window is `t - first - skipped`, exactly `t - first` when nothing held.
    let skipped = 0;
    renderer.setAnimationLoop((t: number) => {
      if (o.hold?.held(t)) {
        last = -1;
        return;
      }
      if (first < 0) first = t;
      if (last >= 0) deltas.push(t - last);
      else if (lastDrawn >= 0) skipped += t - lastDrawn;
      last = t;
      lastDrawn = t;
      const elapsed = t - first - skipped;
      renderer.info.reset();
      bench.update(elapsed / 1000);
      renderer.render(bench.scene, bench.camera);
      if (elapsed >= o.durationMs || deltas.length >= o.maxFrames + WARMUP_FRAMES || hopeless(deltas, o.limitMs)) {
        renderer.setAnimationLoop(null);
        resolve(deltas);
      }
    });
  });
}

/** Runs the synthetic benchmark on the host's renderer. The host's own loop must not be running. */
export async function runSyntheticBenchmark(host: RendererHost, tier: QualityTier, opts: BenchmarkOptions = {}): Promise<BenchmarkResult> {
  const durationMs = opts.durationMs ?? BENCHMARK_MAX_MS;
  const maxFrames = opts.maxFrames ?? BENCHMARK_MAX_FRAMES;
  const bench = buildBenchmarkScene(tier);
  const renderer = host.renderer;
  try {
    host.tier = tier;
    const canvas = host.currentCanvas;
    host.resize(Math.max(1, canvas.clientWidth || 640), Math.max(1, canvas.clientHeight || 360));
    bench.camera.aspect = Math.max(1, canvas.clientWidth || 640) / Math.max(1, canvas.clientHeight || 360);
    bench.camera.updateProjectionMatrix();
    await renderer.compileAsync(bench.scene, bench.camera);
    const limitMs = tier.budget.frame.frameBudgetMs * BENCHMARK_TOLERANCE;
    const deltas = await measureFrames(renderer as unknown as BenchmarkRenderer, bench, { durationMs, maxFrames, limitMs, hold: opts.hold ?? null });
    const measured = deltas.slice(WARMUP_FRAMES);
    const total = measured.reduce((a, b) => a + b, 0);
    const s = measured.length >= MIN_FRAMES ? summarizeFrames(measured) : { medianMs: Math.max(0, ...measured), p90Ms: Math.max(0, ...measured) };
    const limit = tier.budget.frame.frameBudgetMs * BENCHMARK_TOLERANCE;
    return {
      scene: 'synthetic',
      settingsTier: tier.id,
      frames: measured.length,
      durationMs: Math.round(total),
      medianMs: round2(s.medianMs),
      p90Ms: round2(s.p90Ms),
      passed: measured.length >= MIN_FRAMES && s.p90Ms <= limit,
    };
  } finally {
    renderer.setAnimationLoop(null);
    bench.dispose();
  }
}

/**
 * Early exit for a run that cannot pass: after 4 measured frames, a mean above 4 times the limit means the 3 s window would end
 * in a step-down anyway (a software renderer at 1 fps would otherwise spend 3 s per rung). Builder decision BD-M01c-06.
 */
export function hopeless(deltas: readonly number[], limitMs: number): boolean {
  const measured = deltas.length - WARMUP_FRAMES;
  if (measured < 4) return false;
  let sum = 0;
  for (let i = WARMUP_FRAMES; i < deltas.length; i++) sum += deltas[i] as number;
  return sum / measured > 4 * limitMs;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
