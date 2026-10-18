// packages/shared/src/contracts/c03-input.ts
// C03 1.1.0 (1.0 body with the 1.1 additions merged in place). Copied from spec/domains/01-engine-contracts.md.
// Owner: S01. Types only: binders arrive in M01b1.
//
// One compile fix: Binder.attach took `EventTarget | XRSession`, which needs the DOM and WebXR type libs. This file
// must compile under the DOM-free sim tsconfig, so the parameter is the structural subset of EventTarget that both
// types satisfy. Proposal for the Architect: docs/decisions/M01a1-c03-binder-target.md.
export const C03_VERSION = '1.1.0' as const;   // 1.1: 'bot' device, BotInput, xr:both:wheel, setPoseHybrid, fighterScheme

/** Digital sim actions = bit index in InputFrame.buttons (u32). Bits 0–15 are the net set carried in
 *  C11's u16 `IN.buttons` (frozen in 06 v1.0); bits ≥ 16 never travel in IN (rooms use ACT frames). */
export const enum SimButton {
  Jump = 0, Sprint = 1, Interact = 2, Enter = 3, Attack = 4, Block = 5, Special = 6, Handbrake = 7,
  Nitro = 8, Ability = 9 /* thruster hop etc. */, LookBehind = 10, Horn = 11, FightHeavy = 12,
  FightAssist = 13, Teleport = 14 /* XR teleport commit */, Crouch = 15,
  Respray = 16 /* contextual shop confirm */, Emote = 17, PhoneQuick = 18,
}
/** Main-thread actions: never enter the sim; consumed by camera, UI and shell. */
export const enum ClientAction {
  Look = 0, Camera = 1 /* fp/tp toggle */, ShoulderSwap = 2, Map = 3, Phone = 4, Pause = 5,
  SnapTurnLeft = 6, SnapTurnRight = 7, UiAccept = 8, UiBack = 9, UiUp = 10, UiDown = 11, UiLeft = 12,
  UiRight = 13, UiTabPrev = 14, UiTabNext = 15, PhotoShutter = 16, DebugToggle = 17,
}
export const enum Axis { MoveX = 0, MoveY = 1, Throttle = 2, Brake = 3, Steer = 4, LookX = 5, LookY = 6 }
export type ActionId = `sim.${keyof typeof SimButton}` | `client.${keyof typeof ClientAction}` | `axis.${keyof typeof Axis}`;

export type InputContextId = 'onFoot' | 'vehicle' | 'fighter' | 'menu' | 'phone' | 'map' | 'cutscene' | 'photo' | 'tycoon' | 'xrMenu' | 'debug';
// 1.1: 'bot' is appended, so the u8 index of every 1.0 value is unchanged.
export type DeviceKind = 'kbm' | 'gamepad' | 'touch' | 'xr-controller' | 'xr-hand' | 'xr-transient' | 'pose' | 'bot';

/** The only input the sim reads. One per tick per player. Packs into C11 `IN`. */
export interface InputFrame {
  tick: number;            // u32
  buttons: number;         // u32 held bits (SimButton)
  pressed: number;         // u32 rising edges since previous tick (latched; sub-tick taps never lost)
  released: number;        // u32 falling edges
  moveX: number; moveY: number;   // i8 −127..127 (camera-relative on foot)
  throttle: number; brake: number; // i8 0..127
  steer: number;           // i8 −127..127
  camYaw: number;          // u16, 0..65535 ↔ 0..2π, world yaw of the view
  camPitch: number;        // i16, −16384..16384 ↔ −π/2..π/2
  context: number;         // u8 index into InputContextId order above
  device: number;          // u8 index into DeviceKind order above (glyphs, pose leniency)
}

