import type { RenderBackend } from '@dv/shared';
import type { EngineBridge } from '../client/debug/bridge.ts';
import type { QaFlags } from './qa-flags.ts';
import { RendererHost, THREE_REVISION } from './renderer-host.ts';

/**
 * QA-only GPU and XR probe. Reachable only through a dynamic import guarded by
 * `import.meta.env.VITE_DV_QA === '1'` in the app entry, so production builds contain neither this file,
 * `three`, nor the IWER emulator. Publishes `window.__dvBridge.platform` (11-platform-perf.md section 3).
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

export interface PlatformBridge {
  /** Backend of the renderer if one exists; null before the first probe. */
  backend(): RenderBackend | null;
  gpuProbe(): Promise<GpuProbeResult>;
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

async function readAdapter(): Promise<Pick<GpuProbeResult, 'navigatorGpu' | 'adapter' | 'vendor' | 'architecture' | 'device' | 'description' | 'isFallbackAdapter' | 'features' | 'limits'>> {
  const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
  const empty = {
    navigatorGpu: gpu !== undefined,
    adapter: false,
    vendor: null,
    architecture: null,
    device: null,
    description: null,
    isFallbackAdapter: null,
    features: [] as string[],
    limits: {} as Record<string, number>,
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

/** Installs the IWER Quest 3 emulator. Must run before the renderer is constructed. */
async function installIwer(): Promise<void> {
  const { XRDevice, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3);
  // forceInstall: Chromium has a native navigator.xr, which IWER otherwise leaves in place.
  device.installRuntime({ forceInstall: true });
}

export function installPlatformBridge(flags: QaFlags, canvas: () => HTMLCanvasElement): PlatformBridge {
  let hostPromise: Promise<RendererHost> | null = null;
  let host: RendererHost | null = null;
  let hostError: string | null = null;
  let lastProbe: GpuProbeResult | null = null;
  let xrError: string | null = null;
  let xrMode: string | null = null;

  const getHost = (): Promise<RendererHost> => {
    hostPromise ??= (async () => {
      if (flags.xrEmulate === 'quest3') await installIwer();
      // The Quest policy renders XR on the WebGL2 backend (11-platform.md section 4.3).
      const h = await RendererHost.create({
        canvas: canvas(),
        forceWebGL: flags.gl || flags.xrEmulate !== null,
        xr: flags.xrEmulate !== null,
      });
      host = h;
      return h;
    })();
    return hostPromise;
  };

  const bridge: PlatformBridge = {
    backend: () => host?.backend ?? null,

    async gpuProbe() {
      if (lastProbe) return lastProbe;
      let adapterInfo: Awaited<ReturnType<typeof readAdapter>>;
      let error: string | null = null;
      try {
        adapterInfo = await readAdapter();
      } catch (e) {
        error = errorMessage(e);
        adapterInfo = { navigatorGpu: false, adapter: false, vendor: null, architecture: null, device: null, description: null, isFallbackAdapter: null, features: [], limits: {} };
      }
      let backend: RenderBackend | null = null;
      try {
        backend = (await getHost()).backend;
      } catch (e) {
        hostError = errorMessage(e);
        error = error ? `${error}; ${hostError}` : hostError;
      }
      lastProbe = {
        ...adapterInfo,
        backend,
        threeRevision: THREE_REVISION,
        crossOriginIsolated: self.crossOriginIsolated,
        userAgent: navigator.userAgent,
        error,
      };
      return lastProbe;
    },

    xr: {
      async enterForTest() {
        xrError = null;
        try {
          const h = await getHost();
          const xr = (navigator as unknown as { xr?: XrSystemLike }).xr;
          if (!xr) throw new Error('navigator.xr is not available');
          // Under IWER no user gesture is needed. On real devices XR starts only from a click handler.
          const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
          xrMode = 'immersive-vr';
          await h.renderer.xr.setSession(session as XRSession);
        } catch (e) {
          xrError = errorMessage(e);
          throw e;
        }
      },
      state() {
        return {
          supported: (navigator as unknown as { xr?: unknown }).xr !== undefined,
          isPresenting: host?.isPresenting ?? false,
          frames: host?.xrFrames ?? 0,
          sessionMode: xrMode,
          error: xrError ?? hostError,
        };
      },
    },
  };

  window.__dvBridge = { ...window.__dvBridge, platform: bridge };
  return bridge;
}
