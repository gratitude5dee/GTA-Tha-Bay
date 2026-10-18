# 01 — Engine contracts, part 1: C01 ECS · C02 GameLoop · C03 Input · C04 CameraRig · engine service interfaces

> S01, Wave 1, 2026-10-18. Part of `spec/domains/01-engine.md` (§3 Components, §4 Data). Shared context `06` v1.1 (frozen). Contracts here: **C01 1.0.0; C02, C03, C04 1.1.0** (1.1 section at the end of this file). Types live in `packages/shared/src/contracts/` so consumers (`net`, `ui`, `modes/*`, `mod-sdk`) import them without importing the engine. Part 2 (C05 SaveGame, C06 GameMode, PursuitDirector, clock, interaction, prefabs) is `spec/domains/01-engine-save-modes.md`.

Conventions in every block: `u8/i16/…` comments give the wire or SAB width; "sim" means code that runs inside `sim.worker` or the headless host; all sim numbers that cross a determinism boundary are integers or exactly representable doubles produced by `detmath`.

## C01 — `EntityId` + ECS conventions (owner S01; consumers: all)

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

**Engine component registry v1** (`packages/engine/src/sim/ecs/components.ts`; ids 1–255; S01 owns):

| id | Name | Fields (kind) | hashed | snapshot |
|---|---|---|---|---|
| 1 | Transform | px,py,pz f64 (ENU m, SF origin); qx,qy,qz,qw f32 | yes | render+net |
| 2 | Velocity | vx,vy,vz f32 (m/s); wx,wy,wz f32 (rad/s) | yes | net |
| 3 | Gen | gen u16 (written by allocator only) | no | none |
| 4 | Key | key u32 (StringTable id of StableKey) | yes | none |
| 5 | BodyRef | body u32, collider u32 (physics handles) | no | none |
| 6 | CharacterBody | radius f32, height f32, grounded u8, groundNormalY f32, airTicks u16 | yes | none |
| 7 | Control | owner u8 (ControlOwner), state u16 (family-coded), sinceTick u32, pending u8, target u32 (handle) | yes | net |
| 8 | PlayerControlled | player u8 (0 local, 1..n net slot) | yes | net |
| 9 | Vehicle | handling u32 (str), throttle i8, steer i8, brake i8, handbrake u8, gear i8, rpm f32, speed f32, seats u8 (bitmask) | yes | render+net |
| 10 | VehicleDamage | body f32, engine f32, tires [f32,4] (0..1 health) | yes | render |
| 11 | Seat | vehicle u32 (handle), seat i8 | yes | net |
| 12 | Health | hp f32, max f32, ko u8, koUntilTick u32 | yes | render |
| 13 | Anim | graph u32 (str), state u16, p0 f32, p1 f32, sinceTick u32 | no | render |
| 14 | RenderKey | asset u32 (StringTable id of the full C07 `AssetRef` `<kind>/<id>`), variant u8, visible u8, lodBias i8 | no | render |
| 15 | Interactable | kind u16, radius f32, coneDeg f32, priority i8, prompt u32 (LocKey str), flags u16, cooldown u16 | yes | none |
| 16 | Combat | moveSet u32 (str), move u16, frame u16, hitstun u16, blockstun u16 | yes | render |
| 17 | PoliceUnit | role u8, tactic u8, assignedTick u32, target u32 | yes | render |
| 18 | Witness | kind u8 (police/robotaxi/ped), infraction u16, reportAtTick u32 | yes | none |
| 19 | Pickup | item u32 (str), qty u16, respawnTicks u32 | yes | render |
| 20 | Ambient | cell u32 (str), slot u16, spawnTick u32 | yes | none |
| 21 | Portal | portal u32 (str), sealed u8 | yes | render |
| 22 | AudioEmitter | set u32 (str), p0 f32, p1 f32, flags u8 | no | render |
| 23 | CameraAnchor | headY f32, chestY f32, seatX f32, seatY f32, seatZ f32 | no | none |
| 24 | Ragdoll | untilTick u32, impulse [f32,3] | yes | render |
| 30–39 | Tags | LocalPlayer, Police, Robotaxi, MissionOwned, Persistent, Ped, Prop, NoCollide, Hidden, Busted | yes | — |

