/**
 * Race types (06-racing-data.md 4.2; M07a1). Authoring uses lat/lng and landmark ids; the compiled `RaceDef` adds C08 edge ids
 * pinned to a bake. Pure types and constants: the C02 lint applies, and nothing here does IO.
 *
 * Two additive fields on `RaceDef.line` against the spec text (BD-M07a1-01): `start` and `dxz`, the centreline every `stepM`
 * metres in whole decimetres (a start point and integer deltas), so the referee projects the car on the route without the
 * road graph. Integers keep the compiled file small (V13) and make the decode exact on every device.
 */
import type { DistrictId, LandmarkId } from '../world/c08.ts';
import type { LatLng } from '../world/c08-api.ts';
import type { HeatLevel } from '../contracts/engine-pursuit.ts';
import type { WeatherPreset } from '../contracts/engine-world.ts';
import type { VehicleClass } from '../vehicle/handling.ts';

export type RaceKind = 'sprint' | 'circuit' | 'checkpoint' | 'speedtrap' | 'downhill' | 'hillclimb' | 'drift' | 'pursuit' | 'sideshow' | 'robotaxiRush';
export const RACE_KINDS: readonly RaceKind[] = ['sprint', 'circuit', 'checkpoint', 'speedtrap', 'downhill', 'hillclimb', 'drift', 'pursuit', 'sideshow', 'robotaxiRush'];
/** `sf.<kind>.<slug>` */
export type RaceId = string;
export const RACE_ID_PATTERN = /^sf\.[a-z]+\.[a-z0-9-]{3,40}$/;

export type RacePoint = LatLng | { landmark: LandmarkId };
export const isLandmarkPoint = (p: RacePoint): p is { landmark: LandmarkId } => typeof (p as { landmark?: unknown }).landmark === 'string';

export interface ScriptedBlock { atS: number; kind: 'roadblock2' | 'roadblockHeavy' | 'spikes'; minHeat: HeatLevel; gapM: number }
export interface RaceReward { kind: 'cash' | 'rep' | 'vehicle' | 'unlock' | 'item'; place?: number; cents?: number; rep?: number; ref?: string; firstTimeOnly?: boolean }

/** content/races/<id>/source.json: what the author writes. */
export interface RaceSource {
  schema: 1;
  id: RaceId;
  version: number;
  kind: RaceKind;
  titleKey: string;
  district: DistrictId;
  /** At least 2; snapped to drivable edges within 25 m. */
  waypoints: RacePoint[];
  via?: RacePoint[];
  laps?: number;
  closedLoop?: boolean;
  gateOverrides?: { at: RacePoint; widthM?: number; timeBonusSec?: number; speedCam?: boolean; remove?: boolean }[];
  closures?: { at: RacePoint; propSet: 'barrier-line' | 'cones-line' | 'construction' }[];
  zones?: { id: string; ring: RacePoint[]; kind: 'drift' | 'sideshow' | 'finish' }[];
  hour?: number;
  weather?: WeatherPreset;
  traffic: 'off' | 'light' | 'normal';
  peds: 'sidewalk';
  /** At most 7. */
  opponents: { driverId: string; vehicleDef: string; skill: number }[];
  classLimit?: VehicleClass[];
  loaner?: string;
  police: { enabled: boolean; startHeat: HeatLevel; maxHeat: HeatLevel; roadblocks?: ScriptedBlock[]; success?: 'evade' | { surviveSec: number } };
  rubberBand: number;
  rewards: RaceReward[];
  unlocks?: string[];
  xr: 'full' | 'none';
  story?: { hookId: string };
}

export interface GateDef {
  /** Route metres of the gate. */
  s: number;
  widthM: number;
  kind: 'start' | 'gate' | 'finish' | 'lap' | 'speedCam';
  timeBonusSec?: number;
  /** ENU, f64: x, y, z. */
  at: [number, number, number];
  /** Unit travel direction in x, z. */
  tangent: [number, number];
}

/** content/races/<id>/race.json: compiled, committed, hash-pinned. The runtime loads this. */
export interface RaceDef extends Omit<RaceSource, 'waypoints' | 'via' | 'gateOverrides' | 'closures' | 'zones'> {
  /** C08 bake id the route was compiled on. */
  worldBake: string;
  waypoints: RacePoint[];
  route: { edgeIds: number[]; dir: 1 | -1 }[];
  routeLenM: number;
  /** Every 25 m. */
  elevation: { s: number; y: number }[];
  gates: GateDef[];
  closures: { s: number; lat: number; lng: number; propSet: string }[];
  zones: { id: string; kind: 'drift' | 'sideshow' | 'finish'; ringEnu: [number, number][] }[];
  grid: { s: number; lane: number; offsetM: number }[];
  jumpZones: { s0: number; s1: number }[];
  line: {
    stepM: 5;
    /** 1e-4 1/m, i16. */
    curvature: number[];
    offsetCm: number[];
    /** BD-M07a1-01: first centreline point in decimetres, x then z. */
    start: [number, number];
    /** BD-M07a1-01: deltas of the next points in decimetres, x, z pairs; point k is start + sum of the first k pairs. */
    dxz: number[];
  };
  parSec: number;
  parBotHash: string;
  /** Bronze, silver, gold seconds. */
  medals: [number, number, number];
  version: number;
}

export interface RaceValidationReport {
  id: RaceId;
  ok: boolean;
  findings: { rule: `V${number}`; level: 'error' | 'warn'; message: string; s?: number }[];
  stats: { lengthM: number; maxGradePct: number; gates: number; jumps: number };
}

/** The centreline points of a compiled race, decimetres to metres: [x0, z0, x1, z1, ...]. */
export function centreline(def: Pick<RaceDef, 'line'>): Float64Array {
  const d = def.line.dxz;
  const out = new Float64Array(2 + d.length);
  let x = def.line.start[0];
  let z = def.line.start[1];
  out[0] = x * 0.1;
  out[1] = z * 0.1;
  for (let i = 0; i < d.length; i += 2) {
    x += d[i] as number;
    z += d[i + 1] as number;
    out[2 + i] = x * 0.1;
    out[3 + i] = z * 0.1;
  }
  return out;
}
