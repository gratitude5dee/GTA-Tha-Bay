import {
  ClientAction, type ControlsSettings, type JsonValue, type UiCommand, type BinderTarget, type BootPayload, type FrameSignal, type InputFrame, type LoopStats, type QualityTierId, type SimConfig,
  type SimProfile,
} from '@dv/shared';
import { SimHostImpl, type WorkerLike } from '../../sim/sim-host.ts';
import { ViewModelStore } from '../ui/view-model-source.ts';
import { UiCommandSender } from '../ui/command-sender.ts';
import type { ModesPanel } from '../../debug/modes-panel.ts';
import { spawnSimWorker } from './spawn-worker.ts';
import { BAKED_WORLD, bakedWorldConfig } from '../../sim/scenarios/baked-world.ts';
import { CIVIC_GRAYBOX, civicGrayboxConfig } from '../../sim/scenarios/civic-graybox.ts';
import { physicsDropConfig } from '../../sim/scenarios/physics-drop.ts';
import { WALK_DROP, walkDropConfig } from '../../sim/scenarios/walk-drop.ts';
import type { DebugCommand } from '../../sim/transport/envelope.ts';
import type { PlayerSide } from '../../sim/publish.ts';
import type { PromptSide, VehicleSide } from '../snapshot/reader.ts';
import { SnapshotView } from '../snapshot/reader.ts';
import type { ObjectPool } from '../snapshot/object-pool.ts';
import { CameraRigImpl, type CameraLike } from '../camera/rig.ts';
import { CONTROL_OWNER } from '../../sim/control/states.ts';
import type { PursuitSide } from '../snapshot/reader.ts';
import { headingOf, VehicleCamera, type VehiclePose } from '../vehicle/vehicle-camera.ts';
import {
  GamepadBinder, InputRouterImpl, KbmBinder, pitchToI16, TouchBinder, writeInputFrame, yawToU16,
  type GamepadLike, type PointerLockTarget, type TouchLayout,
} from '../input/index.ts';
import touchLayoutJson from '../../../../../config/input/touch/default-right.json';
import racingTouchLayoutJson from '../../../../../config/input/touch/vehicle-racing.json';
import { ENGINE_TIERS } from '../anim/lod.ts';
import { AUDIO_CONFIG, AudioServiceImpl, type AudioContextLike } from '../audio/audio-service.ts';
import { createFirstGestureUnlock, type FirstGestureUnlock } from '../../platform/media/first-gesture.ts';
import type { GrayboxInfo, GrayboxPacks, GrayboxPackUrls, GrayboxWorld } from '../graybox/load.ts';
import type { TouchOverlay } from '../input/touch-overlay.ts';
import type { FreeCam } from '../debug/free-cam.ts';
import type { Inspector, InspectReply } from '../debug/inspector.ts';
import type { PhysicsDraw, PhysicsShapeInfo } from '../debug/physics-draw.ts';
import type { SimPanel, SkyControls } from '../debug/sim-panel.ts';
import type { XrSmoke, XrSystemLike } from '../xr/smoke.ts';
import type { XrPanelsLite } from '../xr/panels.ts';
import type { QaFlags } from '../../platform/qa-flags.ts';
import type { RendererHost } from '../../platform/renderer-host.ts';
import type { WorldBoot } from './world-layer.ts';

