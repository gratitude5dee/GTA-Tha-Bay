# 01 — Engine contracts, part 2: C05 SaveGame · C06 GameMode + unlocks · PursuitDirector · clock · interaction · prefabs · mission hooks

> S01, Wave 1, 2026-10-18. Part of `spec/domains/01-engine.md`. Contracts **C05 1.1.0, C06 1.1.0** (06 v1.1; 1.1 section at the end of this file). Types live in `packages/shared/src/contracts/`; services in `packages/engine/src/sim/`. Part 1 (C01–C04) is `spec/domains/01-engine-contracts.md`.

## C05 — `SaveGame` (owner S01; consumers: S09 cloud sync, S10 menus, S03/S06/S07/S08 slices)

Profile rules translate Grand-V's save-profile logic: 32-hex ids, named profiles, separate Story and Sandbox namespaces, atomic writes, tombstones with ms timestamps, mtime round-trip, and last-save status on the home screen [research/repos-grand-v.md §(d), rec 11]. Local store is IndexedDB, never OPFS (OPFS handles are single-tab) [research/repos-webport.md P14].

```ts
// packages/shared/src/contracts/c05-save.ts
export const C05_VERSION = '1.1.0' as const;   // 1.1: additive fields in "C05 1.1 and C06 1.1 additions" at the end of this file
export type ProfileId = string & { readonly __brand: 'ProfileId' };   // /^[0-9a-f]{32}$/
export type SliceKind = 'core' | 'settings' | 'story' | 'sandbox' | 'racing' | 'fighter' | 'tycoon' | 'mod';
export type SlotId =
  | 'core' | 'settings' | 'sandbox'
  | 'story:auto' | 'story:1' | 'story:2' | 'story:3'
  | 'mode:racing' | 'mode:fighter' | 'mode:tycoon'
  | `mod:${string}`;                                                    // C14 mod id, sandbox-only data

export const SAVE_LIMITS = {
  maxProfiles: 64, nameMin: 1, nameMax: 80,          // Grand-V profile limits
  recordMaxBytes: 2 * 1024 * 1024,                    // per slot record (canonical JSON UTF-8)
  profileMaxBytes: 16 * 1024 * 1024,                  // all live records of a profile
  storyTargetBytes: 256 * 1024,                       // budget; warn in CI above this
  keepGenerations: 2,                                 // current + previous per slot
  sandboxSavedPositions: 32, sandboxVehicleCap: 8,
  tombstoneRetentionDays: 180,
} as const;

export interface LastSaveStatus { slot: SlotId; at: number /* ms epoch */; ok: boolean; error?: SaveErrorCode; reason: SaveReason }
export interface ProfileMeta {
  id: ProfileId; name: string;                        // NFC, trimmed, unique case-insensitively
  createdAt: number; updatedAt: number;               // ms epoch (wall clock; never sim)
  playtimeSec: number; lastSave: LastSaveStatus | null;
  deviceId: string;                                   // 32-hex, per install
  importedFrom?: { at: number; undoGen: Record<SlotId, number> };
}

/** One IndexedDB row per (profileId, slot, gen). */
export interface SaveRecord<T = unknown> {
  format: 'dv-save';
  kind: SliceKind; slot: SlotId; profileId: ProfileId;
  schema: number;                                     // slice schema version (per kind)
  gen: number;                                        // monotonic per slot
  savedAt: number; playtimeSec: number;               // ms epoch, seconds
  deviceId: string; buildId: string; worldBake: string;
  bytes: number;                                      // canonical JSON byte length of data
  checksum: string;                                   // fnv1a64 hex of canonical JSON of data
  data: T;
}
export interface SlotPointer { profileId: ProfileId; slot: SlotId; gen: number; savedAt: number }
export interface Tombstone { profileId: ProfileId; slot: SlotId | '*'; gen: number; deletedAt: number }

/** Assembled read model used by the menus and by ModeHost; never stored as one blob. */
export interface SaveGame {
  version: 1;
  profile: ProfileMeta;
  core: CoreSlice;
  settings: ProfileSettings;
  story: Partial<Record<'auto' | '1' | '2' | '3', StorySlice>>;
  sandbox: SandboxSlice | null;
  modes: { racing: JsonObject | null; fighter: JsonObject | null; tycoon: JsonObject | null };
  mods: Record<string, JsonObject>;
}

export interface CoreSlice {                          // schema 1
  avatar: JsonObject;                                 // S10 PlayerAvatar, validated by S10's schema; S10 also defines AppearanceV1 (binary, ≤ 512 B) for C11 EV Joined/Appearance
  unlocks: UnlockEventId[];                           // sorted, unique
  firstEncounters: Partial<Record<GameModeId, number>>; // ms epoch of first encounter
  garage: JsonObject[];                               // S06 VehicleInstance[]; shared by story + racing
  inventory: { items: { id: string; qty: number }[]; wardrobe: string[] };
  stats: { distanceKm: number; pursuitsEscaped: number; busted: number; fightsWon: number; racesWon: number; playtimeSec: number };
}

export interface StorySlice {                         // schema 1 (gamedesign §2.14, amended)
  premise: 'hella-valuation' | 'dark-mode' | 'clout-index';
  act: 1 | 2 | 3;
  missions: Record<string /* MissionId */, { state: 'locked' | 'available' | 'passed'; bestSec?: number; medals?: 0 | 1 | 2 | 3 }>;
  activeMission: { id: string; checkpoint: { schema: number; data: JsonObject } /* C09-owned */ } | null;
  flags: Record<string, boolean | number | string>;
  wallet: { cashCents: number; streetCred: number; techClout: number };
  heat: { vehicleHeat: Record<string, number>; impoundStrikes: Record<string, number> };
  property: { safehouses: string[]; businesses: { id: string; level: number }[] };
  npcRelations: Record<string /* NpcId */, { trust: number; met: boolean }>;
  world: { clockT: number; weather: WeatherPreset; seed: number };
  rng: Record<string, [number, number, number, number]>; // xoshiro states of story streams
  position: { x: number; y: number; z: number; yaw: number /* ENU f64 metres + radians (06 §4.3), valid for the record's worldBake; on a worldBake mismatch the loader snaps to the nearest safehouse */; vehicle?: string; safehouse?: string };
}

export interface SandboxSlice {                       // schema 1; never read by story
  toggles: Record<string, boolean | number>;          // sandbox.player.godMode, sandbox.world.density …
  savedPositions: { name: string; x: number; y: number; z: number; yaw: number /* ENU, as StorySlice.position */ }[];
  clock: { hour: number; paused: boolean; syncSystemTime: boolean };
  weather: WeatherPreset;
  presets: JsonObject[];                              // M13 JSON presets (≤ 512 ops each)
}

export interface ProfileSettings {                    // schema 1; device-level graphics and telemetry consent live with S11 (IndexedDB dv-platform), never here
  controls: ControlsSettings;                         // C03
  audio: Record<'master' | 'music' | 'sfx' | 'ambience' | 'voice' | 'radio' | 'ui' | 'cutscene', number>;
  subtitles: { on: boolean; size: 'm' | 'l' | 'xl'; background: boolean; speakerNames: boolean };
  camera: { defaultMode: 'fp' | 'tp'; fovDeg: number; shoulder: 'right' | 'left'; shake: boolean };
  accessibility: { reducedMotion: boolean; hudPalette: 'default' | 'deutan' | 'protan' | 'tritan'; timerScale: 1 | 1.25 | 1.5 | 2; autoBlockStoryFights: boolean; pauseOnTycoonEvents: boolean };
  xr: XrComfortSettings & { heightCalibM: number };   // S11 type (11-platform-xr.md §4.2); a player preference, synced with the profile
  language: string;                                   // BCP 47
  privacy: { cameraFeatures: boolean; parentalConsent: boolean };   // telemetry consent is device-scoped (S11 PlatformSettings.telemetryConsent): events fire before a profile loads
}

export type SaveReason = 'missionPass' | 'safehouse' | 'modeExit' | 'interval' | 'hidden' | 'manual' | 'settings' | 'unlock' | 'import' | 'migration';
export type SaveErrorCode = 'QUOTA' | 'TOO_LARGE' | 'CHECKSUM' | 'CONFLICT' | 'NEWER_SCHEMA' | 'IDB_UNAVAILABLE' | 'NOT_ALLOWED' | 'INVALID' | 'NAME_TAKEN' | 'PROFILE_LIMIT';
export type SaveResult = { ok: true; gen: number; bytes: number } | { ok: false; error: SaveErrorCode; detail?: string };

export interface SaveService {
  listProfiles(): Promise<ProfileMeta[]>;
  createProfile(name: string): Promise<ProfileMeta | SaveResult>;
  renameProfile(id: ProfileId, name: string): Promise<SaveResult>;
  deleteProfile(id: ProfileId): Promise<SaveResult>;           // writes Tombstone{slot:'*'}
  load(id: ProfileId): Promise<SaveGame>;                       // runs migrations in memory
  write(slot: SlotId, data: unknown, reason: SaveReason): Promise<SaveResult>;
  deleteSlot(id: ProfileId, slot: SlotId): Promise<SaveResult>;
  exportProfile(id: ProfileId): Promise<Blob>;                  // .dvsave = JSON {format, records[], tombstones[]}
  importProfile(b: Blob, mode: 'asNew' | 'replace', into?: ProfileId): Promise<SaveResult>;
  undoImport(id: ProfileId): Promise<SaveResult>;
  onStatus(cb: (p: ProfileId, s: LastSaveStatus) => void): () => void;
  /** Cloud sync hooks for S09 (M12+): dirty records and tombstones since a cursor. */
  changesSince(id: ProfileId, cursor: number): Promise<{ records: SaveRecord[]; tombstones: Tombstone[]; cursor: number }>;
}
export type JsonObject = { [k: string]: JsonValue }; export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;   // exported: C09, C14 and ui-bridge import them (DL-194)
type WeatherPreset = import('./engine-world').WeatherPreset;
type UnlockEventId = import('./c06-modes').UnlockEventId; type GameModeId = import('./c06-modes').GameModeId;
type ControlsSettings = import('./c03-input').ControlsSettings;
type XrComfortSettings = import('../platform/xr-comfort').XrComfortSettings;
```

