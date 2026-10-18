# Domain 03 — Story, Missions & Cutscenes (S03), Part C: C09 MissionScript

> Wave 2 · v1.0 · 2026-10-18 · author S03. Continues `03-story.md` (Part A). This part carries template §4 (data) and §5 (runtime) for missions: authoring API, JSON IR and schema, compiler, interpreter, dialogue hooks, mode hooks and unlocks, autoplayer, debugger, content lint and the mission-editor needs for modders. Cutscene types are in Part D (`03-story-cutscenes.md`); story content is in Part B (`03-story-narrative.md`). Requirements: R-MODE-01, R-MODE-05, R-CUT-03 (mission side), R-ENG-04, R-NPC-05 (offline completion), R-IP-02. Binding: A-02, C06 mission hooks (`01-engine-save-modes.md` "Mission and mode hooks"), gamedesign R-DSL 1–12 [research/gamedesign-decomposition.md §2.6].

## C1. Files, ids and versions

| Thing | Rule |
|---|---|
| Contract file | `packages/shared/src/contracts/c09-mission.ts` exports `C09_VERSION = '1.0.0'` and every type in §C3 (pure, no IO) |
| JSON Schema | `packages/shared/schemas/mission-ir-1.schema.json` (draft 2020-12), generated from §C3 by S09's generator (`tools/ci/gen-api-schemas.ts`, library pinned by S13) plus the hand-written bounds of §C4; validated with Ajv, as S09 does for API bodies |
| Source | `content/missions/<missionId>/mission.ts` (TypeScript builder), `lines.<lang>.json` (spoken and printed text), optional `director/<beat>.ts` (in-engine sequences) |
| Compiled IR | C07 asset `data/mission.<missionId>` (`schema: 'mission-ir/1'`), plus `data/story.index` (one row per mission) and `data/lines.<act>.<lang>`; all go through the C07 catalog and provenance (`first_party_authored`) |
| `MissionId` | `^m\.[a-z0-9][a-z0-9.-]{1,40}$`; story missions are `m.a<act>.<nn>` (`m.a1.03`); mod missions are `m.mod.<modId>.<name>` |
| Persistent entities | C01 `StableKey` `mis:<missionId>:<castName>`; `EntityId` never appears in IR, saves or checkpoints |
| Components | story range 512–767 (C01): `MissionCast` 512 (mission id + cast name, interned), `ObjectiveMarker` 513, `CutsceneActor` 514, `DirectorTarget` 515 |
| Versions | `mission.version` (integer, +1 per content change) and `worldBake` (C08 bake hash at compile time); checkpoints carry both |

## C2. Authoring API (TypeScript builder, compiled; never executed at runtime)

`packages/modes/story/src/authoring/` exports `defineMission`, typed op and predicate helpers, and `defineDirector` (Part D §D2). `@dv/mod-sdk` re-exports the same module for modders. The builder only builds data: it returns a `MissionIR` object, and the compiler (`pnpm missions:build`) validates, resolves and writes it. The runtime loads JSON only (R-DSL-1).

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

## C3. IR types (normative)

