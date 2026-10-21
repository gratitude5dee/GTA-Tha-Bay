// packages/shared/src/contracts/c06-modes.ts (C06 1.1.0). Copied from spec/domains/01-engine-save-modes.md "C06" and "C05 1.1 and C06 1.1
// additions". Three differences from the spec text, all type-level and recorded as BD-M04a2-01:
//  - the spec names `PhysicsQueries` and `SimEventBus` without defining them (the same gap M04a1 reported); the minimal shapes below
//    are what the engine implements;
//  - `PrefabService` and `InteractionApi` live in packages/engine, which @dv/shared cannot import; the structural shapes below are the
//    parts a mode may call, and the engine classes satisfy them;
//  - `GameModeUI.mount` takes an `HTMLElement` in the spec; this file is DOM-free (C02 lint), so the host root is `unknown` here.
import type { Rng } from '../rng.ts';
import type { SIM_DT, Tick } from './c02-loop.ts';
import type { EcsApi, EntityHandle, ComponentDef, StableKey } from './c01-ecs.ts';
import type { InputContextId, InputFrame } from './c03-input.ts';
import type { CameraDirective, CameraMode } from './c04-camera.ts';
import type { JsonObject, SaveReason, SlotId, JsonValue } from './c05-save.ts';
import type { GameModeId, UnlockEventId } from './c06-ids.ts';
import type { PursuitApi } from './engine-pursuit.ts';
import type { WorldClockApi } from './engine-world.ts';
import type { WorldApi } from '../world/c08-api.ts';
import type { AssetRef } from '../assets/c07.ts';
import type { TelemetryName } from '../telemetry.ts';
import type { UiBridge, UiCommand, ViewModelSource } from './ui-bridge.ts';

export type { GameModeId, UnlockEventId } from './c06-ids.ts';
export const C06_VERSION = '1.1.0' as const;   // 1.1: additive members in "C05 1.1 and C06 1.1 additions"

export interface ModeRequirements {
  simProfile: 'local' | 'canonical' | 'any';
  world: 'city' | 'stage' | 'none';                 // city = streamed SF (C08); stage = a mode-loaded diorama of C07 prop assets via ModeContext.assets (C06 1.1)
  physics: boolean;
  xr: 'full' | 'seated' | 'panel' | 'none';
  inputContexts: InputContextId[];
  network: 'none' | 'optional' | 'required';
}
export interface GameModeDescriptor {
  id: GameModeId; version: number;
  titleKey: string; tile: { art: string /* C07 AssetRef, first-party modes use `ui/mode-<GameModeId>` */; order: number /* unique: story 1, racing 2, fighter 3, tycoon 4; mods >= 100 (DL-167) */ };
  status: 'available' | 'comingSoon';               // A-06 stubs register as comingSoon
  unlock: UnlockEventId | null;                     // null = always available (story, sandbox)
  standalone: boolean;                              // has a main-menu tile
  embeddable: boolean;                              // can run inside story via a C09 mode hook
  requires: ModeRequirements;
  saveSlot: SlotId | null; sliceSchema: number;
  sim: () => Promise<{ default: GameModeSim }>;     // dynamic import inside sim.worker
  ui: () => Promise<{ default: GameModeUI }>;       // dynamic import on main
  /** 1.1: top-level (menu) entry profile when requires.simProfile is 'any' (S06 CCP-1). */
  standaloneProfile?: 'local' | 'canonical';
  /** 1.1: C14 kinds this mode accepts; absent = none (S12). */
  modSurface?: { kinds: ('experience' | 'vehicle' | 'character' | 'rules')[] };
}

export type ModeOrigin = { kind: 'menu' } | { kind: 'story'; missionId: string; hookId: string } | { kind: 'experience'; expId: string };
export interface ModeEnterArgs<A = JsonValue> { defId?: string; params?: A; origin: ModeOrigin; seed: number }
export type ModeExitReason = 'completed' | 'quit' | 'failed' | 'parentExit' | 'error' | 'kill';
export interface ModeResult<R = JsonValue> { outcome: 'win' | 'lose' | 'finish' | 'quit' | 'abort'; data?: R; rewards?: { cashCents?: number; items?: { id: string; qty: number }[] } }

