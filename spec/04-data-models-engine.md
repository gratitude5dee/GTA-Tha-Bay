# 04 — Data models, part 2: engine contracts C01–C04

> Wave 5 integration (Architect), 2026-10-18. Part of `spec/04-data-models.md` (index, conventions, JSON Schema registry). Contract text at 06 v1.1, copied verbatim from the owner spec `spec/domains/01-engine-contracts.md` (S01); the owner spec stays normative and wins on any difference. 1.1 blocks are deltas: apply them with the merge rule of the index §3. Rules are cited, not copied; read them in the owner spec before implementing.

## C01 — `EntityId` + ECS conventions

| Field | Value |
|---|---|
| Owner · version | S01 · `C01_VERSION = '1.0.0'` |
| Source path | `packages/shared/src/contracts/c01-ecs.ts` |
| Defined in | `spec/domains/01-engine-contracts.md` §C01 (component registry table, rules 1–7) |
| Created in | M01a1 (verbatim copy) |
| Consumers | all domains (06 §4.2); milestones M01a1, M01a2, M02b1, M03a1, M03b1, M05a1, M07a1, M08a1, M12b, M13a3 |

```ts
// packages/shared/src/contracts/c01-ecs.ts
export const C01_VERSION = '1.0.0' as const;

/** Dense, recycled bitECS index. Valid only inside one sim world and one session.
 *  Never persisted, never sent on the wire, never held across ticks (use EntityHandle). */
export type EntityId = number & { readonly __brand: 'EntityId' };

/** Generation-checked reference: handle = gen * 2^20 + id (fits u32). */
export type EntityHandle = number & { readonly __brand: 'EntityHandle' };
export const ENTITY_ID_BITS = 20;
export const MAX_ENTITIES = 65_536;          // per sim world, identical on every tier
export const ENTITY_GEN_MAX = 4_095;         // 12 bits; wraps to 1 (0 = never allocated)
export const NULL_HANDLE = 0 as EntityHandle; // id 0 is reserved and never allocated

/** Persistent / network identity. Saves, mission IR, net messages and mods use StableKey, never EntityId. */
export type StableKey =
  | `player:${number}`                 // local player 0, net slots 1..n
  | `veh:${string}`                    // VehicleInstanceId from C05 garage
  | `npc:${string}`                    // C10 NPC id
  | `amb:${string}:${number}`          // ambient agent: C08 cellKey + slot index
  | `mis:${string}:${string}`          // mission id + local entity name (C09)
  | `pfb:${string}:${number}`;         // prefab spawn with a per-session serial (non-persistent)

export type ScalarKind = 'f64' | 'f32' | 'i32' | 'u32' | 'i16' | 'u16' | 'i8' | 'u8';
/** A field is one scalar, or a fixed-length vector of scalars (stored as N parallel arrays). */
export type FieldSpec = ScalarKind | readonly [ScalarKind, number];
export interface ComponentSchema { readonly [field: string]: FieldSpec }

/** Component ids are stable forever; a removed component's id is never reused. */
export type ComponentId = number;
export const COMPONENT_ID_RANGES = {
  engine: [1, 255], world: [256, 511], story: [512, 767], npc: [768, 1023],
  racing: [1024, 1279], fighter: [1280, 1535], tycoon: [1536, 1791], net: [1792, 1919], mod: [2048, 4095],
} as const; // owners: S01, S02, S03, S04, S06, S07, S08, S09, S12

export interface ComponentDef<S extends ComponentSchema = ComponentSchema> {
  readonly id: ComponentId;
  readonly name: string;              // PascalCase, unique
  readonly owner: 'S01' | 'S02' | 'S03' | 'S04' | 'S06' | 'S07' | 'S08' | 'S09' | 'S12';
  readonly schema: S;                 // {} = tag component
  readonly hashed: boolean;           // included in stateHash (C02)
  readonly snapshot: 'none' | 'render' | 'net' | 'render+net';
}

/** Typed-array views (one array per scalar). Backed by one SharedArrayBuffer per world when
 *  crossOriginIsolated, else by ArrayBuffers. Length = MAX_ENTITIES. */
export type ComponentStore<S extends ComponentSchema> = {
  readonly [K in keyof S]: S[K] extends readonly [infer T, number] ? readonly TypedArrayOf<T>[] : TypedArrayOf<S[K]>;
};
type TypedArrayOf<T> = T extends 'f64' ? Float64Array : T extends 'f32' ? Float32Array : T extends 'i32' ? Int32Array
  : T extends 'u32' ? Uint32Array : T extends 'i16' ? Int16Array : T extends 'u16' ? Uint16Array
  : T extends 'i8' ? Int8Array : Uint8Array;

/** Interned strings for component fields (asset ids, cue ids, prefab ids). Deterministic:
 *  ids assigned in first-intern order, which is itself driven by sim order. 0 = empty. */
export interface StringTable { intern(s: string): number; get(id: number): string; readonly size: number }

export interface CommandBuffer {
  spawn(prefabId: string, init?: Partial<Record<string, number>>, key?: StableKey): EntityHandle; // handle valid next stage
  despawn(h: EntityHandle): void;
  add<S extends ComponentSchema>(h: EntityHandle, c: ComponentDef<S>, init?: Partial<Record<keyof S, number>>): void;
  remove(h: EntityHandle, c: ComponentDef): void;
}

export interface EcsApi {
  readonly strings: StringTable;
  store<S extends ComponentSchema>(c: ComponentDef<S>): ComponentStore<S>;
  query(cs: readonly ComponentDef[], not?: readonly ComponentDef[]): Uint32Array; // EntityIds, dense order
  resolve(h: EntityHandle): EntityId | null;      // null if stale
  handle(id: EntityId): EntityHandle;
  byKey(k: StableKey): EntityHandle;               // NULL_HANDLE if absent
  keyOf(h: EntityHandle): StableKey | null;
  has(h: EntityHandle, c: ComponentDef): boolean;
  readonly commands: CommandBuffer;
}
```

