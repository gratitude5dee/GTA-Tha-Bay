import type { DeviceSignals, PerfReport, QualityTierId, RenderBackend } from '@dv/shared';
import type { EngineBridge } from '../client/debug/bridge.ts';
import type { Platform } from './create-platform.ts';
import { buildNotes, exportReport } from './perf/export.ts';
import { PerfHud } from './perf/hud.ts';
import { RenderBudgetMeter } from './perf/meter.ts';
import type { GovernorState } from './governor/governor.ts';
import type { MemoryLevel, MemoryState } from './memory/memory-budget.ts';
import type { MemoryCounters } from './perf/probe.ts';
import { PerfScenarioRunner, type RunInfo, type WorldScenarioDriver } from './perf/scenario-runner.ts';
import type { QaFlags } from './qa-flags.ts';
import { pixelRatioFor, THREE_REVISION } from './renderer-host.ts';

/**
 * QA-only GPU, XR and perf bridge. Reachable only through a dynamic import guarded by `import.meta.env.VITE_DV_QA === '1'`
 * in the app entry, so production builds contain neither this file, the PerfHud, nor the IWER emulator. Publishes
 * `window.__dvBridge.platform` (11-platform-perf.md section 3).
 */
export interface GpuProbeResult {
  navigatorGpu: boolean;
  /** True when navigator.gpu.requestAdapter() returned an adapter. */
  adapter: boolean;
  vendor: string | null;
  architecture: string | null;
  device: string | null;
  description: string | null;
  isFallbackAdapter: boolean | null;
  features: string[];
  limits: Record<string, number>;
  /** Backend the renderer actually initialised, or null if it failed. */
  backend: RenderBackend | null;
  threeRevision: string;
  crossOriginIsolated: boolean;
  userAgent: string;
  error: string | null;
}

export interface XrState {
  supported: boolean;
  isPresenting: boolean;
  /** Frames rendered while presenting. */
  frames: number;
  sessionMode: string | null;
  error: string | null;
}

/** `window.__dvBridge.platform.memory`: callable for the counters (M01c), with the budget's QA members (M11a1). */
export interface MemoryBridge {
  (): MemoryCounters;
  /** The MemoryBudget now: level, the worst used/cap ratio, the injected MB and the response counters. */
  pressure(): MemoryState;
  /** Adds `mb` of accounted heap on top of the reading (0 clears it) and samples the budget at once; returns the level. */
  injectMB(mb: number): MemoryLevel;
}

/** `window.__dvBridge.platform.governor` (M11a1). */
export interface GovernorBridge {
  state(): GovernorState;
  /** Feeds synthetic rendered-frame times (ms) to the governor as if they had just been drawn. A disabled governor ignores them. */
  inject(frameMs: number[]): void;
  /** The frame pacer: the target it holds, the callbacks it was asked about and the ones it let render. */
  pacer(): { targetFps: number; seen: number; rendered: number; bypassed: boolean };
}

export interface PlatformBridge {
  /** Backend of the renderer if one exists; null before the platform is up. */
  backend(): RenderBackend | null;
  /** The active quality tier. */
  tier(): QualityTierId;
  /** Requests a tier change; resolves when applied (a safe point is open in M01c). */
  setTier(id: QualityTierId): Promise<void>;
  /** `reversed` or `standard` (C04 rule 3). */
  depthPolicy(): 'reversed' | 'standard';
  /** The raw device signals the profile was classified from. */
  signals(): DeviceSignals;
  /** Counters from `renderer.info.memory` plus registered wasm bytes; `.pressure()` and `.injectMB()` reach the MemoryBudget. */
  memory: MemoryBridge;
  /** The runtime quality governor: `state()` and `inject(frameMs)`. */
  governor: GovernorBridge;
  /** The drawing-buffer sizing now (M04b5): `pixelRatio` as the renderer holds it, `budgetRatio` the tier's own ratio at scale 1. */
  resolution(): { cssW: number; cssH: number; dpr: number; pixelRatio: number; budgetRatio: number };
  /** Flat frames drawn and frames the GPU pacer held back (QA builds on WebGL2, BD-FIX-CI7-F03). */
  pacing(): { frames: number; held: number };
  gpuProbe(): Promise<GpuProbeResult>;
  perf: {
    run(id: string, opts?: { durationS?: number; warmupS?: number }): Promise<PerfReport>;
    report(): PerfReport | null;
    /** Meter-versus-renderer.info maxima of the last run (AC-6). */
    info(): RunInfo | null;
    /** Live meter reading of the scene being drawn now. */
    live(): { renderObjects: number; triangles: number };
  };
  xr: {
    enterForTest(): Promise<void>;
    state(): XrState;
  };
}

