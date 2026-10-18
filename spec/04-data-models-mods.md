# 04 — Data models, part 9: C14 ModManifest and ModAPI, C17 ExperienceDescriptor

> Wave 5 integration (Architect), 2026-10-18. Part of `spec/04-data-models.md`. Text at 06 v1.1, copied verbatim from `spec/domains/12-modding-contracts.md` B§1–B§7 (S12). The owner spec stays normative; the closed permission table (B§1), cross-field validator rules (B§2) and `config/mod-limits.json` (B§7) are cited, not copied. The experience-descriptor JSON Schema is integration text derived from the C17 TypeScript; the TypeScript wins on any difference.

## C14 — `ModManifest` + `ModAPI`

| Field | Value |
|---|---|
| Owner · version | S12 · `C14` 1.0.0; manifest format `dv-mod/1`; `MODAPI_VERSION` 1.0.0; script protocol `ModMsg v1` |
| Source paths | `packages/shared/src/contracts/c14-mod.ts`, `contracts/c14-modapi.ts`, `contracts/c14-protocol.ts`; schemas `packages/shared/schemas/mod/manifest.v1.schema.json` and the data-tier schemas beside it; route DTOs `packages/shared/src/api/mods.ts`; validators `@dv/shared/mod/check` |
| Defined in | `12-modding-contracts.md` B§1–B§5, B§7 |
| Created in | M13a1 (types, schemas, validators, `dv mod check`) |
| Consumers | S03, S05, S09, S10, S11; milestones M13a1, M13a2, M13a3, M13a4, M13a5, M13a6, M13a7, M13b2, M13b3, M13c2, M13c3 |

Gating (DL-151, 06 §5): `ugc.publish` stays false in production until the M13d1 ACs pass; `mods.enabled`, `mods.script`, `mods.ui` stay off until the M13a3, M13a4 and M13a5 records pass. Mods are refused in rooms (C11 close 4007) and persist only in `mod:<ModId>`.

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

**Runtime JSON Schema — mod manifest** (`packages/shared/schemas/mod/manifest.v1.schema.json`, draft 2020-12, compiled to standalone validators at build; `$defs` for `ProvenanceRecord` reference `provenance-1.0`):

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

`ModAPI` v1 (permission-narrowed facade over a capability-filtered `ModeContext`; positions are anchor-relative; `JsonValue` comes from C05 since DL-194):

```ts
// packages/shared/src/contracts/c14-modapi.ts
import type { ModId, ModPermission } from './c14-mod';
import type { CinematicShot } from './c04-camera';
import type { HeatLevel } from './engine-pursuit';
import type { WeatherPreset } from './engine-world';
import type { JsonValue } from './c05-save'; export type { JsonValue };   // C05 owns the JSON value type; re-exported unchanged for the SDK (DL-194)

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

Data-tier content schemas:

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

```ts
export interface PanelDoc { schema: 'dv-panel/1'; title: string /* string id */; body: PanelNode[] /* ≤ 40 nodes, depth ≤ 3 */ }
export type PanelNode =
  | { k: 'text'; text: string /* string id */ } | { k: 'button'; id: string; label: string } | { k: 'list'; items: PanelNode[] }
  | { k: 'progress'; id: string } | { k: 'image'; asset: string /* path of a texture asset */; alt: string };
```

Script protocol (`c14-protocol.ts`; every message `{v:1,…}`, transport a `MessagePort` pair):

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

Host shims use C01 ids 2048 `ModOwned`, 2049 `ModMarker`, 2050 `ModZoneRef` (none hashed). Mod save slot: `SaveRecord` `kind 'mod'`, `slot 'mod:<ModId>'`, `schema = manifest.storage.schema`, `data = {kv, meta:{modVersion, lastSessionAt}}`, `kv` ≤ 1 MiB.

Session and load types:

```ts
export interface ModSessionInfo { mode: 'sandbox' | 'exp'; expId?: string; seed: number; lang: string; tier: QualityTierId;
  anchor?: { lat: number; lng: number; enu: [number, number, number]; groundY: number }; radius: number }