export interface BootEngineOptions {
  /**
   * Every batch of sim events the page receives, oldest first (M05b2: the CutscenePlayer listens for `cut.request` and `cut.done`).
   * Set it before the first tick: a mission that starts at boot emits its request before the engine handle exists.
   */
  onSimEvents?: (events: readonly { t: string; tick: number; n?: number; s?: string }[]) => void;
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
  /**
   * QA `?mission=<id>` (M05a1): the mission bundle the page loaded (its IR, DirectorScripts and line text). The story mode starts
   * it when the sim boots. Ignored unless `qa` and `flags.mission` are set.
   */
  mission?: Record<string, unknown>;
  /**
   * The story's mission catalog (M05c1): the compiled missions, their directors and line texts. The story mode reads it from the boot
   * payload (`config.story`): its Jobs list, the start markers and the auto trigger. Any build.
   */
  story?: Record<string, unknown>;
  /** The Phone action was pressed (`client.Phone`); the shell opens the phone (M04b2). */
  onPhone?: () => void;
  /** Show the touch layer on any device (`?touch=1`). */
  forceTouch?: boolean;
  /** Each toast the sim raised is handed here as it arrives (M04b1: the shell draws them). */
  onToast?: (t: ToastRecord) => void;
  /** Telemetry the sim queued (`mode.enter`, `mode.exit`, `unlock.emit`; M04a2) is handed here with its registry props. */
  onTelemetry?: (name: string, props: Record<string, string | number | boolean>) => void;
}

/** A toast the sim-side UiBridge raised; the shell (M04b1) draws it, the QA panel lists it. */
export interface ToastRecord {
  id: string;
  kind: string;
  text: string;
  params?: Record<string, string | number>;
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
  /** The vehicle the local player drives (side key `veh`, M03a1); null on foot. */
  vehicle: VehicleSide | null;
  /** The interaction prompt in force (side key `prompt`); null when nothing is offered. */
  prompt: PromptSide | null;
  /** The heat (side key `pursuit`, M03c); null at level 0. */
  pursuit: PursuitSide | null;
  /** The vehicle camera: which of the five views, whether it drives the draw camera now, and where the last frame put it. */
  vehicleCamera: { view: string; active: boolean; x: number; y: number; z: number; distance: number };
  /** QA tools (M03a1): the entity inspector and the physics wireframe. */
  tools: { inspector: boolean; inspectorComponents: string[]; physics: boolean; physicsBodies: number; physicsShapes: string[] } | null;
}

export interface EngineHandle {
  readonly host: SimHostImpl;
  readonly view: SnapshotView;
  readonly canvas: HTMLCanvasElement | null;
  readonly paused: boolean;
  setPaused(paused: boolean): void;
  observe(): EngineObservation;
  act(cmd: DebugCommand): boolean;
  /** The view models the sim publishes (`hud.*`, `sys.*`, `mode.<id>.*`; M04a2). */
  readonly vm: ViewModelStore;
  /** Sends a `UiCommand` to the sim over the command ring. False when it could not be sent. */
  sendUi(cmd: UiCommand): boolean;
  /** Toasts the sim raised since the page started, oldest first (the last 50). */
  toasts(): readonly ToastRecord[];
  /** Telemetry events the sim queued, as the page received them (the last 50). */
  telemetryEvents(): readonly { name: string; props: Record<string, string | number | boolean> }[];
  step(n: number): boolean;
  /** Swaps the touch layout (a shipped one or the player's custom one) and its localized labels; the binder releases every contact. */
  setTouchLayout(layout: TouchLayout, labels?: Readonly<Record<string, string>>): void;
  /** Player actions as ActionIds (`sim.Jump`, `client.Camera`, `axis.MoveX`), for the onboarding tips. */
  onAction(cb: (id: string) => void): () => void;
  /** Forget the previous frame time so the next `dt` is zero (the page was hidden). */
  resetClock(): void;
  qaResults(): Record<string, unknown>;
  /** Input reaches the game (true) or the world is a backdrop (false). */
  setPlay(on: boolean): void;
  /** Ends the XR smoke session, if one runs. */
  endXr(): Promise<void>;
  /** The vehicle camera (M03a1): the bridge cycles and reads it. */
  readonly vehicleCamera: VehicleCamera;
  /** QA tools (M03a1); null outside QA builds with `?debug=1`. */
  readonly tools: { inspector: Inspector; physics: PhysicsDraw } | null;
  /** The scene panels host of the UI skeleton (QA builds with a renderer host only; null otherwise). */
  readonly xrPanels: XrPanelsLite | null;
  /** The input router (null until it exists): the shell rebinds controls and listens for client actions through it (M04b1). */
  readonly router: InputRouterImpl | null;
  /** Unlocks the audio context from a user gesture (the audio test button of Settings). */
  audioUnlock(): void;
  /** The first gesture of the Title (M04c, DL-663): audio context plus the pool of three unlocked `<video>` elements. Idempotent. */
  firstGesture(): void;
  /** The `FirstGestureUnlock` pool for S03's CutscenePlayer: `acquireVideo`/`releaseVideo` (C13 1.1). */
  readonly media: FirstGestureUnlock;
  /** The audio service (null without Web Audio); the cutscene audio port plays on its `cutscene` bus. */
  readonly audioService: AudioServiceImpl | null;
  /** Sends a debug command that has a `qa` reply and waits for the reply (M03a1 bridge). */
  ask(cmd: DebugCommand, replyName: string, timeoutMs?: number): Promise<unknown>;
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