declare global {
  interface Window {
    __dvBridge?: { platform?: PlatformBridge; engine?: EngineBridge };
  }
}

/** Minimal shape of the WebGPU API used by the probe (the DOM lib does not carry WebGPU types). */
interface GpuAdapterLike {
  features: Iterable<string>;
  limits: object;
  info?: { vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean };
  isFallbackAdapter?: boolean;
}
interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
}

interface XrSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init?: object): Promise<unknown>;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

type AdapterRead = Pick<GpuProbeResult, 'navigatorGpu' | 'adapter' | 'vendor' | 'architecture' | 'device' | 'description' | 'isFallbackAdapter' | 'features' | 'limits'>;

async function readAdapter(): Promise<AdapterRead> {
  const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
  const empty: AdapterRead = {
    navigatorGpu: gpu !== undefined,
    adapter: false,
    vendor: null,
    architecture: null,
    device: null,
    description: null,
    isFallbackAdapter: null,
    features: [],
    limits: {},
  };
  if (!gpu) return empty;
  const a = await gpu.requestAdapter();
  if (!a) return empty;
  const limits: Record<string, number> = {};
  for (const key in a.limits) {
    const v = (a.limits as Record<string, unknown>)[key];
    if (typeof v === 'number') limits[key] = v;
  }
  return {
    navigatorGpu: true,
    adapter: true,
    vendor: a.info?.vendor ?? null,
    architecture: a.info?.architecture ?? null,
    device: a.info?.device ?? null,
    description: a.info?.description ?? null,
    isFallbackAdapter: a.info?.isFallbackAdapter ?? a.isFallbackAdapter ?? null,
    features: [...a.features].sort(),
    limits,
  };
}

/** Installs the IWER Quest 3 emulator. Must run before the device probe and the renderer are created. */
export async function installIwer(): Promise<void> {
  const { XRDevice, XRSession, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3);
  // forceInstall: Chromium has a native navigator.xr, which IWER otherwise leaves in place.
  device.installRuntime({ forceInstall: true });
  giveEmulatedLayersAFramebuffer();
  paceEmulatedFrames(XRSession.prototype as unknown as EmulatedSessionProto);
}

type XrFrameCallback = (time: number, frame: unknown) => void;
interface EmulatedSessionProto {
  requestAnimationFrame(this: EmulatedSession, callback: XrFrameCallback): number;
  cancelAnimationFrame(this: EmulatedSession, handle: number): void;
}
interface EmulatedSession extends EmulatedSessionProto {
  readonly renderState: { readonly baseLayer?: { readonly context?: unknown } | null };
}

/**
 * A headset's compositor never lets an app run ahead of its GPU. The emulated layer renders into the offscreen framebuffer below,
 * which nothing presents, so no back-pressure reaches the XR loop: IWER runs it on every window frame, and on software GL each one
 * queued a stereo world render the GPU had not yet drawn (about 36 queued per second against 5 drawn on SwiftShader). The backlog
 * fell due when the session ended and the canvas was presented again: on CI the main thread stalled for 17 to 60 s, longer the
 * longer the session ran (BD-FIX-CI6-A02). The emulator therefore paces XR frames as a compositor would, on a fence: when the GPU
 * has not finished the previous XR frame, this frame's callbacks move to the next device frame. A real headset runs none of this.
 */
function paceEmulatedFrames(proto: EmulatedSessionProto): void {
  const request = proto.requestAnimationFrame;
  const cancel = proto.cancelAnimationFrame;
  /** Per context: the fence after the last XR frame drawn, and the device frame whose callbacks were last let through or held. */
  const pace = new WeakMap<WebGL2RenderingContext, { fence: WebGLSync | null; time: number; go: boolean }>();
  /** Per session: the handle the caller holds, mapped to the request it currently names (a held callback is requested again). */
  const handles = new WeakMap<EmulatedSession, Map<number, number>>();
  proto.requestAnimationFrame = function (this: EmulatedSession, callback: XrFrameCallback): number {
    const live = handles.get(this) ?? new Map<number, number>();
    handles.set(this, live);
    let outer = 0;
    const run: XrFrameCallback = (time, frame) => {
      const ctx = this.renderState.baseLayer?.context;
      const gl = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext ? ctx : null;
      if (gl) {
        let p = pace.get(gl);
        if (!p) pace.set(gl, (p = { fence: null, time: Number.NaN, go: true }));
        // The first callback of a device frame decides for all of them (IWER passes every callback of a frame the same time).
        if (p.time !== time) {
          p.time = time;
          p.go = p.fence === null || gl.getSyncParameter(p.fence, gl.SYNC_STATUS) !== gl.UNSIGNALED;
        }
        if (!p.go) {
          live.set(outer, request.call(this, run));
          return;
        }
      }
      live.delete(outer);
      callback(time, frame);
      if (gl) {
        const p = pace.get(gl);
        if (p) {
          if (p.fence) gl.deleteSync(p.fence);
          p.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
        }
      }
    };
    outer = request.call(this, run);
    live.set(outer, outer);
    return outer;
  };
  proto.cancelAnimationFrame = function (this: EmulatedSession, handle: number): void {
    const live = handles.get(this);
    const current = live?.get(handle) ?? handle;
    live?.delete(handle);
    cancel.call(this, current);
  };
}