Key invariants (rules in the owner spec): only `sim.worker` or the headless host mutates the world; structural changes go through `CommandBuffer` and apply at the end of the issuing `SimStage`; components hold scalars only; ambient agents use `amb:<cell>:<slot>` keys whose spawn is a pure function of `(worldSeed, cell, slot, spawnTick)`; component ids are never renumbered or reused. Engine component ids 1–24 and tags 30–39 are listed in the owner's registry table; other domains allocate inside their `COMPONENT_ID_RANGES` block (story 512–515 in `03-story-missions.md` §C1, mod host shims 2048–2050 in `12-modding-contracts.md` B§5).

## C02 — `GameLoop` phases and determinism

| Field | Value |
|---|---|
| Owner · version | S01 · `C02_VERSION = '1.1.0'` |
| Source path | `packages/shared/src/contracts/c02-loop.ts` |
| Defined in | `01-engine-contracts.md` §C02, "Determinism rules", 1.1 section (rule 3 clarification) |
| Created in | M01a1 |
| Consumers | all domains; milestones M01a1, M01a2 (cross-browser hash job), M02b2, M05a1, M07a2, M08a1, M09a1, M12b |

```ts
// packages/shared/src/contracts/c02-loop.ts
export const C02_VERSION = '1.1.0' as const;   // 1.1: rule 3 clarification (stateless counter hash), see the 1.1 section at the end
export const SIM_HZ = 60;
export const SIM_DT = 1 / 60;            // seconds; the only dt sim code may use
export const MAX_FRAME_DT = 0.15;        // accumulator clamp [research/repos-modding.md §3.4]
export const MAX_TICKS_PER_FRAME = 9;    // floor(0.15 / SIM_DT)
export const AI_DIVISOR = 2;             // AI "think" at 30 Hz on every tier (deterministic)
export const NET_DIVISOR = 3;            // netOut at 20 Hz (A-04)
export type Tick = number;               // u32, starts at 0 per sim session

/** Per render frame, in this order. Input, Sim (hand-off), Anim, Audio and Render run on the main thread; NetIn and NetOut run in
 *  sim.worker (socket in the worker, D-S01-05): NetIn before the tick's Commands stage, NetOut after a tick where tick % NET_DIVISOR === 0 (DL-071). */
export const enum FramePhase { Input = 0, NetIn = 1, Sim = 2, Anim = 3, Audio = 4, Render = 5, NetOut = 6 }

/** Per sim tick, inside sim.worker, in this order. Systems declare one stage + an order key. */
export const enum SimStage {
  Commands = 0,     // apply queued external commands (UI, mods, net) in arrival order
  Control = 1,      // ownership state machine; player + AI intents from InputFrame
  Script = 2,       // GameMode.tick, mission interpreter threads (A-02), zone events
  AI = 3,           // pursuit director, police tactics, traffic/ped brains (rateDivisor 2)
  PhysicsPre = 4,   // kinematic targets, character moves, vehicle controller inputs
  PhysicsStep = 5,  // backend.step(SIM_DT, substeps)
  PhysicsPost = 6,  // read back transforms, contacts → SimEvents, ragdoll timers
  Rules = 7,        // damage, infractions → heat, interaction resolution, economy, clock, weather
  Streaming = 8,    // chunk interest + collider working set requests (C08)
  Publish = 9,      // render snapshot, audio cues, UI view-model patches, stateHash, telemetry
}

export type SimProfile = 'local' | 'canonical';
/** local: tier-dependent density, Rapier simd-compat (D-12), deterministic only on the same build+browser.
 *  canonical: fixed density (mobile-low caps), Rapier deterministic-compat, cross-browser identical. */

export interface SimConfig {
  seed: number;                          // u32 world seed
  profile: SimProfile;
  physicsBuild: 'simd-compat' | 'deterministic-compat'; // derived from profile; one build per session
  tier: QualityTierId;                   // C13 (S11) — read for crowd caps, physics radius and config/engine-tiers.json only
  worldBake: string;                     // C08 bake hash
  hashEvery: number;                     // ticks between stateHash; 0 = off
  startTick?: Tick;
}
export type QualityTierId = import('../platform/c13').QualityTierId; // desktop-ultra | desktop | mobile | mobile-low | xr-quest | xr-visionpro

export interface SystemDef {
  id: string;                            // 'engine.control.owner', 'world.traffic.brain', …
  owner: string;                         // S##
  stage: SimStage;
  order: number;                         // run order within stage; ties broken by id (string compare)
  rateDivisor?: 1 | 2 | 4;               // runs when (tick + offset) % div === 0; offset = fnv32(id) % div
  profiles?: SimProfile[];               // default both
  run(ctx: SystemContext): void;
}
export interface SystemContext { tick: Tick; dt: typeof SIM_DT; ecs: import('./c01-ecs').EcsApi; services: SimServices }
export interface SimServices { /* injected: rng, physics, clock, pursuit, zones, scheduler, events, … (part 2) */
  readonly xrPoses: Readonly<Float32Array> | null; // S11 XrPoseBlock (11-platform-xr.md §4.3) via its seqlock reader; null outside XR
  readonly [name: string]: unknown }

/** Main thread → sim, once per render frame (SAB block or postMessage). */
export interface FrameSignal { frame: number; nowMs: number; dtSec: number; paused: boolean; timeScale: 0.25 | 0.5 | 1 | 2 }

/** Main thread → sim command ring messages that the worker handles outside ticks (rule 9). UI and debug commands for the
 *  Commands stage use the same ring with other `t` values, owned by their senders. */
export type SimControlMessage =
  | { t: 'save.request'; reason: 'hidden' };   // LifecycleController (S11) on visibilitychange → hidden; C05 rule 4 decides eligibility

export interface LoopStats { tick: Tick; ticksLastFrame: number; tickMsP50: number; tickMsP99: number; droppedSec: number; overruns: number }

/** Render snapshot: triple-buffered in SAB; reader takes the newest complete buffer and the previous one. */
export interface SnapshotHeader { seq: number /*u32, odd while writing*/; tick: Tick; count: number; flags: number }
export const SNAPSHOT_RECORD_BYTES = 64;   // layout below
export const SNAPSHOT_MAX_RECORDS = 8_192;
export interface InterpRules { skipIfTickGap: 3; teleportMeters: 2; angleShortestArc: true }

export interface SimHost {
  start(cfg: SimConfig, boot: BootPayload): Promise<void>;
  frame(sig: FrameSignal): void;         // never blocks; worker accumulates and ticks
  stepOnce(): void;                      // debug/headless
  restart(cfg: SimConfig): Promise<void>; // profile switch (GameMode with different simProfile)
  readonly stats: LoopStats;
  dispose(): Promise<void>;
}
export interface BootPayload { strings: string[]; prefabs: unknown[]; config: Record<string, unknown> }
```