```ts
// packages/shared/src/contracts/c09-mission.ts
export const C09_VERSION = '1.0.0' as const;
export type MissionId = `m.${string}`;
export type LocKey = string;                       // ^[a-z0-9_.-]{1,96}$; resolved by S10's i18n
export type LineId = `line.${string}`;             // key into lines.<lang>.json; every line has subtitle text
export type CastName = string;                     // ^[a-z][a-z0-9_]{0,31}$
export type ZoneName = string;                     // same pattern
export type LandmarkId = `lm.${string}`;           // C08 landmark registry (S02)
export type DistrictId = 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'd7' | 'd8' | 'd9' | 'd10';
export type LatLng = [lat: number, lng: number];   // WGS84 in authored data only (06 §4.3); resolved to ENU at load
export type RosterSlot = 'RAP_HYPHY_ELDER' | 'RAP_LYRICIST' | 'RAP_NEW_WAVE' | 'RAP_COLLECTIVE' | 'TECH_VISIONARY'
  | 'TECH_HACKER' | 'TECH_VC' | 'ATH_SHOOTER' | 'ATH_POWER_BACK' | 'INFLUENCER';
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
  title: LocKey; district: DistrictId; tags: string[];
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

export interface Placement { at: LatLng | { landmark: LandmarkId }; yawDeg?: number; snap: 'ground' | 'road' | 'sidewalk' | 'none'; y?: number }

export type CastDef =
  | { k: 'npc'; who: { soul: string } | { slot: RosterSlot }; role: CastRole; spawn?: Placement; prefab?: string; spawnAt?: 'start' | 'manual' }
  | { k: 'vehicle'; prefab: string; spawn: Placement; role?: CastRole; playerUsable?: boolean; spawnAt?: 'start' | 'manual' }
  | { k: 'prop' | 'pickup'; prefab: string; spawn: Placement; item?: string; spawnAt?: 'start' | 'manual' }
  | { k: 'unit'; prefab: `police.${string}`; spawn: Placement; spawnAt?: 'start' | 'manual' };   // named police unit

export type ZoneDef =
  | { k: 'circle'; at: LatLng; r: number }                                // r 2–2,000 m
  | { k: 'poly'; ring: LatLng[]; yMin?: number; yMax?: number }           // 3–64 points
  | { k: 'landmark'; id: LandmarkId; r?: number }
  | { k: 'route'; via: LatLng[]; widthM: number }                         // snapped to C08 road edges at load → ZoneShape 'edges'
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
  | { k: 'stealth'; zone: ZoneName; detectBudget: number; autoplayPath: LatLng[] }
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
export interface MissionIndexRow { id: MissionId; act: number; district: DistrictId; title: LocKey; giver: MissionIR['giver'];
  requires: Pred[]; start: Trigger; asset: `data/mission.${string}`; version: number; tags: string[] }
```

## C4. Schema bounds and validation errors

Bounds are part of the schema (and therefore of `dv mod check`), so a malformed or hostile mission fails before it runs:

| Field | Bound | Field | Bound |
|---|---|---|---|
| `cast` | ≤ 32 entries | `zones` | ≤ 48; circle r 2–2,000 m; poly 3–64 points |
| `stages` | 1–16 | objectives per stage | 1–12 |
| threads (stage objectives + `threads`) | ≤ 16 live | IR op nodes per mission | ≤ 4,000 |
| `loop.max` | ≤ 10,000 | `wait.sec`, timeouts | 0.05–600 s |
| `talk.maxTurns` | 1–12 | `autoplay.expectedSec` | min ≥ 10, max ≤ 3,600, max ≥ min × 1.2 |
| lat/lng | inside `config/world.bounds.json` (C08), SF land or right-of-way | strings | LocKey/LineId only; no raw display text anywhere in IR |

Compiler errors carry a JSON Pointer and a code: `E_SCHEMA`, `E_REF_CAST`, `E_REF_ZONE`, `E_REF_LINE`, `E_REF_LANDMARK`, `E_OUT_OF_BOUNDS`, `E_ROUTE_UNSNAPPABLE`, `E_DEPICTION`, `E_NAME`, `E_NO_FALLBACK`, `E_HOOK_STUB`, `E_UNREACHABLE_STAGE`, `E_BUDGET`. `dv mod check` prints the same codes.

## C5. Compiler and load-time resolution

1. **Build** (`pnpm missions:build [--mission <id>]`, `tools/ci` wrapper over `packages/modes/story/src/compiler`): run the builder, validate against the schema, lint (§C11), check every `LineId` exists in `lines.en.json`, check every `BeatRef` resolves to a CutsceneRef with a fallback or to a DirectorScript (`E_NO_FALLBACK`), emit `data/mission.<id>`, `data/story.index`, `data/lines.<act>.<lang>`, and `content/audio-needs/story.json` (lines needing TTS, per speaker soul, for S04/S05).
2. **Load** (in `sim.worker`, when the mission becomes `starting`): resolve `LatLng` → ENU with the C08 frame; `landmark` → registry position; `route.via` → C08 road-graph edges with A* between consecutive points → `ZoneShape {k:'edges', edgeIds, widthM}`; snap placements (`road` = nearest drivable edge lane, `sidewalk` = nearest ped-graph node, `ground` = heightfield). Register zones with `ZoneService.define('mis:<id>:<zone>', shape)`.
3. **World-bake drift (R-DSL-12).** If `worldBake` differs from the loaded bake, resolution is re-run; any reference that fails to resolve (snap distance > 25 m, unsnappable route, missing landmark) disables the mission with `E_REF_*` shown in the Jobs app and in telemetry `mission.fail` (`reason: 'unresolved'`). A saved `activeMission` whose `version` or `worldBake` no longer matches is dropped and the mission restarts from `available` (never a broken checkpoint).
4. **Cast resolution.** `{slot}` resolves through `content/story/cast.json` (slot → roster soul id) and the live C12 `RosterFlags`: a killed character (scope `spawn` or `all`) or an unsupplied roster (Q-19) uses the soul's `standIn` (C10). `{soul}` resolves to the compiled soul; its tier is read from the soul, never from the IR.

