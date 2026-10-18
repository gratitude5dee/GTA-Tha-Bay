# 06 — Racing, part 2: §4 Data (types, schemas, configs, save slice, wire shapes)

> S06, Wave 3, 2026-10-18. Part of `spec/domains/06-racing.md` (main file: scope, design, runtime, platforms, facts, milestones, tests). Content tables (garage, handling presets, events, ladder) are in `spec/domains/06-racing-content.md`. S06 owns **no numbered contract**. It owns the types below, which live in `packages/shared/src/vehicle/` and `packages/shared/src/racing/` (pure: types, constants, pure functions; C02 lint applies) and in `packages/modes/racing/` (sim and UI halves). Where a type touches a contract owned elsewhere, the line says so; shapes of C08 are the 06 v1.0 sketch exactly, and every use is listed as an assumption in the main file §10.

## 4.1 Vehicle: classes, handling, quirks (R-MODE-02, R-IP-01)

```ts
// packages/shared/src/vehicle/handling.ts
export const VEHICLE_SCHEMA = 1 as const;
export type VehicleClass = 'D' | 'C' | 'B' | 'A' | 'S' | 'R';           // R = robotaxi special class
export type Drivetrain = 'FWD' | 'RWD' | 'AWD';

export type Quirk =
  | { k: 'speedGovernor'; kph: number; jailbreakItem?: string }           // R class: 105 kph until jailbroken
  | { k: 'autoYield'; radiusM: number }                                    // automatic emergency braking assist
  | { k: 'stallOnDarkSignal'; holdSec: [number, number] }                  // stops at a dark signal, holds a seeded 4–9 s
  | { k: 'thrusterHop'; deltaVy: number; charges: number; rechargeSec: number; coyoteSec: number }
  | { k: 'regenBraking'; nitroPerSec: number; minKph: number };            // EV: braking refills nitro

export interface HandlingProfile {
  schema: typeof VEHICLE_SCHEMA; id: string;                                // 'hp.aurelian-sorrel'
  rev: number;                                                             // +1 per tuning change; stored in replays
  class: VehicleClass; fictionalMake: string;                              // checked by ip:strings / names:lint
  massKg: number; cgHeightM: number; wheelbaseM: number; trackM: number; frontWeightPct: number;
  engine: {
    idleRpm: number; redlineRpm: number;
    torque: readonly (readonly [rpm: number, nm: number])[];               // ascending rpm, linear interpolation
    powerKw: number;                                                       // declared; CI asserts within 3 % of max(T·ω)
  };
  drive: {
    type: Drivetrain; gears: readonly number[]; reverse: number; finalDrive: number; efficiency: number;
    wheelRadiusM: number; shiftUpPct: number; shiftDownPct: number;       // of redline; auto gearbox only (arcade)
    shiftTimeSec: number; awdRearBias: number;                             // 0..1, AWD only
  };
  tire: {
    muLong: number; muLat: number; peakSlipDeg: number;                    // peak of the lateral curve
    slideRatio: number; slideAtX: number;                                  // plateau (0.78) reached at x = slip/peak = 2.5
    loadSens: number;                                                      // 0..0.3: μ falls as load rises
    frontGrip: number; rearGrip: number; rollResistN: number;
  };
  aero: { cdA: number; downforceNPerMps2: number };
  steer: { lockDeg: number; speedRefMps: number; minLockPct: number; rateDegPerS: number; assist: number; selfAlign: number };
  brake: { maxDecelG: number; bias: number; abs: boolean };
  drift: { assist: number; handbrakeRearGrip: number; yawDamp: number };   // assist 0..1
  suspension: { restM: number; travelM: number; rideHz: number; dampingRatio: number; antiRoll: number;
                landingDamp: number; airPitchTrim: number; airRollTrim: number };
  nitro: { capacity: number; boostKw: number; drainPerSec: number; minToFire: number; maxOverTopPct: number;
           refill: { driftPerSec: number; nearMiss: number; draftPerSec: number; airPerSec: number } };
  durability: number;                                                      // divisor in damage formulas, class-scaled
  quirks?: readonly Quirk[];
}

/** Per-class envelope. Content CI and S12's vehicle-mod validator reject any profile outside it (D-S06-08). */
export interface ClassEnvelope { class: VehicleClass; massKg: [number, number]; powerKw: [number, number];
  muLat: [number, number]; topKph: [number, number]; zeroTo100Sec: [number, number]; piBand: [number, number] }
export declare const CLASS_ENVELOPE: Readonly<Record<VehicleClass, ClassEnvelope>>;  // numbers in 06-racing-content.md §C.2

// ---- pure per-step model (sim code: detmath only, no Math.sqrt/sin/pow) --------------------------------------------
export interface WheelContact {
  inContact: boolean; point: [number, number, number]; normal: [number, number, number];
  suspLenM: number; vLong: number; vLat: number;                           // wheel-frame ground speed, m/s
  loadN: number; surface: 0 | 1 | 2;                                       // 0 asphalt, 1 wet (rain preset), 2 loose (grating, tram rail)
}
export interface BodyKin { vLong: number; vLat: number; yawRate: number; speedMps: number; upY: number;
  airborneTicks: number; grade: number /* rise/run under the car */ }
export interface HandlingState {                                            // component Vehicle (engine) + Drift/Nitro/Quirk (racing)
  gear: number; rpm: number; shiftTicks: number; steerRad: number;
  nitro: number; nitroOn: boolean; driftTicks: number; driftScore: number;
  hopCharges: number; hopRechargeTicks: number; stallTicks: number; engineHealth: number; tireHealth: [number, number, number, number];
}
export interface HandlingInput { throttle: number; brake: number; steer: number; handbrake: boolean; nitro: boolean;
  ability: boolean; assist: AssistSettings }                               // quantized C03 InputFrame fields
export interface HandlingOutput {
  steerRad: [number, number];                                              // front wheels
  wheelForce: [WheelForce, WheelForce, WheelForce, WheelForce];            // applied as impulses at contact points
  yawTorque: number; airTorque: [number, number, number]; abilityImpulseY: number;
  events: HandlingEvent[];
}
export interface WheelForce { long: number; lat: number }                  // newtons, wheel frame
export type HandlingEvent = { t: 'shift'; to: number } | { t: 'nitro'; on: boolean } | { t: 'hop' } | { t: 'drift'; angleDeg: number }
  | { t: 'stall' } | { t: 'govern' };
export declare function stepHandling(p: HandlingProfile, s: HandlingState, i: HandlingInput,
  w: readonly [WheelContact, WheelContact, WheelContact, WheelContact], b: BodyKin, dt: number): HandlingOutput; // dt = SIM_DT or SIM_DT/2

export interface AssistSettings {                                           // per profile, C05 mode:racing slice
  steerAssist: 0 | 1 | 2 | 3; brakeAssist: boolean; autoThrottle: boolean; autoBrake: boolean;   // autoThrottle: touch one-handed, XR hands
  driftAssist: 0 | 1 | 2; stabilityControl: boolean; racingLine: 'off' | 'brake' | 'full'; resetPenalty: boolean;
}
```