  // QA `?mission=<id>`: the story mode starts that mission; the flags that force its paths ride along (M05a1).
  if (opts.qa && opts.flags.mission && opts.mission) {
    const f = opts.flags;
    boot = {
      ...boot,
      config: {
        ...boot.config,
        mission: {
          ...opts.mission,
          ...(f.stage !== null ? { stage: f.stage } : {}),
          ...(f.seed !== null ? { seed: f.seed } : {}),
          ...(f.hooks !== null ? { hooks: f.hooks } : {}),
          ...(f.talk !== null ? { talk: f.talk } : {}),
          ...(f.beats === 'instant' ? { beats: 'instant' } : {}),
        },
      },
    };
  }

  if (opts.story) boot = { ...boot, config: { ...boot.config, story: opts.story } };

  // QA `?unlockAll=1`: unlocks in memory only; the sim ignores it unless it was started as a QA build (M04a2).
  if (opts.qa && opts.flags.unlockAll) boot = { ...boot, config: { ...boot.config, unlockAll: true } };
  // QA `?racing=1`: the sim worker boots the racing module (M07a1).
  if (opts.qa && opts.flags.racing) boot = { ...boot, config: { ...boot.config, racing: true } };

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
  // The scene panels of the UI skeleton (M04b2): QA builds only, until M11b1 brings the real `XrPanels`.
  let xrPanels: XrPanelsLite | null = null;
  let xrSupported = false;
  let chunksLoaded = 0;
  let backend: EngineObservation['backend'] = 'none';
  const view = new SnapshotView();
  // Vehicles (M03a1): the five cameras, the context switch, the prompt overlay, and the QA tools.
  const vcam = new VehicleCamera();
  // The snapshot side block reaches the HUD as view-model keys the page sets itself (M04b2, DL-663 part 2): the S10 widgets read them.
  // Player actions for the onboarding tips (M04b2): rising edges of the sim buttons, movement, look and the client actions, by ActionId.
  const actionListeners = new Set<(id: string) => void>();
  const SIM_NAMES = ['Jump', 'Sprint', 'Interact', 'Enter', 'Attack', 'Block', 'Special', 'Handbrake', 'Nitro', 'Ability', 'LookBehind', 'Horn', 'FightHeavy', 'FightAssist', 'Teleport', 'Crouch', 'Respray', 'Emote', 'PhoneQuick'];
  const CLIENT_NAMES = ['Look', 'Camera', 'ShoulderSwap', 'Map', 'Phone', 'Pause'];
  const emitAction = (id: string): void => {
    for (const cb of [...actionListeners]) cb(id);
  };
  const emitFrameActions = (f: InputFrame, looked: boolean): void => {
    if (actionListeners.size === 0) return;
    for (let i = 0; i < SIM_NAMES.length; i++) if (f.pressed & (1 << i)) emitAction(`sim.${SIM_NAMES[i]}`);
    if (f.moveX !== 0 || f.moveY !== 0) emitAction('axis.MoveX');
    if (looked) emitAction('axis.LookX');
  };
  const mirrored = new Map<string, string>();
  const mirror = (k: `hud.${string}`, v: JsonValue | null): void => {
    const sig = v === null ? '' : JSON.stringify(v);
    if (mirrored.get(k) === sig) return;
    mirrored.set(k, sig);
    vm.setLocal(k, v);
  };
  const mirrorHud = (): void => {
    const pr = playing ? view.prompt : null;
    const pu = playing ? view.pursuit : null;
    const ve = playing && view.vehicle && view.vehicle.state === 201 ? view.vehicle : null;
    mirror('hud.prompt', pr ? { kind: pr.kind, key: pr.key, hold: pr.hold, progress: Math.round(pr.progress * 100) / 100, ...(pr.reason ? { reason: pr.reason } : {}) } : null);
    mirror('hud.heat', pu ? { level: pu.level, phase: pu.phase, cooldown: Math.round(pu.cooldown * 100) / 100, units: pu.units, seen: pu.seen } : null);
    mirror('hud.veh', ve ? { kph: Math.round(Math.abs(ve.speed) * 3.6), gear: ve.gear, rpm: Math.round(ve.rpm / 50) * 50 } : null);
    mirror('hud.device', router?.active ?? 'kbm');
  };
  let pursuitUi: { update(s: PursuitSide | null): void } | null = null;
  let drivingCtx = false;
  let snapBehind = false;
  let idleSec = 0;
  let inspector: Inspector | null = null;
  let physicsDraw: PhysicsDraw | null = null;
  let physicsPoll = 0;

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
  // FirstGestureUnlock (M04c): the single first-gesture handler; it unlocks the audio service and the video pool.
  const media = createFirstGestureUnlock({ audio: audio ?? { unlock: () => Promise.resolve() } });
  cleanups.push(media.attach(window));
  if (audio) cleanups.push(audio.attachLifecycle(document, () => document.visibilityState));

