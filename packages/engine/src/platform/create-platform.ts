import {
  C13_VERSION,
  type BenchmarkResult,
  type DeviceProfile,
  type PlatformSettings,
  type QualityTier,
  type QualityTierId,
  type RenderBackend,
  type TelemetryEnvelope,
  type TierDecision,
  type TierDecisionSource,
} from '@dv/shared';
import type { AssetClient, WorkerPort } from '../assets/client.ts';
import { startAssets } from '../assets/spawn.ts';
import { requestPersist } from '../assets/store/persist.ts';
import { DeviceProbe, type ProbeEnv } from './device-probe.ts';
import { LifecycleController } from './lifecycle.ts';
import { createIdbStore, type PlatformStore } from './platform-store.ts';
import type { ByteSource } from './perf/probe.ts';
import { FrameSampler, readMemory, type MemoryCounters } from './perf/probe.ts';
import type { QaFlags } from './qa-flags.ts';
import { QualityServiceImpl } from './quality-service.ts';
import type { CreateRenderer, RendererHost } from './renderer-host.ts';
import { TierSelector, type RunBenchmark } from './tier-select.ts';
import { TelemetryClient, osMajorOf, type TimerApi } from './telemetry/client.ts';
import { ErrorReporter } from './telemetry/errors.ts';
import { Heartbeat, RafWatchdog, type KeyValueStorage } from './telemetry/heartbeat.ts';
import { TIERS } from './tier-config.ts';

/**
 * `createPlatform` (C13 section 5.1, boot sequence). Order: heartbeat and telemetry start, `DeviceProbe` and `classifyDevice`,
 * the tier decision that needs no renderer (override or stored), the renderer host with the (XR) tier's backend policy, the
 * benchmark when none is stored, the persisted `TierDecision`, then `app.start`, `tier.decision` and `app.ready`.
 *
 * Not a contract. Everything with a side effect is injectable so unit tests run it with fakes.
 */
export interface CreatePlatformOptions {
  canvas: HTMLCanvasElement;
  flags: QaFlags;
  build: string;
  env?: ProbeEnv;
  store?: PlatformStore;
  /** `localStorage` by default; null when unavailable. */
  storage?: KeyValueStorage | null;
  createRenderer?: CreateRenderer;
  /** Epoch ms. */
  now?: () => number;
  /** Milliseconds since navigation start (`performance.now()`). */
  perfNow?: () => number;
  timers?: TimerApi;
  send?: (body: string, viaBeacon: boolean) => void;
  sessionId?: string;
  nav?: 'navigate' | 'reload' | 'back_forward';
  events?: { unsupported?: (e: Error) => void; reloadPrompt?: () => void };
  /** Replaces the synthetic benchmark (tests). */
  benchmark?: (host: RendererHost, tier: QualityTier) => Promise<BenchmarkResult>;
  /** Start the host's render loop at the end of boot. Default true. */
  startLoop?: boolean;
  /** Attach the lifecycle, error and watchdog listeners to the real document and window. Default true. */
  attachListeners?: boolean;
  /** Consent read at boot, before any save profile loads. Defaults to the stored `PlatformSettings`. */
  consent?: PlatformSettings['telemetryConsent'];
  /** Probability of keeping a desktop `perf.minute` (25 %). Tests pass a constant. */
  sample?: () => number;
  /**
   * The asset client (M01e). Default: start `asset.worker` and wait for the store to open. Pass `null` to run without one
   * (`app.start` then reports `store: 'memory'`); unit tests pass a fake.
   */
  assets?: AssetClient | null;
  /** Creates asset.worker when no client is passed: the app supplies the composed worker with the world jobs (M02b1). Default: the engine's own. */
  spawnAssetWorker?: () => WorkerPort;
  /**
   * `BootConfig.region` for the telemetry gate (BD-FIX-CI-01): a blocked region never calls the gated `POST /api/v1/t`. Default: one
   * `GET /api/v1/boot` (geo-exempt) where there is a page and `fetch`; `null` sends without waiting (unit tests).
   */
  region?: Promise<'ok' | 'blocked'> | null;
}

/** Reads `region` from `GET /api/v1/boot`. Anything but an explicit 'blocked' counts as 'ok' (offline, an error, an old Worker). */
export async function fetchBootRegion(fetchFn: typeof fetch = fetch, origin = ''): Promise<'ok' | 'blocked'> {
  try {
    const res = await fetchFn(`${origin}/api/v1/boot`, { cache: 'no-store' });
    if (!res.ok) return 'ok';
    const body = (await res.json()) as { region?: unknown } | null;
    return body?.region === 'blocked' ? 'blocked' : 'ok';
  } catch {
    return 'ok';
  }
}