**Rules (numbered, testable):**
1. Only `sim.worker` (or the headless host) mutates the world. The main thread maps component stores read-only (bitECS stores are SAB-backed typed arrays; structural changes stay on the owning thread [research/stack-rendering-platform.md §5.2]).
2. Structural changes (spawn, despawn, add, remove) go through `CommandBuffer` and apply at the end of the issuing `SimStage`, in issue order. Field writes are immediate.
3. Components hold scalars only. Strings go through `StringTable`; references to other entities are `EntityHandle` in a `u32` field; nothing stores objects, closures or `Map`s.
4. Systems iterate `query()` results in returned order. Code never iterates a `Map`/`Set`/object whose key order depends on non-sim input; `for…in` is banned in sim code; every `Array.prototype.sort` call passes a comparator that is total (ties broken by `EntityHandle`).
5. Ambient agents (traffic, peds) carry `Ambient{cell, slot}` and a `StableKey` `amb:<cell>:<slot>`. Their spawn and route are a pure function of `(worldSeed, cell, slot, spawnTick)` (§C02 RNG). Tiers enable slots `0 … densityCap(tier, cell) − 1`, so a mobile client's agents are a prefix of a desktop client's (accepted; fixed in the 06 v1.0 C08 sketch: spawn tables keyed by `(cellKey, slot)` with a per-tier `densityCap`, DL-049).
6. A component id, once published, is never renumbered or reused; schema changes add a new component.
7. Every `ComponentDef` with `hashed: true` must be serializable to bytes by its typed arrays alone (no side tables), so `stateHash` and `snapshot()` can run without component-specific code.

## C02 — `GameLoop` phases (owner S01; consumers: all)

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

**Snapshot record layout (64 B, little-endian):** `0 u32 handle · 4 u32 renderKey · 8 f64 px · 16 f64 py · 24 f64 pz · 32 f32 qx · 36 f32 qy · 40 f32 qz · 44 f32 qw · 48 u16 animState · 50 u16 flags · 52 f32 animP0 · 56 f32 animP1 · 60 u8 variant · 61 u8 lod · 62 u16 reserved`. A side block per snapshot carries `CameraDirective` (C04), `EnvState` (part 2), heat HUD state, interaction prompt and audio cue ring offsets.

**Rules:**
1. The sim owns its period. The worker accumulates `FrameSignal.dtSec × timeScale`, clamps the accumulator to `MAX_FRAME_DT`, runs `while (acc ≥ SIM_DT)` ticks, then publishes `alpha = acc / SIM_DT`. Time beyond the clamp is dropped and counted in `droppedSec` (slow-motion instead of a spiral) [research/repos-modding.md §3.4].
2. The main thread never waits for a tick. It renders the newest complete snapshot pair interpolated by `alpha`, one tick behind; it skips interpolation for an entity when the tick gap > 3 or the move > 2 m, and interpolates angles the short way [research/repos-modding.md §3.4, §7.1].
3. Hidden page ⇒ no rAF ⇒ no `FrameSignal` ⇒ no ticks. The sim also pauses on `paused: true` (menus, phone in story, focus loss).
4. `timeScale ≠ 1` is allowed only in sandbox sessions and debug builds; it scales accumulated time, never `SIM_DT`.
5. `FramePhase.Sim` on the main thread is only the hand-off (`frame(sig)`); ticks run in the worker concurrently with `Anim/Audio/Render` of the same frame.
6. `NetIn` and `NetOut` run in `sim.worker`, which owns the socket (D-S01-05; main-thread `MessagePort` relay only if iOS workers lack WebSocket). `NetIn` drains received network frames into the command ring before the Commands stage; `NetOut` runs after the tick where `tick % NET_DIVISOR === 0` (wire format is C11, S09): one `IN` sample per 50 ms; desktop and XR send each sample, mobile batches two per frame at 10 Hz (C11 `MOBILE_SEND_HZ`).
7. `stateHash(tick)` = FNV-1a-64 (two u32 lanes, `Math.imul` only) over, in order: tick (u32), every `hashed` component store in ascending `ComponentId` for the entities of `query([Key])` in ascending `StableKey` order, then all hashed resources (RNG states, clock, weather, pursuit, economy) in fixed order. Published when `tick % hashEvery === 0`.
8. `FrameSignal` is posted on every main-thread rAF and every XR frame callback, including frames S11's `FramePacer` does not draw (30 fps tiers), so the sim clock never depends on the render rate; in XR the main thread writes `XrPoseBlock` before posting it.
9. `SimControlMessage`s are handled by the worker as soon as they arrive, outside ticks, so they work while the page is hidden and no `FrameSignal` flows (rule 3). `save.request` calls `SaveService` (C05) with the given reason; it writes only when C05 rule 4 eligibility holds, and the result is reported through `SaveService.onStatus` (DL-070).

