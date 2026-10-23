# 04 — Data models, part 3: C05 SaveGame, C06 GameMode, save versioning

> Wave 5 integration (Architect), 2026-10-18. Part of `spec/04-data-models.md`. Text at 06 v1.1, copied verbatim from `spec/domains/01-engine-save-modes.md` (S01) and, for the UI bridge shapes, `spec/domains/10-ui.md` §3.3 (designed by S10, file owned by S01). The owner specs stay normative. 1.1 blocks are deltas (index §3 merge rule).

## C05 — `SaveGame`

| Field | Value |
|---|---|
| Owner · version | S01 · `C05_VERSION = '1.2.0'` from M05e1; `'1.1.0'` from the M04a family until then (1.2: `property.businesses[].state?`, DL-225) |
| Source path | `packages/shared/src/contracts/c05-save.ts`; service `packages/engine/src/sim/save/` (runs in `sim.worker`) |
| Defined in | `01-engine-save-modes.md` §C05 (IndexedDB layout, rules 1–10, envelope JSON Schema), "C05 1.1 and C06 1.1 additions" |
| Created in | M04a family (`SaveService`, local saves); cloud sync M12a1 |
| Consumers | S03, S04, S06, S07, S08, S09, S10, S12; milestones M04a family, M04b1 (saves page), M05a1 (`StorySlice`, checkpoints), M07a1 (`mode:racing`), M08a2 (`mode:fighter`), M09a1 (`mode:tycoon`), M12a1, M12a2, M13a3 (`mod:<ModId>`) |

