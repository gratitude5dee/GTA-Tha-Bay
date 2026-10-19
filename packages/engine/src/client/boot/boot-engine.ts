import type { BootPayload, FrameSignal, LoopStats, QualityTierId, SimConfig, SimProfile } from '@dv/shared';
import { SimHostImpl, type WorkerLike } from '../../sim/sim-host.ts';
import { spawnSimWorker } from './spawn-worker.ts';
import { physicsDropConfig, PHYSICS_DROP } from '../../sim/scenarios/physics-drop.ts';
import type { DebugCommand } from '../../sim/transport/envelope.ts';
import { SnapshotView } from '../snapshot/reader.ts';
import type { ObjectPool } from '../snapshot/object-pool.ts';
import type { QaFlags } from '../../platform/qa-flags.ts';
import type { RendererHost } from '../../platform/renderer-host.ts';

export interface BootEngineOptions {
  /** Where the canvas and the "Recovering..." banner go. */
  container: HTMLElement;
  qa: boolean;
  flags: QaFlags;
  profile?: SimProfile;
  tier?: QualityTierId;
  scenario?: string;
  /** Text of the recovery banner (from the i18n catalog). */
  labels: { recovering: string };
  /** Replaces the Worker constructor (tests). */
  spawn?: () => WorkerLike;
  /** Skip the three.js view (the sim still runs and `frame` still ticks on requestAnimationFrame). */
  headless?: boolean;
  /**
   * The platform's renderer host (M01c). The engine draws the snapshot on the host's scene and runs on its frame hook; the host
   * and its canvas belong to the platform, so `dispose` detaches without stopping the loop. Without one, the engine builds none
   * and ticks on requestAnimationFrame.
   */
  host?: RendererHost;
}

export interface EngineObservation {
  tick: number;
  stats: LoopStats;
  hash: string | null;
  transport: 'sab' | 'postMessage' | null;
  physicsBuild: 'simd-compat' | 'deterministic-compat' | null;
  restarts: number;
  snapshotReuse: number;
  records: number;
  frames: number;
  crashed: string | null;
  recovering: boolean;
  paused: boolean;
  rebases: number;
  eventsDropped: number;
  commandsDropped: number;
  backend: 'webgpu' | 'webgl2' | 'none';
}

export interface EngineHandle {
  readonly host: SimHostImpl;
  readonly view: SnapshotView;
  readonly canvas: HTMLCanvasElement | null;
  readonly paused: boolean;
  setPaused(paused: boolean): void;
  observe(): EngineObservation;
  act(cmd: DebugCommand): boolean;
  step(n: number): boolean;
  /** Forget the previous frame time so the next `dt` is zero (the page was hidden). */
  resetClock(): void;
  qaResults(): Record<string, unknown>;
  dispose(): Promise<void>;
}