export interface LoadedMod { manifest: ModManifest; version: SemVer; files: ReadonlyMap<string, Uint8Array>; refs: ReadonlyMap<string, AssetRef> /* path → <kind>/mod.<sha12> */ }
```

Install records (IndexedDB `dv-mods` v1: `installed` key `modId`; `journal` key `txId`, index `by_state`; `meta` key `k`; OPFS `dv/mods/blobs/<sha256>`, `dv/mods/staging/<txId>/archive`):

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

Route DTOs (routes 35–37 and 53; `mods.slug` is exposed as `ModId`, database UUIDs never leave the server):

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

Check and error codes:

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

## C17 — `ExperienceDescriptor`

| Field | Value |
|---|---|
| Owner · version | S12 · `C17_VERSION = '1.0.0'` |
| Source path | `packages/shared/src/contracts/c17-experience.ts`; schema `packages/shared/schemas/mod/experience-descriptor.v1.schema.json` |
| Defined in | `12-modding-contracts.md` B§6, B§7 |
| Created in | M13a1 (types, schema); route 37 storage M13a2; map markers and web tiles M13b2 |
| Consumers | S02, S09, S10; milestones M13a2, M13a3 (`exp:<id>` sessions), M13a7 (store pages), M13b2, M13b3, M13b4 |

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

Moderation and visibility are server-owned and read-only to clients. Ranking uses the Wilson lower bound of `up = (count + sum) / 2` out of `count`. Route 37 `GET` takes `chunk=<z/x/y>` (≤ 9 z=9 keys) or `bbox=minLng,minLat,maxLng,maxLat` and returns `moderation:'published' ∧ visibility:'public'` to anonymous callers; route 37 `POST` takes `{modId, modVersion, anchor:{lat,lng}, radius, entryRules, visibility}` and the server computes `chunkKey`, `nhood`, `worldVersion` and `modSha256`. Storage: table `experiences` in migration 0007 (part 10).

**Runtime JSON Schema — experience descriptor** (draft 2020-12; validates stored descriptors and route 37 responses; the route 37 `POST` body schema is generated from the DTO by `tools/ci/gen-api-schemas.ts`; the cross-field rule `|start.x|, |start.z| ≤ radius` and anchor checks `anchor.outside_sf`, `anchor.not_public_land`, `anchor_residential` are validator code):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"experience-descriptor-1","type":"object","additionalProperties":false,
 "required":["id","modId","modVersion","anchor","radius","entryRules","rating","moderation","visibility"],
 "properties":{
  "id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"},
  "modId":{"type":"string","maxLength":41,"pattern":"^[a-z0-9][a-z0-9-]{1,19}\\.[a-z0-9][a-z0-9-]{1,19}$"},
  "modVersion":{"type":"string","pattern":"^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$"},
  "anchor":{"type":"object","additionalProperties":false,"required":["lat","lng","chunkKey"],"properties":{
    "lat":{"type":"number","minimum":-90,"maximum":90},"lng":{"type":"number","minimum":-180,"maximum":180},
    "chunkKey":{"type":"string","pattern":"^9/[0-9]{1,3}/[0-9]{1,3}$"}}},
  "radius":{"type":"number","minimum":10,"maximum":250},
  "entryRules":{"type":"object","additionalProperties":false,"required":["entry","start"],"properties":{
    "entry":{"enum":["on_foot","in_vehicle","either"]},
    "start":{"type":"array","prefixItems":[{"type":"number"},{"type":"number"},{"type":"number"}],"minItems":3,"maxItems":3},
    "hours":{"type":"array","prefixItems":[{"type":"number","minimum":0,"maximum":24},{"type":"number","minimum":0,"maximum":24}],"minItems":2,"maxItems":2},
    "weather":{"enum":["clear","karl-fog","overcast","rain","smoke","golden"]}}},
  "rating":{"type":"object","additionalProperties":false,"required":["sum","count"],"properties":{
    "sum":{"type":"integer"},"count":{"type":"integer","minimum":0}}},
  "moderation":{"enum":["needs_review","published","rejected","needs_update","unlisted_pending_review","removed"]},
  "visibility":{"enum":["private","unlisted","public"]},
  "worldVersion":{"type":"string","pattern":"^[0-9a-f]{64}$"},
  "modSha256":{"type":"string","pattern":"^[0-9a-f]{64}$"}}}
```
`ExperienceCard` (route 37 list and detail items) extends this schema with `title`, `summary`, `tags`, `author {id, display}`, `thumbUrl?`, `contentWarnings`, `tiersOk` (C13 `QualityTierId[]`), `aiAssisted`, `updatedAt` (epoch ms) and `nhood` (C08 `DistrictId`).