```ts
// packages/shared/src/contracts/c05-save.ts
export const C05_VERSION = '1.1.0' as const;   // M04a1 writes 1.1.0 (additive fields in "C05 1.1 and C06 1.1 additions"); M05e1 sets '1.2.0' (businesses[].state?, DL-225)
export type ProfileId = string & { readonly __brand: 'ProfileId' };   // /^[0-9a-f]{32}$/
export type SliceKind = 'core' | 'settings' | 'story' | 'sandbox' | 'racing' | 'fighter' | 'tycoon' | 'mod';
export type SlotId =
  | 'core' | 'settings' | 'sandbox'
  | 'story:auto' | 'story:1' | 'story:2' | 'story:3'
  | 'mode:racing' | 'mode:fighter' | 'mode:tycoon'
  | `mod:${string}`;                                                    // C14 mod id, sandbox-only data

export const SAVE_LIMITS = {
  maxProfiles: 64, nameMin: 1, nameMax: 80,          // our design values (DL-732), within profileMaxBytes
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
  property: { safehouses: string[]; businesses: { id: string; level: number; state?: JsonObject /* 1.2, ≤ 2,048 B canonical JSON */ }[] };
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

IndexedDB `dv-saves` v1 stores: `profiles` (key `id`), `records` (`[profileId, slot, gen]`), `pointers` (`[profileId, slot]`), `tombstones` (`[profileId, slot, deletedAt]`), `conflicts` (`[profileId, slot, serverVersion]`), `meta`. Never OPFS (single-tab handles) [research/repos-webport.md P14].

**Runtime JSON Schema — save-record envelope** (draft 2020-12; file `packages/engine/src/sim/save/schema/save-record.v1.schema.json`, `$id` as given; slice schemas beside it as `<kind>.v<n>.schema.json`):

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

Slice schemas owned outside S01: `CoreSlice.avatar` → `packages/shared/schemas/ui/avatar.v1.schema.json` (S10); `CoreSlice.garage[]` → `vehicle-instance.v1.schema.json` (S06, `06-racing-data.md` §4.1); `mode:racing` slice `06-racing-data.md` §4.4; `mode:fighter` slice `07-fighter-core.md` FC2; `mode:tycoon` slice `08-tycoon.md` §4.6; `mod:<ModId>` data `{kv, meta}` `12-modding-contracts.md` B§5; mission checkpoint `MissionCheckpointV1` `03-story-missions.md` §C3.

## C06 — `GameMode`, unlocks and `ModeContext` services

| Field | Value |
|---|---|
| Owner · version | S01 · `C06_VERSION = '1.1.0'` |
| Source paths | `packages/shared/src/contracts/c06-modes.ts`, `engine-pursuit.ts`, `engine-world.ts`, `ui-bridge.ts` (all under `packages/shared/src/contracts/`); ModeHost and services in `packages/engine/src/sim/` |
| Defined in | `01-engine-save-modes.md` §C06 (ModeHost rules 1–8), PursuitDirector, clock, interaction, prefabs, mission and mode hooks, economy and combat, 1.1 section; `10-ui.md` §3.3 |
| Created in | M04a family (ModeHost, unlocks); clock M02b2; prefabs and interaction M03a1; pursuit M03c; UI bridge M04b1 |
| Consumers | S02, S03, S04, S06, S07, S08, S10, S12; milestones M03c, M04a family, M04b1, M04b2, M05a1, M05e1, M07a1, M08a2, M09a1, M13a3, M13a4 |

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

PursuitDirector core (default `config/pursuit.json` values in the owner spec; racing uses `config/pursuit.race.json` through `PursuitProfile.configRef`):

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

Time-of-day and weather clock (one game day = 172,800 half-seconds; rate 1 = 30 game s per real s):

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

Interaction system:

```ts
export const enum InteractKind { EnterVehicle = 1, Talk = 2, Pickup = 3, Door = 4, Shop = 5, SafehouseSave = 6, MissionStart = 7, ModeEntry = 8, Experience = 9, Respray = 10, Transit = 11, Generic = 99 }
export interface InteractionPrompt { target: EntityHandle; kind: InteractKind; promptKey: string; hold: boolean; progress: number /*0..1*/ }
export interface InteractionHandler { kind: InteractKind; canInteract(ctx: ModeContext, actor: EntityHandle, target: EntityHandle): true | string /* loc key reason */; begin(ctx: ModeContext, actor: EntityHandle, target: EntityHandle): void }
export interface InteractionApi { register(h: InteractionHandler): void; current(player?: number): InteractionPrompt | null; setEnabled(kind: InteractKind, on: boolean): void }
```

Entity prefabs (`assets/prefabs/<id>.json`, JSON Schema validated at build and at mod load):

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

Mission and mode hooks (consumed by the C09 interpreter):

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

Economy and combat cores (money is integer cents; credits and debits are idempotent by key):

```ts
export interface EconomyApi { balance(): number /* cents */; credit(cents: number, reason: string, idemKey: string): boolean; debit(cents: number, reason: string, idemKey: string): boolean /* false if insufficient */; ledgerSince(tick: Tick): { tick: Tick; cents: number; reason: string }[] }
export interface CombatApi { // open-world melee; frame data and move sets are S07's (C-fighter schema)
  setMoveSet(h: EntityHandle, moveSetId: string): void; startMove(h: EntityHandle, moveId: string): boolean;
  onHit(cb: (e: { attacker: EntityHandle; victim: EntityHandle; move: string; damage: number; ko: boolean }) => void): () => void;
}
```

**UI bridge** (`packages/shared/src/contracts/ui-bridge.ts`, C06 1.1, DL-098; `ToastKind` declared in the file since DL-196; `FallbackTrigger` and `CutsceneOutcome` are imported from C09 `c09-cutscene.ts`, `JsonValue`/`JsonObject`/`SlotId`/`SaveReason` from C05, `GameModeId` from C06):

```ts
// packages/shared/src/contracts/ui-bridge.ts   (C06 1.1; S01 owns the file, S10 designed the shapes)
export type VmKey = `hud.${string}` | `phone.${string}` | `sys.${string}` | `mode.${GameModeId}.${string}`;
export interface VmPatch { k: VmKey; rev: number; v: JsonValue | null }          // whole-value replace; null deletes
export interface ViewModelSource {
  get<T extends JsonValue>(k: VmKey): T | undefined;
  subscribe(k: VmKey | `${string}*`, cb: (v: JsonValue | undefined, k: VmKey) => void): () => void;
  readonly rev: number;
}
export type ToastKind = 'info' | 'success' | 'warning' | 'unlock' | 'error';     // = ToastSpec['kind'] (§3.1); declared here because @dv/shared cannot import packages/ui (DL-196)
export interface UiBridge {                                                       // sim side = ModeContext.ui
  patch(k: VmKey, v: JsonValue | null): void;                                     // coalesced, ≤ 64 patches and ≤ 4 KiB per tick
  toast(t: { id: string; kind: ToastKind; text: string /* LocKey */; params?: Record<string, string | number> }): void;
  openApp(app: string): void; closeOverlay(): void;
}
export type UiCommand =
  | { t: 'mode.start'; id: GameModeId; slot?: SlotId } | { t: 'mode.quit' } | { t: 'pause'; on: boolean }
  | { t: 'save.request'; reason: SaveReason } | { t: 'save.settings'; data: JsonObject } | { t: 'save.avatar'; avatar: JsonObject }
  | { t: 'save.profile'; op: 'create' | 'rename' | 'delete' | 'select'; id?: string; name?: string }
  | { t: 'garage.call'; vehicleKey: string } | { t: 'garage.favorite'; vehicleKey: string }
  | { t: 'sandbox.set'; path: string; v: boolean | number } | { t: 'sandbox.teleport'; name: string }
  | { t: 'phone.waypoint'; x: number; z: number } | { t: 'cutscene.skip' }
  | { t: 'cutscene.state'; playId: string /* String(cut.request n), 03-story-cutscenes §D7 */; item?: number; state: 'video' | 'fallback' | 'done'; trigger?: FallbackTrigger; outcome?: CutsceneOutcome }   // C09 player → sim (S03, DL-081)
  | { t: 'mode.cmd'; mode: GameModeId; name: string; args?: JsonObject };         // mode-owned commands (≤ 512 B)
