import { classifyDevice, type AdapterSummary, type DeviceProfile, type DeviceSignals } from '@dv/shared';

/**
 * Gathers `DeviceSignals` from the browser (11-platform.md section 5.1 step 2) and classifies them with the pure
 * `classifyDevice`. It requests the GPU adapter once, and asks `isSessionSupported('immersive-vr')` only when
 * `navigator.xr` exists.
 */

interface GpuAdapterLike {
  features: Iterable<string>;
  limits: { maxTextureDimension2D?: number; maxBufferSize?: number };
  info?: { vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean };
  isFallbackAdapter?: boolean;
}
interface GpuLike {
  requestAdapter(options?: object): Promise<GpuAdapterLike | null>;
}
interface XrLike {
  isSessionSupported(mode: string): Promise<boolean>;
}

/** The slice of the global scope the probe reads. Tests pass a fake. */
export interface ProbeEnv {
  navigator: Navigator & {
    gpu?: GpuLike;
    xr?: XrLike;
    deviceMemory?: number;
    standalone?: boolean;
    userAgentData?: { brands?: { brand: string }[]; mobile?: boolean; platform?: string };
  };
  screen: { width: number; height: number };
  devicePixelRatio: number;
  crossOriginIsolated: boolean;
  matchMedia?: (q: string) => { matches: boolean };
  XRGPUBinding?: unknown;
}

function currentEnv(): ProbeEnv {
  return globalThis as unknown as ProbeEnv;
}

const MB = 1024 * 1024;

async function adapterOf(gpu: GpuLike | undefined): Promise<{ summary: AdapterSummary | null; features: string[] }> {
  if (!gpu) return { summary: null, features: [] };
  try {
    const a = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) return { summary: null, features: [] };
    const info = a.info;
    return {
      summary: {
        vendor: info?.vendor ?? '',
        architecture: info?.architecture ?? '',
        device: info?.device ?? '',
        description: info?.description ?? '',
        isFallbackAdapter: info?.isFallbackAdapter ?? a.isFallbackAdapter ?? false,
        maxTextureDimension2D: a.limits.maxTextureDimension2D ?? 0,
        maxBufferSize: a.limits.maxBufferSize ?? 0,
      },
      features: [...a.features].sort(),
    };
  } catch {
    return { summary: null, features: [] };
  }
}

async function xrSupport(xr: XrLike | undefined): Promise<boolean | null> {
  if (!xr) return null;
  try {
    return await xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

async function storageInfo(nav: ProbeEnv['navigator']): Promise<{ quota: number | null; usage: number | null }> {
  try {
    const e = await nav.storage?.estimate?.();
    return {
      quota: e?.quota !== undefined ? Math.round(e.quota / MB) : null,
      usage: e?.usage !== undefined ? Math.round(e.usage / MB) : null,
    };
  } catch {
    return { quota: null, usage: null };
  }
}

export class DeviceProbe {
  private readonly env: ProbeEnv;
  private signals: Promise<DeviceSignals> | null = null;

  constructor(env: ProbeEnv = currentEnv()) {
    this.env = env;
  }

  /** Raw signals; the adapter is requested once and the result cached. */
  gather(): Promise<DeviceSignals> {
    this.signals ??= this.read();
    return this.signals;
  }

  async classify(): Promise<DeviceProfile> {
    return classifyDevice(await this.gather());
  }

  private async read(): Promise<DeviceSignals> {
    const { navigator: nav, screen } = this.env;
    const [{ summary, features }, immersive, storage] = await Promise.all([
      adapterOf(nav.gpu),
      xrSupport(nav.xr),
      storageInfo(nav),
    ]);
    const hints = nav.userAgentData;
    const standalone = this.env.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true;
    return {
      userAgent: nav.userAgent,
      platform: nav.platform,
      ...(hints
        ? { uaData: { brands: (hints.brands ?? []).map((b) => b.brand), mobile: hints.mobile === true, platform: hints.platform ?? '' } }
        : {}),
      maxTouchPoints: nav.maxTouchPoints ?? 0,
      hardwareConcurrency: nav.hardwareConcurrency ?? 0,
      deviceMemoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
      screen: { w: screen.width, h: screen.height, dpr: this.env.devicePixelRatio },
      displayModeStandalone: standalone,
      crossOriginIsolated: this.env.crossOriginIsolated === true,
      hasNavigatorGpu: nav.gpu !== undefined,
      hasNavigatorXr: nav.xr !== undefined,
      hasXrGpuBinding: typeof this.env.XRGPUBinding !== 'undefined',
      immersiveVrSupported: immersive,
      adapter: summary,
      gpuFeatures: features,
      opfs: typeof nav.storage?.getDirectory === 'function',
      storageQuotaMB: storage.quota,
      storageUsageMB: storage.usage,
    };
  }
}
