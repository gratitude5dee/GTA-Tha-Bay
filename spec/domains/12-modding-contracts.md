# 12 — Modding & UGC, Part B: contracts C14 and C17, protocols, install records, limits

> S12, Wave 4, 2026-10-18. Part of `spec/domains/12-modding.md` (§4 Data). Contracts are **v1.0.0**, accepted by the Architect in 06 v1.1 (2026-10-18) with the finalization edits DL-089 (`compat.world`, `uses.npcs`) and DL-090 (C17 `worldVersion`/`modSha256` in 1.0.0, `ChunkKey`, `nhood`); the 06 §4.4 sketches are kept exactly and *(fixed)* lines are marked. Types live in `packages/shared/src/contracts/` (C14: `c14-mod.ts`, `c14-modapi.ts`; C17: `c17-experience.ts`) so `@dv/mod-sdk`, `services/edge`, `tools/cli` and the engine import them without importing an implementation. `AssetKind`, `AssetRef`, `ProvenanceRecord` are C07; `QualityTierId` is C13; `SlotId` is C05; `WeatherPreset` and `CinematicShot` are from C06/C04. Assumptions on concurrent specs are listed in the return block.

## B§1 C14 — `ModManifest`

```ts
// packages/shared/src/contracts/c14-mod.ts
import type { AssetKind, AssetRef } from '../assets/c07';
import type { ProvenanceRecord } from '../assets/provenance';

export const C14_VERSION = '1.0.0' as const;          // this contract (manifest + ModAPI shapes)
export const MODAPI_VERSION = '1.0.0' as const;       // semver of the ModAPI surface; additive = minor, breaking = major + one-release overlap
export const MOD_MANIFEST_SCHEMA = 'dv-mod/1' as const;

export type ModId = string;       // ^[a-z0-9][a-z0-9-]{1,19}\.[a-z0-9][a-z0-9-]{1,19}$, ≤ 41 chars; the suffix of C05 slot `mod:<ModId>`
export type ModKind = 'experience' | 'vehicle' | 'character' | 'rules';           // (fixed by 06 §4.4)
export type ModTier = 'data' | 'script' | 'ui';                                    // (fixed, D-26)
export type SemVer = string;      // MAJOR.MINOR.PATCH[-prerelease], no build metadata
export type Sha256 = string;      // 64 lowercase hex

/** Closed enum (fixed): unknown values fail validation at `dv mod check`, in the Queue consumer, and at install. */
export const MOD_PERMISSIONS = [
  'world.props', 'world.spawn', 'world.markers', 'world.zones',
  'mission.register', 'vehicle.register', 'character.register',
  'player.teleport', 'player.loadout', 'camera.cinematic', 'audio.play', 'npc.cameo',
  'ui.panel', 'ui.hud', 'storage', 'rules.tick', 'rules.events',
] as const;
export type ModPermission = (typeof MOD_PERMISSIONS)[number];

export type ModAssetKind = Extract<AssetKind, 'character' | 'vehicle' | 'prop' | 'texture' | 'ui' | 'audio_music' | 'audio_sfx' | 'data' | 'anim'>;
export type ModContentWarning = 'flashing' | 'loud' | 'crude-humor' | 'mild-violence';

export interface ModAssetEntry {                      // every asset carries a C07 record (fixed)
  path: string;                                       // archive-relative, NFC, no '..', no leading '/', ≤ 120 chars
  kind: ModAssetKind; sha256: Sha256; bytes: number;
  provenance: ProvenanceRecord;                       // provenance.sha256 === sha256; provenance.paths includes `path`
}
export interface ModProvenance {
  license: string;                                    // SPDX id of the creator's own content; allowlist config/license-allowlist.json (S05)
  remixAllowed: boolean;
  remixOf?: { id: ModId; version: SemVer; archiveSha256: Sha256 };   // parent must be remix-allowed or on the licence allowlist
  aiAssisted: { code: boolean; assets: boolean };     // drives the store "AI-assisted" badge
  credits: { name: string; role: string; url?: string }[];            // ≤ 20
  thirdParty: { name: string; version: string; spdx: string }[];     // code bundled into entry/ui, from the bundler metadata
}
export interface ModCompat {
  api: string;                                        // semver range satisfied by MODAPI_VERSION, e.g. "^1.0.0"
  world?: string[];                                   // accepted C08 bakeIds (= C05 `worldBake`, 64-hex) or ≥ 12-hex prefixes; absent = any bake, subject to anchor re-validation on rebake (DL-089)
  game?: string;                                      // semver range of the app version
}
export interface ModUiSpec {
  entry: string;                                      // one self-contained HTML file, ≤ 512 KiB, data: URIs only
  xrPanel?: string;                                   // path to a `dv-panel/1` JSON for XR and the L2 fallback
  widthPct: number; heightPct: number;                // 10..40 of the viewport
}
export interface ModDataFiles {                       // kind decides which are required (JSON Schema allOf)
  experience?: string;                                // `dv-exp/1`, required for kind 'experience'
  scene?: string;                                     // `dv-scene/1`
  missions?: string[];                                // C09 IR files (S03 schema, `mod` profile), ≤ 8
  vehicles?: string[];                                // required for kind 'vehicle', ≤ 8
  outfits?: string[];                                 // required for kind 'character', ≤ 32 items in total
  strings?: string;                                   // id → text table; all player-visible text goes through it
}
export interface ModDeclarations {                    // creator's standing statements; the publish step records the human confirmation
  originalWork: true; noRealPeople: true; noThirdPartyGameAssets: true; noSecrets: true;
}

export interface ModManifest {
  schema: typeof MOD_MANIFEST_SCHEMA;
  id: ModId; name: string /* 3–48 */; version: SemVer; summary: string /* ≤ 280 */;
  author: { id: string /* identity profile id, stamped by the server; '' in local builds */; display: string /* 2–32 */ };
  kind: ModKind; tier: ModTier;
  entry?: string;                                     // script: bundled ES module ≤ 256 KiB; required when tier is 'script', optional for 'ui'
  ui?: ModUiSpec;                                     // required iff tier === 'ui'
  data: ModDataFiles;
  permissions: ModPermission[];
  assets: ModAssetEntry[];                            // ≤ 256
  uses?: { assets?: AssetRef[]; npcs?: string[] };    // first-party C07 refs and roster/approved NPC ids the mod depends on
  provenance: ModProvenance;
  compat: ModCompat;
  contentWarnings: ModContentWarning[];
  storage?: { schema: number };                       // version of the mod's own KV layout (default 1)
  declarations: ModDeclarations;
  multiplayer: false;                                 // literal; there is no other value in v1
}

/** Install-time identity of an archive (never authored). */
export interface ModArchiveRef { modId: ModId; version: SemVer; archiveSha256: Sha256; bytes: number }
```