export interface Platform {
  readonly profile: DeviceProfile;
  readonly host: RendererHost;
  readonly quality: QualityServiceImpl;
  readonly telemetry: TelemetryClient;
  readonly heartbeat: Heartbeat;
  readonly errors: ErrorReporter;
  readonly sampler: FrameSampler;
  /** Null where there is no document (unit tests). */
  readonly lifecycle: LifecycleController | null;
  readonly decision: TierDecision;
  readonly settings: PlatformSettings;
  readonly backend: RenderBackend;
  readonly sessionId: string;
  readonly build: string;
  readonly store: PlatformStore;
  /** The world-pack client; null when workers are unavailable or the asset worker failed to start. */
  readonly assets: AssetClient | null;
  /** Counters from `renderer.info.memory` plus the registered wasm bytes. */
  memory(): MemoryCounters;
  /** Registers an accounted byte source (a wasm memory, a SharedArrayBuffer block). */
  registerBytes(name: string, read: ByteSource): () => void;
  /** The engine's hooks for the lifecycle: pause the sim, clamp the next dt. */
  bindEngine(b: { setPaused: (p: boolean) => void; resetClock: () => void }): void;
  dispose(): void;
}

function guardedStorage(): KeyValueStorage | null {
  try {
    const s = globalThis.localStorage;
    // Touch it: Safari private windows throw on write.
    s.setItem('dv.probe', '1');
    s.removeItem('dv.probe');
    return s;
  } catch {
    return null;
  }
}

function navType(): 'navigate' | 'reload' | 'back_forward' {
  try {
    const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (e?.type === 'reload' || e?.type === 'back_forward') return e.type;
  } catch {
    // Not available in this environment.
  }
  return 'navigate';
}