```ts
// packages/shared/src/vehicle/damage.ts
export interface DamageState { body: number; engine: number; tires: [number, number, number, number] }   // 0 = destroyed … 1 = new; mirrors engine VehicleDamage
export type ImpactKind = 'static' | 'vehicle' | 'prop' | 'ped' | 'spike' | 'landing';
export interface Impact { kind: ImpactKind; vNormal: number; vTangent: number; local: [number, number, number];  // contact point in body frame
  otherMassKg: number; tire?: 0 | 1 | 2 | 3 }
export declare function applyImpact(p: HandlingProfile, d: DamageState, i: Impact, difficulty: Difficulty): DamageState;
export declare function powerScale(d: DamageState): number;          // 1 − 0.4·(1 − engine)  → 0.6 at worst
export declare function tireGripScale(d: DamageState, wheel: 0 | 1 | 2 | 3): number; // 1 → 0.4 when tire = 0
```

```ts
// packages/shared/src/vehicle/instance.ts — C05 CoreSlice.garage element (JSON Schema vehicle-instance.v1.schema.json, golden files in M07a)
export type UpgradeSlot = 'engine' | 'tires' | 'brakes' | 'suspension' | 'weight' | 'nitro' | 'armor';
export interface VehicleInstance {
  id: string;                                                              // 32-hex; StableKey `veh:<id>`
  defId: string;                                                           // PrefabDef id, e.g. 'vehicle.aurelian-sorrel'
  upgrades: Partial<Record<UpgradeSlot, 0 | 1 | 2 | 3>>; livery: { assetRef: string /* C07 AssetRef livery/…|texture/… */; hue: number; plate: string /* ≤ 7 chars, A–Z 0–9 */ };
  damage: DamageState; odometerKm: number; acquired: number /* epoch ms */; source: 'bought' | 'reward' | 'loaner' | 'mod';
}
export type Difficulty = 'easy' | 'normal' | 'hard';
```