  const spawn = opts.spawn ?? spawnSimWorker;

  // The UI channel (M04a2): view models from the sim, commands to it, toasts and queued telemetry.
  const vm = new ViewModelStore();
  const toastLog: ToastRecord[] = [];
  const telemetryLog: { name: string; props: Record<string, string | number | boolean> }[] = [];
  let modesUi: ModesPanel | null = null;
  const uiSender = new UiCommandSender(() => host.transport);
  const withProfile = (c: SimConfig, p: SimProfile): SimConfig => ({ ...c, profile: p, physicsBuild: p === 'canonical' ? 'deterministic-compat' : 'simd-compat' });

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
    onUi: (out) => {
      vm.apply(out.patches);
      for (const t of out.toasts) {
        toastLog.push(t);
        if (toastLog.length > 50) toastLog.shift();
        opts.onToast?.(t);
      }
      modesUi?.refresh();
    },
    onSimEvents: (events) => {
      worldBoot?.layer.onSimEvents?.(events);
      opts.onSimEvents?.(events);
      for (const e of events) {
        if (e.t === 'telemetry' && e.s) {
          const bar = e.s.indexOf('|');
          try {
            const name = e.s.slice(0, bar);
            const props = JSON.parse(e.s.slice(bar + 1)) as Record<string, string | number | boolean>;
            telemetryLog.push({ name, props });
            if (telemetryLog.length > 50) telemetryLog.shift();
            opts.onTelemetry?.(name, props);
          } catch {
            // a malformed line is dropped
          }
        } else if (e.t === 'mode.restart' && e.s) {
          // C06 rule 3: a top-level mode of another profile restarts the sim behind loading, then starts there.
          const [profile, then] = e.s.split('|') as [SimProfile, string];
          void switchProfile(profile, then);
        }
        if (e.t === 'audio.cue' && e.s) audio?.play({ tick: e.tick, cue: e.s, bus: AUDIO_CONFIG.footstep.bus, ...(e.a !== undefined ? { entity: e.a } : {}) });
        else if (e.t === 'world.chunk') chunksLoaded = Math.max(chunksLoaded, e.n ?? 0);
      }
    },
  });

  async function switchProfile(profile: SimProfile, then: string): Promise<void> {
    if (recovering || disposed) return;
    recovering = true;
    banner.hidden = false;
    pool?.clear();
    vm.reset();
    mirrored.clear();
    try {
      await host.restart(withProfile(cfg, profile));
      host.sendUi({ t: 'mode.start', id: then as never });
    } catch (e) {
      console.error('profile switch failed', e);
    } finally {
      recovering = false;
      banner.hidden = true;
    }
  }

  async function recover(): Promise<void> {
    if (recovering || disposed) return;
    recovering = true;
    banner.hidden = false;
    pool?.clear();
    vm.reset();
    mirrored.clear();
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

  /** The pose of an entity with its orientation (the vehicle camera needs the heading). */
  const targetFull = (handle: number): VehiclePose | null => {
    for (let i = 0; i < view.count; i++) {
      const p = view.poses[i];
      if (p && p.handle === handle) return { x: p.px, y: p.py, z: p.pz, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw };
    }
    return null;
  };

  /** Sends a debug command with a reply and waits for the reply (the same wait the world bridge uses). */
  const ask = async (cmd: DebugCommand, replyName: string, timeoutMs = 8000): Promise<unknown> => {
    if (!host.sendDebug(cmd)) return null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (host.qaResults.has(replyName)) return host.qaResults.get(replyName);
      await new Promise<void>((r) => setTimeout(r, 15));
    }
    return null;
  };
  let askSerial = 0;

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
    // The control owner decides the input context (C03): a vehicle owner reads the `vehicle` bindings.
    const driving = view.player?.owner === CONTROL_OWNER.Vehicle;
    if (router && driving !== drivingCtx) {
      drivingCtx = driving;
      if (driving) {
        router.push('vehicle');
        snapBehind = true;
        vcam.reset();
      } else router.pop('vehicle');
    }
    if (router) {
      const block = host.transport?.input;
      if (playing) {
        // Look first (no tick latency), then the devices into the input block the worker samples once per tick. The free cam
        // takes the look for itself and the sim gets the neutral `debug` context, so the player stands still.
        const lookBefore = look.yaw + look.pitch * 7;
        router.applyLook(dtSec, freeCam?.active ? freeCam.look : look);
        idleSec = Math.abs(look.yaw + look.pitch * 7 - lookBefore) > 1e-5 ? 0 : idleSec + dtSec;
        const frame = router.sample(frames, look);
        emitFrameActions(frame, Math.abs(look.yaw + look.pitch * 7 - lookBefore) > 1e-5);
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
    mirrorHud();
    pursuitUi?.update(view.pursuit);
    if (physicsDraw?.visible) {
      physicsDraw.sync(view.poses, view.count);
      if (++physicsPoll % 30 === 1) {
        const id = ++askSerial;
        void ask({ t: 'debug.physics', id }, `physics.reply.${id}`).then((r) => {
          const list = (r as { bodies?: PhysicsShapeInfo[] } | null)?.bodies;
          if (list) physicsDraw?.setShapes(list);
        });
      }
    }
    if (rig) {
      const tier = hostScene?.tier ?? null;
      const vfollow = driving && view.camera?.reason === 'vehicle' ? view.camera.follow : undefined;
      const vpose = vfollow ? targetFull(vfollow.target) : null;
      if (vfollow && vpose && !freeCam?.active) {
        // The vehicle cameras: chase near, mid and far, hood and cockpit (R-PLAT-04). The player's own mesh is hidden by the sim.
        const heading = headingOf(vpose);
        if (snapBehind) {
          vcam.snapBehind(look, heading);
          snapBehind = false;
        }
        vcam.recentre(look, heading, idleSec, dtSec);
        vcam.update({
          camera: rig.camera, pose: vpose, look, allowed: view.camera?.allowedDistance ?? null, dtSec, idleSec,
          drawDistanceM: (tier?.budget.world.buildingDrawDistanceM ?? FALLBACK_DRAW_DISTANCE_M) + (worldBoot ? (tier?.budget.world.altitudeBoostM ?? 0) : 0),
        });
        if (pool) {
          pool.hiddenHandle = null;
          pool.fadeHandle = null;
          pool.fadeOpacity = 1;
        }
        if (xrSmoke) xrSmoke.update();
        xrPanels?.update(nowMs / 1000);
      } else {
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
        xrPanels?.update(nowMs / 1000);
      }
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
        boundaryFog: view.boundaryFog,
        poses: view.poses,
        poseCount: view.count,
        poseKeys: view.keys,
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
    // Remapped controls come from the sim's settings slice as the view model `sys.controls` (also on load; R-ENG-04).
    const applyControls = (v: unknown): void => {
      if (v && typeof v === 'object') router?.setOverrides(v as ControlsSettings);
    };
    applyControls(vm.get('sys.controls'));
    cleanups.push(vm.subscribe('sys.controls', applyControls));
    kbm.attach(window as unknown as BinderTarget);
    pad.attach(window as unknown as BinderTarget);
    touchBinder.attach(overlay.root as unknown as BinderTarget);
    // A mode with its own touch layout (racing, M07a1) swaps it in while it is the root of the mode stack.
    cleanups.push(vm.subscribe('sys.mode', (v) => {
      const rootMode = (v as { stack?: { id: string }[] } | undefined)?.stack?.[0]?.id;
      const next = rootMode === 'racing' ? (racingTouchLayoutJson as unknown as TouchLayout) : layout;
      overlay?.setLayout(next);
      touchBinder?.setLayout(next);
    }));
    overlay.setEnabled(playing);
    cleanups.push(() => kbm.detach(), () => pad.detach(), () => touchBinder?.detach(), () => overlay?.dispose());
    const off = router.onClientAction((action, phase) => {
      if (phase !== 'pressed') return;
      if ((action as number) < CLIENT_NAMES.length) emitAction(`client.${CLIENT_NAMES[action as number]}`);
      if (action === ClientAction.Camera) {
        if (drivingCtx) vcam.cycle();
        else rig?.toggleFpTp();
      }
      else if (action === ClientAction.ShoulderSwap) rig?.swapShoulder();
      else if (action === ClientAction.Phone) opts.onPhone?.();
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
        // The entity inspector (F7) and the physics wireframe (F6), M03a1.
        const [{ Inspector: Insp }, { PhysicsDraw: Draw }] = await Promise.all([import('../debug/inspector.ts'), import('../debug/physics-draw.ts')]);
        inspector = new Insp({
          container: document.body,
          ask: async (cmd) => {
            const id = ++askSerial;
            const r = await ask({ ...cmd, id } as DebugCommand, `inspect.reply.${id}`);
            return r as InspectReply | null;
          },
        });
        physicsDraw = new Draw(opts.host!.scene);
        cleanups.push(() => inspector?.dispose(), () => physicsDraw?.dispose());
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
          if (e.code === 'F6' && !e.repeat) {
            e.preventDefault();
            physicsDraw?.toggle();
            return;
          }
          if (e.code === 'F7' && !e.repeat) {
            e.preventDefault();
            inspector?.toggle();
            return;
          }
          if (e.code !== 'F4' || e.repeat) return;
          e.preventDefault();
          const cam = made.camera as unknown as { position: { x: number; y: number; z: number } };
          freeCam?.toggle({ pos: [cam.position.x, cam.position.y, cam.position.z], yaw: look.yaw, pitch: look.pitch });
        };
        window.addEventListener('keydown', onKey);
        cleanups.push(() => window.removeEventListener('keydown', onKey), () => panel?.dispose());
      }
      // The pursuit panel (M03c) is on in every QA build, so the wanted system can be seen without ?debug=1.
      const { PursuitPanel } = await import('../../debug/pursuit-panel.ts');
      const pursuitAsk = (op: string, args?: Record<string, unknown>): void => {
        const id = ++askSerial;
        void host.sendDebug({ t: 'debug.pursuit', id, op, ...(args ? { args } : {}) });
      };
      const pp = new PursuitPanel({
        container: document.body,
        onHeat: (level) => pursuitAsk('setHeat', { level }),
        onNeverWanted: (on) => pursuitAsk('neverWanted', { on }),
        onBlock: () => pursuitAsk('blockAhead', { ahead: 45 }),
        onStrip: () => pursuitAsk('stripAhead', { ahead: 45 }),
      });
      pursuitUi = pp;
      cleanups.push(() => pp.dispose());
      // The modes panel (M04a2) is on in every QA build too: mode state, wallet, unlocks and the last toasts, with the start/quit buttons.
      const { ModesPanel } = await import('../../debug/modes-panel.ts');
      const modesAsk = (op: string, args?: Record<string, unknown>): void => {
        const id = ++askSerial;
        void host.sendDebug({ t: 'debug.modes', id, op, ...(args ? { args } : {}) });
      };
      modesUi = new ModesPanel({
        container: document.body,
        vm,
        toasts: () => toastLog,
        onStart: (id) => void uiSender.send({ t: 'mode.start', id }),
        onQuit: () => void uiSender.send({ t: 'mode.quit' }),
        onUnlock: (id) => modesAsk('unlock', { id }),
        onCredit: (cents) => modesAsk('credit', { cents, key: `qa:panel:${++askSerial}` }),
      });
      const mp = modesUi;
      cleanups.push(() => mp.dispose());
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
      {
        const { XrPanelsLite } = await import('../xr/panels.ts');
        xrPanels = new XrPanelsLite(host2.scene, host2.camera);
        const panels = xrPanels;
        cleanups.push(() => panels.dispose());
      }
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
        vehicle: view.vehicle,
        prompt: view.prompt,
        pursuit: view.pursuit,
        vehicleCamera: { view: vcam.view, active: drivingCtx, x: vcam.last.x, y: vcam.last.y, z: vcam.last.z, distance: vcam.last.distance },
        tools: inspector && physicsDraw
          ? {
              inspector: inspector.visible, inspectorComponents: inspector.components, physics: physicsDraw.visible,
              physicsBodies: physicsDraw.count, physicsShapes: physicsDraw.shapesDrawn,
            }
          : null,
      };
    },
    act: (cmd) => host.sendDebug(cmd),
    vm,
    sendUi: (cmd) => uiSender.send(cmd),
    toasts: () => toastLog,
    get xrPanels() {
      return xrPanels;
    },
    get router() {
      return router;
    },
    audioUnlock: () => {
      void audio?.unlock().catch(() => {});
    },
    firstGesture: () => {
      void media.trigger();
    },
    media,
    audioService: audio,
    telemetryEvents: () => telemetryLog,
    step: (n) => host.sendDebug({ t: 'debug.step', n }),
    resetClock: () => {
      lastNow = -1;
    },
    setTouchLayout: (layout, labels) => {
      touchBinder?.setLayout(layout);
      overlay?.setLayout(layout, labels, (layout as { opacity?: number }).opacity ?? 1);
    },
    onAction: (cb) => {
      actionListeners.add(cb);
      return () => void actionListeners.delete(cb);
    },
    qaResults: () => Object.fromEntries(host.qaResults),
    setPlay,
    vehicleCamera: vcam,
    get tools() {
      return inspector && physicsDraw ? { inspector, physics: physicsDraw } : null;
    },
    ask,
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