function newSessionId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `s${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

const GLOBAL_TIMERS: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as number),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as number),
};

/** Sources whose persisted decision is a measurement or a demotion rather than a transient override. */
const PERSISTED: ReadonlySet<TierDecisionSource> = new Set([
  'auto-benchmark',
  'abnormal-exit-demotion',
  'governor-demotion',
  'memory-pressure',
]);

export async function createPlatform(o: CreatePlatformOptions): Promise<Platform> {
  const now = o.now ?? Date.now;
  const perfNow = o.perfNow ?? ((): number => performance.now());
  const timers = o.timers ?? GLOBAL_TIMERS;
  const shellMs = perfNow();
  const sessionId = o.sessionId ?? newSessionId();
  const store = o.store ?? createIdbStore();
  const storage = o.storage === undefined ? guardedStorage() : o.storage;
  // Asked first so that the answer is usually in before the first flush (app.ready plus 200 ms).
  const region =
    o.region !== undefined ? o.region : typeof location !== 'undefined' && typeof fetch === 'function' ? fetchBootRegion(fetch, location.origin) : null;

  // Settings (consent first: the boot events respect it).
  const settings = await store.getSettings();
  const consent = o.consent ?? settings.telemetryConsent;

  // Device signals and profile.
  const probe = new DeviceProbe(o.env);
  const profile = await probe.classify();

  // Telemetry and the heartbeat. The envelope is read at flush time, after the backend and tier are known.
  let hostRef: RendererHost | null = null;
  let quality: QualityServiceImpl | null = null;
  const envelope = (): TelemetryEnvelope => ({
    tier: quality?.tier.id ?? 'desktop',
    deviceClass: profile.class,
    osMajor: osMajorOf(profile.signals.userAgent),
    displayMode: hostRef?.isPresenting ? 'xr' : profile.displayMode,
    backend: hostRef?.ready ? hostRef.backend : 'webgl2',
  });
  const telemetry = new TelemetryClient({
    build: o.build,
    sessionId,
    env: envelope,
    consent,
    now,
    timers,
    ...(o.send ? { send: o.send } : {}),
    ...(region ? { region } : {}),
  });
  const bytes = new Map<string, ByteSource>();
  const memEst = (): { memEstMB: number; gpuEstMB: number } => {
    const m = readMemory(hostRef?.ready ? (hostRef.renderer as unknown as { info: Parameters<typeof readMemory>[0] }).info : null, bytes);
    return { memEstMB: Math.round(m.gpuMB + m.wasmMB), gpuEstMB: Math.round(m.gpuMB) };
  };
  const heartbeat = new Heartbeat({
    storage,
    sid: sessionId,
    build: o.build,
    now,
    timers,
    emitter: telemetry,
    capsOf: (id) => {
      const b = TIERS[id].budget.memory;
      return { maxAccountedHeapMB: b.maxAccountedHeapMB, maxGpuResourceMB: b.maxGpuResourceMB };
    },
    memory: memEst,
  });
  telemetry.attachHeartbeat(heartbeat);
  const analysis = heartbeat.analyzePrevious();
  const errors = new ErrorReporter(telemetry);

  // The asset worker starts in parallel with the tier decision and renderer; `app.start` waits for its `open()`.
  const assetsPromise: Promise<AssetClient | null> =
    o.assets !== undefined
      ? Promise.resolve(o.assets)
      : startAssets({
          ...(o.spawnAssetWorker ? { spawn: o.spawnAssetWorker } : {}),
          init: { origin: typeof location === 'undefined' ? '' : location.origin, localMedia: import.meta.env.VITE_DV_QA === '1' ? '/media-local' : null, mobileOrXr: profile.class !== 'desktop' },
          tier: () => quality?.tier.id ?? 'mobile-low',
          onTelemetry: (name, props) => telemetry.emit(name, props),
        });

  const selector = new TierSelector({
    profile,
    build: o.build,
    qa: o.flags,
    store,
    settings,
    now,
    benchmark: null,
    backend: null,
  });

  // The decision that needs no renderer decides which backend policy the renderer is built with.
  const early = await selector.resolve();
  const xrTierId: QualityTierId | null =
    o.flags.xrEmulate !== null ? 'xr-quest' : profile.xrHeadset === 'quest' ? 'xr-quest' : profile.xrHeadset === 'visionpro' ? 'xr-visionpro' : null;
  const initTierId = xrTierId ?? early?.decision.tier ?? selector.provisional();
  const initTier = TIERS[initTierId];
  // The record of this session starts now, so a page killed during the first-boot benchmark is still seen at the next boot.
  heartbeat.start({ tier: initTierId, backend: 'webgl2' });

  const { RendererHost: HostClass } = await import('./renderer-host.ts');
  const { runSyntheticBenchmark } = await import('./benchmark.ts');
  const host = new HostClass({
    canvas: o.canvas,
    ...(o.createRenderer ? { createRenderer: o.createRenderer } : {}),
    qa: o.flags,
    compatibilityMode: settings.compatibilityMode,
    // QA builds on a software WebGPU fallback adapter (SwiftShader through Vulkan, the `chromium-webgpu` project) pace flat WebGL2 frames
    // on GPU fences, as a compositor would: that headless setup gives WebGL no back-pressure. Every other browser keeps its own pacing,
    // and production builds always do (BD-FIX-CI7-F03).
    paceGpu: import.meta.env.VITE_DV_QA === '1' && profile.signals.adapter?.isFallbackAdapter === true,
    events: {
      gpuError: (kind, message) => errors.gpu(kind, message),
      unsupported: (e) => o.events?.unsupported?.(e),
      reloadPrompt: () => o.events?.reloadPrompt?.(),
    },
  });
  hostRef = host;
  await host.init(initTier);
  const backend = host.backend;
  heartbeat.patch({ backend });

  // Tier: the early decision, or the benchmark.
  let selection = early;
  const flat = (id: QualityTierId): QualityTier => TIERS[id];
  if (!selection) {
    const run: RunBenchmark = (tier) => (o.benchmark ? o.benchmark(host, tier) : runSyntheticBenchmark(host, tier));
    selector.useBenchmark(run, backend);
    selection = await selector.benchmarkSelection();
  }
  let decision = selection.decision;
  // Two qualifying abnormal exits on this tier demote it one rung (11-platform-pwa.md section 9).
  if (analysis.demoteFrom !== null && analysis.demoteFrom === decision.tier && decision.source !== 'url-override' && decision.source !== 'user-override') {
    const demoted = await selector.demote(decision.tier, 'abnormal-exit-demotion');
    if (demoted) decision = demoted;
  }
  host.tier = flat(decision.tier);

  quality = new QualityServiceImpl({
    profile,
    backend,
    initial: decision.tier,
    safeAtStart: true,
    apply: async (next, prev, reason) => {
      host.tier = next;
      host.resize(host.currentCanvas.clientWidth || 1, host.currentCanvas.clientHeight || 1);
      heartbeat.patch({ tier: next.id });
      heartbeat.note(`tier:${prev.id}>${next.id}`);
      telemetry.emit('tier.decision', { tier: next.id, source: reason });
      if (PERSISTED.has(reason)) {
        await store.putTierDecision({
          v: 1,
          tier: next.id,
          source: reason,
          decidedAt: now(),
          build: o.build,
          uaHash: profile.uaHash,
          adapterHash: profile.adapterHash,
          c13: C13_VERSION,
        });
      }
    },
  });

  // Size the drawing buffer under the tier caps.
  const canvas = host.currentCanvas;
  host.resize(canvas.clientWidth || 640, canvas.clientHeight || 360);

  heartbeat.patch({ tier: decision.tier });
  if (analysis.demoteFrom !== null && decision.source === 'abnormal-exit-demotion') heartbeat.note('demoted');

  // Frame sampler: the continuous frame ring for perf.minute, the HUD and the stall watchdog.
  const info = (): Parameters<typeof readMemory>[0] => (host.ready ? (host.renderer as unknown as { info: Parameters<typeof readMemory>[0] }).info : null);
  const sampler = new FrameSampler(info);
  const watchdog = new RafWatchdog(perfNow, timers, () => heartbeat.note('raf.stall'));
  host.addFrameListener({
    before: (t) => {
      sampler.before(t);
      watchdog.frame();
    },
    after: () => sampler.after(),
  });

  // Events: app.start, tier.decision, app.ready. `store` is what the asset worker's open() returned.
  const assets = await assetsPromise;
  const nav = o.nav ?? navType();
  telemetry.emit('app.start', {
    nav,
    coi: profile.signals.crossOriginIsolated,
    store: assets?.storeKind === 'opfs' ? 'opfs' : 'memory',
    backend,
    tier: decision.tier,
  });
  telemetry.emit('tier.decision', {
    tier: decision.tier,
    source: decision.source,
    ...(decision.benchmark ? { benchP90Ms: decision.benchmark.p90Ms } : {}),
  });
  // The first standalone launch asks the browser to protect the origin's storage (once per profile; story start asks from M05a1).
  if (profile.displayMode === 'standalone') {
    void requestPersist('standalone', {
      storage: typeof navigator === 'undefined' ? null : navigator.storage,
      marker: storage,
      emit: (name, props) => telemetry.emit(name, props),
    });
  }
  telemetry.emit('app.ready', { bootMs: Math.round(perfNow()), phaseShellMs: Math.round(shellMs), phaseWorldMs: 0, nav });
  telemetry.start();
  telemetry.flushSoon();

  // perf.minute: 100 % on mobile and XR, 25 % on desktop.
  const keepDesktop = o.sample ?? Math.random;
  const minuteTimer = timers.setInterval(() => {
    const s = sampler.takeMinute();
    if (!s) return;
    if (profile.class === 'desktop' && keepDesktop() >= 0.25) return;
    const m = memEst();
    const mem = readMemory(info(), bytes);
    telemetry.emit('perf.minute', {
      fpsP50: s.fpsP50,
      fpsP5: s.fpsP5,
      frameP95Ms: s.frameP95Ms,
      drawCalls: s.drawCalls,
      tris: s.tris,
      texMBEst: Math.round(mem.texturesMB),
      gpuMBEst: m.gpuEstMB,
      memEstMB: m.memEstMB,
    });
  }, 60_000);

  // Lifecycle, error and watchdog listeners.
  let engineBinding: { setPaused: (p: boolean) => void; resetClock: () => void } | null = null;
  const lifecycle =
    typeof document !== 'undefined' && typeof window !== 'undefined'
      ? new LifecycleController({
          doc: document,
          win: window,
          heartbeat,
          telemetry,
          setPaused: (p) => engineBinding?.setPaused(p),
          clampNextDt: () => {
            sampler.resetClock();
            engineBinding?.resetClock();
          },
        })
      : null;
  let uninstallErrors: (() => void) | null = null;
  if (lifecycle && o.attachListeners !== false) {
    lifecycle.attach();
    uninstallErrors = errors.install();
    watchdog.start();
  }
  if (o.startLoop !== false) host.startLoop();

  const platform: Platform = {
    profile,
    host,
    quality,
    telemetry,
    heartbeat,
    errors,
    sampler,
    lifecycle,
    get decision() {
      return decision;
    },
    settings,
    backend,
    sessionId,
    build: o.build,
    store,
    assets,
    memory: () => readMemory(info(), bytes),
    registerBytes: (name, read) => {
      bytes.set(name, read);
      return () => bytes.delete(name);
    },
    bindEngine: (b) => {
      engineBinding = b;
    },
    dispose: () => {
      timers.clearInterval(minuteTimer);
      lifecycle?.detach();
      uninstallErrors?.();
      watchdog.stop();
      assets?.dispose();
      heartbeat.markClosed();
      heartbeat.stop();
      telemetry.flush('pagehide');
      telemetry.stop();
      host.dispose();
    },
  };
  return platform;
}