**Permissions** (closed). The namespace is where the capability appears on `ModContext<P>` (B§3). "Min tier" is the lowest tier whose package may request it; data-tier files use the same permissions through the ops they contain (a `ped` scene op needs `world.spawn`), checked at validation.

| Permission | Namespace | Min tier | Allows | Limits (S12 design values, `config/mod-limits.json`) |
|---|---|---|---|---|
| `world.props` | `props` | data | place and remove mod-owned props (instanced per asset) | prefab kind `prop` or the mod's own; inside radius |
| `world.spawn` | `spawn` | data | peds and civilian vehicles from the prefab allowlist | 8 spawns/s; entity cap per tier; never `police.*`, `portal.*`, `player.*` |
| `world.markers` | `markers` | data | world markers and map blips | ≤ 16 |
| `world.zones` | `zones` | data | trigger zones (circle, polygon) | ≤ 32 |
| `mission.register` | `missions` | data | C09 IR under the `mod` profile | ≤ 8 missions; no economy, unlock, story-flag or mode-load ops |
| `vehicle.register` | `vehicles` | data | vehicle prefabs and handling data (S06 schema, clamped to class limits) | ≤ 8 |
| `character.register` | `outfits` | data | outfits and ped skins on `bay_rig_v1` | ≤ 32; no voices, no real people |
| `player.teleport` | `player` | script | teleport inside the radius | radius only |
| `player.loadout` | `player` | script | grant registered item sets | no economy, no persistence outside `mod:<id>` |
| `camera.cinematic` | `camera` | script | C04 `CinematicShot` sequences | ≤ 12 shots, ≤ 60 s; refused in XR (pending S11) |
| `audio.play` | `audio` | data | cues from the mod's `audio_*` assets or first-party cues | 4 cues/s |
| `npc.cameo` | `npcs` | data | place roster or approved NPCs by id; talk goes through the official proxy (C10) | ≤ 4; no custom dialogue; killed NPCs refused (`RosterFlags`) |
| `ui.panel` | `ui` | ui | open the iframe panel and exchange messages | 30 msg/s, 4 KiB |
| `ui.hud` | `hud` | script | host-rendered HUD widgets (text, bar, icon) | ≤ 6 |
| `storage` | `storage` | script | per-mod key-value store in `mod:<id>` | ≤ 1 MiB, ≤ 64 keys, key ≤ 64 chars, value ≤ 64 KiB |
| `rules.tick` | `rules` | script | `onTick(hz, fn)` | ≤ 10 Hz |
| `rules.events` | `rules` | script | typed `onEvent`, `after`, `finish` | handler cap 32 |

**Asset rules.** Allowed kinds are `ModAssetKind` only (no `voice`, `cutscene`, `rig`, `portrait`, `mouth_atlas`, `audio_bark`, `world_pack`, `terrain`, `building`, `map_data`, `font`). Character-family assets must carry `likeness {tier:'original', face_reference_used:false, photoreal:false, voice_mode:'none'}`; any other tier fails (the closed schema allows only `original`). `audio_music` with `origin:'generated'` is routed to human review (vendor plan terms, [research/legal-ip-likeness.md §0 item 5]). At load the host maps each archive path to the synthesized ref `<kind>/mod.<sha256[0:12]>` (a valid C07 `AssetId`), so only full `AssetRef`s cross into engine APIs and ECS `RenderKey`.

## B§2 Manifest JSON Schema

`packages/shared/schemas/mod/manifest.v1.schema.json` (draft 2020-12), compiled to standalone validators at build. `$defs` for `ProvenanceRecord` reference `provenance-1.0` (S05).

