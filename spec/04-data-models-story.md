# 04 — Data models, part 5: C09 MissionScript and cutscenes

> Wave 5 integration (Architect), 2026-10-18. Part of `spec/04-data-models.md`. Text at 06 v1.1, copied verbatim from `spec/domains/03-story-missions.md` §C1–§C4 and `spec/domains/03-story-cutscenes.md` §D2 (S03). The owner specs stay normative; cache-key rules (§D3) and the player protocol (§D7) are cited, not copied.

## C09 — `MissionScript` + cutscenes

| Field | Value |
|---|---|
| Owner · version | S03 · `C09_VERSION = '1.0.0'` (re-exported by `c09-cutscene.ts`) |
| Source paths | `packages/shared/src/contracts/c09-mission.ts`, `contracts/c09-cutscene.ts`, `genai/cutscene-key.ts`; schema `packages/shared/schemas/mission-ir-1.schema.json`; authoring builder `packages/modes/story/src/authoring/` (re-exported by `@dv/mod-sdk`) |
| Defined in | `03-story-missions.md` §C1–§C4; `03-story-cutscenes.md` §D2, §D3, §D7 |
| Created in | M04c (`CutsceneManifest`, `PreparedClip` types and fixtures); M05a1 (IR, VM, schema); M05b2 (`cutsceneKey`, index, player) |
| Consumers | S04, S05, S06, S07, S09, S10, S11, S12; milestones M04c, M05a1, M05a2, M05b1, M05b2, M05c1, M05c3, M06a3 (talk ops), M07b2 (`cut.race.intro.<raceId>`), M08b2 (fight sequences), M11b2 family (XR hosts), M13a3 (`mod` validation profile) |

**Files, ids and versions** (§C1): IR asset `data/mission.<missionId>` (`schema: 'mission-ir/1'`) plus `data/story.index` and `data/lines.<act>.<lang>`, all C07 catalog assets with `origin: 'authored'` provenance (DL-161). `MissionId` `^m\.[a-z0-9][a-z0-9.-]{1,80}$` (story `m.a<act>.<nn>`, mods `m.mod.<modId>.<name>`); persistent entities `mis:<missionId>:<castName>`; story components 512–515; checkpoints carry `mission.version` and `worldBake`.

Authoring API (illustrative; builds data only, never executed at runtime):

```ts
// content/missions/m.a1.02/mission.ts — illustrative, abbreviated
export default defineMission({
  id: 'm.a1.02', version: 1, act: 1, district: 'd1', title: 'mission.m.a1.02.title',
  giver: { phone: 'x_ramos' }, requires: [passed('m.a1.01')],
  cast: { fare: npc({ soul: 'ama_osei', role: 'civilian', spawn: at(37.7764, -122.3942) }),
          rival: vehicle({ prefab: 'robotaxi.default', spawn: at(37.7766, -122.3950), role: 'rival' }) },
  zones: { pickup: circle(37.7764, -122.3942, 12), dropoff: landmark('lm.bart-24th', 15) },
  stages: [
    stage('pickup', [goto('pickup', { inVehicle: 'any', stopped: true })]),
    stage('race-eta', [deliver('fare', 'dropoff')], { timeLimitSec: 240, onEnter: [task('rival', driveTo('dropoff'))] }),
    stage('lose-patrol', [escape()], { onEnter: [heat({ set: 1 })], checkpoint: true }),
  ],
  fail: [failWhen(ko('fare'), 'fail.reason.fare_hurt'), failWhen(busted(), 'fail.reason.busted')],
  heatPolicy: { maxHeat: 2, clearOnPass: true }, rewards: { cashCents: 120_000, streetCred: 20 },
  unlocks: ['unlock.district.d1', 'unlock.district.d2'],
  autoplay: { expectedSec: [300, 720], seeds: [1, 2, 3] },
});
```

IR types (normative):

