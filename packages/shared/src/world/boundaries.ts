/**
 * World edge rules that the world package and the engine both apply (02-world-maps.md section 4.1; M02c1, DL-685, DL-691).
 * Pure and deterministic; C02 lint applies. They live here so `packages/world` (the shore respawn, the play-bounds wall) and
 * the engine (`vehicle-system.ts` in M03a1, the swim owner) import one rule without an engine to world import.
 */

/** Water deeper than this at the wheels (or the chest, on foot) counts as wet. */
export const WATER_WALL_DEPTH_M = 0.6;
/** Ticks (1.5 s at 60 Hz) a body stays wet before a vehicle stalls. */
export const WATER_WALL_TICKS = 90;

/** What `waterWall` remembers between calls: how long the body has been wet and whether it already stalled. */
export interface WaterWallState {
  wetTicks: number;
  stalled: boolean;
}

export const WATER_WALL_DRY: Readonly<WaterWallState> = Object.freeze({ wetTicks: 0, stalled: false });

export type WaterWallVerdict = 'ok' | 'stall' | 'respawn';

export interface WaterWallStep {
  state: WaterWallState;
  verdict: WaterWallVerdict;
}

/**
 * One step of the water soft wall. `ticks` is the number of sim ticks since the previous call (1 when called every tick).
 *
 * - depth at or below `WATER_WALL_DEPTH_M`: the wet time resets and the verdict is `ok` (a stalled body still respawns);
 * - deeper: the wet time grows; the call that reaches `WATER_WALL_TICKS` returns `stall` (tick 90, not 89), the next call
 *   returns `respawn` (the world side then places the body at the nearest road-adjacent `ShoreNode`).
 */
export function waterWall(state: Readonly<WaterWallState>, depthM: number, ticks = 1): WaterWallStep {
  if (state.stalled) return { state: { wetTicks: state.wetTicks, stalled: true }, verdict: 'respawn' };
  if (!(depthM > WATER_WALL_DEPTH_M)) return { state: { wetTicks: 0, stalled: false }, verdict: 'ok' };
  const wet = state.wetTicks + (ticks > 0 ? ticks : 0);
  if (wet >= WATER_WALL_TICKS) return { state: { wetTicks: wet, stalled: true }, verdict: 'stall' };
  return { state: { wetTicks: wet, stalled: false }, verdict: 'ok' };
}

/** Width of the invisible wall outside `play`, metres (02-world-maps.md 4.1 c). */
export const PLAY_WALL_MARGIN_M = 50;
/** Cameras and aircraft clamp here. */
export const PLAY_MAX_Y_M = 600;

/** Length of the fog ramp before a county-line edge, metres, and the fog far-plane factor at the line. */
export const COUNTY_FOG_RAMP_M = 150;
export const COUNTY_FOG_MIN = 0.4;

/** Fog far-plane factor at `distM` from the nearest county-line edge: 1 at 150 m or more, falling linearly to 0.4 at the line. */
export function countyFogFactor(distM: number): number {
  if (!(distM < COUNTY_FOG_RAMP_M)) return 1;
  const d = distM > 0 ? distM : 0;
  return COUNTY_FOG_MIN + ((1 - COUNTY_FOG_MIN) * d) / COUNTY_FOG_RAMP_M;
}

/**
 * Pushes a ground body back inside the play box plus the wall margin (the capsule wall). `bounds` is `config/world.bounds.json`
 * `play`. Returns the clamped position and whether it moved.
 */
export function clampToPlayWall(
  x: number,
  z: number,
  play: { minX: number; maxX: number; minZ: number; maxZ: number },
  margin = PLAY_WALL_MARGIN_M,
): { x: number; z: number; clamped: boolean } {
  const cx = x < play.minX - margin ? play.minX - margin : x > play.maxX + margin ? play.maxX + margin : x;
  const cz = z < play.minZ - margin ? play.minZ - margin : z > play.maxZ + margin ? play.maxZ + margin : z;
  return { x: cx, z: cz, clamped: cx !== x || cz !== z };
}