Snapshot record layout (64 B, little-endian) and the numbered loop rules 1–9 are in the owner spec directly below this block. Determinism rules 1–7 define the lint scope (`packages/shared/**`, `packages/engine/src/sim/**` except `sim/save/**`, `packages/modes/*/src/sim/**`), the allowed exact operations, `xoshiro128**` seeded by `splitmix32(worldSeed ^ fnv32(streamName))`, quantized `InputFrame`s, the two Rapier 0.21.0 builds per profile [research/stack-rendering-platform.md §5.1, F-014] and `canonical` density. C02 1.1 (rule 3 clarification, no type change): the stateless counter hash `ctrU32(seed, stream, counter) = splitmix32((seed ^ fnv32(stream)) + Math.imul(counter, 0x9E3779B1))` is allowed in sim code and keeps no state (S08 definition, `08-tycoon-events.md` §3; golden vectors `packages/shared/test/golden/ctr.v1.json` written in M01a1 and re-checked in Chromium and WebKit in M01a2).

`stateHash(tick)` is FNV-1a-64 over tick, hashed component stores in ascending `ComponentId` for `query([Key])` in ascending `StableKey` order, then hashed resources in fixed order (C02 rule 7).

## C03 — `InputAction` map

| Field | Value |
|---|---|
| Owner · version | S01 · `C03_VERSION = '1.1.0'` |
| Source path | `packages/shared/src/contracts/c03-input.ts` |
| Defined in | `01-engine-contracts.md` §C03 (rules 1–10), 1.1 section |
| Created in | M01a1 (types); binders and router M01b1/M01b2 |
| Consumers | S03, S06, S07, S10, S11, S12; milestones M01b1, M01b2, M04b1 (rebind UI), M05a2 (autoplayer `BotInput`), M07a1, M08a2, M08c1, M11b1, M13a4 |