```ts
// packages/shared/src/contracts/c09-mission.ts
export const C09_VERSION = '1.0.0' as const;
export type MissionId = `m.${string}`;
export type LocKey = string;                       // ^[a-z0-9_.-]{1,96}$; resolved by S10's i18n
export type LineId = `line.${string}`;             // key into lines.<lang>.json; every line has subtitle text
export type CastName = string;                     // ^[a-z][a-z0-9_]{0,31}$
export type ZoneName = string;                     // same pattern
export type { LandmarkId } from '../world/c08';    // C08 owns the id space (S02, DL-077)
export type MissionDistrictId = 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'd7' | 'd8' | 'd9' | 'd10';   // gameplay districts, a subset of C08 DistrictId
export type LatLngTuple = [lat: number, lng: number];   // WGS84 in authored data only (06 §4.3); the compiler converts to C08 `LatLng` {lat, lng} (c08-api.ts) for WorldResolver
export type RosterSlot = 'RAP_HYPHY_ELDER' | 'RAP_LYRICIST' | 'RAP_NEW_WAVE' | 'RAP_COLLECTIVE' | 'TECH_VISIONARY'
  | 'TECH_HACKER' | 'TECH_VC' | 'ATH_SHOOTER' | 'ATH_POWER_BACK' | 'INFLUENCER';   // the one roster-slot type; S07 FighterSlotId = RosterSlot | 'PLAYER_FIGHTER' (DL-163)
export type CastRole = 'ally' | 'mentor' | 'rival' | 'host' | 'opponent' | 'cameo' | 'antagonist' | 'civilian' | 'unit';
export type Who = 'player' | 'playerVehicle' | CastName;
type HeatLevel = import('./engine-pursuit').HeatLevel;
type WeatherPreset = import('./engine-world').WeatherPreset;
type UnlockEventId = import('./c06-modes').UnlockEventId;
type JsonObject = import('./c05-save').JsonObject;

export interface MissionIR {
  schema: 'mission-ir/1';
  id: MissionId; version: number; worldBake: string; act: 1 | 2 | 3 | 0;   // 0 = mod / experience mission
  premise: 'hella-valuation' | 'mod';
  title: LocKey; district: MissionDistrictId; tags: string[];
  giver: { npc: CastName } | { phone: string /* soul id */ } | { world: true };
  requires: Pred[];                                 // all must hold for 'available'
  start: Trigger;
  cast: Record<CastName, CastDef>;                  // ≤ 32
  zones: Record<ZoneName, ZoneDef>;                 // ≤ 48
  intro?: BeatRef; outro?: BeatRef;                 // Part D CutsceneRef ids or in-engine DirectorScript ids
  stages: StageDef[];                               // 1–16, run in order unless a talk outcome jumps
  threads?: Record<string, Op[]>;                   // mission-wide background threads (≤ 8), started at stage 0
  fail: FailRule[];
  heatPolicy: { maxHeat: HeatLevel; clearOnPass: boolean; startHeat?: HeatLevel };
  ambient?: { traffic?: number; peds?: number; lock?: { hour?: number; weather?: WeatherPreset } }; // multipliers 0..1
  rewards: Rewards; medals?: { silverSec: number; goldSec: number; goldIf?: Pred };
  unlocks?: UnlockEventId[];                        // emitted on pass, idempotent
  modeHooks?: ModeHook[];                           // referenced by 'mode' objectives
  autoplay: { expectedSec: [min: number, max: number]; seeds: [number, number, number] };
  lines: LineId[];                                  // every line the mission may show or speak (lint target)
}

export type Trigger =
  | { k: 'marker'; at: Placement; radiusM: number; onFoot?: boolean; hours?: [from: number, to: number] } // InteractKind.MissionStart
  | { k: 'phone'; contact: string /* soul id */; delaySec?: number }      // Contacts/Messages app
  | { k: 'auto'; when: Pred }                                             // chained, e.g. after the previous mission
  | { k: 'mode'; mode: 'sandbox' | `exp:${string}` };                     // mod/experience missions only

export interface Placement { at: LatLngTuple | { landmark: LandmarkId }; yawDeg?: number; snap: 'ground' | 'road' | 'sidewalk' | 'none'; y?: number }

export type CastDef =
  | { k: 'npc'; who: { soul: string } | { slot: RosterSlot }; role: CastRole; spawn?: Placement; prefab?: string; spawnAt?: 'start' | 'manual' }
  | { k: 'vehicle'; prefab: string; spawn: Placement; role?: CastRole; playerUsable?: boolean; spawnAt?: 'start' | 'manual' }
  | { k: 'prop' | 'pickup'; prefab: string; spawn: Placement; item?: string; spawnAt?: 'start' | 'manual' }
  | { k: 'unit'; prefab: `police.${string}`; spawn: Placement; spawnAt?: 'start' | 'manual' };   // named police unit

export type ZoneDef =
  | { k: 'circle'; at: LatLngTuple; r: number }                                // r 2–2,000 m
  | { k: 'poly'; ring: LatLngTuple[]; yMin?: number; yMax?: number }           // 3–64 points
  | { k: 'landmark'; id: LandmarkId; r?: number }
  | { k: 'route'; via: LatLngTuple[]; widthM: number }                         // snapped to C08 road edges at load → ZoneShape 'edges'
  | { k: 'cast'; cast: CastName; r: number };                             // moving circle; evaluated by the VM as a distance test, never registered with ZoneService

export interface StageDef {
  id: string; join: 'all' | 'any' | 'sequence';
  objectives: ObjectiveDef[];                       // 1–12
  onEnter?: Op[]; onComplete?: Op[];
  timeLimitSec?: number;                            // × ProfileSettings.accessibility.timerScale
  checkpoint?: boolean;                             // snapshot on entry (default true for stage 0 and every stage with heat)
  conduct?: 'lawful' | 'unlawful';                  // compiler infers 'unlawful' if any escape/stealth/heat; see §C11
  next?: string;                                    // default: following stage
}

export type ObjectiveDef = { id: string; text: LocKey; optional?: boolean; marker?: boolean } & (
  | { k: 'goto'; zone: ZoneName; onFoot?: boolean; inVehicle?: CastName | 'any'; stopped?: boolean }
  | { k: 'enterVehicle'; vehicle: CastName | 'any' }
  | { k: 'follow'; target: CastName; band: [near: number, far: number]; loseAfterSec: number; untilZone?: ZoneName; untilEvent?: string }
  | { k: 'chase'; target: CastName; catchDist: number; holdSec?: number }
  | { k: 'escape'; untilHeat: 0 }
  | { k: 'survive'; sec: number }
  | { k: 'collect'; cast: CastName }
  | { k: 'deliver'; cast: CastName; to: ZoneName; fragile?: number /* max damage 0..1 */ }
  | { k: 'protect'; target: CastName; minHealth: number; sec?: number; untilZone?: ZoneName }
  | { k: 'talk'; talk: TalkDef }
  | { k: 'photo'; subject: CastName | LandmarkId; framing?: 'any' | 'wide' | 'selfie'; maxDistM?: number }
  | { k: 'stealth'; zone: ZoneName; detectBudget: number; autoplayPath: LatLngTuple[] }
  | { k: 'defeat'; targets: CastName[]; nonLethal: true }
  | { k: 'score'; metric: 'drift' | 'airtime' | 'nearMiss'; target: number; withinSec: number }
  | { k: 'wait'; sec: number }
  | { k: 'mode'; hook: string /* ModeHook.id */ });

export interface TalkDef {                           // §C7
  id: string; npc: CastName; intent: LocKey;          // short goal shown to the player and sent as context
  outcomes: Record<string, { stage?: string; flags?: Record<string, boolean | number | string>; trust?: number; label: LocKey; when?: TalkUnlock }>;
  default: string;                                    // outcome used offline/timeout/CI when no choice is made
  maxTurns: number;                                   // 1–12
  ink: string;                                        // knot `mission_<missionId>_<talkId>` in the NPC's ink story (S04)
}
export interface TalkUnlock { actions?: NpcAction[]; minTrust?: number; mood?: string[] } // gates an outcome behind NPC effects
export type NpcAction = 'none' | 'offer_mission' | 'offer_race' | 'offer_fight' | 'offer_deal' | 'give_item' | 'sell' | 'refuse'
  | 'call_police' | 'flee' | 'attack' | 'follow' | 'leave';  // C10 effects.action set [research/ai-npc-runtime.md §2.4]

export interface ModeHook {                          // C06 rules 2 and 5; §C8
  id: string; mode: 'racing' | 'fighter' | 'tycoon'; defId: string; params?: JsonObject;
  passOn: ('win' | 'finish' | 'lose' | 'quit')[];   // ModeResult.outcome values that pass the objective
  stub: ObjectiveDef;                                // never k:'mode'; used when the mode cannot run
  unlockOnFirstEncounter?: UnlockEventId;
  retry: 'hook' | 'checkpoint';
}

export interface FailRule { when: Pred; reason: LocKey; retry: 'checkpoint' | 'start' }
export interface Rewards {
  cashCents?: number; streetCred?: number; techClout?: number;
  items?: { id: string; qty: number }[]; vehicles?: string[] /* prefab ids → garage */; safehouse?: string;
  trust?: { npc: string /* soul id */; delta: number }[];
}
export type BeatRef = { cutscene: string /* CutsceneRefId, Part D */ } | { director: string /* DirectorScript id */ };

export type Op =
  | { op: 'seq'; body: Op[] } | { op: 'all'; branches: Op[][] } | { op: 'race'; branches: Op[][] }
  | { op: 'if'; cond: Pred; then: Op[]; else?: Op[] }
  | { op: 'loop'; max: number; until?: Pred; body: Op[] }                     // max ≤ 10,000
  | { op: 'wait'; sec: number } | { op: 'waitUntil'; cond: Pred; timeoutSec?: number; onTimeout?: Op[] }
  | { op: 'waitEvent'; event: string; timeoutSec?: number }
  | { op: 'spawn' | 'despawn'; cast: CastName[] }
  | { op: 'task'; cast: CastName; task: NpcTask }
  | { op: 'say'; speaker: CastName | 'player' | 'radio'; line: LineId; wait?: boolean }
  | { op: 'text'; from: string /* soul id */; line: LineId }                  // phone message
  | { op: 'marker'; target: CastName | ZoneName; kind: 'objective' | 'destination' | 'target' | 'avoid'; on: boolean }
  | { op: 'beat'; ref: BeatRef }                                             // cutscene or in-engine sequence (Part D)
  | { op: 'camera'; shot: string /* DirectorShot preset */ | 'release'; subject?: Who; sec?: number }
  | { op: 'fade'; to: 0 | 1; sec: number }
  | { op: 'heat'; set?: HeatLevel; cap?: HeatLevel; clear?: true; unit?: CastName }
  | { op: 'clock'; lock?: { hour?: number; weather?: WeatherPreset }; unlock?: true }
  | { op: 'ambient'; traffic?: number; peds?: number }
  | { op: 'flag'; set: Record<string, boolean | number | string> }
  | { op: 'trust'; npc: CastName; delta: number }
  | { op: 'give'; items?: { id: string; qty: number }[]; cashCents?: number; idem: string }
  | { op: 'emit'; event: string }                                            // mission-scoped event, recorded
  | { op: 'pass' } | { op: 'fail'; reason: LocKey };

export type NpcTask =
  | { t: 'goto'; zone: ZoneName; mode: 'walk' | 'run' | 'drive' } | { t: 'driveTo'; zone: ZoneName; style: 'normal' | 'fast' | 'flee' }
  | { t: 'follow'; who: Who; distM: number } | { t: 'enterVehicle'; vehicle: CastName; seat: number } | { t: 'leaveVehicle' }
  | { t: 'anim'; clip: string /* AnimGraph state */; loop?: boolean } | { t: 'look'; who: Who } | { t: 'idle' } | { t: 'flee'; from: Who };

export type Pred =
  | { p: 'and' | 'or'; of: Pred[] } | { p: 'not'; of: Pred } | { p: 'true' }
  | { p: 'inZone'; who: Who; zone: ZoneName } | { p: 'inVehicle'; who: Who; vehicle?: CastName | 'any' }
  | { p: 'near'; a: Who; b: Who; maxM: number } | { p: 'far'; a: Who; b: Who; minM: number }
  | { p: 'health'; who: Who; below: number } | { p: 'ko'; who: Who } | { p: 'destroyed'; cast: CastName }
  | { p: 'busted' } | { p: 'heat'; min?: HeatLevel; max?: HeatLevel; phase?: 'clear' | 'pursuit' | 'search' | 'cooldown' }
  | { p: 'speed'; who: Who; minMps?: number; maxMps?: number }
  | { p: 'hour'; from: number; to: number } | { p: 'weather'; is: WeatherPreset[] }
  | { p: 'flag'; key: string; eq?: boolean | number | string; gte?: number }
  | { p: 'trust'; npc: string; gte?: number; lte?: number } | { p: 'item'; id: string; gte: number } | { p: 'cash'; gteCents: number }
  | { p: 'objective'; id: string; state: 'active' | 'done' | 'failed' } | { p: 'stageTime'; gteSec?: number; lteSec?: number }
  | { p: 'event'; name: string; since: 'stage' | 'mission' } | { p: 'modeResult'; hook: string; outcome: string[] }
  | { p: 'passed'; mission: MissionId } | { p: 'act'; gte: 1 | 2 | 3 } | { p: 'unlocked'; id: UnlockEventId };

export interface MissionCheckpointV1 {               // stored opaque as StorySlice.activeMission.checkpoint = {schema: 1, data}
  missionId: MissionId; version: number; worldBake: string;
  stage: number; attempt: number; seed: number; rng: [number, number, number, number];
  elapsedSec: number;                               // mission clock, cutscenes excluded
  flags: Record<string, boolean | number | string>; objectivesDone: string[]; talkResults: Record<string, string>;
  player: { x: number; y: number; z: number; yaw: number; health: number; vehicle?: CastName | `garage:${string}` };
  cast: Record<CastName, { alive: boolean; x?: number; y?: number; z?: number; yaw?: number; inVehicle?: CastName; health?: number }>;
  walletDeltaCents: number;                         // credited mid-mission via idempotent 'give', restored on retry
}
export type MissionPhase = 'available' | 'starting' | 'intro' | 'stage' | 'outro' | 'passed' | 'failed' | 'aborted';
export interface MissionIndexRow { id: MissionId; act: number; district: MissionDistrictId; title: LocKey; giver: MissionIR['giver'];
  requires: Pred[]; start: Trigger; asset: `data/mission.${string}`; version: number; tags: string[] }
```