## 4.2 Races: authoring, compiled definition, runtime (R-MODE-02, R-MAP-01)

Authoring coordinates are lat/lng and landmark ids (design pillar P-1); compiled data adds C08 edge ids pinned to a `worldBake`. Everything is JSON Schema validated (`packages/shared/schemas/racing/*.schema.json`) at build time (`pnpm map:races validate`) and at mod load.

```ts
// packages/shared/src/racing/race-def.ts
export type RaceKind = 'sprint' | 'circuit' | 'checkpoint' | 'speedtrap' | 'downhill' | 'hillclimb' | 'drift' | 'pursuit' | 'sideshow' | 'robotaxiRush';
export type RaceId = string;                                               // /^sf\.[a-z]+\.[a-z0-9-]{3,40}$/
export type LatLng = { lat: number; lng: number } | { landmark: string };  // landmark ids come from S02's landmark table
export type DistrictId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9' | 'D10';

/** content/races/<id>/source.json — what the author writes. */
export interface RaceSource {
  schema: 1; id: RaceId; version: number; kind: RaceKind; titleKey: string; district: DistrictId;
  waypoints: LatLng[];                                                     // ≥ 2; snapped to drivable edges ≤ 25 m
  via?: LatLng[];                                                          // forced pass-through points between waypoints
  laps?: number; closedLoop?: boolean;
  gateOverrides?: { at: LatLng; widthM?: number; timeBonusSec?: number; speedCam?: boolean; remove?: boolean }[];
  closures?: { at: LatLng; propSet: 'barrier-line' | 'cones-line' | 'construction' }[];
  zones?: { id: string; ring: LatLng[]; kind: 'drift' | 'sideshow' | 'finish' }[];   // drift scoring and sideshow ring areas
  hour?: number; weather?: WeatherPreset;                                  // WeatherPreset = engine-world.ts
  traffic: 'off' | 'light' | 'normal'; peds: 'sidewalk';
  opponents: { driverId: string; vehicleDef: string; skill: number }[];    // skill 0..1, ≤ 7
  classLimit?: VehicleClass[]; loaner?: string;                            // loaner = VehicleInstance defId when the garage has no legal car
  police: { enabled: boolean; startHeat: HeatLevel; maxHeat: HeatLevel; roadblocks?: ScriptedBlock[]; success?: 'evade' | { surviveSec: number } };
  rubberBand: number;                                                      // 0..1 event strength; ×difficulty factor
  rewards: RaceReward[]; unlocks?: string[];                               // UnlockEventId strings
  xr: 'full' | 'none';                                                     // default by kind, see main §6
  story?: { hookId: string };                                              // C09 mission hook that embeds this event (assumption A-S06-4)
}
export type ScriptedBlock = { atS: number /* route metres */; kind: 'roadblock2' | 'roadblockHeavy' | 'spikes'; minHeat: HeatLevel; gapM: number };

/** content/races/<id>/race.json — compiled, committed, hash-pinned. Runtime loads this. */
export interface RaceDef extends Omit<RaceSource, 'waypoints' | 'via' | 'gateOverrides' | 'closures' | 'zones'> {
  worldBake: string;                                                       // C08 bake hash; mismatch → re-snap or CI fail (5 % length rule)
  waypoints: LatLng[];                                                     // kept for re-snap
  route: { edgeIds: number[]; dir: 1 | -1 }[];                             // C08 RoadGraph edges, ordered
  routeLenM: number; elevation: { s: number; y: number }[];                // every 25 m, for HUD and validator
  gates: GateDef[]; closures: { s: number; lat: number; lng: number; propSet: string }[];
  zones: { id: string; kind: 'drift' | 'sideshow' | 'finish'; ringEnu: [number, number][] }[];
  grid: { s: number; lane: number; offsetM: number }[];                    // grid slots as route positions, 6 m spacing
  jumpZones: { s0: number; s1: number }[];                                 // from C08 `jumpZones` tag
  line: { stepM: 5; curvature: number[] /* 1e-4 1/m, i16 */; offsetCm: number[] };   // racing-line data for AI and HUD
  parSec: number; parBotHash: string;                                      // headless canonical bot result (V12)
  medals: [number, number, number];                                        // bronze, silver, gold seconds = par ×1.25, ×1.12, ×1.04
  version: number;
}
export interface GateDef { s: number; widthM: number; kind: 'start' | 'gate' | 'finish' | 'lap' | 'speedCam';
  timeBonusSec?: number; at: [number, number, number] /* ENU, f64 */; tangent: [number, number] }

export interface RaceReward { kind: 'cash' | 'rep' | 'vehicle' | 'unlock' | 'item'; place?: number; cents?: number; rep?: number; ref?: string; firstTimeOnly?: boolean }

/** Validator output, `pnpm map:races validate --json`. */
export interface RaceValidationReport { id: RaceId; ok: boolean;
  findings: { rule: `V${number}`; level: 'error' | 'warn'; message: string; s?: number }[]; stats: { lengthM: number; maxGradePct: number; gates: number; jumps: number } }
```

