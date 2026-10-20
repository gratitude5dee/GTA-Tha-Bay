import {
  ClientAction, type BinderTarget, type BootPayload, type FrameSignal, type InputFrame, type LoopStats, type QualityTierId, type SimConfig,
  type SimProfile,
} from '@dv/shared';
import { SimHostImpl, type WorkerLike } from '../../sim/sim-host.ts';
import { spawnSimWorker } from './spawn-worker.ts';
import { BAKED_WORLD, bakedWorldConfig } from '../../sim/scenarios/baked-world.ts';
import { CIVIC_GRAYBOX, civicGrayboxConfig } from '../../sim/scenarios/civic-graybox.ts';
import { physicsDropConfig } from '../../sim/scenarios/physics-drop.ts';
import { WALK_DROP, walkDropConfig } from '../../sim/scenarios/walk-drop.ts';
import type { DebugCommand } from '../../sim/transport/envelope.ts';
import type { PlayerSide } from '../../sim/publish.ts';
import { SnapshotView } from '../snapshot/reader.ts';
import type { ObjectPool } from '../snapshot/object-pool.ts';
import { CameraRigImpl, type CameraLike } from '../camera/rig.ts';
import {
  GamepadBinder, InputRouterImpl, KbmBinder, pitchToI16, TouchBinder, writeInputFrame, yawToU16,
  type GamepadLike, type PointerLockTarget, type TouchLayout,
} from '../input/index.ts';
import touchLayoutJson from '../../../../../config/input/touch/default-right.json';
import { ENGINE_TIERS } from '../anim/lod.ts';
import { AUDIO_CONFIG, AudioServiceImpl, unlockOnFirstGesture, type AudioContextLike } from '../audio/audio-service.ts';
import type { GrayboxInfo, GrayboxPacks, GrayboxPackUrls, GrayboxWorld } from '../graybox/load.ts';
import type { TouchOverlay } from '../input/touch-overlay.ts';
import type { FreeCam } from '../debug/free-cam.ts';
import type { SimPanel, SkyControls } from '../debug/sim-panel.ts';
import type { XrSmoke, XrSystemLike } from '../xr/smoke.ts';
import type { QaFlags } from '../../platform/qa-flags.ts';
import type { RendererHost } from '../../platform/renderer-host.ts';
import type { WorldBoot } from './world-layer.ts';

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
  /**
   * Boot the S02 gray-box Civic Center block (M01b2): the URLs of the two fixture packs. The page fetches them, hands the `p0`
   * bytes to the worker in `BootPayload.config.packs` and draws terrain, roads and buildings from both. Without it the engine
   * runs the `scenario` (default `walk-drop`).
   */
  graybox?: GrayboxPackUrls;
  /**
   * Boot a baked, streamed world (M02b1): the `baked-world` scenario with the spawn and the sim-module payload from `world`, and the
   * layer drawn on the host's scene. Takes precedence over `graybox` and `scenario`.
   */
  world?: WorldBoot;
  /**
   * Whether the page is in play: keyboard, pointer and touch input reach the game and the touch layer shows. Off, the world
   * runs as a slow-turning backdrop behind the title. Default true; `setPlay` changes it.
   */
  play?: boolean;
  /** Called when the Pause action toggles the pause (single player pauses the sim). */
  onPausedChange?: (paused: boolean) => void;
  /** Show the touch layer on any device (`?touch=1`). */
  forceTouch?: boolean;
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
  camera: {
    mode: string; allowedDistance: number | null; lastToggleRefused: boolean; locked: boolean; opacity: number; near: number; far: number;
    /** World position of the draw camera, ENU metres. */
    pos: [number, number, number];
  } | null;
  /** The gray-box block (M01b2); null for the other scenarios. */
  world: GrayboxInfo | null;
  /** The page is in play (input reaches the game, the touch layer shows). */
  play: boolean;
  touch: { visible: boolean; contacts: number; active: string } | null;
  audio: { unlocked: boolean; played: number; dropped: number } | null;
  /** QA tools: the F3 panel and the F4 free cam. */
  debug: { panel: boolean; freeCam: boolean } | null;
  /** The XR smoke (QA builds with `immersive-vr` support). */
  xr: { supported: boolean; presenting: boolean; frames: number; sessions: number } | null;
  /** Chunks the sim has added colliders for, from the `world.chunk` events. */
  chunksLoaded: number;
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
  /** Input reaches the game (true) or the world is a backdrop (false). */
  setPlay(on: boolean): void;
  /** Ends the XR smoke session, if one runs. */
  endXr(): Promise<void>;
  dispose(): Promise<void>;
}