/**
 * IWER 2.6.0's `XRWebGLLayer.framebuffer` is always null (the emulator composites nothing). three r186's WebGL backend keys a
 * WeakMap by the layer framebuffer when it renders into the XR render target, so a null throws on every XR frame
 * (M01b2, BD-M01b2-09). The QA emulator therefore hands each layer an offscreen framebuffer with a colour and a depth
 * renderbuffer the size of the drawing buffer; a real headset passes its own opaque framebuffer and none of this runs.
 */
function giveEmulatedLayersAFramebuffer(): void {
  const Layer = (globalThis as { XRWebGLLayer?: { prototype: object } }).XRWebGLLayer;
  if (!Layer) return;
  const made = new WeakMap<object, { fb: WebGLFramebuffer; w: number; h: number; color: WebGLRenderbuffer; depth: WebGLRenderbuffer }>();
  Object.defineProperty(Layer.prototype, 'framebuffer', {
    configurable: true,
    get(this: { context: WebGL2RenderingContext }) {
      const gl = this.context;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      let e = made.get(this);
      const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const prevRb = gl.getParameter(gl.RENDERBUFFER_BINDING) as WebGLRenderbuffer | null;
      if (!e) {
        const fb = gl.createFramebuffer();
        const color = gl.createRenderbuffer();
        const depth = gl.createRenderbuffer();
        if (!fb || !color || !depth) return null;
        e = { fb, w: 0, h: 0, color, depth };
        made.set(this, e);
      }
      if (e.w !== w || e.h !== h) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, e.fb);
        gl.bindRenderbuffer(gl.RENDERBUFFER, e.color);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, e.color);
        gl.bindRenderbuffer(gl.RENDERBUFFER, e.depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, e.depth);
        gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
        gl.bindRenderbuffer(gl.RENDERBUFFER, prevRb);
        e.w = w;
        e.h = h;
      }
      return e.fb;
    },
  });
}

