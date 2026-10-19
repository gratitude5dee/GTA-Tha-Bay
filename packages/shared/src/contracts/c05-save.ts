/**
 * C05 SaveGame (spec/domains/01-engine-save-modes.md, 1.1.0 plus the 1.2 optional `state`). Types and constants only.
 * Copied from the owner section; see BD-M04a1-01 for the one import-path difference (c06-ids.ts).
 */
import type { GameModeId, UnlockEventId } from './c06-ids.ts';
import type { ControlsSettings } from './c03-input.ts';
import type { WeatherPreset } from './engine-world.ts';
import type { XrComfortSettings } from '../platform/xr-comfort.ts';

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
  property: { safehouses: string[]; businesses: { id: string; level: number; state?: JsonObject /* 1.2 (M05e1): S03 business state, canonical JSON <= 2,048 bytes */ }[] };
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
  npc?: { voice: 'all' | 'heroes' | 'off'; aiDialogue: boolean };    // 1.1 (S04)
  cutscenes?: { generated: boolean; audio: 'generated' | 'engine' };  // 1.1 (S03)
  privacy: { cameraFeatures: boolean; parentalConsent: boolean };   // telemetry consent is device-scoped (S11 PlatformSettings.telemetryConsent): events fire before a profile loads
}

export type SaveReason = 'missionPass' | 'safehouse' | 'modeExit' | 'interval' | 'hidden' | 'manual' | 'settings' | 'unlock' | 'import' | 'migration' | 'checkpoint';   // 1.1 adds 'checkpoint'
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