```ts
// packages/shared/src/contracts/c03-input.ts
export const C03_VERSION = '1.1.0' as const;   // 1.1: 'bot' device, BotInput, xr:both:wheel, setPoseHybrid, fighterScheme (end of file)

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
export type DeviceKind = 'kbm' | 'gamepad' | 'touch' | 'xr-controller' | 'xr-hand' | 'xr-transient' | 'pose';

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
  | `pose:${string}`;                    // gesture ids from S07's classifier

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
}                                         // 1.1 adds optional fighterScheme (end of file, DL-095)

export interface Binder {
  readonly device: DeviceKind;
  readonly connected: boolean;
  attach(target: EventTarget | XRSession): void;
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
}

/** Pose binder (S07 implements the classifier); emits timestamped actions for the fighter buffer. */
export interface PoseActionEvent { action: ActionId; captureTs: number; confidence: number }
```

C03 1.1 delta (DL-094…DL-096, DL-158, DL-159):

```ts
// c03-input.ts — 1.1 (appended union members keep the u8 DeviceKind index of 1.0 values stable)
export type DeviceKind = 'kbm' | 'gamepad' | 'touch' | 'xr-controller' | 'xr-hand' | 'xr-transient' | 'pose' | 'bot';
export type ControlId = /* 1.0 members */ | 'xr:both:wheel';    // analog −1..1 from S11 HandFeatures two-hand wheel (S06)
export interface InputRouter { /* 1.0 members */ setPoseHybrid(on: boolean): void }   // S07 hybrid pose (rule 8)
export interface ControlsSettings { /* 1.0 fields */ fighterScheme?: 'classic' | 'simple' }   // selects config/input/<device>.fighter-<scheme>.json (S07)
/** QA-only (VITE_DV_QA builds and headless CI): writes player-0 InputFrames in sim.worker for the C09 autoplayer and S06/S07/S08 bots. */
export interface BotInput { frame(tick: number): InputFrame; readonly device: 'bot' }
```

In `InputContextId 'fighter'` the `SimButton` bits are re-read through the alias table Attack=LP, Ability=MP, FightHeavy=HP, Sprint=LK, Nitro=MK, Horn=HK, Special=SP, FightAssist=AS, Handbrake=HY, Block=BL, Emote=TA, Interact=DA (no new bits; S07 `07-fighter-core.md` FC5). In `InputContextId 'photo'` the shutter is `sim.Interact`; `client.PhotoShutter` stays the UI screenshot action (DL-159). `BotInput` is never bundled into production builds (`check:bundle`). The u8 `InputFrame.device` index of every 1.0 `DeviceKind` value is unchanged because `'bot'` is appended.