## C6. Interpreter (VM) semantics

**Hosting.** `StoryModeSim` (C06 `GameModeSim`, `packages/modes/story/src/mode.ts`) owns one `MissionRuntime` at a time (one active story mission, gamedesign §2.5). Each stage objective and each `threads` entry is one C06 `SimScheduler` thread `mis:<id>:<threadName>`; threads run in `threadId` order in `SimStage.Script` (C06 rules). The VM is a tree-walking interpreter over the IR op arrays with an explicit frame stack per thread (no recursion on the JS stack, so the state is inspectable by the debugger).

**Budget and yields.** Each executed op node costs 1; predicate nodes cost 1 each. A thread stops at 2,000 ops per tick (`SimScheduler.opsBudgetPerTick`) and resumes next tick; hitting the budget 60 ticks in a row raises `E_BUDGET` (mission aborts to `failed` with `fail.reason.script_error`, telemetry `err.sim`). `wait` yields `waitTicks(ceil(sec × 60))`; `waitUntil` yields `{k:'waitUntil', pred}` with a pure predicate closure; `waitEvent` yields `{k:'waitEvent'}` on the mission event bus. `all` forks child frames in branch order and joins; `race` forks and cancels losing branches at the end of the tick in which one finishes (lowest branch index wins a tie).

**Determinism.** RNG stream `mission:<missionId>` seeded with `hash32(storySeed, missionId, attempt)`; actor tasks use the C02 per-entity streams; the VM never reads wall time. The mission clock (`stageTime`, `timeLimitSec`, `elapsedSec`) counts sim ticks while `phase = 'stage'` and **excludes beats** (cutscenes and in-engine sequences), so a video path and a fallback path leave every mission timer equal. Asynchronous inputs (talk results, beat completion, mode results) enter the sim as commands at a tick and are recorded in the `TimelineRecorder`, so a recorded run replays exactly.

**Objective threads.** An objective thread evaluates its completion predicate each tick (zones via `ZoneService`, heat via `PursuitApi.state()`, health and vehicles via `EcsApi` reads), publishes `hud.mission` (title, objective text, timer, assist hint; S10 key) and the marker, and finishes `done` or `failed`. `join: 'all'` completes when all non-optional objectives are done; `'any'` on the first; `'sequence'` reveals objectives one by one. `follow` fails when the target is farther than `band[1]` for `loseAfterSec`; `stealth` fails when detections exceed `detectBudget` (detection events come from S04 NPC perception and S01 pursuit witnesses); `deliver` with `fragile` fails when the carried entity's damage exceeds the value.