```json
{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "dv-mod-1", "type": "object", "additionalProperties": false,
  "required": ["schema","id","name","version","summary","author","kind","tier","data","permissions","assets","provenance","compat","contentWarnings","declarations","multiplayer"],
  "properties": {
    "schema": { "const": "dv-mod/1" },
    "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{1,19}\\.[a-z0-9][a-z0-9-]{1,19}$" },
    "name": { "type": "string", "minLength": 3, "maxLength": 48 },
    "version": { "type": "string", "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z.-]+)?$" },
    "summary": { "type": "string", "maxLength": 280 },
    "author": { "type": "object", "additionalProperties": false, "required": ["id","display"],
      "properties": { "id": { "type": "string" }, "display": { "type": "string", "minLength": 2, "maxLength": 32 } } },
    "kind": { "enum": ["experience","vehicle","character","rules"] },
    "tier": { "enum": ["data","script","ui"] },
    "entry": { "type": "string", "pattern": "^[a-z0-9._/-]{1,120}\\.js$" },
    "ui": { "$ref": "#/$defs/ui" },
    "data": { "$ref": "#/$defs/data" },
    "permissions": { "type": "array", "uniqueItems": true, "maxItems": 17,
      "items": { "enum": ["world.props","world.spawn","world.markers","world.zones","mission.register","vehicle.register","character.register","player.teleport","player.loadout","camera.cinematic","audio.play","npc.cameo","ui.panel","ui.hud","storage","rules.tick","rules.events"] } },
    "assets": { "type": "array", "maxItems": 256, "items": { "$ref": "#/$defs/asset" } },
    "uses": { "type": "object", "additionalProperties": false, "properties": {
      "assets": { "type": "array", "maxItems": 64, "items": { "type": "string", "pattern": "^[a-z_]+/[a-z0-9][a-z0-9._-]{1,62}$" } },
      "npcs": { "type": "array", "maxItems": 4, "items": { "type": "string", "pattern": "^[a-z][a-z0-9_-]{2,47}$" } } } },
    "provenance": { "$ref": "#/$defs/modProvenance" },
    "compat": { "type": "object", "additionalProperties": false, "required": ["api"],
      "properties": { "api": { "type": "string" }, "world": { "type": "array", "items": { "type": "string", "pattern": "^[0-9a-f]{12,64}$" }, "maxItems": 8 }, "game": { "type": "string" } } },
    "contentWarnings": { "type": "array", "uniqueItems": true, "items": { "enum": ["flashing","loud","crude-humor","mild-violence"] } },
    "storage": { "type": "object", "additionalProperties": false, "properties": { "schema": { "type": "integer", "minimum": 1 } } },
    "declarations": { "type": "object", "additionalProperties": false, "required": ["originalWork","noRealPeople","noThirdPartyGameAssets","noSecrets"],
      "properties": { "originalWork": { "const": true }, "noRealPeople": { "const": true }, "noThirdPartyGameAssets": { "const": true }, "noSecrets": { "const": true } } },
    "multiplayer": { "const": false } },
  "allOf": [
    { "if": { "properties": { "tier": { "const": "data" } } }, "then": { "not": { "anyOf": [ { "required": ["entry"] }, { "required": ["ui"] } ] } } },
    { "if": { "properties": { "tier": { "const": "script" } } }, "then": { "required": ["entry"], "not": { "required": ["ui"] } } },
    { "if": { "properties": { "tier": { "const": "ui" } } }, "then": { "required": ["ui"] } },
    { "if": { "properties": { "kind": { "const": "experience" } } }, "then": { "properties": { "data": { "required": ["experience"] } } } },
    { "if": { "properties": { "kind": { "const": "vehicle" } } }, "then": { "properties": { "data": { "required": ["vehicles"] } } } },
    { "if": { "properties": { "kind": { "const": "character" } } }, "then": { "properties": { "data": { "required": ["outfits"] } } } },
    { "if": { "properties": { "kind": { "const": "rules" } } }, "then": { "properties": { "tier": { "enum": ["script","ui"] } } } } ],
  "$defs": {
    "asset": { "type": "object", "additionalProperties": false, "required": ["path","kind","sha256","bytes","provenance"],
      "properties": { "path": { "type": "string", "maxLength": 120 },
        "kind": { "enum": ["character","vehicle","prop","texture","ui","audio_music","audio_sfx","data","anim"] },
        "sha256": { "pattern": "^[0-9a-f]{64}$" }, "bytes": { "type": "integer", "minimum": 1, "maximum": 134217728 },
        "provenance": { "$ref": "provenance-1.0" } } },
    "ui": { "type": "object", "additionalProperties": false, "required": ["entry","widthPct","heightPct"],
      "properties": { "entry": { "type": "string", "pattern": "\\.html$" }, "xrPanel": { "type": "string", "pattern": "\\.json$" },
        "widthPct": { "type": "integer", "minimum": 10, "maximum": 40 }, "heightPct": { "type": "integer", "minimum": 10, "maximum": 40 } } },
    "data": { "type": "object", "additionalProperties": false, "properties": {
      "experience": { "type": "string" }, "scene": { "type": "string" }, "strings": { "type": "string" },
      "missions": { "type": "array", "maxItems": 8, "items": { "type": "string" } },
      "vehicles": { "type": "array", "maxItems": 8, "items": { "type": "string" } },
      "outfits": { "type": "array", "maxItems": 32, "items": { "type": "string" } } } },
    "modProvenance": { "type": "object", "additionalProperties": false, "required": ["license","remixAllowed","aiAssisted","credits","thirdParty"],
      "properties": { "license": { "type": "string" }, "remixAllowed": { "type": "boolean" },
        "remixOf": { "type": "object", "additionalProperties": false, "required": ["id","version","archiveSha256"],
          "properties": { "id": { "type": "string" }, "version": { "type": "string" }, "archiveSha256": { "pattern": "^[0-9a-f]{64}$" } } },
        "aiAssisted": { "type": "object", "required": ["code","assets"], "properties": { "code": { "type": "boolean" }, "assets": { "type": "boolean" } } },
        "credits": { "type": "array", "maxItems": 20 }, "thirdParty": { "type": "array", "maxItems": 64 } } } } }
```