### Determinism rules (part of C02; D-13, A-04)
1. Sim code (`packages/shared/**`, `packages/engine/src/sim/**`, `packages/modes/*/src/sim/**`; one exception: `packages/engine/src/sim/save/**` is async IO that runs in `sim.worker` outside ticks, may use `Date.now` and `crypto.getRandomValues`, and is reached from systems only through `ModeContext.save.request`) must not use: `Math.random`, `Math.sin/cos/tan/asin/acos/atan/atan2/sinh/cosh/tanh/exp/expm1/log/log1p/log2/log10/pow/cbrt/hypot/sqrt`, the `**` operator, `Date`, `performance.now`, `crypto.getRandomValues`, `setTimeout/setInterval`, `for…in`, `Intl`, `toLocaleString`, and imports from `three` or any DOM type. Enforced by ESLint `no-restricted-properties`, `no-restricted-globals`, `no-restricted-syntax`, `no-restricted-imports` with a fixture that must fail (JS transcendentals are implementation-dependent across engines [research/gamedesign-decomposition.md §0]).
2. Allowed exact operations: `+ − × ÷`, `Math.abs/min/max/floor/ceil/round/trunc/sign/fround/imul/clz32`, integer bit ops. `detmath` provides `sqrt, sin, cos, atan2, exp, log, pow, hypot, lerpAngle, normalizeAngle` as polynomial/iterative implementations over those operations, with golden vectors checked in Node, Chromium and WebKit (M01a). Whether `Math.sqrt` is bit-identical across engines is UNVERIFIED, so `detmath.sqrt` must not delegate to it until the vectors pass.
3. RNG: `xoshiro128**` (32-bit state ×4, `Math.imul`), seeded by `splitmix32(worldSeed ^ fnv32(streamName))`. Named streams: `world`, `weather`, `pursuit`, `police`, `spawn`, `ai`, `loot`, `mode:<id>`, `mission:<id>`, and per-agent streams `amb:<cell>:<slot>`. Stream states are hashed resources and are saved in checkpoints. No module keeps a private generator.
4. Inputs reach the sim only as quantized `InputFrame`s (C03). Analog values are integers before the sim sees them.
5. Physics: the `canonical` profile uses `@dimforge/rapier3d-deterministic-compat@0.21.0` (cross-platform deterministic) and the `local` profile `@dimforge/rapier3d-simd-compat@0.21.0` (locally deterministic) [research/stack-rendering-platform.md §5.1, F-014]. Exactly one build is loaded per sim session; switching requires `SimHost.restart`.
6. Ambient density in `canonical` is the `mobile-low` cap regardless of device; the cross-browser hash test, mission autoplay CI, race ghosts and server checks run `canonical`.
7. Presentation (animation, camera smoothing, audio, VFX, sun direction) never feeds back into sim state.

## C03 — `InputAction` map (owner S01; consumers: S06, S07, S10, S11, S12)

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
  fighterScheme: 'classic' | 'simple';
}

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

**Rules:**
1. Look is applied to the camera on the main thread every frame (no tick latency); the sim receives the resulting `camYaw/camPitch` in the next `InputFrame`.
2. A press shorter than one tick is never lost: binders latch rising edges; `sample()` sets `pressed` if a latch exists and clears it.
3. Gesture resolution (hold, double-tap, chord, hold-to-toggle) happens in `InputRouter` before quantization; the sim sees only bits.
4. The kbm binder suspends while a DOM text field has focus; all bindings release on `blur` and on `visibilitychange` [research/repos-webport.md §2.7].
5. Desktop look uses Pointer Lock with `unadjustedMovement: true`; iPhone has no Pointer Lock, so touch uses `touch:dragR` [research/stack-rendering-platform.md §2, F-011].
6. Gamepads use the W3C standard mapping; XR controllers the `xr-standard` mapping; Quest A/B/X/Y indices are UNVERIFIED, so defaults never put a required action only on a face button [research/gamedesign-decomposition.md §6].
7. XR input is routed by `event.inputSource`, never by array index; Vision Pro transient inputs are empty until a pinch [research/stack-rendering-platform.md §4.3]. The `xr-controller`, `xr-hand` and `xr-transient` binders are thin readers over S11's `XrInputRouter` per-frame cache and never sample `XRFrame` themselves; face-button indices come from `config/xr-input-profiles.json` (S11 Part B §5.4).
8. The last device that produced input becomes `active` (UI glyphs). Any touch, key or pad input disables the pose binder until re-enabled [research/auth-ugc-input-maps.md §4.7], unless `InputRouter.setPoseHybrid(true)` is in effect (C03 1.1): then pose drives strikes and guard while stick or keys drive movement.
9. Every `SimButton` and `ClientAction` is remappable on every device except `client.Pause`, which always keeps its default binding in addition to any override (R-ENG-04).
10. Defaults per device and context are the gamedesign §6 matrix, stored as JSON in `config/input/`; touch defaults use stick radius 58 px, knob 26 px, sprint beyond 1.35× radius, look gain 3.0, tilt-steer dead zone 10°/full 45°, min hold 120 ms [research/repos-webport.md §3.6].

## C04 — `CameraRig` (owner S01; consumers: S02, S03, S06, S07, S11)

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