```ts
// packages/shared/src/racing/referee.ts — pure; used by the sim, by headless bots and by RoomDO (M12c) so all agree on gate logic
export interface RefereeState { gate: number; lap: number; s: number; sWindow: number; wrongWayTicks: number; stuckTicks: number;
  timeLeftMs: number | null; speedSum: number; driftScore: number; finished: boolean; dnf: boolean }
export declare function crossedGate(g: GateDef, prev: [number, number, number], cur: [number, number, number]): boolean; // segment test in XZ, |Δy| ≤ 6 m, dot(tangent, motion) > 0
export declare function projectToRoute(def: RaceDef, p: [number, number, number], windowFrom: number): { s: number; lateralM: number };
export declare function refereeStep(def: RaceDef, st: RefereeState, prev: [number, number, number], cur: [number, number, number], speedMps: number, tick: number): RaceEvent[];
export declare function placeOrder(states: readonly { id: number; st: RefereeState; tickLastGate: number }[]): number[];   // by (lap, gate, -distanceToNext, tick)
export type RaceEvent =
  | { t: 'race.gate'; i: number; tick: number; speedMps: number } | { t: 'race.lap'; lap: number; ms: number } | { t: 'race.finish'; ms: number; tick: number }
  | { t: 'race.dnf'; reason: 'time' | 'totaled' | 'busted' | 'abandon' } | { t: 'race.wrongway' } | { t: 'race.respawn'; at: number };
```

### 4.2.1 Validator rules (each error fails CI)

**V1** edge continuity; **V2** one-way violation (warn); **V3** length in range per kind (sprint 1.2–12 km, circuit lap 1.0–4 km, hillclimb 0.6–3 km, others 0.5–8 km); **V4** max grade ≤ 41 % (flag jump zones above 12 % crest change); **V5** circuit closure within 15 m and 25°; **V6** gate spacing ≤ 260 m, width ≥ 10 m, none inside a closure; **V7** every intersecting side street within 30 m of the route has a closure prop or `traffic: off`; **V8** grid slots fit the lane count (6 m spacing, 3.2 m lanes); **V9** no route node outside `config/world.bounds.json` or in a portal/water zone; **V10** all landmark ids exist; **V11** hour and weather valid; **V12** `parSec` present and reproduced by the bot; **V13** compiled JSON ≤ 64 KiB; **V14** pursuit kinds have `police.enabled` and `startHeat ≥ 1`; **V15** opponents' vehicles legal for `classLimit`. The same validator runs in `dv mod check` for data-tier race mods with caps (≤ 64 gates, ≤ 7 opponents, ≤ 120 edges).

## 4.3 Replay, ghost, leaderboard payloads (R-MODE-02)