Cross-field rules the schema cannot express are validator functions with codes (B§7 `ModCheckCode`): permission/tier minimums, every `assets[].path` exists in the archive with that SHA-256, every file in the archive is either listed in `assets`, named in `data`/`entry`/`ui`, or one of `manifest.json`, `README.md`, `CREDITS.md`, `evidence.json`; `provenance.sha256 === sha256`; `uses` refs resolve to active public catalog entries; `permissions` equal the union of what the data files and (by static scan) the script reference, with extra permissions a warning and missing ones an error.

## B§3 `ModAPI` v1 (typed, versioned, permission-narrowed)

`ModAPI` is a facade over a capability-filtered subset of C06 `ModeContext` (rule 7). The host implements it in `packages/engine/src/sim/mods/broker.ts`; the SDK publishes the types and an `.d.ts` for the QuickJS environment. A mod is `export default defineMod<P>({ … })`; `P` is the union of granted permissions, so `ctx.props` does not type-check unless `'world.props'` is in `P`. Positions are **anchor-relative** (§2.1 principle 7); nothing here exposes `EntityId`, `EntityHandle`, raw ECS, physics, `ModeContext` itself, the economy, `UnlockApi`, saves outside `storage`, the network, telemetry, or the pose camera.

```ts
// packages/shared/src/contracts/c14-modapi.ts
import type { ModId, ModPermission } from './c14-mod';
import type { CinematicShot } from './c04-camera';
import type { HeatLevel } from './engine-pursuit';
import type { WeatherPreset } from './engine-world';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type AnchorVec3 = readonly [x: number, y: number, z: number];   // metres; origin = anchor on the ground; +X east, +Y up, −Z north; |x|,|z| ≤ radius
export type ModEntityRef = number & { readonly __brand: 'ModEntityRef' };   // session-local, opaque, never an EntityHandle
export type ModZoneShape = { k: 'circle'; at: AnchorVec3; r: number } | { k: 'poly'; ring: readonly [number, number][]; yMin: number; yMax: number };
export type ModMarkerSpec = { at: AnchorVec3; icon: 'start' | 'goal' | 'info' | 'shop' | 'danger'; label?: string /* string-table id */ };

export interface ModRng { u32(): number; float(): number; range(a: number, b: number): number; pick<T>(xs: readonly T[]): T }
export interface ModTime { readonly tick: number; readonly simMs: number }       // since the mod loaded; no wall clock exists

export interface ModSnapshot {                       // delivered with every script tick; the only way a script reads the world
  tick: number; simMs: number;
  player: { pos: AnchorVec3; yaw: number; speedMps: number; onFoot: boolean; vehicle?: string /* prefab id */; insideRadius: boolean };
  clock: { hour: number; weather: WeatherPreset };   // WorldClockApi.env() subset
  heat: HeatLevel;                                   // 0..6 (6 = scripted finale), read-only
  mine: { ref: ModEntityRef; pos: AnchorVec3 }[];    // ≤ 64 nearest mod-owned entities
}
export type ModEvent =
  | { t: 'zone.enter'; zone: string } | { t: 'zone.exit'; zone: string }
  | { t: 'interact'; ref: ModEntityRef }
  | { t: 'vehicle.enter'; prefab: string } | { t: 'vehicle.exit'; prefab: string }
  | { t: 'heat'; level: number } | { t: 'hour'; hour: number } | { t: 'weather'; preset: WeatherPreset }
  | { t: 'mission.end'; id: string; outcome: 'win' | 'lose' | 'quit' }
  | { t: 'ui'; msg: JsonValue } | { t: 'exp.enter' } | { t: 'exp.exit' };

export interface ModApiProps    { place(prefab: string, at: AnchorVec3, o?: { yaw?: number; scale?: number }): ModEntityRef; remove(ref: ModEntityRef): void }
export interface ModApiSpawn    { ped(prefab: string, at: AnchorVec3, o?: { yaw?: number; behavior?: 'idle' | 'wander' | 'patrol'; path?: AnchorVec3[] }): ModEntityRef;
                                  vehicle(prefab: string, at: AnchorVec3, o?: { yaw?: number; parked?: boolean }): ModEntityRef; despawn(ref: ModEntityRef): void }
export interface ModApiMarkers  { add(m: ModMarkerSpec): ModEntityRef; remove(ref: ModEntityRef): void }
export interface ModApiZones    { define(id: string, s: ModZoneShape): void; undefine(id: string): void }
export interface ModApiMissions { register(irFile: string): void; start(id: string): boolean }                 // IR is a data file path; the C09 interpreter runs it
export interface ModApiVehicles { register(file: string): void }
export interface ModApiOutfits  { register(file: string): void }
export interface ModApiPlayer   { teleport(at: AnchorVec3): boolean; giveLoadout(setId: string): boolean }   // false when outside the radius or unknown set
export interface ModApiCamera   { play(shots: readonly CinematicShot[]): boolean; release(): void }
export interface ModApiAudio    { play(cue: string, at?: AnchorVec3): void }
export interface ModApiNpcs     { cameo(npcId: string, at: AnchorVec3): ModEntityRef | null }               // null when killed, not allowed, or over the cap
export interface ModApiUi       { post(msg: JsonValue): void; onMessage(fn: (msg: JsonValue) => void): void }  // ≤ 4 KiB per message
export interface ModApiHud      { set(id: string, w: { kind: 'text' | 'bar' | 'icon'; text?: string; value?: number; icon?: string }): void; clear(id: string): void }
export interface ModApiStorage  { get(key: string): JsonValue | undefined; set(key: string, v: JsonValue): void; remove(key: string): void; keys(): string[]; readonly schema: number }
export interface ModApiRules {
  onTick(hz: number /* 1..10 */, fn: (snap: ModSnapshot) => void): void;
  onEvent<T extends ModEvent['t']>(t: T, fn: (e: Extract<ModEvent, { t: T }>, snap: ModSnapshot) => void): void;
  after(ms: number, fn: () => void): void;                              // sim time
  finish(outcome: 'win' | 'lose' | 'quit'): void;                       // ends exp:<id> with a ModeResult and no rewards
}

interface PermNamespaces {
  'world.props': { props: ModApiProps }; 'world.spawn': { spawn: ModApiSpawn }; 'world.markers': { markers: ModApiMarkers };
  'world.zones': { zones: ModApiZones }; 'mission.register': { missions: ModApiMissions }; 'vehicle.register': { vehicles: ModApiVehicles };
  'character.register': { outfits: ModApiOutfits }; 'player.teleport': { player: Pick<ModApiPlayer, 'teleport'> };
  'player.loadout': { player: Pick<ModApiPlayer, 'giveLoadout'> }; 'camera.cinematic': { camera: ModApiCamera };
  'audio.play': { audio: ModApiAudio }; 'npc.cameo': { npcs: ModApiNpcs }; 'ui.panel': { ui: ModApiUi }; 'ui.hud': { hud: ModApiHud };
  'storage': { storage: ModApiStorage }; 'rules.tick': { rules: Pick<ModApiRules, 'onTick'> };
  'rules.events': { rules: Pick<ModApiRules, 'onEvent' | 'after' | 'finish'> };
}
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

export interface ModContextBase {
  readonly id: ModId; readonly apiVersion: string; readonly tier: 'data' | 'script' | 'ui';
  readonly anchor: { readonly radius: number };                         // the frame's size; positions beyond it are rejected
  readonly rng: ModRng; readonly time: ModTime;
  log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void;  // ≤ 240 chars, 20 lines/s
  str(id: string): string;                                              // string-table lookup for the active language, falls back to English
}
export type ModContext<P extends ModPermission = never> = ModContextBase & UnionToIntersection<PermNamespaces[P]>;

export interface ModDefinition<P extends ModPermission> {
  setup(ctx: ModContext<P>): void;                                      // runs once at load; register handlers here
  migrate?(from: number, to: number, kv: Record<string, JsonValue>): Record<string, JsonValue>;   // storage.schema change
  teardown?(ctx: ModContext<P>): void;                                  // best effort; 20 ms budget
}
export declare function defineMod<P extends ModPermission = never>(def: ModDefinition<P>): ModDefinition<P>;
```