```

HUD view-model keys and their owners (`hud.player`, `hud.wallet`, `hud.mission`, `hud.area`, `hud.map`, `hud.clock`, `hud.vehicle`, `hud.subtitle`, `hud.net`, `mode.<id>.*`) are listed under the block in `10-ui.md` §3.3; `hud.heat` rides the C02 snapshot side block, not a patch.

**C05 1.1 and C06 1.1 delta** (DL-097, DL-098; rule changes for `exp:` sessions, Story ↔ experience switch, `standaloneProfile`, fighter stats and the deferred C06 1.2 vehicle readout are in the owner section):

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

## Save-game versioning and migration rules (C05)

These rules consolidate C05 rules 1–10, the C05 1.1 rule changes, C09 §C5 and C12 route 16–19 and 50–51 semantics. Where a line below and the owner text differ, `01-engine-save-modes.md` wins.

**Version numbers in a save.**

| Number | Where | Current | Changes when |
|---|---|---|---|
| `format` | `SaveRecord.format` | `'dv-save'` | never; a different envelope is a C05 major bump with an ADR (06 §4.1) |
| `SaveGame.version` | assembled read model | `1` | never persisted; changes with C05 major only |
| `schema` | `SaveRecord.schema`, per `SliceKind` | `core` 1, `settings` 1, `story` 1, `sandbox` 1, `racing` 1, `fighter` 1, `tycoon` 1, `mod` = `manifest.storage.schema` (default 1) | a slice shape changes in a way old readers cannot ignore |
| `gen` | per `(profileId, slot)` | monotonic from 1 | every successful write |
| `version` | server `save_records.version` / `CloudSaveRecord.version` | server-assigned | every accepted cloud write (`If-Match`) |
| `save_version` | server column | copy of `SaveRecord.schema` | with `schema` |
| `worldBake` | `SaveRecord.worldBake` | C08 `WorldIndex.bakeId` (64 hex) | every world bake |
| checkpoint `schema` | `StorySlice.activeMission.checkpoint.schema` | 1 (`MissionCheckpointV1`, C09-owned) | C09 checkpoint shape change |

**Rules.**
1. **Additive fields need no bump.** C05 1.1 fields (`ProfileSettings.npc?`, `.cutscenes?`, `SaveReason 'checkpoint'`) are optional; an absent field means the documented default, so `settings` stays at schema 1. Any field that a v1 reader would misread, any removed or renamed field, and any changed unit is a schema bump.
2. **A schema bump ships four things in one PR:** the new `<kind>.v<n+1>.schema.json`, a pure `migrate[kind][n](data) → data@n+1` (no clock, no randomness, no IO), a golden file `packages/engine/src/sim/save/__golden__/<kind>/v<n+1>.json`, and an unchanged golden `v<n>.json` that CI migrates forward and validates against the new schema. Mode slices also bump `GameModeDescriptor.sliceSchema` and implement `GameModeSim.migrateSlice(old, fromSchema)`.
3. **Load path.** Read the pointer's record → verify the FNV-1a-64 checksum (fall back to the previous generation and report `CHECKSUM`) → validate the envelope schema → run migrations in memory in order → validate against the current slice schema. The stored record is rewritten only by the next ordinary write, as a new generation.
4. **Newer than the build.** A record whose `schema` is newer than the build loads read-only with `NEWER_SCHEMA`; the server also refuses a cloud record whose `schema` is newer than the client build (`CloudSaveRecord` comment, C12).
5. **Failure.** A throwing migration leaves the stored record untouched and loads the previous generation; the status line reports the error (`LastSaveStatus.error`).
6. **World drift.** A `StorySlice.position` from another `worldBake` snaps to the nearest safehouse (DL-057). A saved `activeMission` whose mission `version` or `worldBake` no longer matches is dropped and the mission restarts from `available` (C09 §C5.3).
7. **Capabilities.** Story sessions write `core, settings, story:*`; sandbox `settings, sandbox, mod:*`; a standalone mode `core, settings, mode:<id>`; an `exp:<id>` session only `mod:<its ModId>` (C05 1.1). Anything else is `NOT_ALLOWED`.
8. **Tombstones.** Deleting a slot or profile writes a `Tombstone`; restore and import never resurrect a tombstoned slot newer than the incoming record. Tombstones live 180 days on the device (`SAVE_LIMITS.tombstoneRetentionDays`, and only after S09 reports them synced) and 180 days on the server (`save_records.deleted_at`, `save_profiles.deleted_at`; DL-195).
9. **Import and export.** `.dvsave` = JSON `{format, records[], tombstones[]}`; import validates every record against its schema, writes new generations and keeps `importedFrom.undoGen` for `undoImport`.
10. **Cloud sync (M12a1).** One `SaveRecord` per `(saveProfileId, SlotId)`; save profiles are created or renamed by route 50 before the first route 17 write; a 409 stores the server copy in `conflicts` and the player chooses; nothing is overwritten silently. Inline `data` up to 262,144 bytes, larger records (≤ 2 MiB) as an R2 blob.
11. **Mod storage.** A `manifest.storage.schema` bump calls the mod's `migrate(from, to, kv)` once; a throw keeps the old record and disables the mod for the session (`12-modding-contracts.md` B§5).
12. **Tests.** `pnpm check:unit -- packages/engine/src/sim/save` runs golden migration, checksum fallback, multi-tab CAS, tombstone and import/undo tests; every slice schema has at least one golden file per version.
