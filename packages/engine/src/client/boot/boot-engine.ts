import { ClientAction, type BinderTarget, type BootPayload, type FrameSignal, type LoopStats, type QualityTierId, type SimConfig, type SimProfile } from '@dv/shared';
import { SimHostImpl, type WorkerLike } from '../../sim/sim-host.ts';
import { spawnSimWorker } from './spawn-worker.ts';
import { physicsDropConfig } from '../../sim/scenarios/physics-drop.ts';
import { WALK_DROP, walkDropConfig } from '../../sim/scenarios/walk-drop.ts';
import type { DebugCommand } from '../../sim/transport/envelope.ts';
import type { PlayerSide } from '../../sim/publish.ts';
import { SnapshotView } from '../snapshot/reader.ts';
import type { ObjectPool } from '../snapshot/object-pool.ts';
import { CameraRigImpl, type CameraLike } from '../camera/rig.ts';
import { GamepadBinder, InputRouterImpl, KbmBinder, writeInputFrame, type GamepadLike, type PointerLockTarget } from '../input/index.ts';
import type { QaFlags } from '../../platform/qa-flags.ts';

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
  /** The local player from the newest snapshot (M01b1): feet position, velocity, control state, grounded; null without one. */
  player: PlayerSide | null;
  /** The camera rig (M01b1): the mode, the sim's collision distance, and whether the last fp/tp toggle was refused. */
  camera: { mode: string; allowedDistance: number | null; lastToggleRefused: boolean; locked: boolean } | null;
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
  qaResults(): Record<string, unknown>;
  dispose(): Promise<void>;
}