**Rules.** (1) Every method is fire-and-forget or returns a value computed host-side from data the host already holds; none awaits. (2) A call outside the granted set cannot compile, and at runtime the namespace is absent from `ctx`, so `ctx.props` is `undefined` (test `mod-perm-denied`). (3) Positions outside `radius` are clamped for `props`/`spawn`/`markers`, rejected for `teleport`. (4) Handles from `ModEntityRef` are valid only for the mod that created them. (5) `after`, `onTick` and `rng` use sim time and seeded streams only. (6) `log` is the only output channel besides commands. (7) Adding a method, event type or optional field is a minor `MODAPI_VERSION`; removing or changing one is a major bump with the previous major served by an adapter for one release (C§7).

## B§4 Data-tier content schemas

All validated by the shared validators; schema files in `packages/shared/schemas/mod/`.

```ts
import type { WeatherPreset } from './engine-world';
export interface ExperienceAuthored {               // data.experience, `dv-exp/1`; the placement (anchor) is NOT in the archive (C§4)
  schema: 'dv-exp/1';
  title: string /* 3–60 */; summary: string /* ≤ 280 */; tags: string[] /* ≤ 5 */;
  radius: number;                                   // authored extent, 10..250 m; placement may shrink it
  entry: 'on_foot' | 'in_vehicle' | 'either';
  start: AnchorVec3;                                // where the player is placed on entry
  hours?: [number, number]; weather?: WeatherPreset;   // optional entry window (game hours 0..24, C06 preset)
  thumbnail?: string;                               // path to a PNG/WebP asset ≤ 256 KiB, 640×360
  previewAnchor?: { lat: number; lng: number };     // dev loop and sandbox preview only
}
export type SceneOp =
  | { op: 'prop'; prefab: string; at: AnchorVec3; yaw?: number; scale?: number }
  | { op: 'ped'; prefab: string; at: AnchorVec3; yaw?: number; behavior?: 'idle' | 'wander' | 'patrol'; path?: AnchorVec3[] }
  | { op: 'vehicle'; prefab: string; at: AnchorVec3; yaw?: number; parked?: boolean }
  | { op: 'marker'; at: AnchorVec3; icon: 'start' | 'goal' | 'info' | 'shop' | 'danger'; label?: string }
  | { op: 'zone'; id: string; shape: ModZoneShape }
  | { op: 'sign'; at: AnchorVec3; yaw: number; text: string /* string-table id; resolved text ≤ 40 chars, moderated */ }
  | { op: 'audio'; cue: string; at: AnchorVec3; loop?: boolean }
  | { op: 'mission'; file: string };
export interface ModScene { schema: 'dv-scene/1'; ops: SceneOp[] /* ≤ 512 */ }
```