export function installPlatformBridge(platform: Platform, flags: QaFlags, opts: { worldDriver?: () => WorldScenarioDriver | null } = {}): PlatformBridge {
  const host = platform.host;
  let lastProbe: GpuProbeResult | null = null;
  let xrError: string | null = null;
  let xrMode: string | null = null;

  const runner = new PerfScenarioRunner({
    host,
    tier: () => platform.quality.tier,
    profile: platform.profile,
    build: platform.build,
    now: () => Date.now(),
    wasm: new Map(),
    // The governor is held off during a scenario run unless the page forces it on (`?governor=on`): counts never follow frame times.
    governor: flags.governor === 'on' ? 'on' : 'off',
    dynamicProbe: (() => {
      let off: (() => void)[] = [];
      let min = 1;
      let tiers = 0;
      let down0 = 0;
      let up0 = 0;
      return {
        begin: () => {
          min = platform.quality.dynamic.renderScale;
          tiers = 0;
          down0 = platform.governor.state().downgrades;
          up0 = platform.governor.state().upgrades;
          off = [
            platform.quality.onDynamicChange((q) => void (min = Math.min(min, q.renderScale))),
            platform.quality.onTierChange(() => void (tiers += 1)),
          ];
        },
        end: () => {
          for (const f of off) f();
          off = [];
          const s = platform.governor.state();
          return { minRenderScale: min, downgrades: s.downgrades - down0, upgrades: s.upgrades - up0, tierChanges: tiers };
        },
      };
    })(),
    errors: () => ({ gpuLost: platform.errors.counts.gpuLost, uncaptured: platform.errors.counts.uncaptured, js: platform.errors.counts.js }),
    ...(opts.worldDriver ? { worldDriver: opts.worldDriver } : {}),
  });

  // Live meter: walks the scene being drawn, once per frame, while the HUD or a bridge reader needs it.
  const liveMeter = new RenderBudgetMeter(600);
  let live = { renderObjects: 0, triangles: 0 };
  let liveOn = flags.perf;
  host.addFrameListener({
    after: () => {
      if (!liveOn || runner.isRunning) return;
      const a = host.active;
      live = liveMeter.measure(a.scene, a.camera, host.shadowPasses, host.backdrop && !host.menuActive ? [host.backdrop] : []);
    },
  });

  // Declared below; the HUD buttons call it after the bridge exists.
  // eslint-disable-next-line prefer-const
  let bridge: PlatformBridge;

  if (flags.perf) {
    const hud = new PerfHud({
      read: () => ({
        tier: platform.quality.tier.id,
        backend: host.backend,
        frameMs: platform.sampler.probe,
        renderObjects: live.renderObjects,
        triangles: live.triangles,
        memory: platform.memory(),
        governor: platform.governor.enabled ? 'on' : 'off',
        running: runner.isRunning,
      }),
      onRun: (durationS) => {
        void bridge.perf.run(flags.scenario ?? 'graybox-walk', { durationS }).catch((e: unknown) => console.warn('perf run failed', e));
      },
      onExport: () => {
        void buildNotes({ now: Date.now(), tier: platform.quality.tier.id, backend: host.backend, signals: platform.profile.signals, assets: platform.assets }).then((notes) =>
          exportReport(runner.report(), notes),
        );
      },
    });
    void hud;
  }

  bridge = {
    backend: () => (host.ready ? host.backend : null),
    tier: () => platform.quality.tier.id,
    setTier: (id) => platform.quality.setTier(id, 'url-override'),
    depthPolicy: () => host.depthPolicy,
    signals: () => platform.profile.signals,
    memory: Object.assign(() => platform.memory(), {
      pressure: () => platform.memoryBudget.state(performance.now()),
      injectMB: (mb: number) => {
        platform.memoryBudget.injectMB(mb);
        return platform.memoryBudget.sample(performance.now());
      },
    }),
    governor: {
      state: () => platform.governor.state(),
      inject: (frameMs) => platform.governor.inject(frameMs),
      pacer: () => ({ targetFps: platform.pacer.targetFps, seen: platform.pacer.seen, rendered: platform.pacer.rendered, bypassed: platform.pacer.bypassed }),
    },
    pacing: () => ({ frames: host.frames, held: host.pacedFrames }),
    resolution: () => {
      const canvas = host.currentCanvas;
      const cssW = Math.max(1, canvas.clientWidth);
      const cssH = Math.max(1, canvas.clientHeight);
      const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
      return { cssW, cssH, dpr, pixelRatio: host.renderer.getPixelRatio(), budgetRatio: pixelRatioFor(platform.quality.tier, cssW, cssH, dpr, 1) };
    },

    async gpuProbe() {
      if (lastProbe) return lastProbe;
      let adapterInfo: AdapterRead;
      let error: string | null = null;
      try {
        adapterInfo = await readAdapter();
      } catch (e) {
        error = errorMessage(e);
        adapterInfo = { navigatorGpu: false, adapter: false, vendor: null, architecture: null, device: null, description: null, isFallbackAdapter: null, features: [], limits: {} };
      }
      lastProbe = {
        ...adapterInfo,
        backend: host.ready ? host.backend : null,
        threeRevision: THREE_REVISION,
        crossOriginIsolated: self.crossOriginIsolated,
        userAgent: navigator.userAgent,
        error,
      };
      return lastProbe;
    },

    perf: {
      run: (id, opts) => {
        liveOn = false;
        const governorWas = platform.governor.enabled;
        if (flags.governor !== 'on') platform.governor.setEnabled(false);
        return runner.run(id, opts ?? {}).finally(() => {
          liveOn = flags.perf;
          platform.governor.setEnabled(governorWas);
        });
      },
      report: () => runner.report(),
      info: () => runner.info(),
      live: () => {
        if (!liveOn) {
          const a = host.active;
          live = liveMeter.measure(a.scene, a.camera, host.shadowPasses, host.backdrop && !host.menuActive ? [host.backdrop] : []);
        }
        return live;
      },
    },

    xr: {
      async enterForTest() {
        xrError = null;
        try {
          const xr = (navigator as unknown as { xr?: XrSystemLike }).xr;
          if (!xr) throw new Error('navigator.xr is not available');
          // Under IWER no user gesture is needed. On real devices XR starts only from a click handler.
          const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
          xrMode = 'immersive-vr';
          await host.renderer.xr.setSession(session as XRSession);
        } catch (e) {
          xrError = errorMessage(e);
          throw e;
        }
      },
      state() {
        return {
          supported: (navigator as unknown as { xr?: unknown }).xr !== undefined,
          isPresenting: host.isPresenting,
          frames: host.xrFrames,
          sessionMode: xrMode,
          error: xrError,
        };
      },
    },
  };

  window.__dvBridge = { ...window.__dvBridge, platform: bridge };
  return bridge;
}
