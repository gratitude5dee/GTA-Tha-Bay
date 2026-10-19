import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BenchmarkResult, DeviceSignals, QualityTier } from '@dv/shared';
import type { ProbeEnv } from '../../src/platform/device-probe.ts';
import type { CreateRenderer, RendererFactoryOptions } from '../../src/platform/renderer-host.ts';
import type { TimerApi } from '../../src/platform/telemetry/client.ts';
import type { KeyValueStorage } from '../../src/platform/telemetry/heartbeat.ts';

const root = (p: string): string => fileURLToPath(new URL(`../../../../${p}`, import.meta.url));

export function uaFixture(name: string): DeviceSignals {
  return (JSON.parse(readFileSync(root(`tools/ci/fixtures/ua/${name}.json`), 'utf8')) as { signals: DeviceSignals }).signals;
}

/** A `ProbeEnv` replaying captured signals, without touching the real navigator. */
export function envFrom(s: DeviceSignals): ProbeEnv {
  return {
    navigator: {
      userAgent: s.userAgent,
      platform: s.platform,
      maxTouchPoints: s.maxTouchPoints,
      hardwareConcurrency: s.hardwareConcurrency,
      ...(s.deviceMemoryGB !== null ? { deviceMemory: s.deviceMemoryGB } : {}),
      ...(s.hasNavigatorGpu
        ? {
            gpu: {
              requestAdapter: () =>
                Promise.resolve(
                  s.adapter
                    ? {
                        features: s.gpuFeatures,
                        limits: { maxTextureDimension2D: s.adapter.maxTextureDimension2D, maxBufferSize: s.adapter.maxBufferSize },
                        info: { ...s.adapter },
                      }
                    : null,
                ),
            },
          }
        : {}),
      ...(s.hasNavigatorXr ? { xr: { isSessionSupported: () => Promise.resolve(s.immersiveVrSupported === true) } } : {}),
    } as unknown as ProbeEnv['navigator'],
    screen: { width: s.screen.w, height: s.screen.h },
    devicePixelRatio: s.screen.dpr,
    crossOriginIsolated: s.crossOriginIsolated,
    matchMedia: () => ({ matches: s.displayModeStandalone }),
    ...(s.hasXrGpuBinding ? { XRGPUBinding: {} } : {}),
  };
}

export class FakeStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

export class FakeClock {
  t: number;
  constructor(start = 1_800_000_000_000) {
    this.t = start;
  }
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Timers that never fire on their own; tests call `fire()`. */
export class FakeTimers implements TimerApi {
  private n = 0;
  readonly intervals = new Map<number, { fn: () => void; ms: number }>();
  readonly timeouts = new Map<number, { fn: () => void; ms: number }>();
  setTimeout(fn: () => void, ms: number): unknown {
    this.timeouts.set(++this.n, { fn, ms });
    return this.n;
  }
  clearTimeout(h: unknown): void {
    this.timeouts.delete(h as number);
  }
  setInterval(fn: () => void, ms: number): unknown {
    this.intervals.set(++this.n, { fn, ms });
    return this.n;
  }
  clearInterval(h: unknown): void {
    this.intervals.delete(h as number);
  }
  /** Runs every interval whose period equals `ms`. */
  tick(ms: number): void {
    for (const i of [...this.intervals.values()]) if (i.ms === ms) i.fn();
  }
  runTimeouts(): void {
    for (const [k, v] of [...this.timeouts]) {
      this.timeouts.delete(k);
      v.fn();
    }
  }
}

export interface FakeRendererState {
  created: RendererFactoryOptions[];
  renderers: FakeRenderer[];
  disposed: number;
}

export class FakeRenderer {
  xr = { enabled: false, isPresenting: false };
  shadowMap = { type: 0 };
  toneMapping = 0;
  info = {
    autoReset: true,
    render: { drawCalls: 0, triangles: 0 },
    memory: { texturesSize: 0, total: 0, textures: 0, geometries: 0 },
    reset: (): void => {},
  };
  reversedDepthBuffer: boolean;
  backend: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean; device?: { features: string[] } };
  onDeviceLost: (info: { reason?: string | null; message?: string }) => void = () => {};
  onError: (info: unknown) => void = () => {};
  loop: ((t: number) => void) | null = null;
  disposed = false;

  constructor(
    readonly opts: RendererFactoryOptions,
    private readonly behavior: { failInit?: boolean; backend: 'webgpu' | 'webgl2' },
  ) {
    this.reversedDepthBuffer = true;
    this.backend = behavior.backend === 'webgpu' ? { isWebGPUBackend: true } : { isWebGLBackend: true };
  }

  init(): Promise<void> {
    return this.behavior.failInit ? Promise.reject(new Error('WebGPU adapter not found')) : Promise.resolve();
  }
  setAnimationLoop(fn: ((t: number) => void) | null): void {
    this.loop = fn;
  }
  setPixelRatio(): void {}
  setSize(): void {}
  render(): void {}
  compileAsync(): Promise<void> {
    return Promise.resolve();
  }
  dispose(): void {
    this.disposed = true;
  }
}

/**
 * Factory for a fake renderer. `webgpuInitFails` makes every non-forced renderer reject `init()`; `webglInitFails` makes the
 * forced WebGL2 one reject as well.
 */
export function fakeFactory(opts: { webgpuInitFails?: boolean; webglInitFails?: boolean } = {}): { create: CreateRenderer; state: FakeRendererState } {
  const state: FakeRendererState = { created: [], renderers: [], disposed: 0 };
  const create: CreateRenderer = (o) => {
    state.created.push(o);
    const webgl = o.forceWebGL;
    const r = new FakeRenderer(o, {
      failInit: webgl ? opts.webglInitFails === true : opts.webgpuInitFails === true,
      backend: webgl ? 'webgl2' : 'webgpu',
    });
    state.renderers.push(r);
    return r as unknown as ReturnType<CreateRenderer>;
  };
  return { create, state };
}

/** Benchmark stub: p90 per tier id, in ms. */
export function fakeBenchmark(p90ByTier: Partial<Record<string, number>>, calls: string[] = []): (tier: QualityTier) => Promise<BenchmarkResult> {
  return (tier) => {
    calls.push(tier.id);
    const p90 = p90ByTier[tier.id] ?? 10;
    return Promise.resolve({
      scene: 'synthetic',
      settingsTier: tier.id,
      frames: 180,
      durationMs: 3000,
      medianMs: p90 * 0.8,
      p90Ms: p90,
      passed: p90 <= tier.budget.frame.frameBudgetMs * 1.1,
    });
  };
}