Prefab allowlist: first-party `PrefabDef` ids of kinds `prop`, `ped` (`ped.ambient.*`), `vehicle` (`vehicle.*`, `robotaxi.default`), `pickup`, `marker`, `trigger`, and the mod's own registered ids (`veh.<modId>.<name>`, `outfit.<modId>.<name>`). Never `police.*`, `portal.*`, `player.*`; no firearm prefab exists (D-30). `vehicles/*.json` wrap a C06 `PrefabDef` (kind `vehicle`) plus an S06 `HandlingProfile` clamped to the class limits; `outfits/*.json` wrap S10 wardrobe items on `bay_rig_v1`; both schemas are owned by S06 and S10 and re-exported in the SDK (assumption in the return block). Mission IR files use S03's schema under the `mod` profile. The declarative panel for XR and the L2 fallback:

```ts
export interface PanelDoc { schema: 'dv-panel/1'; title: string /* string id */; body: PanelNode[] /* ≤ 40 nodes, depth ≤ 3 */ }
export type PanelNode =
  | { k: 'text'; text: string /* string id */ } | { k: 'button'; id: string; label: string } | { k: 'list'; items: PanelNode[] }
  | { k: 'progress'; id: string } | { k: 'image'; asset: string /* path of a texture asset */; alt: string };
```
Buttons deliver `{t:'ui', msg:{panel:id}}` to the script; `progress` values are set with `hud.set`.

## B§5 Protocols, host shims, saves, install records

**Script protocol** (`packages/shared/src/contracts/c14-protocol.ts`; every message `{v:1,…}`, schema-tested from both sides; transport is a `MessagePort` pair created by main at session start).

```ts
export type ModFaultReason = 'deadline' | 'memory' | 'stack' | 'throw' | 'protocol' | 'ui' | 'worker-died';
export interface ScriptLimits { deadlineMs: number; memoryBytes: number; stackBytes: number; maxCmds: 64; maxCmdBytes: 8192 }
export interface ModCommand { c: string /* 'props.place' | 'spawn.ped' | … one id per ModAPI method */; ref?: number /* VM-allocated, monotonic */; a: JsonValue[] }

export type ModMsgDown =                                  // sim.worker → mod.worker
  | { v: 1; t: 'init'; modId: ModId; source: string; granted: ModPermission[]; limits: ScriptLimits; seed: number; radius: number; lang: string;
      storage: { schema: number; kv: Record<string, JsonValue> } }
  | { v: 1; t: 'tick'; seq: number; snap: ModSnapshot; events: ModEvent[]; lockstep: boolean }
  | { v: 1; t: 'shutdown' };
export type ModMsgUp =                                    // mod.worker → sim.worker
  | { v: 1; t: 'ready'; tickHz: number | null; events: ModEvent['t'][] }
  | { v: 1; t: 'cmds'; seq: number; cmds: ModCommand[]; usedMs: number }
  | { v: 1; t: 'kv'; patch: Record<string, JsonValue | null> }
  | { v: 1; t: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; msg: string }
  | { v: 1; t: 'fault'; reason: ModFaultReason; detail?: string };
export interface ModFault { modId: ModId; reason: ModFaultReason; detail?: string; atTick: number }
export type UiMsg = { v: 1; t: 'hello'; modId: ModId } | { v: 1; t: 'msg'; d: JsonValue };       // iframe ↔ host over the transferred port; ≤ 4 KiB, 30/s
```

**Host shims** (C01 range 2048–4095, owner S12; scalars only; none is `hashed`, because mod sessions are not canonical): 2048 `ModOwned {mod u16, serial u32, kind u8}` (snapshot `render`), 2049 `ModMarker {icon u8, label u32 str}` (`render`), 2050 `ModZoneRef {zone u32 str}` (`none`); 2051–2111 reserved for host shims; 2112–4095 reserved for data-declared components (deferred, not v1). Mod entities are created with `pfb:<prefabId>:<serial>` keys and are never persisted; persistence is the `mod:<id>` slot only.

**Mod save slot.** `SaveRecord` with `kind:'mod'`, `slot:'mod:<ModId>'` (the C05 slot regex already accepts `ModId`), `schema` = `manifest.storage.schema` (default 1), `data` = `{ kv: Record<string, JsonValue>; meta: { modVersion: SemVer; lastSessionAt: number } }`. `kv` canonical JSON ≤ 1 MiB (half the 2 MiB record cap, so metadata and growth fit). The host flushes at session end and every 60 s when dirty, through `SaveService.write(slot, data, reason)` with reason `modeExit` or `interval`. Capability: `sandbox` sessions may write `mod:*` (C05 rule 3, unchanged); an `exp:` session may write only its own mod's slot (C05 1.1 rule 3, DL-097). A `storage.schema` bump calls `migrate(from, to, kv)` once; a throw keeps the old record and disables the mod for the session.

**Session and load types.**

```ts
export interface ModSessionInfo { mode: 'sandbox' | 'exp'; expId?: string; seed: number; lang: string; tier: QualityTierId;
  anchor?: { lat: number; lng: number; enu: [number, number, number]; groundY: number }; radius: number }
export interface LoadedMod { manifest: ModManifest; version: SemVer; files: ReadonlyMap<string, Uint8Array>; refs: ReadonlyMap<string, AssetRef> /* path → <kind>/mod.<sha12> */ }
```

