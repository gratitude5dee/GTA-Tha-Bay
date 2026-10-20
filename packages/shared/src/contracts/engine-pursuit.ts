// packages/shared/src/contracts/engine-pursuit.ts — C06 1.1.0, PursuitDirector core. Copied from spec/domains/01-engine-save-modes.md
// ("PursuitDirector core" and its 1.1 additions) without shape changes; owner S01.
import type { EntityHandle, StableKey } from './c01-ecs.ts';

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
export interface PursuitProfile {
  kind: 'story' | 'race'; startHeat: HeatLevel; maxHeat: HeatLevel; success?: { kind: 'evade' } | { kind: 'survive'; sec: number };
  /** 1.1: e.g. 'config/pursuit.race.json' (S06 CCP-2). */
  configRef?: string;
}
export interface PursuitApi {
  state(): Readonly<HeatState>;
  report(k: InfractionKind, at: [number, number, number], witness: 'police' | 'robotaxi' | 'ped' | 'heli', count?: number): void;
  setHeat(l: HeatLevel, reason: string): void; capHeat(l: HeatLevel): void; clear(reason: string): void;
  setProfile(p: PursuitProfile): void;
  /** 1.1: predicted race route for roadblocks; null unsets. */
  setRouteHint(edgeIds: readonly number[] | null): void;
  vehicleHeat(vehicleKey: string): number; respray(vehicleKey: string): void;
  spawnNamedUnit(prefabId: string, key: StableKey): EntityHandle;
}