Cutscene types (normative):

```ts
// packages/shared/src/contracts/c09-cutscene.ts  (C09_VERSION re-exported from c09-mission.ts)
import type { LineId, CastName, LatLngTuple } from './c09-mission';
import type { LandmarkId } from '../world/c08';
type LikenessTier = import('../assets/c07').LikenessTier;      // consented | parody | fictionalized | original (C07)
type AssetRef = import('../assets/c07').AssetRef;

export type CutsceneHook = 'story.establish' | 'story.beat' | 'fight.walkin' | 'fight.faceoff' | 'fight.special'
  | 'fight.super' | 'fight.shutdown' | 'fight.ending' | 'race.intro';
export type CutsceneRefId = `cut.${string}`;   // cut.story.<missionId>.<beat> · cut.fight.walkin.<char>.<stage> · cut.fight.faceoff.<a>.<b>
                                               // cut.fight.<special|super|shutdown>.<char>.<move> · cut.fight.ending.<char> · cut.race.intro.<raceId>
export interface CueSpec { line: LineId; speaker?: string /* soul id */; startMs: number; endMs: number; kind: 'dialogue' | 'sdh' }
export interface CutsceneRef {
  id: CutsceneRefId; hook: CutsceneHook;
  template: `${string}@${number}`;             // content/prompts/genai/<name>@<n>.md
  cast: string[];                              // soul ids, sorted; never the player avatar or a user NPC
  stage: string | null;                        // `<stageId|beat.<refId>|race.<raceId>>@<ver>`
  move: string | null;                         // `<moveId>@<ver>` (fighter hooks)
  slots: Record<string, string>;               // authored slot text (§D4), versioned by the beat revision
  fallback: string;                            // DirectorScript id; required
  cues: CueSpec[];                             // shared by video and fallback
  audio: 'engine' | 'generated-ambient';       // §D7
  prefetch: 'onTrigger' | 'onObjective' | 'onSelect' | 'none';
  priority: 1 | 2 | 3 | 4;                     // prewarm order (§D9)
  skippable: true;
}
export interface CutsceneKeyInput {             // A-03, exactly these eight properties
  template: `${string}@${number}`;
  characters: { id: string; soulVersion: number; likenessTier: LikenessTier }[];  // sorted by id, unique
  move: string | null; stage: string | null;
  style: `${string}@${number}`;                // style bible, e.g. 'bay-cel@1'
  endpoint: `${string}@${string}`;             // endpointId@pinnedUpdatedAt from config/genai-endpoints.json
  seed: number;                                // u32
  inputHashes: string[];                       // sorted lowercase SHA-256 of input files, never URLs
}
/** sha256Hex(canonicalize(normalizeKeyInput(i))) — packages/shared/src/genai/cutscene-key.ts; pure and synchronous. */
export declare function cutsceneKey(i: CutsceneKeyInput): string;
export declare function normalizeKeyInput(i: CutsceneKeyInput): CutsceneKeyInput;   // sorts, dedupes, lowercases; throws on bad input

export interface CutsceneIndexEntry {
  ref: CutsceneRefId; key: string; keyInput: CutsceneKeyInput; provider: string /* registry provider key */;
  characters: { id: string; soulVersion: number; tier: LikenessTier }[];
  durationMs: number; fallback: string; cues: CueSpec[]; audio: CutsceneRef['audio']; stale?: true;
}
export interface CutsceneIndex {                // shipped as C07 asset data/cutscene-index; rows also feed S09's cutscene_catalog
  schema: 'cutscene-index/1'; release: string; builtAt: number; entries: CutsceneIndexEntry[];
}
export interface ShotPlan {                     // private; S05's keyframe + video steps consume it
  shotId: string; durationS: 6 | 7 | 8 | 9 | 10; prompt: string; keyframePrompt: string;
  inputs: { role: 'style' | 'sheet' | 'plate' | 'keyframe'; sha256: string; subject?: string }[];
  camera: 'static' | 'push-in' | 'pull-out' | 'pan' | 'orbit' | 'tracking'; subjects: string[];
}
export interface CutsceneRequest {               // private build artifact cutscene-requests.json → prewarm → GenJob(kind 'cutscene_shot')
  schema: 'cutscene-request/1'; key: string; keyInput: CutsceneKeyInput; ref: CutsceneRefId; hook: CutsceneHook;
  templateSha256: string; shots: ShotPlan[]; cues: CueSpec[]; audio: CutsceneRef['audio'];
  characters: CutsceneIndexEntry['characters']; priority: CutsceneRef['priority']; budgetUsdMicros: number;
}
export interface Rendition { file: string /* relative to cutscenes/<key>/ */; bytes: number; sha256: string; codecs: string; kbps: number }
export interface CutsceneManifest {              // R2 cutscenes/<key>/manifest.json, written last (06 §4.4 fixed)
  schema: 'cutscene-asset/1'; key: string; recipe: 'cut@1';
  fps: 24; frames: number; width: number; height: number;
  renditions: Partial<Record<'v540' | 'v768' | 'v1080' | 'p720', Rendition>>;  // p720 only with degraded: true
  audio?: { file: 'a.m4a'; lufs: number; speechDetected: boolean; approvedBy?: string };   // optional: absent when the ref's audio is 'engine' (06 v1.1 C09 line, DL-082)
  poster: 'poster.webp'; last: 'last.webp'; subs: Record<string /* BCP 47 */, string /* subs.<lang>.vtt */>;
  shots: { shotId: string; startFrame: number; frames: number }[];
  characters: { id: string; soulVersion: number; tier: LikenessTier }[];
  licence: { gate: 'ADR-GENAI-01'; provider: string; status: 'cleared' | 'pending'; termsSnapshotSha256: string[];
    clearedBy?: string; clearedAt?: number; uiCredit?: string };
  provenance: { endpoint: string; pinnedUpdatedAt: string; requestIds: string[]; origSha256: string;
    c2pa: 'valid' | 'valid-untrusted' | 'absent' | 'invalid'; resigned: boolean; aiGenerated: true };
  degraded?: true;
}
export interface PreparedClip {                 // 06 §4.4 fixed minimum (DL-061) + S03 fields
  key: string;
  source: { kind: 'element'; video: HTMLVideoElement } | { kind: 'decoder'; url: string; codec: string };
  width: number; height: number; durationMs: number;
  cues: { startMs: number; endMs: number; text: string }[];
  degraded: boolean;
  aiGenerated: true; uiCredit?: string; posterUrl: string; lastUrl: string;
}
export type CutsceneHostKind = 'dom-overlay' | 'xr-media-layer' | 'xr-texture' | 'webcodecs-texture';
export type FallbackTrigger = 'not_ready' | 'not_permitted' | 'media_error' | 'start_stall' | 'mid_stall'
  | 'codec' | 'budget' | 'policy' | 'offline' | 'degraded_sequence' | 'setting_off';
export type CutsceneOutcome = { path: 'video' | 'fallback' | 'instant'; skipped: boolean; trigger?: FallbackTrigger };
export interface CutscenePlayer {               // packages/engine/src/client/cutscene/ (S03, main thread)
  /** Resolve refs via the index, roster flags and route 27; fetch manifests; pick host and rendition; never throws. */
  prepare(playId: string, refs: CutsceneRefId[]): Promise<{ clips: PreparedClip[] } | { fallback: FallbackTrigger }>;
  play(playId: string, clips: PreparedClip[]): Promise<CutsceneOutcome>;
  /** Mixed sequences (fight intros, DL-081): items play back to back; an item whose ref is null, suppressed or not ready plays its
   *  DirectorScript in-engine; the sim is told per item through UiCommand {t:'cutscene.state', playId, item, state}. Never throws. */
  playSequence(playId: string, items: { ref: CutsceneRefId | null; fallback: string /* DirectorScript id */ }[]): Promise<CutsceneOutcome[]>;
  skip(playId: string): void;
  prefetch(refs: CutsceneRefId[]): void;        // manifest, poster, audio; ≤ 2 ahead on mobile tiers
}

export interface DirectorScript {               // content/missions/<id>/director/<beat>.ts → data/director.<id>; also S06/S07 sequences
  schema: 'director/1'; id: string; durationSec: number; seed: number;
  marks: Record<string, { at: LatLngTuple | { landmark: LandmarkId } | { local: [number, number, number] }; yawDeg: number }>;
  actors: { who: CastName | 'player' | `soul:${string}`; start: string; end: string; prefab?: string }[];
  shots: DirectorShot[];                        // sorted by atSec; first shot at 0
  actions: { atSec: number; who: string; do: 'moveTo' | 'runTo' | 'driveTo' | 'anim' | 'look' | 'enter' | 'exit'; arg: string }[];
  cues: CueSpec[];
  xrVantage: { mark: string; yawDeg: number };  // XR: fixed vantage, no cuts (C04 rule 5)
  letterbox: boolean; music?: AssetRef; frame?: 'world' | 'stage2d';  // stage2d = fighter side view
}
export interface DirectorShot {
  atSec: number; preset: 'establish' | 'two-shot' | 'over-shoulder' | 'single' | 'insert' | 'reaction' | 'tracking' | 'orbit' | 'auto';
  subject: string; secondary?: string; from?: string /* mark */; lens: 'wide' | 'normal' | 'tele';
  move?: 'static' | 'push-in' | 'pull-out' | 'pan' | 'orbit';
}
```