export interface GameModeSim<S extends JsonObject = JsonObject> {
  enter(ctx: ModeContext, args: ModeEnterArgs, slice: S | null): void;
  /** Called every tick in SimStage.Script while the mode is on top of the stack. */
  tick(ctx: ModeContext): void;
  /** Called every tick while a child mode runs (optional; default: nothing). */
  suspendedTick?(ctx: ModeContext): void;
  exit(ctx: ModeContext, reason: ModeExitReason): ModeResult;
  saveSlice(ctx: ModeContext): S | null;
  migrateSlice?(old: JsonObject, fromSchema: number): S;
  onEvent?(ctx: ModeContext, e: SimEvent): void;
}
export interface GameModeUI {
  mount(host: { root: unknown /* HTMLElement on the page */; vm: ViewModelSource; send(cmd: UiCommand): void }): void;
  unmount(): void;
  inputContexts: InputContextId[];
  cameraDefault?: CameraMode;
  /** 1.1 (S10): mode tile and saves page. */
  summary?(slice: JsonObject | null): { lines: { label: string /* LocKey */; value: string }[] };
  settingsPanel?(): unknown /* S10 ScreenDef */; assists?: { id: string; label: string /* LocKey */ }[];
}

/** The spec names this type and does not define it (M04a1 reported the gap). Reads of the static world and the physics scene. */
export interface PhysicsQueries {
  /** Static ground height at (x, z), or null where no collider is loaded. */
  groundY(x: number, z: number): number | null;
  /** Nearest hit of a ray against the scene: distance along `dir` (unit), the hit normal and the entity handle (0 for statics). */
  castRay(o: [number, number, number], dir: [number, number, number], maxM: number): { toi: number; normal: [number, number, number]; entity: number } | null;
}
export type SimEvent = { t: string; tick: Tick; a?: EntityHandle; b?: EntityHandle; n?: number; s?: string }; // typed unions per owner in part files of each domain
/** The spec names this type and does not define it. `emit` queues for the page and calls the subscribers of `t` at once; `on('*')` hears all. */
export interface SimEventBus { emit(e: SimEvent): void; on(t: string, cb: (e: SimEvent) => void): () => void }

export interface PrefabService {
  spawn(id: string, at: { pos: [number, number, number]; yaw: number }, key?: StableKey, init?: Record<string, number>): EntityHandle;
  despawn(h: EntityHandle): void;
}
export interface InteractionPrompt { target: EntityHandle; kind: number; promptKey: string; hold: boolean; progress: number /*0..1*/; reason?: string }
export interface InteractionApi {
  register(h: never /* InteractionHandler, engine-side shape */): void;
  current(player?: number): InteractionPrompt | null;
  setEnabled(kind: number, on: boolean): void;
}

export type ZoneShape = { k: 'circle'; at: [number, number, number]; r: number } | { k: 'poly'; ring: [number, number][]; yMin: number; yMax: number } | { k: 'edges'; edgeIds: number[]; widthM: number };
export interface ZoneService {                        // lat/lng and landmark ids are resolved to ENU by S03 at load
  define(id: string, s: ZoneShape): void; undefine(id: string): void;
  inside(id: string, h: EntityHandle): boolean; query(id: string, filter?: ComponentDef[]): EntityHandle[]; // ascending handle
  onEnter(id: string, filter: ComponentDef[], cb: (h: EntityHandle) => void): () => void; onExit(id: string, filter: ComponentDef[], cb: (h: EntityHandle) => void): () => void;
}
export interface SimScheduler {                        // cooperative threads; S03 maps IR ops onto these
  spawn(threadId: string, step: (t: ThreadCtx) => ThreadYield): void; kill(threadId: string): void;
  readonly opsBudgetPerTick: 2000;                    // per thread
}
export interface ThreadCtx { tick: Tick; ops: number; rng: Rng }
export type ThreadYield = { k: 'continue' } | { k: 'waitTicks'; n: number } | { k: 'waitUntil'; pred: () => boolean; timeoutTicks?: number } | { k: 'waitEvent'; t: string } | { k: 'done' };
export interface TimelineRecorder {
  emit(e: { t: string; tick: Tick; data: JsonObject }): void; snapshotEvery: 2 /* ticks = 33 ms */; export(): ArrayBuffer;
  /** 1.1: recorded async inputs, replayed without re-querying (S04). */
  external(e: { src: 'talk' | 'intent' | 'cutscene' | 'mode'; tick: Tick; data: JsonObject }): void;
}