/** True when the page can share memory with a worker. */
export function canUseSab(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

/** The scenario the page boots unless told otherwise: the walking course with the player (M01b1). The page asks for the gray-box block. */
export const DEFAULT_SCENARIO = WALK_DROP.id;

function configFor(scenario: string, profile: SimProfile, tier: QualityTierId): SimConfig {
  const base =
    scenario === CIVIC_GRAYBOX.id ? civicGrayboxConfig(profile, 60)
    : scenario === WALK_DROP.id ? walkDropConfig(profile, 60)
    : physicsDropConfig(profile, 60);
  return { ...base, tier };
}

/** Where the player's view starts for each scenario (radians). */
function startYaw(scenario: string): number {
  return scenario === WALK_DROP.id ? WALK_DROP.spawnYaw : scenario === CIVIC_GRAYBOX.id ? CIVIC_GRAYBOX.spawnYaw : 0;
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

/** The far plane when the host has no tier yet: the building draw distance of the desktop tier before M01c's budgets. */
const FALLBACK_DRAW_DISTANCE_M = 800;
/** The backdrop turns slowly behind the title screen, radians per second. */
const BACKDROP_ORBIT_RAD_PER_SEC = 0.06;
/** While the title is up the world renders at this fraction of the play resolution. */
const BACKDROP_RENDER_SCALE = 0.6;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Boots the engine on the page (01-engine.md section 5, boot order): isolation check and transport choice, spawn
 * sim.worker, load exactly one Rapier build in it, then draw the snapshot with the renderer host. Every rAF posts a
 * FrameSignal. A worker error or two seconds without a snapshot shows "Recovering..." and restarts the worker.
 *
 * M01b1 adds the input pipeline (binders, router, the input block) and the camera rig: each frame the router samples the
 * devices and writes the InputFrame into the block the worker reads, the rig follows the player from the snapshot.
 *
 * M01b2 adds the gray-box block (fetched packs, the mesher, the `civic-graybox` scenario), touch input and its layer, the
 * animated mannequin, the audio bus skeleton with the footfall cue, and in QA builds the F3 sim panel, the F4 free cam and the
 * XR smoke button.
 */
export async function bootEngine(opts: BootEngineOptions): Promise<EngineHandle> {
  const profile: SimProfile = opts.profile ?? 'local';
  const worldBoot = opts.world ?? null;
  const scenario = worldBoot ? BAKED_WORLD.id : (opts.scenario ?? (opts.graybox ? CIVIC_GRAYBOX.id : DEFAULT_SCENARIO));
  const cfg = worldBoot
    ? { ...bakedWorldConfig(profile, 60, worldBoot.bakeId), tier: opts.tier ?? opts.flags.tier ?? 'desktop' }
    : configFor(scenario, profile, opts.tier ?? opts.flags.tier ?? 'desktop');

  let packs: GrayboxPacks | null = null;
  let boot: BootPayload = { strings: [], prefabs: [], config: { scenario } };
  if (worldBoot) {
    boot = { strings: [], prefabs: [], config: { ...worldBoot.config, scenario, spawn: worldBoot.spawn, spawnYaw: worldBoot.spawnYaw } };
  } else if (scenario === CIVIC_GRAYBOX.id) {
    if (!opts.graybox) throw new Error('the civic-graybox scenario needs the pack URLs (BootEngineOptions.graybox)');
    const gb = await import('../graybox/load.ts');
    packs = await gb.fetchGrayboxPacks(opts.graybox);
    boot = { strings: [], prefabs: [], config: gb.grayboxBootConfig(packs) };
  }

  const banner = document.createElement('div');
  banner.className = 'dv-engine-banner';
  banner.setAttribute('role', 'status');
  banner.textContent = opts.labels.recovering;
  banner.hidden = true;
  opts.container.append(banner);

  let recovering = false;
  let paused = false;
  let playing = opts.play ?? true;
  let frames = 0;
  let lastNow = -1;
  let disposed = false;
  let pool: ObjectPool | null = null;
  let rig: CameraRigImpl | null = null;
  let router: InputRouterImpl | null = null;
  let overlay: TouchOverlay | null = null;
  let touchBinder: TouchBinder | null = null;
  let world: GrayboxWorld | null = null;
  let hostScene: RendererHost | null = null;
  let panel: SimPanel | null = null;
  let skyControls: SkyControls | null = null;
  let freeCam: FreeCam | null = null;
  let xrSmoke: XrSmoke | null = null;
  let xrSupported = false;
  let chunksLoaded = 0;
  let backend: EngineObservation['backend'] = 'none';
  const view = new SnapshotView();

  /** The player's view angles: applied every frame on the main thread (C03 rule 1). */
  const look = { yaw: worldBoot ? worldBoot.spawnYaw : startYaw(scenario), pitch: 0 };
  const cleanups: (() => void)[] = [];
  const reducedMotion = prefersReducedMotion();

  // Audio: one context, made inside the first gesture; `foot.step` cues from the sim play through it.
  const AudioCtor = (globalThis as { AudioContext?: new () => unknown; webkitAudioContext?: new () => unknown }).AudioContext
    ?? (globalThis as { webkitAudioContext?: new () => unknown }).webkitAudioContext;
  const audio: AudioServiceImpl | null = AudioCtor
    ? new AudioServiceImpl({
        createContext: () => new AudioCtor() as AudioContextLike,
        audioSession: (navigator as { audioSession?: { type: string } }).audioSession ?? null,
        maxVoices: ENGINE_TIERS[opts.tier ?? opts.flags.tier ?? 'desktop'].audioVoices,
      })
    : null;
  if (audio) {
    cleanups.push(unlockOnFirstGesture(audio, window), audio.attachLifecycle(document, () => document.visibilityState));
  }

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
    ...(worldBoot?.initExtras ? { initExtras: worldBoot.initExtras } : {}),
    onSimEvents: (events) => {
      worldBoot?.layer.onSimEvents?.(events);
      for (const e of events) {
        if (e.t === 'audio.cue' && e.s) audio?.play({ tick: e.tick, cue: e.s, bus: AUDIO_CONFIG.footstep.bus, ...(e.a !== undefined ? { entity: e.a } : {}) });
        else if (e.t === 'world.chunk') chunksLoaded = Math.max(chunksLoaded, e.n ?? 0);
      }
    },
  });

  async function recover(): Promise<void> {
    if (recovering || disposed) return;
    recovering = true;
    banner.hidden = false;
    pool?.clear();
    chunksLoaded = 0;
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

  /** Resolution while the title is up is lower; play restores it. */
  const applyScale = (): void => {
    if (!hostScene || !hostScene.ready) return;
    const c = hostScene.currentCanvas;
    hostScene.resize(Math.max(1, c.clientWidth), Math.max(1, c.clientHeight), playing ? 1 : BACKDROP_RENDER_SCALE);
  };

  const neutralFrame = (tick: number): InputFrame => ({
    tick, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0,
    camYaw: yawToU16(look.yaw), camPitch: pitchToI16(look.pitch), context: 0, device: 0,
  });

  const onFrame = (nowMs: number): void => {
    if (disposed) return;
    const dtSec = lastNow < 0 ? 0 : Math.min((nowMs - lastNow) / 1000, 1);
    lastNow = nowMs;
    panel?.frame(nowMs);
    skyControls?.sync(view.env, view.blackout);
    if (router) {
      const block = host.transport?.input;
      if (playing) {
        // Look first (no tick latency), then the devices into the input block the worker samples once per tick. The free cam
        // takes the look for itself and the sim gets the neutral `debug` context, so the player stands still.
        router.applyLook(dtSec, freeCam?.active ? freeCam.look : look);
        const frame = router.sample(frames, look);
        if (block) writeInputFrame(block, frame);
        overlay?.setActiveDevice(router.active);
      } else {
        // The title is up: the world idles and the view turns slowly.
        if (!reducedMotion) look.yaw += dtSec * BACKDROP_ORBIT_RAD_PER_SEC;
        if (block) writeInputFrame(block, neutralFrame(frames));
      }
    }
    const sig: FrameSignal = { frame: frames++, nowMs, dtSec, paused, timeScale: 1 };
    if (!recovering) host.frame(sig);
    const camPos = hostScene?.camera.position ?? null;
    if (!recovering && host.view && view.update(host.view)) {
      pool?.sync(view.poses, view.count, (k) => view.keys.get(k), dtSec, camPos);
    }
    if (rig) {
      const tier = hostScene?.tier ?? null;
      if (view.camera && !freeCam?.active) rig.apply(view.camera);
      if (pool) {
        pool.hiddenHandle = rig.playerHidden ? (view.camera?.follow?.target ?? null) : null;
        pool.fadeHandle = view.camera?.follow?.target ?? null;
        pool.fadeOpacity = rig.playerOpacity;
        const id = tier?.id;
        if (id) pool.setLodBands(ENGINE_TIERS[id].animBands);
      }
      if (freeCam?.active) {
        freeCam.update(dtSec);
      } else {
        rig.update({
          alpha: view.alpha,
          dtSec,
          reducedMotion,
          // A streamed world draws L2 out to r2 (+ the altitude boost when high): the world pass reaches that far, the backdrop pass further.
          drawDistanceM: (tier?.budget.world.buildingDrawDistanceM ?? FALLBACK_DRAW_DISTANCE_M) + (worldBoot ? (tier?.budget.world.altitudeBoostM ?? 0) : 0),
          depthPolicy: hostScene?.depthPolicy ?? 'standard',
        });
      }
      if (xrSmoke) xrSmoke.update();
    }
    if (audio && camPos) audio.setListener([camPos.x, camPos.y, camPos.z], [0, 0, -1], [0, 1, 0]);
    if (worldBoot && hostScene) {
      const cam = hostScene.camera;
      cam.updateMatrixWorld();
      // The camera looks down its local -Z: the third column of the world matrix, negated (no three import at the top of this file).
      const e = cam.matrixWorld.elements;
      worldBoot.layer.frame({
        nowMs,
        dtSec,
        player: view.player,
        camera: { pos: [cam.position.x, cam.position.y, cam.position.z], dir: [-(e[8] as number), -(e[9] as number), -(e[10] as number)] },
        env: view.env,
        blackout: view.blackout,
      });
    }
  };

  let canvas: HTMLCanvasElement | null = null;
  let stopLoop: () => void = () => {};
  const runOnRaf = (): void => {
    let handle = 0;
    const tick = (t: number): void => {
      onFrame(t);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    stopLoop = () => cancelAnimationFrame(handle);
  };
  if (opts.headless || !opts.host) {
    runOnRaf();
  } else {
    const made = await createView(opts.host, opts.container, onFrame, packs, worldBoot).catch((e: unknown) => {
      console.warn('engine view unavailable, running the sim without drawing', e);
      return null;
    });
    if (made) {
      canvas = made.canvas;
      pool = made.pool;
      world = made.world;
      backend = made.backend;
      stopLoop = made.stop;
      hostScene = opts.host;
      rig = new CameraRigImpl({ camera: made.camera as unknown as CameraLike, targetPose, look: () => look });
      applyScale();
    } else {
      runOnRaf();
    }
    // Input: keyboard, mouse, standard gamepads and touch. Pages that drive their own renderer (probe) are headless.
    const kbm = new KbmBinder({
      isTextFocus: () => textFieldFocused() || !playing,
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
    const { TouchOverlay: Overlay } = await import('../input/touch-overlay.ts');
    const layout = touchLayoutJson as unknown as TouchLayout;
    overlay = new Overlay({
      container: document.body,
      layout,
      ...(opts.forceTouch ? { coarsePointer: () => true } : {}),
    });
    touchBinder = new TouchBinder({
      layout,
      viewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
      win: window as unknown as BinderTarget,
      doc: document as unknown as BinderTarget,
      visibility: () => document.visibilityState,
      onVisual: overlay.draw,
    });
    router = new InputRouterImpl({ binders: [kbm, pad, touchBinder] });
    kbm.attach(window as unknown as BinderTarget);
    pad.attach(window as unknown as BinderTarget);
    touchBinder.attach(overlay.root as unknown as BinderTarget);
    overlay.setEnabled(playing);
    cleanups.push(() => kbm.detach(), () => pad.detach(), () => touchBinder?.detach(), () => overlay?.dispose());
    const off = router.onClientAction((action, phase) => {
      if (phase !== 'pressed') return;
      if (action === ClientAction.Camera) rig?.toggleFpTp();
      else if (action === ClientAction.ShoulderSwap) rig?.swapShoulder();
      else if (action === ClientAction.Pause) {
        paused = !paused;
        opts.onPausedChange?.(paused);
      } else if (action === ClientAction.DebugToggle) panel?.toggle();
    });
    cleanups.push(off);

    // QA builds only (the literal comparison lets production builds drop the branch): the F3 panel, the F4 free cam, the XR smoke.
    if (import.meta.env.VITE_DV_QA === '1' && opts.qa && made) {
      if (opts.flags.debug) {
        const [{ SimPanel: Panel, SkyControls: Sky }, { FreeCam: Free }] = await Promise.all([import('../debug/sim-panel.ts'), import('../debug/free-cam.ts')]);
        panel = new Panel({
          container: document.body,
          build: import.meta.env.VITE_DV_BUILD ?? 'qa',
          stats: () => ({ stats: host.stats, entities: host.report?.entities ?? 0 }),
          transport: () => host.kind ?? 'none',
          tier: () => hostScene?.tier?.id ?? 'none',
          backend: () => backend,
        });
        freeCam = new Free({ router, camera: made.camera as unknown as CameraLike });
        // The sky controls (M02b2): only a streamed world has a sky.
        if (worldBoot) {
          const layer = worldBoot.layer;
          skyControls = new Sky({
            container: document.body,
            onHour: (h) => void host.sendDebug({ t: 'debug.hour', h }),
            onWeather: (w) => void host.sendDebug({ t: 'debug.weather', w, blendSec: 0 }),
            onBlackout: (on) => void host.sendDebug({ t: 'debug.blackout', on }),
            onRain: (rain) => layer.debug?.setRainOverride(rain),
            onFreeze: (on) => void host.sendDebug({ t: 'debug.clock.pause', on }),
            ...(layer.debug?.look ? { look: layer.debug.look } : {}),
          });
          // The sky controls are on from the start with ?debug=1 (F3 hides them with the panel text), so the day and the weather can be seen at once.
          panel.addCompanion(skyControls.root, true);
          cleanups.push(() => skyControls?.dispose());
        }
        // A phone has no F3: with ?debug=1 on a touch device the panel is on from the start.
        if (opts.forceTouch || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)) panel.toggle();
        const onKey = (e: KeyboardEvent): void => {
          if (e.code !== 'F4' || e.repeat) return;
          e.preventDefault();
          const cam = made.camera as unknown as { position: { x: number; y: number; z: number } };
          freeCam?.toggle({ pos: [cam.position.x, cam.position.y, cam.position.z], yaw: look.yaw, pitch: look.pitch });
        };
        window.addEventListener('keydown', onKey);
        cleanups.push(() => window.removeEventListener('keydown', onKey), () => panel?.dispose());
      }
      const { installXrSmoke } = await import('../xr/smoke.ts');
      const host2 = opts.host;
      xrSmoke = await installXrSmoke({
        renderer: () => host2.renderer,
        scene: host2.scene,
        camera: host2.camera,
        xr: (navigator as unknown as { xr?: XrSystemLike }).xr,
        container: document.body,
        onSession: (s) => (s ? rig?.enterXr() : rig?.exitXr()),
        feet: () => {
          const p = view.player;
          return p ? { x: p.pos[0], y: p.pos[1], z: p.pos[2], yaw: look.yaw } : null;
        },
      });
      xrSupported = xrSmoke !== null;
      if (xrSmoke) cleanups.push(() => xrSmoke?.dispose());
    }
  }

  const setPlay = (on: boolean): void => {
    if (playing === on) return;
    playing = on;
    overlay?.setEnabled(on);
    if (!on && document.pointerLockElement) document.exitPointerLock?.();
    applyScale();
  };
  const onResize = (): void => applyScale();
  addEventListener('resize', onResize);
  cleanups.push(() => removeEventListener('resize', onResize));

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
      const cam = hostScene?.camera;
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
          ? {
              mode: rig.mode,
              allowedDistance: view.camera?.allowedDistance ?? null,
              lastToggleRefused: rig.lastToggleRefused,
              locked: rig.locked,
              opacity: rig.playerOpacity,
              near: cam?.near ?? 0,
              far: cam?.far ?? 0,
              pos: cam ? [cam.position.x, cam.position.y, cam.position.z] : [0, 0, 0],
            }
          : null,
        world: world ? world.info() : null,
        play: playing,
        touch: overlay && touchBinder
          ? { visible: overlay.visible, contacts: touchBinder.contactCount, active: router?.active ?? 'kbm' }
          : null,
        audio: audio ? { unlocked: audio.unlocked, played: audio.played, dropped: audio.dropped } : null,
        debug: panel || freeCam ? { panel: panel?.visible ?? false, freeCam: freeCam?.active ?? false } : null,
        xr: xrSupported
          ? { supported: true, presenting: hostScene?.isPresenting ?? false, frames: hostScene?.xrFrames ?? 0, sessions: xrSmoke?.sessions ?? 0 }
          : null,
        chunksLoaded,
      };
    },
    act: (cmd) => host.sendDebug(cmd),
    step: (n) => host.sendDebug({ t: 'debug.step', n }),
    resetClock: () => {
      lastNow = -1;
    },
    qaResults: () => Object.fromEntries(host.qaResults),
    setPlay,
    endXr: async () => {
      await xrSmoke?.end();
    },
    dispose: async () => {
      disposed = true;
      stopLoop();
      for (const off of cleanups.splice(0)) off();
      pool?.dispose();
      world?.dispose();
      worldBoot?.layer.dispose();
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
  world: GrayboxWorld | null;
  stop: () => void;
}

/** The sky the gray-box stands under, and the fog that hides the edge of the 512 m block. */
const SKY_COLOR = 0xa9c8e8;
const FOG_NEAR_M = 180;
const FOG_FAR_M = 640;

/** The view: the snapshot pool, and for the gray-box the meshed block, drawn on the platform host's scene. */
async function createView(
  host: RendererHost,
  container: HTMLElement,
  onFrame: (nowMs: number) => void,
  packs: GrayboxPacks | null,
  worldBoot: WorldBoot | null,
): Promise<MadeView> {
  const [{ ObjectPool }, three, gb] = await Promise.all([
    import('../snapshot/object-pool.ts'),
    import('three/webgpu'),
    packs ? import('../graybox/load.ts') : Promise.resolve(null),
  ]);
  const canvas = host.currentCanvas;
  if (!canvas.isConnected) container.append(canvas);

  const { scene, camera } = host;
  const hemi = new three.HemisphereLight(0xdbe9ff, 0x4a4f44, 1.7);
  const sun = new three.DirectionalLight(0xfff1d6, 2.4);
  sun.position.set(120, 220, 80);
  if (!worldBoot) scene.add(hemi, sun);
  let world: GrayboxWorld | null = null;
  if (worldBoot) {
    // The world layer owns the lights, the sky and the fog of the streamed city.
    worldBoot.layer.attach(host);
    camera.position.set(worldBoot.spawn[0], worldBoot.spawn[1] + 30, worldBoot.spawn[2] + 40);
    camera.lookAt(worldBoot.spawn[0], worldBoot.spawn[1], worldBoot.spawn[2]);
  } else if (packs && gb) {
    scene.background = new three.Color(SKY_COLOR);
    scene.fog = new three.Fog(SKY_COLOR, FOG_NEAR_M, FOG_FAR_M);
    world = new gb.GrayboxWorld(packs);
    world.addTo(scene);
    // Until the sim publishes a camera directive the view looks at the block from above the spawn.
    camera.position.set(89, 30, 90);
    camera.lookAt(60, 16, 40);
  } else {
    scene.background = new three.Color(0x10141c);
    camera.position.set(0, 17, 40);
    camera.lookAt(0, 1, 12);
  }

  const resize = (): void => host.resize(Math.max(1, host.currentCanvas.clientWidth), Math.max(1, host.currentCanvas.clientHeight));
  resize();

  const pool = new ObjectPool(scene);
  host.frameHook = onFrame;
  return {
    canvas,
    pool,
    camera,
    backend: host.backend,
    world,
    stop: () => {
      host.frameHook = null;
      if (!worldBoot) scene.remove(hemi, sun);
      if (world) {
        scene.fog = null;
        scene.background = null;
      }
    },
  };
}
