/**
 * Roadblock placement (M03c): `roadblock2` (two cruisers angled across the lane with barriers) and `roadblockHeavy` (two SUVs, a
 * longer barrier line). Where it goes:
 *
 *  - with a route hint (`setRouteHint`, the predicted race route): the first hinted edge ahead of the player whose middle lies between
 *    `MIN_AHEAD_M` and `MAX_AHEAD_M` from the player;
 *  - otherwise on the predicted A* route: the route from the player to a point `PREDICT_M` ahead along the heading, and the edge where
 *    the route reaches `TARGET_AHEAD_M`.
 *
 * Sim code under the C02 lint.
 */
import type { EdgeId } from '@dv/shared';
import type { PlayerView, PursuitWorld, Vec3 } from '../ports.ts';
import { dist2, forwardOf, rightOf } from './follow.ts';

export const MIN_AHEAD_M = 90;
export const MAX_AHEAD_M = 420;
export const TARGET_AHEAD_M = 190;
export const PREDICT_M = 700;

export type RoadblockKind = 'roadblock2' | 'roadblockHeavy';

export interface BlockSpec {
  kind: RoadblockKind;
  edge: EdgeId;
  /** Lane centre where the block stands. */
  pos: Vec3;
  /** Heading of the road there. */
  yaw: number;
  /** Where the two units park and the heading they take (angled to the road). */
  unitSlots: { pos: Vec3; yaw: number }[];
  barriers: { pos: Vec3; yaw: number }[];
}

/** Builds the block that stands on `edge` at lane point (`pos`, `yaw`). Pure geometry. */
export function blockAt(kind: RoadblockKind, edge: EdgeId, pos: Vec3, yaw: number): BlockSpec {
  const [rx, rz] = rightOf(yaw);
  const across = (m: number): Vec3 => [pos[0] + rx * m, pos[1], pos[2] + rz * m];
  const angle = kind === 'roadblockHeavy' ? 1.15 : 0.95;
  const unitSlots = [
    { pos: across(-2.6), yaw: yaw + angle },
    { pos: across(2.6), yaw: yaw - angle },
  ];
  const nBarriers = kind === 'roadblockHeavy' ? 7 : 5;
  const barriers: BlockSpec['barriers'] = [];
  for (let i = 0; i < nBarriers; i++) {
    const m = (i - (nBarriers - 1) / 2) * 1.5;
    const [fx, fz] = forwardOf(yaw);
    // the line sits 4 m ahead of the units, so the units are in front of the barriers as the player sees them
    barriers.push({ pos: [pos[0] + rx * m - fx * 4, pos[1], pos[2] + rz * m - fz * 4], yaw });
  }
  return { kind, edge, pos, yaw, unitSlots, barriers };
}

/** The edge and distance of the block on the player's predicted way, or null when the world has none ahead. */
export function planRoadblock(world: PursuitWorld, player: PlayerView, kind: RoadblockKind, hint: readonly number[] | null): BlockSpec | null {
  const [fx, fz] = forwardOf(player.yaw);
  const ahead = (x: number, z: number): number => (x - player.pos[0]) * fx + (z - player.pos[2]) * fz;
  if (hint && hint.length > 0) {
    for (const edge of hint) {
      const len = world.edgeLength(edge);
      const mid = world.lanePoint(edge, len / 2);
      if (!mid) continue;
      const d = dist2(mid.x, mid.z, player.pos[0], player.pos[2]);
      if (d < MIN_AHEAD_M || d > MAX_AHEAD_M || ahead(mid.x, mid.z) <= 0) continue;
      return blockAt(kind, edge, [mid.x, mid.y, mid.z], mid.yaw);
    }
    return null;
  }
  const route = world.route(
    { x: player.pos[0], z: player.pos[2] },
    { x: player.pos[0] + fx * PREDICT_M, z: player.pos[2] + fz * PREDICT_M },
  );
  if (!route || route.edges.length === 0) return null;
  let run = 0;
  let first = true;
  for (const edge of route.edges) {
    const len = world.edgeLength(edge);
    if (first) {
      // the player is somewhere on the first edge: its tail does not count
      first = false;
      run += len * 0.5;
      continue;
    }
    if (run + len >= TARGET_AHEAD_M) {
      const mid = world.lanePoint(edge, len / 2);
      if (!mid) return null;
      const d = dist2(mid.x, mid.z, player.pos[0], player.pos[2]);
      if (d < MIN_AHEAD_M || d > MAX_AHEAD_M) return null;
      return blockAt(kind, edge, [mid.x, mid.y, mid.z], mid.yaw);
    }
    run += len;
  }
  return null;
}