Cutscene key (A-03 v1, DL-051; §D3): `cutsceneKey = sha256Hex(canonicalize(normalizeKeyInput(i)))` over exactly the eight `CutsceneKeyInput` properties; `characters` sorted by `id` and unique, `inputHashes` sorted and lower-cased, `seed` an integer in 0…2³²−1; licence status never enters the key; at least seven vectors in `packages/shared/test/cutscene-key.vectors.json`. R2 layout `cutscenes/<key>/` with `manifest.json` written last; renditions `v540 | v768 | v1080`, or `p720` with `degraded: true`. Sim protocol (§D7, DL-160): `cut.request` carries `n` (u32 play counter, `playId = String(n)`) and `s` (comma-joined `CutsceneRefId`s); the player answers with C06 1.1 `UiCommand {t:'cutscene.state'}`. Telemetry `cutscene.play` carries C16 1.1 `path` and `trigger` (DL-193).

## Runtime JSON Schema — mission IR

`packages/shared/schemas/mission-ir-1.schema.json` (draft 2020-12) is generated from the §C3 types by `tools/ci/gen-api-schemas.ts` and then overlaid with the hand-written bounds of §C4. It is validated with Ajv by `pnpm missions:build`, at load in `sim.worker`, and by `dv mod check` (same error codes). Top-level overlay (merged into the generated schema's root):

```json
{"$comment":"03-story-missions.md §C4 bounds, merged by tools/ci/gen-api-schemas.ts into the generated mission-ir-1 schema",
 "properties":{
  "schema":{"const":"mission-ir/1"},
  "id":{"type":"string","pattern":"^m\\.[a-z0-9][a-z0-9.-]{1,80}$"},
  "worldBake":{"type":"string","pattern":"^[0-9a-f]{64}$"},
  "title":{"type":"string","pattern":"^[a-z0-9_.-]{1,96}$"},
  "cast":{"type":"object","maxProperties":32,"propertyNames":{"pattern":"^[a-z][a-z0-9_]{0,31}$"}},
  "zones":{"type":"object","maxProperties":48,"propertyNames":{"pattern":"^[a-z][a-z0-9_]{0,31}$"}},
  "stages":{"type":"array","minItems":1,"maxItems":16,"items":{"properties":{"objectives":{"type":"array","minItems":1,"maxItems":12}}}},
  "threads":{"type":"object","maxProperties":8},
  "autoplay":{"properties":{"expectedSec":{"type":"array","prefixItems":[{"type":"number","minimum":10},{"type":"number","maximum":3600}],"minItems":2,"maxItems":2}}},
  "lines":{"type":"array","items":{"type":"string","pattern":"^line\\."}}}}
```

Nested bounds (applied to the generated `$defs` of the named types):

| Type · field | JSON Schema keyword |
|---|---|
| `ZoneDef` `k:'circle'` · `r` | `minimum: 2`, `maximum: 2000` |
| `ZoneDef` `k:'poly'` · `ring` | `minItems: 3`, `maxItems: 64` |
| `Op` `loop` · `max` | `maximum: 10000` |
| `Op` `wait` and objective `wait` · `sec`; `waitUntil`, `waitEvent` · `timeoutSec` | `minimum: 0.05`, `maximum: 600` |
| talk · `maxTurns` | `minimum: 1`, `maximum: 12` |
| every `LocKey` field | `pattern: ^[a-z0-9_.-]{1,96}$` |
| every `LineId` field | `pattern: ^line\.` |

Checks the schema cannot express run in the compiler and in `dv mod check` with the §C4 codes: ≤ 16 live threads, ≤ 4,000 IR op nodes, `expectedSec` max ≥ min × 1.2, every lat/lng inside `config/world.bounds.json` `play` and on land or right-of-way (`E_OUT_OF_BOUNDS`), references (`E_REF_*`), depiction and name lint (`E_DEPICTION`, `E_NAME`), missing fallbacks (`E_NO_FALLBACK`), hook stubs (`E_HOOK_STUB`), unreachable stages, budget (`E_BUDGET`). No raw display text appears anywhere in IR: strings are `LocKey` or `LineId` only.