```ts
// packages/shared/src/racing/replay.ts
export interface ReplayHeaderV1 {
  v: 1; raceId: RaceId; raceVersion: number; worldBake: string; buildId: string; profile: 'local' | 'canonical';
  seed: number; vehicleDef: string; handlingRev: number; upgrades: Partial<Record<UpgradeSlot, number>>; assists: AssistSettings;
  difficulty: Difficulty; hour: number; weather: string; startTick: number; finishTick: number | null; gateTicks: number[];
  endHash: string;                                                         // FNV-1a-64 hex of vehicle components at finishTick (C02 rule 7 order)
}
/** Inputs section: per tick (steer i8, throttle u7, brake u7, buttons u16 = Handbrake|Nitro|Ability|LookBehind bits), RLE of identical
 *  consecutive frames as (count varint, 5 bytes). Typical 90 s lap ≈ 2–4 KB. Track section: every 3rd tick (20 Hz): zigzag-varint deltas of
 *  x/z in 2 cm, y in 4 cm, yaw u16 delta, speed u8 (kph/2). ≈ 4 B/sample → 7 KB per 90 s. */
export declare function encodeReplay(h: ReplayHeaderV1, inputs: readonly number[], track: Int32Array | null): Uint8Array;
export declare function decodeReplay(b: Uint8Array): { h: ReplayHeaderV1; inputs: Uint32Array; track: Int32Array | null };
export const REPLAY_LIMITS = { maxInputsBytes: 12_288, maxTrackBytes: 16_384, maxDurationSec: 600, keyframeEveryTicks: 300 } as const;
export interface GhostEntry { vehicleDef: string; ms: number; profile: 'local' | 'canonical'; buildId: string; worldBake: string;
  inputsB64: string | null; trackB64: string; savedAt: number }

// Route 21 (C12), semantics owned by S06 (validator), transport by S09. Proposed type — see main §10 CCP-6.
export interface ScoreSubmit { board: string /* 'racing.<raceId>.time' | 'racing.<raceId>.score' */; value: number; raceId: RaceId; raceVersion: number;
  worldBake: string; buildId: string; vehicleDef: string; handlingRev: number; gateTicks: number[]; replayB64: string; replaySha256: string }
export interface ScoreRow { rank: number; name: string; value: number; verified: boolean; vehicleDef: string }
```

## 4.4 Save slice and unlocks (R-MODE-05)

```ts
// C05 slot 'mode:racing' (SliceKind 'racing', schema 1, ≤ 1.5 MiB by RACING_SLICE_MAX_BYTES; C05 caps 2 MiB)
export interface RacingSlice {
  rep: number; purseCents: number;                                         // own wallet; story wallet untouched (currency firewall, D-S06-04)
  settings: { difficulty: Difficulty; assists: AssistSettings; units: 'kph' | 'mph'; vehicleView: VehicleView; hud: 'full' | 'minimal'; ghost: 'off' | 'best' | 'friend' };
  ladder: { beaten: string[]; current: number };                           // rival ids; current = 10 … 1
  events: Record<RaceId, { bestMs?: number; bestScore?: number; medals: 0 | 1 | 2 | 3; plays: number; lastPlayed: number }>;
  ghosts: Record<RaceId, GhostEntry>;                                      // best per event; evicted oldest-first above the byte cap
  pursuit: { bountyRecord: number; longestSec: number; evaded: number; busted: number };
  vehicleHeat: Record<string, number>;                                     // StableKey veh:<id> → heat 0..5 (standalone; story keeps its own in StorySlice.heat)
  stats: { races: number; wins: number; distanceKm: number; driftScoreBest: number; airtimeBestSec: number; takedowns: number };
}
export const RACING_SLICE_MAX_BYTES = 1_572_864;
```

| UnlockEventId (C06 `^unlock\.`) | Emitted by | Grants |
|---|---|---|
| `unlock.racing` | first `racing` mode encounter (C09 hook, Act 1 mission 3 in every premise; `core.firstEncounters`) | menu tile `racing`; starter garage (D class loaner set) |
| `unlock.racing.class.c`, `.b`, `.a`, `.s` | Rep levels 3, 7, 11, 15 | vehicles of that class become buyable; events with that `classLimit` open |
| `unlock.racing.ladder.<n>` (n = 10 … 1) | beating rival n | `vehicles: [reward car]`, `districts: [district]` |
| `unlock.racing.robotaxi` | Robotaxi Rush A8 (story) or ladder rival 5 | `vehicles: ['vehicle.halcyon-cormorant']` jailbroken variant |
| `unlock.racing.event.<raceId>` | story hook completion | the event as a free event |

