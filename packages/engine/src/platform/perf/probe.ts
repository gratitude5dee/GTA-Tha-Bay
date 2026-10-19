/**
 * PerfProbe (11-platform-perf.md section 3): a frame-time ring of 36,000 `Float32Array` samples (10 minutes at 60 fps) with
 * percentiles and hitch counters. Pure: the caller pushes the rAF (or XRFrame) delta of every rendered frame.
 */
export const PERF_RING_SAMPLES = 36_000;

export interface FrameStats {
  count: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Frames longer than 50 ms. */
  over50ms: number;
  /** Frames longer than twice the budget. */
  over2xBudget: number;
}

/** Nearest-rank percentile of an ascending array. */
export function percentileOf(sortedAsc: ArrayLike<number>, q: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const i = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
  return sortedAsc[i] as number;
}

export class PerfProbe {
  private readonly ring: Float32Array;
  private head = 0;
  private filled = 0;
  /** Total samples pushed since the last reset (not capped by the ring). */
  total = 0;

  constructor(capacity: number = PERF_RING_SAMPLES) {
    this.ring = new Float32Array(capacity);
  }

  get capacity(): number {
    return this.ring.length;
  }

  /** Number of samples currently held (at most `capacity`). */
  get count(): number {
    return this.filled;
  }

  push(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs < 0) return;
    this.ring[this.head] = frameMs;
    this.head = (this.head + 1) % this.ring.length;
    if (this.filled < this.ring.length) this.filled += 1;
    this.total += 1;
  }

  reset(): void {
    this.head = 0;
    this.filled = 0;
    this.total = 0;
  }

  /** The held samples in ascending order. */
  sorted(): Float32Array {
    const out = this.ring.slice(0, this.filled);
    out.sort();
    return out;
  }

  percentile(q: number): number {
    return percentileOf(this.sorted(), q);
  }

  /** Percentiles and hitch counts over the held samples. `budgetMs` is the tier's frame budget (over2xBudget). */
  stats(budgetMs: number): FrameStats {
    const s = this.sorted();
    let over50 = 0;
    let over2x = 0;
    for (let i = 0; i < s.length; i++) {
      const v = s[i] as number;
      if (v > 50) over50 += 1;
      if (v > 2 * budgetMs) over2x += 1;
    }
    return {
      count: s.length,
      medianMs: percentileOf(s, 0.5),
      p95Ms: percentileOf(s, 0.95),
      p99Ms: percentileOf(s, 0.99),
      maxMs: s.length > 0 ? (s[s.length - 1] as number) : 0,
      over50ms: over50,
      over2xBudget: over2x,
    };
  }
}

/** The slice of `renderer.info` the platform reads (three r186 names: render.drawCalls, render.triangles, memory.*). */
export interface RendererInfoLike {
  render: { drawCalls: number; triangles: number };
  memory: { texturesSize?: number; geometries?: number; textures?: number; total?: number };
}

const MB = 1024 * 1024;

export interface MemoryCounters {
  textures: number;
  geometries: number;
  texturesMB: number;
  gpuMB: number;
  /** Bytes of registered WebAssembly memories and buffers, in MB. */
  wasmMB: number;
}

/** A named source of accounted bytes (a wasm `memory.buffer`, a SharedArrayBuffer block). */
export type ByteSource = () => number;

/**
 * Counters only (11-platform-perf.md section 5): `renderer.info.memory` plus the registered wasm bytes. It is an estimate for
 * the heartbeat and the perf report, not a measurement of the process.
 */
export function readMemory(info: RendererInfoLike | null, wasm: ReadonlyMap<string, ByteSource>): MemoryCounters {
  let wasmBytes = 0;
  for (const read of wasm.values()) wasmBytes += read();
  return {
    textures: info?.memory.textures ?? 0,
    geometries: info?.memory.geometries ?? 0,
    texturesMB: (info?.memory.texturesSize ?? 0) / MB,
    gpuMB: (info?.memory.total ?? 0) / MB,
    wasmMB: wasmBytes / MB,
  };
}

/** Per-minute window for the `perf.minute` event: frame percentiles and the largest draw and triangle counts. */
export interface MinuteStats {
  fpsP50: number;
  fpsP5: number;
  frameP95Ms: number;
  drawCalls: number;
  tris: number;
  frames: number;
}

/**
 * Frame listener that feeds a `PerfProbe` with the rAF delta of every rendered frame and keeps the `renderer.info` maxima of
 * the current window. Cheap enough for production: it reads two counters per frame and does not walk the scene.
 */
export class FrameSampler {
  readonly probe: PerfProbe;
  private last = -1;
  private drawMax = 0;
  private triMax = 0;
  private window = new PerfProbe(7200);
  /** Rendered frames since creation. */
  frames = 0;

  constructor(
    private readonly info: () => RendererInfoLike | null,
    capacity: number = PERF_RING_SAMPLES,
  ) {
    this.probe = new PerfProbe(capacity);
  }

  before(time: number): void {
    if (this.last >= 0) {
      const dt = time - this.last;
      this.probe.push(dt);
      this.window.push(dt);
    }
    this.last = time;
  }

  after(): void {
    this.frames += 1;
    const i = this.info();
    if (!i) return;
    if (i.render.drawCalls > this.drawMax) this.drawMax = i.render.drawCalls;
    if (i.render.triangles > this.triMax) this.triMax = i.render.triangles;
  }

  /** Forget the frame before the next one (a hidden tab or a pause makes a long first delta). */
  resetClock(): void {
    this.last = -1;
  }

  /** Stats of the window since the last call, then starts a new window. Null when the window holds fewer than 2 frames. */
  takeMinute(): MinuteStats | null {
    const w = this.window;
    const out: MinuteStats | null =
      w.count >= 2
        ? {
            fpsP50: round1(1000 / Math.max(0.001, w.percentile(0.5))),
            // The 5th-percentile fps is the 95th-percentile frame time.
            fpsP5: round1(1000 / Math.max(0.001, w.percentile(0.95))),
            frameP95Ms: round2(w.percentile(0.95)),
            drawCalls: this.drawMax,
            tris: Math.round(this.triMax),
            frames: w.count,
          }
        : null;
    this.window = new PerfProbe(7200);
    this.drawMax = 0;
    this.triMax = 0;
    return out;
  }
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