## C04 — `CameraRig`, animation and audio types

| Field | Value |
|---|---|
| Owner · version | S01 · `C04_VERSION = '1.1.0'` |
| Source paths | `packages/shared/src/contracts/c04-camera.ts`, `packages/shared/src/contracts/anim-states.ts`; presentation-only `packages/engine/src/client/anim/types.ts`, `packages/engine/src/client/audio/types.ts`; service `packages/engine/src/sim/physics/backend.ts` |
| Defined in | `01-engine-contracts.md` §C04 (rules 1–6), "Engine service interfaces", 1.1 section |
| Created in | M01b1 (`c04-camera.ts`, `anim-states.ts`); `PhysicsBackend` M01a2 |
| Consumers | S02, S03, S06, S07, S08, S09, S11; milestones M01b1, M01b2, M03a1, M05b2, M07a1, M08a2, M11b1, M11b2 family, M12b (SNAP `anim` byte) |

```ts
// packages/shared/src/contracts/c04-camera.ts
export const C04_VERSION = '1.1.0' as const;   // 1.1: XRRigParams.vantage, origin 'diorama', AnimStateId mode blocks (end of file)
export type CameraMode = 'fp' | 'tp' | 'cinematic' | 'xr';
export type VehicleView = 'chase-near' | 'chase-mid' | 'chase-far' | 'hood' | 'cockpit';
export type Vec3 = [number, number, number];

export interface CollisionParams {
  probeRadius: number;     // default 0.25 m sphere cast, run in sim (Publish stage)
  pullInSec: number;       // default 0 (instant)
  easeOutSec: number;      // default 0.3
  fadeOccludersM: number;  // fade the player mesh when camera < this from it (default 0.6)
}
export interface FollowParams {
  target: number;          // EntityHandle
  anchor: 'head' | 'chest' | 'seat' | 'root';
  shoulder: 'right' | 'left';
  offset: Vec3;            // right, up, back in target space; tp on foot default [0.6, 0.35, 2.8]
  fovDeg: number;          // default fp 75, tp 65 (user setting overrides)
  lag: { pos: number; rot: number }; // smoothing g in k = 1 − e^(−dt·g); default 9 / 12
  pitchLimitsDeg: [number, number];  // default [−70, 70]
  autoRecenterSec: number; // vehicles 1.5 s, on foot 0 (off)
  collision: CollisionParams;
}
export type ShotKind = 'chase' | 'flyby' | 'side' | 'front' | 'heli' | 'rearlow' | 'enemy' | 'shoulder' | 'wide' | 'fixed' | 'spline';
export interface CinematicShot {
  kind: ShotKind; subject: number;   // EntityHandle
  pos?: Vec3; lookAt?: Vec3;          // ENU metres (f64) for fixed/spline
  spline?: { pts: Vec3[]; durationTicks: number };
  fovDeg: number; damping: number; durationTicks: number; seed: number;
}
export interface XRRigParams {
  origin: 'feet' | 'seat' | 'arena' | 'desk';
  turn: { snapDeg: 30 | 45; smooth: boolean };
  vignette: number;                   // 0..1 strength while moving or yawing
  seated: boolean; heightCalibM: number;
  session: 'immersive-vr' | 'immersive-ar'; // v1: 'immersive-vr' only; 'immersive-ar' reserved for a post-M11b ADR (visionOS support UNVERIFIED)
}
/** Published by the sim each tick (snapshot side block). The main-thread rig obeys it. */
export interface CameraDirective {
  mode: CameraMode;
  follow?: FollowParams;
  vehicleView?: VehicleView;
  shot?: CinematicShot;               // when mode = 'cinematic'
  xr?: XRRigParams;                   // when mode = 'xr'
  allowedDistance?: number;           // collision result for follow (m)
  fade?: { to: 0 | 1; sec: number }; letterbox?: boolean;
  shake?: { amp: number; decayPerSec: number }; // ignored when reduced motion or XR
  lockPlayerToggle: boolean;          // true during cutscenes (R-PLAT-04)
  reason: 'player' | 'vehicle' | 'mission' | 'cutscene' | 'mode' | 'debug';
}
export interface CameraRig {
  readonly mode: CameraMode;
  readonly camera: unknown;           // three PerspectiveCamera (typed in packages/engine/client)
  /** User toggle; returns false if lockPlayerToggle or mode is cinematic/xr. */
  toggleFpTp(): boolean;
  /** 06 sketch compatibility: shorthand for apply({ mode: 'tp'|'fp', follow: { ...params, target } }). */
  follow(target: number, params: Partial<FollowParams>): void;
  setVehicleView(v: VehicleView): void;
  swapShoulder(): void;
  apply(d: CameraDirective): void;
  /** Per render frame after snapshot interpolation. */
  update(f: { alpha: number; dtSec: number; reducedMotion: boolean; drawDistanceM: number }): void;
  onModeChange(cb: (m: CameraMode) => void): () => void;
}
```

