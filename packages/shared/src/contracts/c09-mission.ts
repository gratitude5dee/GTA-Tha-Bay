// C09 MissionScript (1.0.0): the mission IR types of spec/domains/03-story-missions.md section C3, verbatim.
// M05b1 created this file as a stub because M04c had not landed; M05a1 completes it. The first four type lines below the version are
// the stub's and stay unchanged. Differences from the spec text, all type-level: the three `import('...')` type aliases of the spec
// became `import type` lines (lint rule consistent-type-imports); `JsonObject` comes from c05-save.
import type { HeatLevel } from './engine-pursuit.ts';
import type { WeatherPreset } from './engine-world.ts';
import type { UnlockEventId } from './c06-ids.ts';
import type { JsonObject } from './c05-save.ts';
import type { LandmarkId } from '../world/c08.ts';

export const C09_VERSION = '1.0.0' as const;

export type LineId = `line.${string}`;             // key into lines.<lang>.json; every line has subtitle text
export type CastName = string;                     // ^[a-z][a-z0-9_]{0,31}$
export type LatLngTuple = [lat: number, lng: number];   // WGS84 in authored data only (06 §4.3)

export type MissionId = `m.${string}`;
export type LocKey = string;                       // ^[a-z0-9_.-]{1,96}$; resolved by S10's i18n
export type ZoneName = string;                     // same pattern
export type { LandmarkId };                        // C08 owns the id space (S02, DL-077)
export type MissionDistrictId = 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'd7' | 'd8' | 'd9' | 'd10';   // gameplay districts, a subset of C08 DistrictId
export type RosterSlot = 'RAP_HYPHY_ELDER' | 'RAP_LYRICIST' | 'RAP_NEW_WAVE' | 'RAP_COLLECTIVE' | 'TECH_VISIONARY'
  | 'TECH_HACKER' | 'TECH_VC' | 'ATH_SHOOTER' | 'ATH_POWER_BACK' | 'INFLUENCER';   // the one roster-slot type; S07 FighterSlotId = RosterSlot | 'PLAYER_FIGHTER' (DL-163)
export type CastRole = 'ally' | 'mentor' | 'rival' | 'host' | 'opponent' | 'cameo' | 'antagonist' | 'civilian' | 'unit';
export type Who = 'player' | 'playerVehicle' | CastName;

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