/** True when the page can share memory with a worker. */
export function canUseSab(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

/** The scenario the page boots unless told otherwise: the walking course with the player (M01b1). */
export const DEFAULT_SCENARIO = WALK_DROP.id;

function configFor(scenario: string, profile: SimProfile, tier: QualityTierId): SimConfig {
  const base = scenario === WALK_DROP.id ? walkDropConfig(profile, 60) : physicsDropConfig(profile, 60);
  return { ...base, tier };
}

const rejectAfter = (ms: number, what: string): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} after ${ms} ms`)), ms));

/** True while a text field has focus (C03 rule 4: the keyboard binder suspends). */
function textFieldFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** The far plane until the tier budgets drive it (M01c): the building draw distance of the desktop tier. */
const DRAW_DISTANCE_M = 800;

/**
 * Boots the engine on the page (01-engine.md section 5, boot order): isolation check and transport choice, spawn
 * sim.worker, load exactly one Rapier build in it, then draw the snapshot with the renderer host. Every rAF posts a
 * FrameSignal. A worker error or two seconds without a snapshot shows "Recovering..." and restarts the worker.
 *
 * M01b1 adds the input pipeline (binders, router, the input block) and the camera rig: each frame the router samples the
 * devices and writes the InputFrame into the block the worker reads, the rig follows the player from the snapshot.
 */
export async function bootEngine(opts: BootEngineOptions): Promise<EngineHandle> {
  const profile: SimProfile = opts.profile ?? 'local';
  const scenario = opts.scenario ?? DEFAULT_SCENARIO;
  const cfg = configFor(scenario, profile, opts.tier ?? opts.flags.tier ?? 'desktop');
  const boot: BootPayload = { strings: [], prefabs: [], config: { scenario } };

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
  let rig: CameraRigImpl | null = null;
  let router: InputRouterImpl | null = null;
  let backend: EngineObservation['backend'] = 'none';
  const view = new SnapshotView();
  /** The player's view angles: applied every frame on the main thread (C03 rule 1). */
  const look = { yaw: scenario === WALK_DROP.id ? WALK_DROP.spawnYaw : 0, pitch: 0 };
  const cleanups: (() => void)[] = [];

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

  const targetPose = (handle: number): { x: number; y: number; z: number } | null => {
    for (let i = 0; i < view.count; i++) {
      const p = view.poses[i];
      if (p && p.handle === handle) return { x: p.px, y: p.py, z: p.pz };
    }
    return null;
  };

  const onFrame = (nowMs: number): void => {
    if (disposed) return;
    const dtSec = lastNow < 0 ? 0 : Math.min((nowMs - lastNow) / 1000, 1);
    lastNow = nowMs;
    if (router) {
      // Look first (no tick latency), then the devices into the input block the worker samples once per tick.
      router.applyLook(dtSec, look);
      const frame = router.sample(frames, look);
      const block = host.transport?.input;
      if (block) writeInputFrame(block, frame);
    }
    const sig: FrameSignal = { frame: frames++, nowMs, dtSec, paused, timeScale: 1 };
    if (!recovering) host.frame(sig);
    if (!recovering && host.view && view.update(host.view)) pool?.sync(view.poses, view.count, (k) => view.keys.get(k));
    if (rig) {
      if (view.camera) rig.apply(view.camera);
      if (pool) pool.hiddenHandle = rig.playerHidden ? (view.camera?.follow?.target ?? null) : null;
      rig.update({ alpha: view.alpha, dtSec, reducedMotion: false, drawDistanceM: DRAW_DISTANCE_M });
    }
  };

  let canvas: HTMLCanvasElement | null = null;
  let stopLoop: () => void = () => {};
  if (opts.headless) {
    let handle = 0;
    const tick = (t: number): void => {
      onFrame(t);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    stopLoop = () => cancelAnimationFrame(handle);
  } else {
    const made = await createView(opts, onFrame).catch((e: unknown) => {
      console.warn('engine view unavailable, running the sim without drawing', e);
      return null;
    });
    if (made) {
      canvas = made.canvas;
      pool = made.pool;
      backend = made.backend;
      stopLoop = made.stop;
      rig = new CameraRigImpl({ camera: made.camera as unknown as CameraLike, targetPose, look: () => look });
    } else {
      let handle = 0;
      const tick = (t: number): void => {
        onFrame(t);
        handle = requestAnimationFrame(tick);
      };
      handle = requestAnimationFrame(tick);
      stopLoop = () => cancelAnimationFrame(handle);
    }
    // Input: keyboard, mouse and standard gamepads. Pages that drive their own renderer (probe, XR emulation) are headless.
    const kbm = new KbmBinder({
      isTextFocus: textFieldFocused,
      doc: document as unknown as BinderTarget,
      visibility: () => document.visibilityState,
      isLocked: () => document.pointerLockElement !== null,
      onLockLost: () => router?.raiseClientAction(ClientAction.Pause),
      warn: (m) => console.warn(m),
      ...(canvas ? { canvas: canvas as unknown as PointerLockTarget } : {}),
    });
    const pad = new GamepadBinder({
      getPads: () => (typeof navigator.getGamepads === 'function' ? (navigator.getGamepads() as unknown as ArrayLike<GamepadLike | null>) : []),
      warn: (m) => console.warn(m),
    });
    router = new InputRouterImpl({ binders: [kbm, pad] });
    kbm.attach(window as unknown as BinderTarget);
    pad.attach(window as unknown as BinderTarget);
    cleanups.push(() => kbm.detach(), () => pad.detach());
    const off = router.onClientAction((action, phase) => {
      if (phase !== 'pressed') return;
      if (action === ClientAction.Camera) rig?.toggleFpTp();
      else if (action === ClientAction.ShoulderSwap) rig?.swapShoulder();
      else if (action === ClientAction.Pause) paused = !paused;
    });
    cleanups.push(off);
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
        player: view.player,
        camera: rig
          ? { mode: rig.mode, allowedDistance: view.camera?.allowedDistance ?? null, lastToggleRefused: rig.lastToggleRefused, locked: rig.locked }
          : null,
      };
    },
    act: (cmd) => host.sendDebug(cmd),
    step: (n) => host.sendDebug({ t: 'debug.step', n }),
    qaResults: () => Object.fromEntries(host.qaResults),
    dispose: async () => {
      disposed = true;
      stopLoop();
      for (const off of cleanups.splice(0)) off();
      pool?.dispose();
      banner.remove();
      await host.dispose();
    },
  };
}

interface MadeView {
  canvas: HTMLCanvasElement;
  pool: ObjectPool;
  camera: object;
  backend: 'webgpu' | 'webgl2';
  stop: () => void;
}

/** The debug view: a canvas on the page, drawn by the renderer host from the snapshot pool. */
async function createView(opts: BootEngineOptions, onFrame: (nowMs: number) => void): Promise<MadeView> {
  const [{ RendererHost }, { ObjectPool }, three] = await Promise.all([
    import('../../platform/renderer-host.ts'),
    import('../snapshot/object-pool.ts'),
    import('three/webgpu'),
  ]);
  const canvas = document.createElement('canvas');
  canvas.id = 'dv-engine-canvas';
  canvas.className = opts.flags.debug ? 'dv-engine-canvas dv-engine-canvas--play' : 'dv-engine-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  opts.container.append(canvas);
  const host = await RendererHost.create({ canvas, forceWebGL: opts.flags.gl, xr: false });

  const { scene, camera, renderer } = host;
  scene.background = new three.Color(0x10141c);
  scene.add(new three.HemisphereLight(0xbfd4ff, 0x30343c, 1.6));
  const sun = new three.DirectionalLight(0xffffff, 2.2);
  sun.position.set(30, 60, 20);
  scene.add(sun);
  // Until the sim publishes a camera directive the view looks down on the fixture.
  camera.position.set(0, 17, 40);
  camera.lookAt(0, 1, 12);

  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  const pool = new ObjectPool(scene);
  host.frameHook = onFrame;
  return {
    canvas,
    pool,
    camera,
    backend: host.backend,
    stop: () => {
      host.frameHook = null;
      renderer.setAnimationLoop(null);
      removeEventListener('resize', resize);
      canvas.remove();
    },
  };
}

