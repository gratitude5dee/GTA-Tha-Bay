/**
 * Boundaries (M02c1, DL-691; 02-world-maps.md section 4.1). Runtime rules on top of the portals and the queries; the pure rules
 * (`waterWall`, the fog ramp, the play-wall clamp) are in `@dv/shared`'s `world/boundaries.ts`.
 *
 *  - **County line.** A static barrier across each county-line portal edge (`barrierPrism`), a fog ramp over the last 150 m
 *    (`countyFogFactor`: 1 at 150 m, 0.4 at the line, written to the snapshot side block as `wf`), and the SimEvent
 *    `{t: 'world.boundary', s: 'countyLine'}` once per approach (the player comes within 30 m of the line and has not been
 *    farther than 90 m since). M04a2 maps the event to the toast `world.boundary.countyLine`.
 *  - **Play bounds.** `config/world.bounds.json` `play` plus 50 m is an invisible wall for ground bodies (`playWallPrisms`, four
 *    thick boxes just outside it); cameras and aircraft clamp at `maxY` 600 m.
 *  - **Water.** The soft wall for vehicles is `waterWall` (shared); `nearestShore` finds the respawn point.
 * Pure; C02 lint applies.
 */
import {
  COUNTY_FOG_RAMP_M, PLAY_MAX_Y_M, PLAY_WALL_MARGIN_M, countyFogFactor, datan2, dsin, dcos, dsqrt, TWO_PI,
  type ChunkKey, type Portal, type ShoreNode,
} from '@dv/shared';
import type { RoadGraph } from '../graph/query.ts';
import type { ChunkSource } from './query.ts';

/** The player is "at the line" within this of a county-line portal, metres. */
export const COUNTY_TRIGGER_M = 30;
/** The approach latch resets once the player is this far from every county-line portal. */
export const COUNTY_RESET_M = 90;
/** Barrier box: thickness and the height above the road, metres; it extends this far past the road width on each side. */
export const BARRIER_THICKNESS_M = 0.8;
export const BARRIER_HEIGHT_M = 4;
export const BARRIER_SHOULDER_M = 1.5;
/** Thickness of the play-bounds wall boxes, metres. */
export const PLAY_WALL_THICKNESS_M = 100;
/** A shore node counts as road-adjacent when a drivable edge runs within this of it, metres. */
export const SHORE_ROAD_M = 15;
/** How far `nearestShore` looks, metres. */
export const SHORE_SEARCH_M = 700;

export interface WorldBoundaryEvent {
  tick: number;
  s: 'countyLine';
}

const prism = (base: number, height: number, pts: readonly number[]): number[] => [pts.length / 2, base, height, ...pts];

/**
 * A wall across the road at a portal: a box centred on the portal, `thickness` along the travel direction and as wide as the
 * road plus a shoulder on each side. Packed as a C08 `PrismPack` record (counter-clockwise).
 */
export function barrierPrism(p: Pick<Portal, 'x' | 'y' | 'z' | 'yaw' | 'widthM'>): number[] {
  // forward is (-sin yaw, -cos yaw); across the road is (cos yaw, -sin yaw)
  const fx = -dsin(p.yaw), fz = -dcos(p.yaw);
  const ax = dcos(p.yaw), az = -dsin(p.yaw);
  const hw = p.widthM / 2 + BARRIER_SHOULDER_M, ht = BARRIER_THICKNESS_M / 2;
  const c = (sa: number, sf: number): [number, number] => [p.x + ax * hw * sa + fx * ht * sf, p.z + az * hw * sa + fz * ht * sf];
  const q = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
  const flat: number[] = [];
  for (const [x, z] of q) flat.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
  return prism(p.y - 1, BARRIER_HEIGHT_M, flat);
}