export type ControlId =
  | `key:${string}`                    // KeyboardEvent.code, e.g. key:KeyW
  | `mouse:${0 | 1 | 2 | 3 | 4}` | 'mouse:wheelUp' | 'mouse:wheelDown' | 'mouse:dx' | 'mouse:dy'
  | `pad:b${number}` | `pad:a${number}` // W3C standard mapping indices
  | `touch:stick:${'L' | 'R'}` | `touch:btn:${string}` | 'touch:dragR' | 'touch:tilt'
  | `xr:${'left' | 'right'}:b${number}` | `xr:${'left' | 'right'}:a${number}` // xr-standard indices
  | `xr:${'left' | 'right'}:gesture:${string}` | 'xrt:pinch' | 'xrt:pinchHold'
  | `pose:${string}`                    // gesture ids from S07's classifier
  | 'xr:both:wheel';                    // 1.1: analog −1..1 from S11 HandFeatures two-hand wheel (S06)

export interface Binding {
  control: ControlId;
  modifiers?: ControlId[];                // chords; all must be held
  gesture?: 'press' | 'hold' | 'doubleTap' | 'release';
  holdMs?: number;                        // default 300
  doubleTapMs?: number;                   // default 450 [research/repos-modding.md §3.5]
  scale?: number; invert?: boolean; deadzone?: number; // axes only
}
export type ContextBindings = Partial<Record<ActionId, Binding[]>>;
export interface InputMap { version: 1; device: DeviceKind; contexts: Partial<Record<InputContextId, ContextBindings>> }

/** Persisted per profile in C05 settings.controls. Defaults live in config/input/defaults.<device>.json. */
export interface ControlsSettings {
  schema: 1;
  overrides: Partial<Record<DeviceKind, Partial<Record<InputContextId, ContextBindings>>>>;
  holdToToggle: ActionId[];               // e.g. sim.Sprint, sim.Block, sim.LookBehind
  lookSensitivity: Record<'kbm' | 'gamepad' | 'touch', number>;
  invertY: boolean;
  deadzones: { stickInner: number; stickOuter: number; trigger: number };
  touch: { layout: string /* layout id */; tiltSteer: boolean; stickRadiusPx: number; opacity: number };
  fighterScheme?: 'classic' | 'simple';   // 1.1: selects config/input/<device>.fighter-<scheme>.json (S07)
}

/** Structural subset of EventTarget (and of XRSession, which extends it) that binders use. See the header note. */
export interface BinderTarget {
  addEventListener(type: string, listener: (event: never) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: never) => void, options?: unknown): void;
}

export interface Binder {
  readonly device: DeviceKind;
  readonly connected: boolean;
  attach(target: BinderTarget): void;
  detach(): void;
  /** Accumulate raw device state into RawInputState; called on events and once per frame. */
  poll(into: RawInputState, nowMs: number): void;
}
export interface RawInputState { controls: Map<ControlId, number>; latchedPress: Set<ControlId>; lookDelta: [number, number]; lastActiveDevice: DeviceKind }

export interface InputRouter {
  readonly active: DeviceKind;
  push(ctx: InputContextId): void; pop(ctx: InputContextId): void; top(): InputContextId;
  setOverrides(s: ControlsSettings): void;
  /** Build the next frame's InputFrame from RawInputState; called by the sim boundary each tick. */
  sample(tick: number, cam: { yaw: number; pitch: number }): InputFrame;
  onClientAction(cb: (a: ClientAction, phase: 'pressed' | 'released') => void): () => void;
  rebindCapture(device: DeviceKind, timeoutMs: number): Promise<ControlId | null>; // settings UI
  setPoseHybrid(on: boolean): void;       // 1.1: S07 hybrid pose (rule 8)
}

/** Pose binder (S07 implements the classifier); emits timestamped actions for the fighter buffer. */
export interface PoseActionEvent { action: ActionId; captureTs: number; confidence: number }

/** 1.1, QA-only (VITE_DV_QA builds and headless CI): writes player-0 InputFrames in sim.worker for the C09 autoplayer
 *  and S06/S07/S08 bots. Never bundled into production builds (`check:bundle`). */
export interface BotInput { frame(tick: number): InputFrame; readonly device: 'bot' }
