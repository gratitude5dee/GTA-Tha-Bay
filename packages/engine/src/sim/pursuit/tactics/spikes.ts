/**
 * Spike strips (M03c): placed only at C08 `chokePoints` tags ahead of the player, preferably on the predicted route. A strip is a
 * `prop.spikestrip` across the lane; a tire whose contact point lies on it gets health 0 (the vehicle damage state takes grip
 * x 0.4 for a dead tire).
 *
 * Sim code under the C02 lint.
 */
import type { ChokePoint } from '@dv/shared';
import type { PlayerView, PursuitWorld, VehicleView, Vec3 } from '../ports.ts';
import { dist2, forwardOf, rightOf } from './follow.ts';

export const SPIKE_MIN_AHEAD_M = 100;
export const SPIKE_MAX_AHEAD_M = 450;
/** Half length of the strip along the road and the least half width across it, metres. */
export const STRIP_HALF_ALONG_M = 0.5;
export const STRIP_MIN_HALF_ACROSS_M = 3.2;

/** Tire contact points in the vehicle frame (right, forward) in the order FL, FR, RL, RR (the vehicle prefabs' wheel layout). */
const TIRES: readonly (readonly [number, number])[] = [[-0.81, 1.33], [0.81, 1.33], [-0.81, -1.57], [0.81, -1.57]];

export interface StripSpec {
  /** The choke point it stands at. */
  tag: string;
  pos: Vec3;
  yaw: number;
  halfAcrossM: number;
}

/** The strip for the best choke point ahead, or null. `routeEdges` (the predicted route) is preferred when given. */
export function planSpikes(world: PursuitWorld, player: PlayerView, routeEdges: readonly number[] | null, exclude: ReadonlySet<string>): StripSpec | null {
  const [fx, fz] = forwardOf(player.yaw);
  const cx = player.pos[0] + fx * 250, cz = player.pos[2] + fz * 250;
  const found = world.chokePointsNear(cx, cz, 320);
  let best: ChokePoint | null = null;
  let bestScore = -1e9;
  for (const cp of found) {
    if (exclude.has(cp.id)) continue;
    const d = dist2(cp.x, cp.z, player.pos[0], player.pos[2]);
    const ahead = (cp.x - player.pos[0]) * fx + (cp.z - player.pos[2]) * fz;
    if (d < SPIKE_MIN_AHEAD_M || d > SPIKE_MAX_AHEAD_M || ahead < d * 0.5) continue;
    const onRoute = routeEdges !== null && routeEdges.includes(cp.edge) ? 1000 : 0;
    const score = onRoute - d;
    if (score > bestScore || (score === bestScore && best !== null && cp.id < best.id)) {
      best = cp;
      bestScore = score;
    }
  }
  if (!best) return null;
  const road = world.nearestRoad(best.x, best.z, 30);
  const lane = road ? world.lanePoint(road.edge, road.s) : null;
  return {
    tag: best.id,
    pos: [best.x, lane ? lane.y : best.y, best.z],
    yaw: lane ? lane.yaw : player.yaw,
    halfAcrossM: Math.max(STRIP_MIN_HALF_ACROSS_M, best.widthM / 2),
  };
}

/** World position of tire `k` of a vehicle. */
export function tirePoint(v: Pick<VehicleView, 'pos' | 'yaw'>, k: number): [number, number] {
  const t = TIRES[k] as readonly [number, number];
  const [fx, fz] = forwardOf(v.yaw);
  const [rx, rz] = rightOf(v.yaw);
  return [v.pos[0] + rx * t[0] + fx * t[1], v.pos[2] + rz * t[0] + fz * t[1]];
}

/**
 * The tires of `v` on the strip now. The strip is longer along the road by the distance the vehicle covers in one director step
 * (`|speed| / 30`), so a fast car cannot step over it between two steps.
 */
export function crossedTires(strip: StripSpec, v: VehicleView): number[] {
  const out: number[] = [];
  const along = forwardOf(strip.yaw);
  const across = rightOf(strip.yaw);
  const halfAlong = STRIP_HALF_ALONG_M + Math.abs(v.speed) / 30;
  for (let k = 0; k < 4; k++) {
    const [x, z] = tirePoint(v, k);
    const dx = x - strip.pos[0], dz = z - strip.pos[2];
    if (Math.abs(dx * along[0] + dz * along[1]) <= halfAlong && Math.abs(dx * across[0] + dz * across[1]) <= strip.halfAcrossM) out.push(k);
  }
  return out;
}