**Rules:**
1. fp/tp toggle works on foot and in vehicles at any time except while `lockPlayerToggle` (R-PLAT-04). fp on foot = eye at head anchor (1.7 m standing); fp in vehicle = `cockpit` or `hood`.
2. Collision is a sphere cast from the anchor to the desired camera position in `sim.worker` against static colliders and vehicles, every tick for the active follow camera; the rig pulls in immediately and eases out over `easeOutSec`. A 100-pose sweep test asserts the camera is never inside geometry (M01b).
3. Near plane: fp 0.05 m, tp/cinematic 0.1 m; far = tier building draw distance (C13). Depth: S11's `RendererHost` requests `reversedDepthBuffer` on every tier and publishes `depthPolicy`; when it reports `'standard'` the rig raises near to `max(near, far / 20000)` (`11-platform.md` §5.1 step 4) [research/stack-rendering-platform.md §1.2].
4. Cinematic shots come from S03's director (gta-sa-earth-style vocabulary, LOS validation, cut after 0.8 s occlusion) running as a sim system so scrubbing is deterministic [research/repos-world.md §3.4]; the rig only applies them.
5. XR: camera = viewer pose; `origin` anchors the reference space to the player's feet, vehicle seat (rest frame), fighter arena or tycoon desk. No shake, no director cuts, no camera-collision push (head in geometry fades to black, S11 Part B §5.3); the rig exposes only the dolly; cutscenes play on a panel or from a fixed vantage; snap turn 30° default; vignette while moving [research/stack-rendering-platform.md §4.4; research/gamedesign-decomposition.md §2.13].
6. Reduced motion: shake off, director cuts ≥ 2 s apart, fades replace whip pans.

## Engine service interfaces (not numbered contracts; consumed by S02, S03, S06, S07, S11)

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

## C02 1.1, C03 1.1 and C04 1.1 additions (Architect, second reconciliation, 2026-10-18)

Additive minor bumps accepted from Wave 2–4 return blocks (`spec/11-decision-log.md` DL-091, DL-094…DL-096). Nothing in 1.0 changes meaning.

**C02 1.1, determinism rule 3 (clarification, S08).** A stateless counter-based hash `ctrU32(seed: number, stream: string, counter: number): number` = `splitmix32((seed ^ fnv32(stream)) + Math.imul(counter, 0x9E3779B1))` (S08's definition, `08-tycoon-events.md` §3; golden vectors in the M01a cross-browser job) is allowed in sim code. It keeps no state, so it is not a private generator and needs nothing in checkpoints or hashes; tycoon event rolls, hiring draws and board votes use it so that adding content does not shift other draws.

```ts
// c03-input.ts — 1.1 (appended union members keep the u8 DeviceKind index of 1.0 values stable)
export type DeviceKind = 'kbm' | 'gamepad' | 'touch' | 'xr-controller' | 'xr-hand' | 'xr-transient' | 'pose' | 'bot';
export type ControlId = /* 1.0 members */ | 'xr:both:wheel';    // analog −1..1 from S11 HandFeatures two-hand wheel (S06)
export interface InputRouter { /* 1.0 members */ setPoseHybrid(on: boolean): void }   // S07 hybrid pose (rule 8)
export interface ControlsSettings { /* 1.0 fields */ fighterScheme?: 'classic' | 'simple' }   // selects config/input/<device>.fighter-<scheme>.json (S07)
/** QA-only (VITE_DV_QA builds and headless CI): writes player-0 InputFrames in sim.worker for the C09 autoplayer and S06/S07/S08 bots. */
export interface BotInput { frame(tick: number): InputFrame; readonly device: 'bot' }
```
In `InputContextId 'fighter'` the `SimButton` bits are re-read through a normative alias table (Attack=LP, Ability=MP, FightHeavy=HP, Sprint=LK, Nitro=MK, Horn=HK, Special=SP, FightAssist=AS, Handbrake=HY, Block=BL, Emote=TA, Interact=DA); no new bits, labels per context (S07 `07-fighter-core.md` FC5). `BotInput` is never bundled into production builds (`check:bundle`).

```ts
// c04-camera.ts — 1.1
export interface XRRigParams {                                     // 1.0 fields unchanged, plus:
  origin: 'feet' | 'seat' | 'arena' | 'desk' | 'diorama';         // diorama = tabletop third-person chase view (XrComfortSettings.chaseView, S06)
  vantage?: { pos: Vec3; yaw: number };                           // fixed XR viewpoint for in-engine cutscene fallbacks (S03), no cuts (rule 5)
}
```
**`AnimStateId` mode blocks (ADR in Wave 5 cites DL-091):** 128–159 racing (S06: vehicle states 128–136, driver states 144–148), 160–207 fighter (S07; move states are played by S07's frame-locked clip player, the SNAP id only selects the state family), 208–255 tycoon (S08 claims 224–231, unused in v1). 0–22 engine and 23–127 S01 reserve are unchanged.