## 4.5 Components, anim states, SimEvents, telemetry (C01, C04, C16)

Component ids 1024–1279 (owner S06; hashed = included in `stateHash`):

| id | Name | Fields | hashed | snapshot |
|---|---|---|---|---|
| 1024 | RaceParticipant | instance u16, gate u16, lap u8, place u8, sM f32, finishTick u32, flags u8 (human, ai, dnf, ghost) | yes | net |
| 1025 | AiDriver | driver u32 (str), skill u8, lineOffsetCm i16, rbMult f32, mode u8 (follow, overtake, recover), stuckTicks u16 | yes | none |
| 1026 | Drift | angleDeg f32, ticks u16, chain f32, score f32 | yes | render |
| 1027 | Nitro | charge f32, on u8, lockTicks u16 | yes | render+net |
| 1028 | VehicleQuirk | hopCharges u8, hopRechargeTicks u16, stallTicks u16, governed u8, autoYieldActive u8 | yes | net |
| 1029 | GhostPlayback | replay u32 (str), cursor u32, track u8 | yes | render |
| 1030 | RaceMarker | gate u16, kind u8, state u8 | no | render |
| 1031 | Surface | kind u8, wetness u8 (written by the vehicle system, read by audio/VFX) | no | render |

`AnimStateId` block **128–159 reserved by S06** (ADR in Wave 5; engine ids 0–22 unchanged): 128 vehicle idle, 129 driving, 130 braking, 131 drifting, 132 nitro, 133 airborne, 134 hop, 135 wrecked, 136 stalled, 137 sirens on (police variant), 138–143 reserved; 144 driver celebrate, 145 driver dejected, 146 driver reset-wave, 147 repair kneel, 148 photo pose; 149–159 reserved. Vehicle entities carry these in the SNAP `anim` byte so remote cars show nitro, drift and wreck state.