export interface EconomyApi { balance(): number /* cents */; credit(cents: number, reason: string, idemKey: string): boolean; debit(cents: number, reason: string, idemKey: string): boolean /* false if insufficient */; ledgerSince(tick: Tick): { tick: Tick; cents: number; reason: string }[] }
export interface CombatApi { // open-world melee; frame data and move sets are S07's (C-fighter schema)
  setMoveSet(h: EntityHandle, moveSetId: string): void; startMove(h: EntityHandle, moveId: string): boolean;
  onHit(cb: (e: { attacker: EntityHandle; victim: EntityHandle; move: string; damage: number; ko: boolean }) => void): () => void;
}

export interface ModeContext {
  readonly tick: Tick; readonly dt: typeof SIM_DT; readonly origin: ModeOrigin;
  readonly ecs: EcsApi;                              // C01
  readonly prefabs: PrefabService; readonly physics: PhysicsQueries;
  rng(stream: string): Rng;                          // auto-prefixed 'mode:<id>:'
  readonly clock: WorldClockApi; readonly pursuit: PursuitApi; readonly interaction: InteractionApi;
  readonly zones: ZoneService; readonly scheduler: SimScheduler; readonly timeline: TimelineRecorder;
  readonly camera: { direct(d: CameraDirective): void; release(): void };
  readonly input: { frame(player?: number): InputFrame; push(c: InputContextId): void; pop(c: InputContextId): void };
  readonly unlocks: UnlockApi; readonly economy: EconomyApi; readonly combat: CombatApi;
  readonly events: SimEventBus; readonly ui: UiBridge;
  readonly assets: { request(refs: AssetRef[] /* C07 */, prio: 'now' | 'soon'): void; ready(refs: AssetRef[]): boolean };
  readonly save: { request(reason: SaveReason): void };
  readonly telemetry: { emit(name: TelemetryName, props: Record<string, string | number | boolean>): void }; // C16 closed registry
  readonly net: null | { slot: number; peers(): number[] };  // C11; null in single player
  /** 1.1: C08 graph, traffic, map, teleport, query, places, resolver (S02 P1). */
  readonly world: WorldApi;
  /** 1.1: filtered S04 runtime for missions and mods (sim side). */
  readonly npc: {
    whereIs(npcId: string): { pos: [number, number, number]; activity: string } | null;
    isKilled(npcId: string, scope: 'all' | 'spawn' | 'fighter' | 'cutscene' | 'voice' | 'marketing' | 'ugc'): boolean;
    playKnot(npcId: string, knot: string /* C10 InkKnot */, playId: string): void;   // lines arrive as hud.subtitle patches; completion as SimEvent 'npc.knot.done'
  };
  /** Start a child mode (embedding). Resolves via onEvent({t:'mode.childExit'}). */
  startChild(id: GameModeId, args: Omit<ModeEnterArgs, 'origin'>): boolean;
}

export interface UnlockDef {
  id: UnlockEventId; titleKey: string; hidden?: boolean; source: 'base' | `mod:${string}`;
  grants: { menuTile?: GameModeId; fighters?: string[]; vehicles?: string[]; districts?: string[] };
}
export interface UnlockApi {
  emit(id: UnlockEventId, src: { kind: 'mission' | 'mode' | 'achievement' | 'debug'; ref: string }): boolean; // true if new
  has(id: UnlockEventId): boolean;
  list(): UnlockEventId[];
}
export interface UnlockRegistry extends UnlockApi { register(defs: UnlockDef[]): void; defs(): UnlockDef[]; onUnlocked(cb: (d: UnlockDef) => void): () => void }