Engine service interfaces (not numbered contracts; `PhysicsBackend` consumes the C08 `StaticShapeSet` built by `toStaticShapeSet`, DL-078):

```ts
// packages/engine/src/sim/physics/backend.ts
export interface PhysicsBackend {
  readonly build: 'simd-compat' | 'deterministic-compat';
  init(): Promise<void>;                       // loads the one wasm build for this session
  readonly origin: [number, number, number];   // ENU f64 of the physics-local frame
  rebase(o: [number, number, number]): void;   // floating origin; called when player > 1,000 m away
  step(dt: number, substeps: 1 | 2): void;     // 2 when any player vehicle > 100 km/h
  addChunkStatics(chunkKey: string, shapes: StaticShapeSet): void; // heightfield + building prisms (C08)
  removeChunkStatics(chunkKey: string): void;
  createBody(d: BodyDesc): number; removeBody(id: number): void;
  readBody(id: number, out: Float64Array): void;              // pos(3) quat(4) linvel(3) angvel(3)
  setKinematicTarget(id: number, p: [number, number, number], q: [number, number, number, number]): void;
  applyImpulse(id: number, j: [number, number, number], at?: [number, number, number]): void;
  character: { move(id: number, desired: [number, number, number], o: CharMoveOpts): CharMoveResult };
  vehicle: { create(body: number, wheels: WheelDesc[]): number; drive(v: number, i: VehicleDrive): void; read(v: number, out: Float32Array): void };
  castRay(o: [number, number, number], d: [number, number, number], max: number, mask: number): RayHit | null;
  castSphere(o: [number, number, number], d: [number, number, number], r: number, max: number, mask: number): RayHit | null;
  snapshot(): Uint8Array; restore(b: Uint8Array): void; // Rapier takeSnapshot/restoreSnapshot
}
export interface CharMoveOpts { autostepM: number; snapToGroundM: number; maxSlopeDeg: number; slide: boolean }
export interface CharMoveResult { moved: [number, number, number]; grounded: boolean; groundNormalY: number }
export interface StaticShapeSet { heightfield?: { nx: number; nz: number; cell: number; heights: Float32Array; at: [number, number, number] }; prisms: Float32Array /* packed footprint rings + base/height */ }
export interface BodyDesc { kind: 'dynamic' | 'kinematic' | 'fixed'; shape: 'capsule' | 'box' | 'sphere' | 'convex'; dims: number[]; mass?: number; at: [number, number, number]; groups: number }
export interface WheelDesc { pos: [number, number, number]; radius: number; restM: number; axle: 'front' | 'rear' }
export interface VehicleDrive { engineForce: number; brake: number; steerRad: number; handbrake: boolean }
export interface RayHit { toi: number; normal: [number, number, number]; collider: number; entity: number /*handle*/ }

// packages/shared/src/contracts/anim-states.ts (C04, pure; S05 tools/assets and packages/shared/src/rig import these without the engine client; DL-066)
export type SkeletonId = 'bay_rig_v1';   // = C07 rigFamily and asset rig/bay_rig_v1; vendor aliases in packages/shared/src/rig/bay_rig_v1.json (S05)
export const HUMANOID_BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'l_shoulder', 'l_upperArm', 'l_lowerArm', 'l_hand', 'r_shoulder', 'r_upperArm', 'r_lowerArm', 'r_hand',
  'l_upperLeg', 'l_lowerLeg', 'l_foot', 'l_toes', 'r_upperLeg', 'r_lowerLeg', 'r_foot', 'r_toes'] as const;
// AnimStateId (below) lives in the same shared file.

// packages/engine/src/client/anim/types.ts (main thread; presentation only; imports SkeletonId from @dv/shared)
export interface ClipRef { asset: string /* C07 AssetRef `<kind>/<id>`, e.g. anim/<slug>.base */; clip: string; speed?: number }
export interface AnimStateDef {
  id: number; name: string; loop: boolean;
  clip?: ClipRef;
  blend1d?: { param: 0 | 1; points: [threshold: number, clip: ClipRef][] };
  blend2d?: { params: [0, 1]; points: [x: number, y: number, clip: ClipRef][] };
  fadeInSec: number;
}
export interface AnimGraphDef { id: string; skeleton: SkeletonId; states: AnimStateDef[]; ik: { feet: boolean; hands: 'off' | 'xr' } }
export interface AnimLodBands { fullHzWithinM: number; halfHzWithinM: number; quarterHzWithinM: number } // beyond: frozen pose
/** Network animation state (C11 SNAP `anim`, u8); declared in packages/shared/src/contracts/anim-states.ts with SkeletonId and HUMANOID_BONES, S01 owns. Each C01 Control.state
 *  maps to one id: 0 idle, 1 walk, 2 run, 3 sprint, 4 jump, 5 fall, 6 land, 7 vault, 8 enter vehicle, 9 drive, 10 passenger,
 *  11 exit vehicle, 12 ragdoll, 13 get up, 14 knocked out, 15 melee ready, 16 attack, 17 hitstun, 18 blockstun, 19 grappled,
 *  20 swim, 21 emote, 22 arrested; 23–127 reserved for S01; 128–255 mode-owned (blocks assigned by ADR). */
export type AnimStateId = number; // u8

// packages/engine/src/client/audio/types.ts
export type AudioBusId = 'master' | 'music' | 'sfx' | 'ambience' | 'voice' | 'radio' | 'ui' | 'cutscene';
export interface AudioCue { tick: number; cue: string; bus: AudioBusId; at?: [number, number, number]; entity?: number; gain?: number; pitch?: number }
export interface AudioService {
  unlock(): Promise<void>;                      // inside first pointerdown/keydown
  setVolume(bus: AudioBusId, linear: number): void;
  duck(target: AudioBusId, db: number, attackMs: number, releaseMs: number): void;
  play(c: AudioCue): void;
  setListener(p: [number, number, number], fwd: [number, number, number], up: [number, number, number]): void;
  updateEmitters(view: ArrayLike<number>): void; // from snapshot AudioEmitter records
  suspend(): void; resume(): void;               // visibilitychange
}
```