**Install records** (IndexedDB `dv-mods` v1: store `installed` key `modId`; `journal` key `txId`, index `by_state`; `meta` key `k`).

```ts
export interface ModBudgetReport { tris: number; textureGpuBytes: number; entities: number; renderObjects: number; sceneOps: number;
  scriptBytes: number; uiBytes: number; tiersOk: QualityTierId[] }
export interface InstalledVersion { archive: { name: string; sha256: Sha256; bytes: number }; blobs: Sha256[]; manifest: ModManifest; budget: ModBudgetReport; installedAt: number }
export interface InstalledMod {
  modId: ModId; kind: ModKind; tier: ModTier; name: string;
  active: SemVer; previous?: SemVer; versions: Record<SemVer, InstalledVersion>;
  enabled: boolean; installedFrom: 'store' | 'local'; installedAt: number; updatedAt: number;
  lastRunOk?: SemVer; revoked?: { reason: 'dmca' | 'policy' | 'security'; at: number }; loadOrder: number;
}
export type JournalState = 'begun' | 'staged' | 'committed' | 'aborted';
export interface JournalEntry { txId: string; op: 'install' | 'update' | 'uninstall' | 'rollback' | 'enable' | 'disable'; modId: ModId; from?: SemVer; to?: SemVer;
  state: JournalState; blobs?: Sha256[]; startedAt: number; endedAt?: number; error?: ModErrorCode }
export type InstallSource = { kind: 'store'; modId: ModId; version: SemVer } | { kind: 'local'; blob: Blob; name: string };
export type InstallStep = 'begin' | 'download' | 'verify' | 'stage' | 'commit' | 'gc';
export interface InstallStepEvent { txId: string; step: InstallStep; done: number; total: number; line: string /* one human line for the log and toast */ }
export type InstallResult = { ok: true; modId: ModId; version: SemVer } | { ok: false; code: ModErrorCode; fix: string };
```

OPFS layout: `dv/mods/blobs/<sha256>` (write-once, identity bytes), `dv/mods/staging/<txId>/archive`. Timestamps are epoch ms; ids UUIDv7.

## B§6 C17 — `ExperienceDescriptor`

```ts
// packages/shared/src/contracts/c17-experience.ts
import type { ModId, SemVer, Sha256, ModContentWarning } from './c14-mod';
import type { AnchorVec3 } from './c14-modapi';
import type { WeatherPreset } from './engine-world';
import type { QualityTierId } from '../platform/c13';
import type { ChunkKey, DistrictId } from '../world/c08';

export const C17_VERSION = '1.0.0' as const;
export type ExperienceModeration = 'needs_review' | 'published' | 'rejected' | 'needs_update' | 'unlisted_pending_review' | 'removed';
export type ExperienceVisibility = 'private' | 'unlisted' | 'public';          // owner-only | link only | on the map
export interface ExperienceAnchor { lat: number; lng: number; chunkKey: ChunkKey /* z=9 key, server computes C08 chunkKeyOf(lat, lng) */ }   // (fixed: both present)
export interface ExperienceEntryRules {
  entry: 'on_foot' | 'in_vehicle' | 'either'; start: AnchorVec3; hours?: [number, number]; weather?: WeatherPreset;
}
export interface ExperienceDescriptor {
  id: string;                                  // UUIDv7 of the placement (C12 ids)
  modId: ModId; modVersion: SemVer;            // a placement pins one published version
  anchor: ExperienceAnchor;
  radius: number;                              // metres, 10..250 (fixed ≤ 250)
  entryRules: ExperienceEntryRules;
  rating: { sum: number; count: number };      // sum of ±1 votes and number of votes; up = (count+sum)/2
  moderation: ExperienceModeration;            // server-owned, read-only to clients (fixed)
  visibility: ExperienceVisibility;            // server-owned, read-only to clients (fixed)
  worldVersion?: string; modSha256?: Sha256;   // part of 1.0.0 (DL-090): worldVersion = C08 bakeId the anchor was validated against; archive pin for rebake re-validation
}
/** Route 37 list/detail item: descriptor plus display data read from the pinned version's `dv-exp/1` and manifest. */
export interface ExperienceCard extends ExperienceDescriptor {
  title: string; summary: string; tags: string[]; author: { id: string; display: string };
  thumbUrl?: string;                           // https://ugc.<host>/thumb/<sha256>.webp
  contentWarnings: ModContentWarning[]; tiersOk: QualityTierId[]; aiAssisted: boolean; updatedAt: number;
  nhood: DistrictId;                           // C08 neighbourhood slug of the anchor (server-computed); S10 shows LocKey nhood.<slug> (DL-090)
}
```

`radius` and `entryRules` are the *placement's* values (a placement may shrink the authored radius); `title`, `summary` and thumbnail come from the pinned version. The client builds the `exp:<id>` `GameModeId` from `id`. Ranking uses the Wilson lower bound of `up = (count + sum) / 2` out of `count`.

## B§7 Route DTOs, error codes, limits

Routes 35–37 follow C12 conventions (`ApiError`, cursor pagination `limit ≤ 50`, epoch ms). Types in `packages/shared/src/api/mods.ts` (S09 hosts, S12 owns the semantics). DTOs expose `mods.slug` as `ModId`; database UUIDs never leave the server.