SimEvents emitted: `race.countdown`, `race.go`, `race.gate`, `race.lap`, `race.finish`, `race.dnf`, `race.wrongway`, `race.respawn`, `veh.impact` (n = vNormal×10), `veh.totaled`, `veh.nitro`, `veh.hop`, `veh.shift`, `drift.chain`, `pursuit.evaded`, `pursuit.busted` (the last two are S01's, listed because the mode listens to them).

Telemetry names proposed to S09 (C16 closed registry; props ≤ 16, no free text, no positions): `racing.start {raceKind, class, tier, profile}`, `racing.finish {raceKind, outcome, durBucket, place, medals}`, `racing.pursuit_end {heatMax, outcome, durBucket}`, `racing.photo {tier}`, `racing.replay_view {mode: 'exact'|'track'}`, `racing.verify_fail {reason}`.

## 4.6 Config files (all JSON Schema validated in CI; hot-reload in `VITE_DV_QA` builds)

```ts
// config/racing.json
export interface RacingConfig {
  schema: 1;
  tierCaps: Record<QualityTierId, { rivals: number; policeCars: number; cullM: number; skidSegments: number;
                                    envProbe: 'grid' | 'baked'; wheelBlur: boolean; sparkParticles: number }>;
  models: { m1PromoteM: 70; m1DemoteM: 100; m1MaxActive: Record<QualityTierId, number> };
  ai: { lookaheadBaseM: 6; lookaheadPerMps: 0.25; speedFactorMin: 0.82; speedFactorMax: 0.98; brakeMarginMax: 1.25; mistakePerCorner: 0.06;
        overtakeGapM: 25; overtakeHoldSec: 1.5; recoverStuckSec: 3; offRouteTeleportM: 40; thinkHz: 30 };
  rubberBand: { maxPct: 0.08; gapScaleM: 150; freezeLastPct: 0.15; difficulty: Record<Difficulty, number>; underdogNitro: 1.25; powerCapPct: 0.08 };
  nitro: { nearMissM: 1.5; nearMissKph: 80; draftWindowSec: 1.2; draftLateralM: 1.5; draftKph: 100; perfectStartWindowSec: 0.25; perfectStartNitroPct: 10 };
  damage: { vThreshold: 3; k: 0.0016; engineShareFront: 0.5; spikePuncture: 1.0; landingVy: 6; repairKitPct: 30; bustRepairPct: 5;
            difficulty: Record<Difficulty, number>; /* 0.6 / 1.0 / 1.2 */ };
  race: { countdownTicks: 180; jumpStartM: 0.5; jumpStartPenaltySec: 3; wrongWayWarnM: 30; wrongWayRespawnSec: 6; stuckResetSec: 3;
          resetPenaltySec: 5; flipResetSec: 3; gateTolerantY: 6; defaultGateWidthM: 14; minGateWidthM: 10; autoGateEveryM: 250; autoGateTurnDeg: 60 };
  drift: { minAngleDeg: 8; chainBreakSec: 1.0; comboStep: 0.1; comboMax: 5; wallPenalty: 0.5 };
  progression: { repThresholds: number[] /* 20 levels */; classRepLevel: { C: 3; B: 7; A: 11; S: 15 }; purseDollars: Record<'D'|'C'|'B'|'A'|'S', number>;
                 placeMult: number[]; medalMult: [1.0, 1.25, 1.5, 2.0] };
  replay: typeof REPLAY_LIMITS;
  photo: { radiusM: 30; fovDeg: [18, 90]; exposureEv: [-2, 2]; filters: number /* LUT count */; };
  xr: { allowKinds: RaceKind[]; vignetteBoostPerYawRate: number };
}
```

```jsonc
// config/pursuit.race.json — same PursuitConfig shape as config/pursuit.json (S01) plus the `race` block; loaded when setProfile({kind:'race'})
{ "schema": 1, "extends": "config/pursuit.json",
  "race": {
    "unitSpeedOfPlayerTop": [0, 0.92, 0.97, 1.00, 1.03, 1.06],   // max unit speed as a fraction of the player's current top speed, heat 0..5
    "catchUp": { "farM": 200, "boost": 1.15, "spawnBehindM": 120, "outOfViewOnly": true },
    "roadblock": { "predictGates": 3, "replanSec": 2.5, "gapM": { "3": 5.5, "4": 4.5, "5": 3.2 }, "heightM": 1.6, "armBeforeM": 140 },
    "spikes": { "lengthM": 9, "lanes": 2, "telegraphM": 90, "perPursuit": { "4": 2, "5": 3 }, "cooldownSec": 25 },
    "bounty": { "perSecAtHeat": 10, "perTakedown": 500, "centsPerPoint": 10 },
    "evade": { "bustMinHeat": 1, "repairFeePct": 5 }
  } }
```

`config/net.speedcaps.json` rows S06 supplies (m/s; S09 applies its 25 % tolerance): `foot 12, D 58, C 77, B 89, A 105, S 119, R 63, police 73, default 95`. Derivation: the class envelope's maximum top speed × 1.12 (nitro over-speed `maxOverTopPct` plus margin) ÷ 3.6, rounded up to the next m/s; police uses the interceptor's 260 kph; R uses the jailbroken 200 kph ceiling.

## 4.7 Wire and view-model shapes

```ts
// C11 EV Activity.data for modeId 'racing' (≤ 768 B JSON; server writes, clients read). MP details in main §2.14.
export interface RaceActivityData { v: 1; race: RaceId; rv: number; laps: number; st: 'grid' | 'countdown' | 'run' | 'fin'; t0: number /* server tick of GO */;
  cls: VehicleClass[] | null; players: { s: number; g: number; l: number; ms?: number; dnf?: 1 }[] }   // ≤ 8 players ≈ 28 B each

// Published each tick to S10 through ModeContext.ui (view model keys; S10 renders)
export interface RaceHudVm { speed: number; unit: 'kph' | 'mph'; rpm01: number; gear: number; nitro01: number; place: number; of: number; lap: number; laps: number;
  gate: number; gates: number; timerMs: number; timeLeftMs: number | null; split: { gate: number; deltaMs: number } | null;
  heat: { level: number; phase: string; cooldown01: number; bounty: number } | null; damage: { body: number; engine: number; tires: number[] };
  hop: { charges: number; ready01: number } | null; govern: boolean; driftScore: number | null; wrongWay: boolean; prompt: string | null }
```