**Stage transitions.** Completing a stage runs `onComplete`, then the next stage (`next`, a talk outcome's `stage`, or the following index); entering runs `onEnter` and, if `checkpoint`, writes a `MissionCheckpointV1` into `StorySlice.activeMission` and requests a save (`SaveReason 'interval'` until a `checkpoint` reason exists; see Part A §10). `pass` (explicit or end of the last stage) → outro beat → rewards → `StorySlice.missions[id].state = 'passed'`, `bestSec`, `medals` → unlocks → `ctx.save.request('missionPass')` → `markSafePoint('mission-end')` through S10's shell.

**Fail rules.** All `fail[]` predicates and the built-in `busted` (when `heatPolicy.maxHeat > 0`) are checked every tick after objectives. On fail: show `reason`, despawn mission cast, restore ambient and clock locks, then offer *Retry* (from the last checkpoint: restore player pose/vehicle/health, cast states, flags, wallet delta and RNG; restart that stage's threads from their first op) or *Quit* (`available`). `retry: 'start'` restarts from stage 0. Bust consequences (fine, impound strike) come from S01's PursuitDirector; the mission only fails.

**Ambient, heat and clock.** On start: apply `ambient` multipliers, `clock.lock` through `WorldClockApi.lock('mis:<id>', hour, weather)`, `heatPolicy.startHeat` via `PursuitApi.setHeat`, and `capHeat(maxHeat)`. On every exit (pass, fail, quit, abort, mode kill) the VM restores all of them (`unlock('mis:<id>')`, multipliers 1, `capHeat(5)`, `clear` if `clearOnPass`). A `finally` table in `MissionRuntime` makes this unconditional.

**Events.** Mission-scoped events (`emit`, objective transitions, `talk.result`, `beat.done`, `mode.result`) go to the timeline as `{t: 'mis.<name>', tick, data}`. The typed timeline vocabulary extends gta-sa-earth's 27 types [research/repos-world.md §3.4]: `mis.stage`, `mis.objective`, `mis.say`, `mis.text`, `mis.beat`, `mis.camera`, `mis.fade`, `mis.heat`, `mis.clock`, `mis.ambient`, `mis.flag`, `mis.reward`, `mis.unlock`, `mis.talk`, `mis.mode`, `mis.pass`, `mis.fail`.

## C7. Dialogue hooks into NPC souls (C10)

**`say`** (scripted line): the VM patches `hud.subtitle` `{speaker, text, startMs, endMs}` and asks `AudioService` for the pre-rendered line (`audio_bark`/`voice` assets produced from `content/audio-needs/story.json` by S04/S05 per the speaker's voice tier); missing audio means text only. Duration = audio length, else `max(1.5 s, 0.06 s × characters)`. A killed speaker (scope `voice`) is text only; scope `spawn` swaps in the stand-in's lines.

**`talk`** (AI conversation with a structured result; R-DSL-7):
1. The objective spawns a conversation through `@dv/npc` (S04) with C10 `NPCDialogueRequest {npcId, encounterId?, soulVersion, turn: {intent, text?}, context, maxTokens}`. `turn.intent` = `mission:<missionId>:<talkId>`; `context` carries `{mission: {id, stage, talkId, goal: intent LocKey text, outcomes: [{id, label}]}, scene: {district, hour, heat}}` (assumption A-C10-1, Part A §10).
2. The conversation UI (S10 surface, S04 client) always shows the outcome choices as buttons once at least one turn has completed or immediately offline. The player's choice decides the outcome; NPC `effects` only **gate** outcomes (`TalkUnlock`: e.g. `bribe` appears only after `effects.action = 'offer_deal'`, `charm` only at `trust ≥ 20`). So the LLM never decides mission flow on its own, and every outcome is reachable by explicit choice once its gate holds.
3. Offline, on quota or budget (`quota_exhausted`, `budget_offline`, `kill_switched`, `upstream_unavailable`), on SSE `fallback`, or after `maxTurns`, the NPC's ink knot `mission_<missionId>_<talkId>` (S04) plays and offers the same outcome choices; ink lines alone must complete every mission (CI check, S04's requirement [research/ai-npc-runtime.md §2.8]).
4. The result enters the sim as a command `{t: 'mode.cmd', mode: 'story', name: 'talk.result', args: {talkId, outcome, turns, path: 'llm' | 'ink'}}` (S10's proposed `UiCommand`), is recorded, applies `flags`/`trust`, and jumps to the outcome's `stage`.
5. Autoplay and CI use `TalkDef.default` with `path: 'scripted'`; no network call is made.

Relationship effects persist in `StorySlice.npcRelations[soulId].trust` (clamped −100…100) and `met`. Mission state reaches the NPC only through `context` (C10 history is server-held, so the client never forges prior turns).

## C8. Mode hooks and unlock events (R-MODE-05)

A `mode` objective runs its `ModeHook`:
1. Look up the C06 descriptor. The **stub path** is used when the descriptor is missing or `comingSoon` (A-06), when `ModeContext.startChild(...)` returns false (profile mismatch, C06 rule 2), when RosterFlags kill the hook's opponent with scope `fighter`, or under `?hooks=stub` (QA).
2. **Real path:** `startChild(hook.mode, {defId, params, seed: hash32(seed, hook.id, attempt)})`; the story is `Suspended`; on `mode.childExit` the result `outcome` is checked against `passOn`; failure retries the hook (`retry: 'hook'`) or the checkpoint. ModeHost emits `unlockOnFirstEncounter` on first entry (C06 rule 5).
3. **Stub path:** the VM runs `hook.stub` as a normal objective and **itself** calls `ctx.unlocks.emit(unlockOnFirstEncounter, {kind: 'mission', ref: '<missionId>:<hookId>'})`, so the unlock is recorded even while the mode is `comingSoon`; the tile becomes playable as soon as a build ships the mode (C06 rule 6).
4. Hook parameter shapes the story sends (assumptions on S06/S07/S08 defs, Part A §10): racing `{raceId}`; fighter `{opponent: soulId, stage: stageId, rounds: 1 | 3, difficulty: 'easy' | 'normal', playerFighter: true}`; tycoon `{scenarioId, weeks}`. Results return in `ModeResult.data`; rewards flow through the child mode's `EconomyApi` idempotency key and are not paid twice by the mission.

Unlock ids the story emits are listed in Part B §B7; their `UnlockDef`s live in `config/unlocks.json` (S01 registry file) with `source: 'base'`.

## C9. Autoplayer (CI bot; R-DSL-5)

`packages/modes/story/src/autoplay/` derives goals from the active objectives (gta-sa-earth P14 pattern [research/repos-world.md §6]) and drives the player through a QA-only `BotInput` source that writes C03 `InputFrame`s for player 0 each tick (assumption A-C03-1, Part A §10).

| Objective | Goal and policy |
|---|---|
| `goto`, `deliver`, `collect`, `protect.untilZone` | A* on the C08 road graph (vehicle when distance > 150 m and a usable vehicle is within 60 m) or the ped graph; re-plan every 2.5 s; stop inside the zone; respect `stopped` |
| `enterVehicle` | walk to the nearest matching vehicle, press `sim.Enter` |
| `follow` | keep the middle of `band` behind the target (PD on distance), re-plan 2.5 s |
| `chase` | intercept: aim at the target's position predicted 1.5 s ahead |
| `escape`, `survive` | drive away from the last-known position toward the nearest C08 `hidingSpots`/`pursuitBreakers` tag outside the search circle; idle in the hiding spot until `heat = 0` |
| `talk` | use `TalkDef.default`; never calls the network |
| `photo` | goto the nearest vantage within `maxDistM` with line of sight; aim; press `sim.Camera` |
| `stealth` | follow `autoplayPath` at walk speed |
| `defeat` | open-world melee bot through `CombatApi` (S07 frame data) |
| `score` | scripted donut/drift input pattern from `config/autoplay/score.json` |
| `wait` | idle |
| `mode` | the child mode's bot (S06 race AI, S07 CPU, S08 auto-founder) or the stub's policy |

**CI run.** `pnpm check:missions [-- --mission <id>]` (proposed alias, Part A §10) runs every mission in the release index × its 3 seeds in Node under the `canonical` profile (fixed `mobile-low` density, deterministic Rapier [`01-engine.md` §2.3]) with `beats: 'instant'` (a beat completes in one tick and applies its end marks), `talk: 'scripted'`, `hooks: 'bot'` where the mode exists, else `'stub'`. A mission fails CI if it does not pass, if `elapsedSec` is outside `expectedSec`, if two runs of the same seed produce different final `stateHash` (C02), or if any compiler error appears. Output per run: result JSON, timeline (`.dvtl`) and hashes as CI artifacts.

## C10. Debugger and preview (R-DSL-11)

QA builds only (`VITE_DV_QA=1`; flags parsed by S11's `QaFlags`, DL-064):
- **URL:** `?mission=<id>&stage=<n>&seed=<s>` starts the mission at a stage (applying the stage's checkpoint defaults); `?hooks=stub|bot`, `?talk=scripted`, `?beats=fallback|instant|video` force paths.
- **Overlay** (`packages/modes/story/src/debug/`, DOM): thread list (id, op path, state, wait reason, ops this tick), active objectives with live predicate values, cast table (StableKey, alive, distance), flags, mission clock, last 50 timeline events; zone and route debug geometry in the world; controls pause, step tick, step op, skip stage, force pass/fail, set flag, teleport to objective, toggle *bot plays*, breakpoints on op paths.
- **Preview (simulate once, scrub):** *Record* runs the mission headless in `sim.worker` at maximum speed under autoplay, records the timeline, then the main thread scrubs entity tracks with binary search (`lastBefore`), shows chapter markers on `mis.stage` events and subtitles from `mis.say` [research/repos-world.md §3.4]. The same recording feeds forum previews of mod missions (S12) and the cutscene storyboard of Part D.
- **Agent bridge:** `window.__dvBridge.mission` = `{ state(), step(ticks), jump(stage), events(since), predicate(path) }` for coding agents and Playwright.

## C11. Content and depiction lint (R-IP-02, D-30)

Run by `missions:build`, `check:missions` and `dv mod check`:
1. **Real-derived cast** (`{slot}` or any soul whose basis is a real person, any tier) may have `role ∈ {mentor, rival, host, opponent, cameo}` only; may appear only in `lawful` stages (the compiler despawns them before an `unlawful` stage starts); may not be the target of `chase`, `follow`, `defeat`, `stealth` detection or a police unit, except as the opponent inside a `fighter` hook; never rides in the player's vehicle; never appears in missions tagged `sideshow` or `jailbreak`; and its lines and talk outcomes never help an `unlawful` stage (a talk objective with a real-derived NPC may not jump to an `unlawful` stage) (`E_DEPICTION`). Fame-domain exclusion: an athlete slot never appears in a sports context, a rapper slot never performs music, and an investor or founder slot never pitches or votes on deals [research/legal-ip-likeness.md L1]. Generated story clips (Part D) cast fictional characters only.
2. **No firearms or gore:** prop and prefab ids under `weapon.*` are rejected; `defeat` is always `nonLethal: true` (D-30).
3. **Names:** IR strings are keys only; `lines.*.json` and `title` text pass `names:lint` (NameRegistry and `config/ip-denylist.json`), so no real name, alias, catchphrase, team, label or song appears in story text [research/legal-ip-likeness.md constraints 6, 14].
4. **Sensitive districts:** missions in D3 (Bayview–Hunters Point) and D4 (Tenderloin, Civic Center) carry the tag `sensitivity-read` and cannot be released until `content/story/sensitivity.json` records a completed read for their current `version` (Part B §B3).

## C12. Mission-editor needs for modders (input to S12, C14, M13a/M13b)

Mods ship missions as data-tier content (C14 kind `experience`; closed permission `mission.register`, assumption A-C14-1). Requirements S03 places on the mod SDK and editor:
1. **Same pipeline:** the SDK exports the §C2 builder, the §C3 types and the schema; `dv mission new|build|check|autoplay|preview` wrap `missions:build` and the headless autoplayer, so a modder's agent gets the identical error codes and an autoplay verdict locally.
2. **Sandbox only:** mod missions run under `exp:<id>` or sandbox (`Trigger k:'mode'`), never in story slots; ids `m.mod.<modId>.*`; unlocks only `unlock.mod.<modId>.*` (`UnlockDef.source 'mod:<id>'`); rewards credit the mod's `mod:<id>` slot economy, never the story wallet.
3. **Cast limits:** only `original`-basis souls (first-party originals or the mod's own NPCs passed through moderation); first-party parody or fictionalized NPCs cannot be cast [research/legal-ip-likeness.md L3].
4. **No generation:** mod beats are DirectorScripts only (in-engine); `cutscene` refs and prompt templates are rejected for mods in v1 (no user generation, G3).
5. **Visual editor** (S12 builds, in the sandbox overlay): place zones on the map (circle, polygon, landmark pick, route by clicking along roads), place cast with snap modes, edit the stage and objective lists with schema-driven forms, record DirectorScript shots by capturing the free-camera pose, run *Test with bot* (autoplayer) and *Preview* (simulate once, scrub), show lint errors at their JSON Pointer, and export IR JSON plus `lines.<lang>.json`.
6. **Agent-friendly docs:** the schema, one example mission per objective kind under `examples/mods/mission-pack/`, and the `mod-missions` skill [research/repos-modding.md §5].
7. **Caps:** the §C4 bounds plus ≤ 4 missions per mod in v1 and the 2,000 ops/thread/tick budget; a mod mission that breaks budget or lint is disabled for the session with a toast (story saves untouched).