/** True when the page can share memory with a worker. */
export function canUseSab(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

function configFor(profile: SimProfile, tier: QualityTierId): SimConfig {
  return { ...physicsDropConfig(profile, 60), tier };
}

const rejectAfter = (ms: number, what: string): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} after ${ms} ms`)), ms));

/**
 * Boots the engine on the page (01-engine.md section 5, boot order): isolation check and transport choice, spawn
 * sim.worker, load exactly one Rapier build in it, then draw the snapshot with the renderer host. Every rAF posts a
 * FrameSignal. A worker error or two seconds without a snapshot shows "Recovering..." and restarts the worker.
 */
export async function bootEngine(opts: BootEngineOptions): Promise<EngineHandle> {
  const profile: SimProfile = opts.profile ?? 'local';
  const cfg = configFor(profile, opts.tier ?? opts.flags.tier ?? 'desktop');
  const boot: BootPayload = { strings: [], prefabs: [], config: { scenario: opts.scenario ?? PHYSICS_DROP.id } };

  const banner = document.createElement('div');
  banner.className = 'dv-engine-banner';
  banner.setAttribute('role', 'status');
  banner.textContent = opts.labels.recovering;
  banner.hidden = true;
  opts.container.append(banner);

  let recovering = false;
  let paused = false;
  let frames = 0;
  let lastNow = -1;
  let disposed = false;
  let pool: ObjectPool | null = null;
  let backend: EngineObservation['backend'] = 'none';
  const view = new SnapshotView();

  const spawn = opts.spawn ?? spawnSimWorker;

  const host: SimHostImpl = new SimHostImpl({
    spawn,
    sab: canUseSab() && opts.flags.transport !== 'postMessage',
    qa: opts.qa,
    readyTimeoutMs: 60_000,
    timeoutAfter: rejectAfter,
    onCrash: (reason, detail) => {
      console.warn(`sim worker ${reason}: ${detail}`);
      void recover();
    },
    onLog: (level, message) => console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'](`sim: ${message}`),
  });

  async function recover(): Promise<void> {
    if (recovering || disposed) return;
    recovering = true;
    banner.hidden = false;
    pool?.clear();
    try {
      await host.restart(cfg);
    } catch (e) {
      console.error('sim worker restart failed', e);
    } finally {
      recovering = false;
      banner.hidden = true;
    }
  }

  await host.start(cfg, boot);

  const onFrame = (nowMs: number): void => {
    if (disposed) return;
    const dtSec = lastNow < 0 ? 0 : Math.min((nowMs - lastNow) / 1000, 1);
    lastNow = nowMs;
    const sig: FrameSignal = { frame: frames++, nowMs, dtSec, paused, timeScale: 1 };
    if (!recovering) host.frame(sig);
    if (!recovering && host.view && view.update(host.view)) pool?.sync(view.poses, view.count, (k) => view.keys.get(k));
  };

  let canvas: HTMLCanvasElement | null = null;
  let stopLoop: () => void = () => {};
  if (opts.headless || !opts.host) {
    let handle = 0;
    const tick = (t: number): void => {
      onFrame(t);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    stopLoop = () => cancelAnimationFrame(handle);
  } else {
    const made = await createView(opts.host, opts.container, onFrame).catch((e: unknown) => {
      console.warn('engine view unavailable, running the sim without drawing', e);
      return null;
    });
    if (made) {
      canvas = made.canvas;
      pool = made.pool;
      backend = made.backend;
      stopLoop = made.stop;
    } else {
      let handle = 0;
      const tick = (t: number): void => {
        onFrame(t);
        handle = requestAnimationFrame(tick);
      };
      handle = requestAnimationFrame(tick);
      stopLoop = () => cancelAnimationFrame(handle);
    }
  }

  return {
    host,
    view,
    get canvas() {
      return canvas;
    },
    get paused() {
      return paused;
    },
    setPaused: (p) => {
      paused = p;
    },
    observe: () => {
      const report = host.report;
      const read = host.view;
      return {
        tick: read?.cur.tick ?? 0,
        stats: host.stats,
        hash: report?.hash?.hex ?? null,
        transport: host.kind,
        physicsBuild: report?.physicsBuild ?? host.cfg?.physicsBuild ?? null,
        restarts: host.restarts,
        snapshotReuse: host.transport?.counters.snapshotReuse ?? 0,
        records: read?.cur.count ?? 0,
        frames,
        crashed: host.crashed,
        recovering,
        paused,
        rebases: report?.rebases ?? 0,
        eventsDropped: host.transport?.counters.eventsDropped ?? 0,
        commandsDropped: host.transport?.counters.commandsDropped ?? 0,
        backend,
      };
    },
    act: (cmd) => host.sendDebug(cmd),
    step: (n) => host.sendDebug({ t: 'debug.step', n }),
    resetClock: () => {
      lastNow = -1;
    },
    qaResults: () => Object.fromEntries(host.qaResults),
    dispose: async () => {
      disposed = true;
      stopLoop();
      pool?.dispose();
      banner.remove();
      await host.dispose();
    },
  };
}

interface MadeView {
  canvas: HTMLCanvasElement;
  pool: ObjectPool;
  backend: 'webgpu' | 'webgl2';
  stop: () => void;
}

/** The debug cube view: the snapshot pool drawn on the platform host's scene. */
async function createView(host: RendererHost, container: HTMLElement, onFrame: (nowMs: number) => void): Promise<MadeView> {
  const [{ ObjectPool }, three] = await Promise.all([import('../snapshot/object-pool.ts'), import('three/webgpu')]);
  const canvas = host.currentCanvas;
  if (!canvas.isConnected) container.append(canvas);

  const { scene, camera } = host;
  scene.background = new three.Color(0x10141c);
  const hemi = new three.HemisphereLight(0xbfd4ff, 0x30343c, 1.6);
  const sun = new three.DirectionalLight(0xffffff, 2.2);
  sun.position.set(30, 60, 20);
  scene.add(hemi, sun);
  camera.position.set(0, 17, 40);
  camera.lookAt(0, 1, 12);

  const resize = (): void => host.resize(Math.max(1, host.currentCanvas.clientWidth), Math.max(1, host.currentCanvas.clientHeight));
  resize();
  addEventListener('resize', resize);

  const pool = new ObjectPool(scene);
  host.frameHook = onFrame;
  return {
    canvas,
    pool,
    backend: host.backend,
    stop: () => {
      host.frameHook = null;
      removeEventListener('resize', resize);
      scene.remove(hemi, sun);
    },
  };
}