**IndexedDB layout** (`dv-saves`, version 1): stores `profiles` (key `id`), `records` (key `[profileId, slot, gen]`), `pointers` (key `[profileId, slot]`), `tombstones` (key `[profileId, slot, deletedAt]`), `conflicts` (key `[profileId, slot, serverVersion]`: cloud copies awaiting the player's choice, rule 10), `meta` (deviceId, cursor). `SaveService` runs in `sim.worker` (slice data is there); the main thread opens the same DB read-only for the home-screen status line.

**Rules (numbered, testable):**
1. **Atomic write.** (a) canonicalize `data` (sorted keys, finite numbers, no `undefined`) and compute `bytes` and `checksum`; (b) reject above `recordMaxBytes` (`TOO_LARGE`) or if the profile total would exceed `profileMaxBytes`; (c) transaction 1 puts the record at `gen = pointer.gen + 1`; (d) a new read verifies the checksum; (e) transaction 2 moves the pointer only if `pointer.gen` is unchanged (else `CONFLICT`); (f) records older than `keepGenerations` are deleted afterwards. A tab killed at any step leaves the pointer on the last good record; orphan records are swept on boot.
2. **Load.** Read the pointer's record; on checksum mismatch fall back to the previous generation and report `CHECKSUM` in `lastSave`; never mutate a record while reading it.
3. **Namespaces.** A session's `SaveCapability` limits writable slots: story → `core, settings, story:*`; sandbox → `settings, sandbox, mod:*`; standalone mode → `core, settings, mode:<id>`. Any other write returns `NOT_ALLOWED`. Sandbox actions can never change story or core (gamedesign P-8).
4. **Autosave** on mission pass, safehouse save, mode exit, unlock, every 300 s of free roam when heat = 0 and no mission is active, and on `visibilitychange → hidden` when the same eligibility holds (the main thread sends C02 `SimControlMessage {t:'save.request', reason:'hidden'}`, handled outside ticks, C02 rule 9). Never mid-pursuit, never mid-mission except the mission's own checkpoint.
5. **Migrations.** Each slice kind has `schema` n and ordered pure functions `migrate[kind][n](data) → data@n+1`. A record with a schema newer than the build loads read-only with `NEWER_SCHEMA`. A failed migration leaves the stored record untouched and loads the previous generation. Golden files `packages/engine/src/sim/save/__golden__/<kind>/v<n>.json` exist for every schema and run in CI.
6. **Tombstones.** Deleting a slot or profile writes a `Tombstone`; restore/import never resurrects a tombstoned slot newer than the incoming record; tombstones expire after 180 days and only after S09 reports them synced.
7. **Profiles.** ≤ 64; names 1–80 chars, unique; ids are 32 lowercase hex from 16 random bytes (`crypto.getRandomValues` is fine here: not sim code). The first launch creates one profile named by the player (R-UI-03 flow, S10).
8. **Import/undo.** Import validates every record against JSON Schema, then writes new generations and stores the previous `gen` per slot in `importedFrom.undoGen`; `undoImport` moves pointers back.
9. **Multi-tab.** The pointer compare-and-swap detects a second writer; the losing tab shows "This profile is open in another tab" and becomes read-only.
10. **Cloud sync (M12a, S09).** The sync unit is one `SaveRecord` per `SlotId` (C12 routes 16–19; save profiles created, renamed and tombstoned via routes 50–51; server `version` per slot). A 409 stores the server copy in `conflicts`; the UI shows both (`savedAt`, `playtimeSec`, device) and the player picks; nothing is overwritten silently [research/gamedesign-decomposition.md §7.4].

**JSON Schema** (2020-12) for the runtime-validated envelope; slice schemas live in `packages/engine/src/sim/save/schema/<kind>.v<n>.schema.json` and are checked against the golden files.

```json
{ "$id": "https://dv.local/schema/save-record.v1.json", "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object", "additionalProperties": false,
  "required": ["format","kind","slot","profileId","schema","gen","savedAt","playtimeSec","deviceId","buildId","worldBake","bytes","checksum","data"],
  "properties": {
    "format": { "const": "dv-save" },
    "kind": { "enum": ["core","settings","story","sandbox","racing","fighter","tycoon","mod"] },
    "slot": { "type": "string", "pattern": "^(core|settings|sandbox|story:(auto|1|2|3)|mode:(racing|fighter|tycoon)|mod:[a-z0-9][a-z0-9._-]{0,63})$" },
    "profileId": { "type": "string", "pattern": "^[0-9a-f]{32}$" },
    "schema": { "type": "integer", "minimum": 1 }, "gen": { "type": "integer", "minimum": 1 },
    "savedAt": { "type": "integer", "minimum": 0 }, "playtimeSec": { "type": "number", "minimum": 0 },
    "deviceId": { "type": "string", "pattern": "^[0-9a-f]{32}$" },
    "buildId": { "type": "string", "maxLength": 64 }, "worldBake": { "type": "string", "maxLength": 64 },
    "bytes": { "type": "integer", "minimum": 2, "maximum": 2097152 },
    "checksum": { "type": "string", "pattern": "^[0-9a-f]{16}$" },
    "data": { "type": "object" } } }
```

## C06 — `GameMode` + unlock registry (owner S01; consumers: S03, S06, S07, S08, S10, S12)

The 06 sketch `{ id, unlockEvent, enter(ctx), exit(), tick(dt), ui(), saveSlice() }` maps onto a descriptor (static, registered at build) plus a sim half (runs in `sim.worker`) and a UI half (runs on the main thread). `tick(dt)` becomes `tick(ctx)` because dt is always `SIM_DT`.

```ts
// packages/shared/src/contracts/c06-modes.ts
export const C06_VERSION = '1.1.0' as const;   // 1.1: additive members in "C05 1.1 and C06 1.1 additions" at the end of this file
export type GameModeId = 'story' | 'sandbox' | 'racing' | 'fighter' | 'tycoon' | `exp:${string}`;
export type UnlockEventId = `unlock.${string}`;     // unlock.racing, unlock.fighter.rap_lyricist, unlock.district.d6

export interface ModeRequirements {
  simProfile: 'local' | 'canonical' | 'any';
  world: 'city' | 'stage' | 'none';                 // city = streamed SF (C08); stage = a mode-loaded diorama of C07 prop assets via ModeContext.assets, no C08 streaming (C06 1.1)
  physics: boolean;
  xr: 'full' | 'seated' | 'panel' | 'none';
  inputContexts: InputContextId[];
  network: 'none' | 'optional' | 'required';
}
export interface GameModeDescriptor {
  id: GameModeId; version: number;
  titleKey: string; tile: { art: string /* C07 AssetRef, first-party modes use `ui/mode-<GameModeId>` */; order: number /* unique: story 1, racing 2, fighter 3, tycoon 4; mods ≥ 100 (DL-167) */ };
  status: 'available' | 'comingSoon';               // A-06 stubs register as comingSoon
  unlock: UnlockEventId | null;                     // null = always available (story, sandbox)
  standalone: boolean;                              // has a main-menu tile
  embeddable: boolean;                              // can run inside story via a C09 mode hook
  requires: ModeRequirements;
  saveSlot: SlotId | null; sliceSchema: number;
  sim: () => Promise<{ default: GameModeSim }>;     // dynamic import inside sim.worker
  ui: () => Promise<{ default: GameModeUI }>;       // dynamic import on main
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
  mount(host: { root: HTMLElement; vm: ViewModelSource; send(cmd: UiCommand): void }): void;
  unmount(): void;
  inputContexts: InputContextId[];
  cameraDefault?: CameraMode;
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
  readonly telemetry: { emit(name: TelemetryName, props: Record<string, string | number | boolean>): void }; // C16 closed registry (packages/shared/src/telemetry.ts); a mode needing a new name proposes it to S09 (contract_change_proposals) before emitting it; unknown names are dropped at ingest
  readonly net: null | { slot: number; peers(): number[] };  // C11; null in single player
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
type AssetRef = import('../assets/c07').AssetRef;        // `<kind>/<id>` (C07, 05-assets.md §4.1)
type TelemetryName = import('../telemetry').TelemetryName; // C16 closed registry (09-backend-contracts.md §3)
```

**ModeHost rules:**
1. States: `Idle → Loading → Entering → Running → Exiting → Idle`; a parent in `Running` becomes `Suspended` while a child runs. Stack depth ≤ 2 (story → one embedded mode). Only one top-level mode exists.
2. An embedded mode runs under the parent's `simProfile`; a descriptor requiring `canonical` cannot embed under a `local` parent and the C09 hook falls back to its `stub` objective.
3. A top-level mode whose `simProfile` differs from the running session triggers `SimHost.restart` behind the loading screen; switching never happens mid-mission.
4. `enter` may not block: assets are requested via `ctx.assets` and the mode polls `ready()`; ModeHost holds `Loading` until the descriptor's boot set is ready (camera fade, input `menu` context).
5. On the first entry of an embeddable mode from story, ModeHost emits the hook's `unlockOnFirstEncounter` (C09) through `UnlockApi.emit`, writes `core.firstEncounters`, saves with reason `unlock`, and posts a one-time toast (R-MODE-05).
6. `UnlockApi.emit` is idempotent; `?unlockAll=1` (non-production builds only) unlocks in memory and never persists. `comingSoon` tiles render locked with their title (A-06).
7. A mode never instantiates its own physics world, renderer, camera rig or save store; everything comes from `ModeContext` (gamedesign P-2). Mods (C14, S12) receive a capability-filtered subset of `ModeContext`.
8. `exit` returns `ModeResult`; rewards go through `EconomyApi` with idempotency key `mode:<id>:<seed>:<tick>`.

## PursuitDirector core (owner S01; shared by story, racing S06, missions S03)

Structure follows NFS Most Wanted (2005) as documented, redesigned for SF; design values from [research/gamedesign-decomposition.md §2.8, §3.4]. Firearms do not exist (D-30): tactics are vehicular, plus an on-foot grapple bust.

```ts
// packages/shared/src/contracts/engine-pursuit.ts
export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;   // 6 = scripted finale only
export type InfractionKind = 'speedingSeen' | 'redLightSeen' | 'hitCivilianVehicle' | 'hitPoliceVehicle' | 'propertyDamage' | 'assault' | 'zoneViolation' | 'evasion';
export type Tactic = 'follow' | 'siren' | 'loudspeaker' | 'pit' | 'boxIn' | 'rollingBlock' | 'roadblock2' | 'roadblockHeavy' | 'spikes' | 'heliSpotlight' | 'suvRam' | 'portalSeal';
export interface PursuitLevelDef { points: number; maxUnits: number; suv: number; heli: boolean; tactics: Tactic[]; searchRadiusM: number; cooldownSec: number }
export interface PursuitConfig {                     // config/pursuit.json, schema-validated, hot-reloadable in dev
  schema: 1;
  levels: [PursuitLevelDef, PursuitLevelDef, PursuitLevelDef, PursuitLevelDef, PursuitLevelDef, PursuitLevelDef, PursuitLevelDef]; // 0..6
  infractionPoints: Record<InfractionKind, number>;  // evasion = per 10 s
  witness: { robotaxiDelaySec: number; pedDelaySec: [number, number]; pedReports: boolean };
  search: { losLostSec: number; growMps: number; hidingMultiplier: number; losChecksPerTick: number };
  bust: { speedMps: number; units: number; radiusM: number; sec: number; onFootGrappleSec: number };
  fines: { minCents: number; cashPct: number; perHeatCents: number };
  impoundStrikes: number;
}
export interface HeatState {
  level: HeatLevel; points: number; phase: 'clear' | 'pursuit' | 'search' | 'cooldown' | 'busted';
  lastKnown: { pos: [number, number, number]; tick: number } | null;
  searchRadiusM: number; cooldown: number;           // 0..1
  units: number[];                                   // EntityHandles
  sealedPortals: string[]; cap: HeatLevel; scripted: boolean;
}
export interface PursuitProfile { kind: 'story' | 'race'; startHeat: HeatLevel; maxHeat: HeatLevel; success?: { kind: 'evade' } | { kind: 'survive'; sec: number } }
export interface PursuitApi {
  state(): Readonly<HeatState>;
  report(k: InfractionKind, at: [number, number, number], witness: 'police' | 'robotaxi' | 'ped' | 'heli', count?: number): void;
  setHeat(l: HeatLevel, reason: string): void; capHeat(l: HeatLevel): void; clear(reason: string): void;
  setProfile(p: PursuitProfile): void;
  vehicleHeat(vehicleKey: string): number; respray(vehicleKey: string): void;
  spawnNamedUnit(prefabId: string, key: StableKey): EntityHandle;
}
```

Default `config/pursuit.json` values (design, owner may tune): level points 0/100/300/700/1,500/3,000 (6 scripted); max units 0/2/4/5+2 SUV/6+2 SUV+heli/8+tactical; search radius —/150/250/400/600/900 m; cooldown —/10/20/35/50/75 s; infractions 5 per second speeding in sight, red light 10, civilian vehicle 20, police vehicle 60, property 2–15, assault 80, evasion 15 per 10 s; robotaxi witness delay 2 s, ped 3–6 s; LOS lost after 2 s opens a search circle growing 5 m/s; hiding spots ×2; bust = speed < 2 m/s with ≥ 2 units within 8 m for 3 s (on foot: grappled 2 s); fine = max($250, 5 % cash + heat × $500); 3 impound strikes [research/gamedesign-decomposition.md §2.8].

**Rules:** (1) The director runs in `SimStage.AI` at 30 Hz; LOS checks are ray casts batched round-robin (`losChecksPerTick`, default 16) against static colliders. (2) Unit dispatch and routes use A* on the C08 road graph with re-plan every 2.5 s; roadblocks go on the predicted route, spikes at C08-tagged choke points [research/repos-world.md P7]. (3) Hiding spots, pursuit breakers, choke points and portals are C08 chunk tags. (4) `vehicleHeat` is per vehicle instance; respray or swapping cars resets vehicle heat, not player heat. (5) At heat 5 the director seals portals. (6) Heat 6 is reachable only through `setHeat(6)` with `scripted: true`. (7) All randomness uses streams `pursuit` and `police`.

## Time-of-day and weather clock (owner S01; visuals S02)

```ts
// packages/shared/src/contracts/engine-world.ts
export type WeatherPreset = 'clear' | 'karl-fog' | 'overcast' | 'rain' | 'smoke' | 'golden'; // [research/repos-world.md P10]
export interface WorldClockState { t: number /* integer game half-seconds since day 0 */; rate: 1 /* half-seconds per tick */; paused: boolean; lockedBy: string | null }
export interface WeatherState { current: WeatherPreset; next: WeatherPreset; blend: number /* u16 0..65535 */; changeAtT: number; fogBankM: number /* marine-layer height */; rain: number /* u8 */ }
export interface EnvState { hour: number; night: number; dark: number; weather: WeatherPreset; next: WeatherPreset; blend: number; fogBankM: number; rain: number }
export interface WorldClockApi {
  now(): Readonly<WorldClockState>; env(): Readonly<EnvState>;
  setHour(h: number): void; pause(on: boolean): void;
  lock(by: string, hour?: number, weather?: WeatherPreset): void; unlock(by: string): void;
  forceWeather(w: WeatherPreset, blendSec: number): void;
}
```
**Rules:** one game day = 172,800 half-seconds; at `rate` 1 the clock advances 30 game seconds per real second (48 real minutes per day; design value). Weather changes are drawn from stream `weather` every 20–40 game minutes with per-preset weights; Karl-the-Fog favours mornings and evenings. `night`/`dark` are piecewise-linear in hour (computed with exact ops) so the sim can use them; the exact sun direction is computed on the main thread for rendering only. Missions lock time/weather and must unlock on exit (C09). Sandbox may set hour, pause, or sync to system time. The env block publishes uniforms `uNight, uDark, uSunDir, uSunColor, uFogColor/Near/Far` for S02's timecyc sky [research/repos-world.md rec 7].

## Interaction system (owner S01; handlers from S03, S04, S10, S12)

```ts
export const enum InteractKind { EnterVehicle = 1, Talk = 2, Pickup = 3, Door = 4, Shop = 5, SafehouseSave = 6, MissionStart = 7, ModeEntry = 8, Experience = 9, Respray = 10, Transit = 11, Generic = 99 }
export interface InteractionPrompt { target: EntityHandle; kind: InteractKind; promptKey: string; hold: boolean; progress: number /*0..1*/ }
export interface InteractionHandler { kind: InteractKind; canInteract(ctx: ModeContext, actor: EntityHandle, target: EntityHandle): true | string /* loc key reason */; begin(ctx: ModeContext, actor: EntityHandle, target: EntityHandle): void }
export interface InteractionApi { register(h: InteractionHandler): void; current(player?: number): InteractionPrompt | null; setEnabled(kind: InteractKind, on: boolean): void }
```
**Rules:** each tick in `Rules`, candidates are `Interactable` entities within their `radius` (default 2.5 m on foot) and `coneDeg` (default 100°) of the player; the score is `priority × 10 − distance − angle/45`, ties broken by handle. The best candidate is published as the HUD prompt. `sim.Interact` (or `sim.Enter` for vehicles) begins it; `hold` prompts need 0.5 s held (instant when hold-to-toggle is on). In XR a grab or pinch on the highlighted target is the same action. Unavailable reasons are shown as localized text.

## Entity prefabs (owner S01; content from S02, S05, S06)

```ts
export type PrefabKind = 'player' | 'vehicle' | 'ped' | 'prop' | 'pickup' | 'police' | 'robotaxi' | 'portal' | 'marker' | 'trigger';
export interface PrefabDef {                          // assets/prefabs/<id>.json, JSON Schema validated at build and mod load
  id: string; kind: PrefabKind; version: number; nameKey?: string; // NameRegistry key; never a raw brand
  render: { asset: string /* C07 AssetRef `<kind>/<id>` */; variants?: number; anim?: string /* AnimGraphDef id */ };
  physics: { body: BodyDesc['kind']; shape: BodyDesc['shape']; dims: number[]; massKg?: number; groups: string[] } | null;
  components: Record<string /* ComponentDef name */, Record<string, number | string>>;
  vehicle?: { handling: string /* S06 HandlingProfile id */; seats: number; wheels: WheelDesc[]; quirks?: string[] };
  interact?: { kind: InteractKind; radius: number; promptKey: string };
  audio?: { set: string };
}
export interface PrefabService { spawn(id: string, at: { pos: [number, number, number]; yaw: number }, key?: StableKey, init?: Record<string, number>): EntityHandle; despawn(h: EntityHandle): void; def(id: string): PrefabDef }
```
v1 prefabs: `player.default`, `ped.ambient.{a..h}` (8 bodies, outfit palette), `vehicle.{compact,sedan,rideshare,van,truck,pickup}`, `police.{cruiser,suv,heli}`, `robotaxi.default`, `prop.{cone,barrier,spikestrip,crate}`, `pickup.{cash,item}`, `portal.{ggb,baybridge}`, `marker.{mission,experience,shop}`, `trigger.zone`.

## Mission and mode hooks (A-02; consumed by S03's interpreter)

```ts
export type ZoneShape = { k: 'circle'; at: [number, number, number]; r: number } | { k: 'poly'; ring: [number, number][]; yMin: number; yMax: number } | { k: 'edges'; edgeIds: number[]; widthM: number };
export interface ZoneService {                        // lat/lng and landmark ids are resolved to ENU by S03 at load
  define(id: string, s: ZoneShape): void; undefine(id: string): void;
  inside(id: string, h: EntityHandle): boolean; query(id: string, filter?: ComponentDef[]): EntityHandle[]; // ascending handle
  onEnter(id: string, filter: ComponentDef[], cb: (h: EntityHandle) => void): () => void; onExit(id: string, filter: ComponentDef[], cb: (h: EntityHandle) => void): () => void;
}
export interface SimScheduler {                        // cooperative threads; S03 maps IR ops onto these
  spawn(threadId: string, step: (t: ThreadCtx) => ThreadYield): void; kill(threadId: string): void;
  readonly opsBudgetPerTick: 2000;                    // per thread [research/gamedesign-decomposition.md §2.6]
}
export interface ThreadCtx { tick: Tick; ops: number; rng: Rng }
export type ThreadYield = { k: 'continue' } | { k: 'waitTicks'; n: number } | { k: 'waitUntil'; pred: () => boolean; timeoutTicks?: number } | { k: 'waitEvent'; t: string } | { k: 'done' };
export interface TimelineRecorder { emit(e: { t: string; tick: Tick; data: JsonObject }): void; snapshotEvery: 2 /* ticks = 33 ms */; export(): ArrayBuffer }
export interface Rng { u32(): number; float(): number /* [0,1) from u32 / 2^32 */; range(a: number, b: number): number; pick<T>(xs: readonly T[]): T; state(): [number, number, number, number] }
export type SimEvent = { t: string; tick: Tick; a?: EntityHandle; b?: EntityHandle; n?: number; s?: string }; // typed unions per owner in part files of each domain
```
**Rules:** zones are evaluated in `SimStage.Script` with a 100 m spatial hash; callbacks fire in ascending handle order; the scheduler runs threads in `threadId` order; `waitUntil` predicates must be pure reads. `TimelineRecorder` records entity tracks every 2 ticks (33 ms) plus typed events, enabling "simulate once, record, scrub" [research/repos-world.md §3.4].

## Economy and combat cores

```ts
export interface EconomyApi { balance(): number /* cents */; credit(cents: number, reason: string, idemKey: string): boolean; debit(cents: number, reason: string, idemKey: string): boolean /* false if insufficient */; ledgerSince(tick: Tick): { tick: Tick; cents: number; reason: string }[] }
export interface CombatApi { // open-world melee; frame data and move sets are S07's (C-fighter schema)
  setMoveSet(h: EntityHandle, moveSetId: string): void; startMove(h: EntityHandle, moveId: string): boolean;
  onHit(cb: (e: { attacker: EntityHandle; victim: EntityHandle; move: string; damage: number; ko: boolean }) => void): () => void;
}
```
**Rules:** money is integer cents; credits/debits are idempotent by key; tycoon dividends into the story wallet cap at $10,000 per in-game week [research/gamedesign-decomposition.md §2.9]. Open-world melee resolves capsule hitboxes from S07 frame data at 60 Hz in `Rules`; knockouts are non-lethal (`Health.ko`), and assault reports an infraction.

## C05 1.1 and C06 1.1 additions (Architect, second reconciliation, 2026-10-18)

Additive minor bumps accepted from Wave 2–4 return blocks (`spec/11-decision-log.md` DL-097, DL-098). Old records and modes stay valid; every new field is optional or a new union member. Shapes are normative here; the file paths are unchanged.

```ts
// c05-save.ts — 1.1
export type SaveReason = /* 1.0 members */ | 'checkpoint';          // C09 stage checkpoint (S03)
export interface ProfileSettings {                                    // 1.0 fields unchanged, plus:
  npc?: { voice: 'all' | 'heroes' | 'off'; aiDialogue: boolean };    // S04; absent = tier defaults (desktop/XR 'all', mobile 'heroes'), aiDialogue true
  cutscenes?: { generated: boolean; audio: 'generated' | 'engine' }; // S03; absent = {generated: true, audio: 'engine'}
}
// ControlsSettings.touch.layout may name a device-scoped 'custom:<n>' layout; a missing layout falls back to 'default-right' (S10).
// CoreSlice.avatar is validated by S10's packages/shared/schemas/ui/avatar.v1.schema.json (S10 owns it; with the wardrobe-item schema in @dv/shared for the mod SDK).

// c06-modes.ts — 1.1
import type { UiBridge, ViewModelSource, UiCommand, VmKey, VmPatch } from './ui-bridge';   // shapes: 10-ui.md §3.3 (+ 'cutscene.state')
import type { WorldApi } from '../world/c08-api';                                           // C08 (S02)
export interface GameModeDescriptor {                                 // 1.0 fields unchanged, plus:
  standaloneProfile?: 'local' | 'canonical';                          // top-level (menu) entry profile when requires.simProfile is 'any' (S06 CCP-1)
  modSurface?: { kinds: ('experience' | 'vehicle' | 'character' | 'rules')[] };   // C14 kinds this mode accepts; absent = none (S12)
}
export interface GameModeUI {                                         // 1.0 members unchanged, plus (S10):
  summary?(slice: JsonObject | null): { lines: { label: string /* LocKey */; value: string }[] };   // mode tile and saves page
  settingsPanel?(): unknown /* S10 ScreenDef */; assists?: { id: string; label: string /* LocKey */ }[];
}
export interface ModeContext {                                        // 1.0 members unchanged, plus:
  readonly world: WorldApi;                                           // C08 graph, traffic, map, teleport, query, places, resolver (S02 P1)
  readonly npc: {                                                     // filtered S04 runtime for missions and mods (sim side)
    whereIs(npcId: string): { pos: [number, number, number]; activity: string } | null;
    isKilled(npcId: string, scope: 'all' | 'spawn' | 'fighter' | 'cutscene' | 'voice' | 'marketing' | 'ugc'): boolean;
    playKnot(npcId: string, knot: string /* C10 InkKnot */, playId: string): void;   // lines arrive as hud.subtitle patches; completion as SimEvent 'npc.knot.done'
  };
}
export interface PursuitProfile { /* 1.0 fields */ configRef?: string /* e.g. 'config/pursuit.race.json' (S06 CCP-2) */ }
export interface PursuitApi { /* 1.0 members */ setRouteHint(edgeIds: readonly number[] | null): void /* predicted race route for roadblocks */ }
export interface TimelineRecorder { /* 1.0 members */ external(e: { src: 'talk' | 'intent' | 'cutscene' | 'mode'; tick: Tick; data: JsonObject }): void }   // recorded async inputs, replayed without re-querying (S04)
/** engine-world.ts: pure weekday of the C06 clock; t in half-seconds, 172,800 per game day, t = 0 is Monday 00:00 (S04). */
export const weekdayOf = (t: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 => (Math.floor(t / 172800) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
```

**Rule changes (1.1):**
- **C05 rule 3, capabilities.** Add: an `exp:<experienceId>` top-level session may write only `mod:<its ModId>` and read `settings`; it never writes `core`, `story:*`, `sandbox` or `mode:*` (S12). Unlock emission is therefore impossible from an experience (C09 `mod` profile, DL-084).
- **C06 rule 3, Story ↔ experience switch.** Entering `exp:<id>` from Story is a top-level mode switch at a safe point: ModeHost saves `story:auto` with reason `modeExit`, starts `exp:<id>`, and on exit reloads `story:auto` at the saved position. The marker prompt is disabled during a mission or a pursuit (S12, DN-S12-11).
- **C06 rule 2, profiles.** A descriptor with `requires.simProfile: 'any'` embeds under the parent's profile; its top-level entry uses `standaloneProfile` (racing: `canonical`, so ghosts, replays and leaderboard runs are exact).
- **ModeHost stats.** On a fighter win ModeHost increments `core.stats.fightsWon`; `ModeResult.data` may carry mode-specific rewards that the parent (Story) applies itself (S07).
- **Engine vehicle readout.** S06's per-wheel contact readout and `applyWheelForces` path (CCP-3) is fixed by S01 and S06 in M03a2 after the U-RAC-1 spike and lands as an additive C06 1.2 member; until then S06 builds its own `castRay` + impulse vehicle (DL-104).

## C05 1.2 addition (Architect, Wave 5 milestone reconciliation, 2026-10-18)

Additive minor bump (`spec/11-decision-log-3.md` DL-225): story businesses (DL-133, `08-tycoon-events.md` §7) keep their `EventHost<BusinessState>` state in the property list, not in `StorySlice.flags`, so mission predicates never read business internals.

```ts
// c05-save.ts — 1.2
export interface StorySlice {                          // 1.1 fields unchanged except this optional member:
  property: { safehouses: string[]; businesses: { id: string; level: number; state?: JsonObject /* S03 business state, canonical JSON ≤ 2,048 bytes */ }[] };
}
```
Rules: an absent `state` means the business's default state at its `level`; `story.v1.schema.json` accepts the optional member without a schema-number change (the field is optional and pre-launch builds never read records written by a later build); the bytes count inside the 2 MiB record cap; M05e1 writes the field first and sets `C05_VERSION = '1.2.0'`. Every 1.1 record loads unchanged.