```ts
export interface ModListItem { id: ModId; name: string; summary: string; kind: ModKind; tier: ModTier; author: { id: string; display: string };
  latest: SemVer; installs30d: number; thread?: { id: string; score: number; posts: number }; thumbUrl?: string; aiAssisted: boolean; tiersOk: QualityTierId[]; updatedAt: number }
export interface ModDetail extends ModListItem { versions: { version: SemVer; state: ModVersionState; at: number; changelog: string }[]; license: string; remixAllowed: boolean; credits: ModProvenance['credits']; remixOf?: ModArchiveRef }
export type ModVersionState = 'scanning' | 'rejected' | 'needs_review' | 'published' | 'unlisted_pending_review' | 'yanked' | 'removed';
export interface ModVersionDetail { modId: ModId; version: SemVer; state: ModVersionState; manifest: ModManifest; archiveSha256: Sha256; bytes: number;
  archiveUrl: string /* https://ugc.<host>/ugc/published/<sha256>.zip */; budget: ModBudgetReport; evidence?: 'implemented' | 'tested' | 'seen-in-game' | 'unverified' }
export interface ModVersionsReq { uploadId: string; manifest: ModManifest; changelog: string /* ≤ 2000 */; visibility: 'unlisted' | 'public' /* requested; applied only after approval */;
  attestation: PublishAttestation; placement?: { lat: number; lng: number; radius: number; entryRules: ExperienceEntryRules } }
export interface PublishAttestation { confirmedAt: number; declarations: ModDeclarations; liveHuman: true }
export interface ModVersionsRes { modId: ModId; version: SemVer; state: 'scanning'; moderationItemId: string; experienceId?: string }
export interface RevokedRes { items: { modId: ModId; version?: SemVer; reason: 'dmca' | 'policy' | 'security'; at: number }[]; next?: string }
```

Route 35 query adds `sort` (`new|top|installed`), `tier` (a `QualityTierId` filter on `tiersOk`) and `limit` (C12 1.1, `09-backend-contracts-1.1.md` §1); route 36 returns 202 `ModVersionsRes` and is idempotent per `(modId, version)` (a changed archive under a published version is `409 conflict`); route 37 `GET` takes `chunk=<z/x/y>` (comma list ≤ 9 keys) or `bbox=minLng,minLat,maxLng,maxLat` and returns only `moderation:'published' ∧ visibility:'public'` for anonymous callers, plus the caller's own placements with their states; route 37 `POST` body `{modId, modVersion, anchor:{lat,lng}, radius, entryRules, visibility}` (a later placement of an already published version).

```ts
export type ModCheckCode =
  | 'envelope.zip_bomb' | 'envelope.entries' | 'envelope.path' | 'envelope.nested_archive' | 'type.banned_format' | 'type.magic_mismatch'
  | 'schema.invalid' | 'perm.unknown' | 'perm.tier' | 'perm.missing' | 'asset.hash' | 'asset.unlisted' | 'asset.kind'
  | 'prov.missing' | 'prov.invalid' | 'prov.licence' | 'prov.endpoint_banned' | 'likeness.tier' | 'secret.found'
  | 'ip.signature' | 'ip.string' | 'cap.size' | 'cap.ops' | 'cap.entities' | 'cap.budget' | 'script.size' | 'script.lint'
  | 'compat.api' | 'compat.world' | 'remix.licence' | 'anchor.outside_sf' | 'anchor.not_public_land' | 'anchor_residential' | 'anchor.address_string';
export type ModErrorCode = ModCheckCode | 'install.hash_mismatch' | 'install.quota' | 'install.offline' | 'install.revoked' | 'install.tier_unsupported'
  | 'load.room' | 'load.story' | 'load.flag_off' | 'publish.attestation' | 'publish.flag_off' | 'publish.rate';
export interface ModFinding { code: ModCheckCode; severity: 'error' | 'warn' | 'review'; file?: string; line?: number; message: string; fix: string }
export interface ModCheckResult { ok: boolean; findings: ModFinding[]; budget: ModBudgetReport; tool: { name: '@dv/shared/mod/check'; version: string } }
```

**`config/mod-limits.json`** (schema-validated, read by validators, loader and `dv`; S12 design values, calibrated in M13a1/M13a3/M13a4):

```jsonc
{ "schema": 1,
  "archive": { "maxBytes": 134217728, "maxEntries": 2000, "maxUncompressedBytes": 536870912, "maxRatio": 100 },
  "install": { "maxPackages": 64, "maxCombinedBytes": 536870912 },
  "manifest": { "maxBytes": 524288, "maxAssets": 256 },
  "script": { "maxBytes": 262144, "maxCmdsPerTick": 64, "maxCmdBytes": 8192, "maxTickHz": 10 },
  "ui": { "maxHtmlBytes": 524288, "msgBytes": 4096, "msgPerSec": 30 },
  "scene": { "maxOps": 512 }, "storage": { "maxBytes": 1048576, "maxKeys": 64, "maxValueBytes": 65536 },
  "experience": { "maxRadiusM": 250, "minRadiusM": 10, "maxPlacementsPerVersion": 3 },
  "tiers": { "desktop-ultra": { "deadlineMs": 4, "memoryBytes": 33554432, "scriptMods": 4, "entities": 96, "renderObjects": 24, "textureMB": 160, "tris": 300000 } /* … one row per C13 tier, values in main §5.4 */ } }
```