/** Four boxes around `play` plus the wall margin: west, east, north, south, each `PLAY_WALL_THICKNESS_M` thick. */
export function playWallPrisms(play: { minX: number; maxX: number; minZ: number; maxZ: number }): number[] {
  const m = PLAY_WALL_MARGIN_M, t = PLAY_WALL_THICKNESS_M;
  const x0 = play.minX - m, x1 = play.maxX + m, z0 = play.minZ - m, z1 = play.maxZ + m;
  const base = -200, h = 1000 + PLAY_MAX_Y_M;
  const box = (ax: number, az: number, bx: number, bz: number): number[] => prism(base, h, [ax, az, bx, az, bx, bz, ax, bz]);
  return [
    ...box(x0 - t, z0 - t, x0, z1 + t),
    ...box(x1, z0 - t, x1 + t, z1 + t),
    ...box(x0, z0 - t, x1, z0),
    ...box(x0, z1, x1, z1 + t),
  ];
}

export interface BoundaryPlayer {
  x: number;
  z: number;
}

export class BoundaryRuntime {
  /** Fog far-plane factor from the last `step` (1 away from the line). */
  fog = 1;
  lastEvent: WorldBoundaryEvent | null = null;
  private latched = false;
  private readonly county: Portal[];

  constructor(portals: readonly Portal[], private readonly onEvent: (e: WorldBoundaryEvent) => void = () => undefined) {
    this.county = portals.filter((p) => p.kind === 'county-line').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Distance from a point to the nearest county-line portal; Infinity when the world has none. */
  distToCountyLine(x: number, z: number): number {
    let best = Infinity;
    for (const p of this.county) {
      const d = dsqrt((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z));
      if (d < best) best = d;
    }
    return best;
  }

  /** One sim tick: updates the fog factor and fires the county-line event once per approach. */
  step(tick: number, me: BoundaryPlayer | null): void {
    if (!me || this.county.length === 0) {
      this.fog = 1;
      return;
    }
    const d = this.distToCountyLine(me.x, me.z);
    this.fog = d < COUNTY_FOG_RAMP_M ? countyFogFactor(d) : 1;
    if (!this.latched && d <= COUNTY_TRIGGER_M) {
      this.latched = true;
      this.lastEvent = { tick, s: 'countyLine' };
      this.onEvent(this.lastEvent);
    } else if (this.latched && d > COUNTY_RESET_M) {
      this.latched = false;
    }
  }

  /** Barrier prisms of the county-line portals whose centre lies in `key`'s chunk, for the statics feed. */
  barriersIn(key: ChunkKey, chunkOf: (x: number, z: number) => ChunkKey): number[] {
    const out: number[] = [];
    for (const p of this.county) if (chunkOf(p.x, p.z) === key) out.push(...barrierPrism(p));
    return out;
  }
}

/** The shore node closest to (x, z) among the resident chunks, nearest first, ties by id. `roadAdjacent` needs a drivable edge within 15 m. */
export function nearestShoreNode(
  chunks: ChunkSource,
  keys: readonly ChunkKey[],
  x: number,
  z: number,
  roadAdjacent: boolean,
  graph: RoadGraph | null,
): ShoreNode | null {
  let best: { n: ShoreNode; d: number } | null = null;
  for (const key of keys) {
    const c = chunks.payload(key);
    if (!c) continue;
    for (const n of c.tags.shoreNodes) {
      const d = dsqrt((n.x - x) * (n.x - x) + (n.z - z) * (n.z - z));
      if (d > SHORE_SEARCH_M || (best !== null && (d > best.d || (d === best.d && n.id >= best.n.id)))) continue;
      if (roadAdjacent && (!graph || graph.nearestEdge(n.x, n.z, undefined, SHORE_ROAD_M) === null)) continue;
      best = { n, d };
    }
  }
  return best ? best.n : null;
}

/**
 * Where a body that fell in the water is put: the shore node pushed 2 m inland, facing inland (the outward normal reversed).
 * The vehicle water wall hands this to `TeleportApi.request('respawn', pose)`.
 */
export function shoreRespawnPose(n: ShoreNode): { x: number; z: number; yaw: number } {
  return { x: n.x - n.nx * 2, z: n.z - n.nz * 2, yaw: yawOfDir(-n.nx, -n.nz) };
}

/** Engine yaw (radians in [0, 2 pi)) of a direction: forward is (-sin yaw, -cos yaw). */
export function yawOfDir(dx: number, dz: number): number {
  const y = datan2(-dx, -dz);
  return y < 0 ? y + TWO_PI : y;
}