C04 1.1 delta (DL-091, DL-096):

```ts
// c04-camera.ts — 1.1
export interface XRRigParams {                                     // 1.0 fields unchanged, plus:
  origin: 'feet' | 'seat' | 'arena' | 'desk' | 'diorama';         // diorama = tabletop third-person chase view (XrComfortSettings.chaseView, S06)
  vantage?: { pos: Vec3; yaw: number };                           // fixed XR viewpoint for in-engine cutscene fallbacks (S03), no cuts (rule 5)
}
```

**`AnimStateId` blocks (u8; DL-091; the Wave 5 ADR records them):**

| Range | Owner | Use |
|---|---|---|
| 0–22 | S01 | engine states listed in the `AnimStateId` comment above |
| 23–127 | S01 | reserved |
| 128–159 | S06 racing | vehicle 128–137, reserved 138–143, driver 144–148, reserved 149–159 (`06-racing-data.md` §4.5) |
| 160–207 | S07 fighter | state families; moves play through S07's frame-locked clip player (`07-fighter-content.md` FX7) |
| 208–255 | S08 tycoon | S08 claims 224–231, unused in v1 (`08-tycoon.md` §3.1) |

`SkeletonId 'bay_rig_v1'` equals the C07 `rigFamily` and the only rig asset `rig/bay_rig_v1`. XR camera rules (C04 rule 5): `immersive-vr` only in v1; `'immersive-ar'` is reserved for a post-M11b ADR and visionOS support for it is UNVERIFIED (`spec/99-open-questions.md` §2.1).
