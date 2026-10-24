/**
 * Route waypoints on the C08 road graph (M05a1, M05c1, M05c2): the lane centre of each edge of a route every 12 m, then the end point.
 * The story autoplayer walks and drives along them, and the NPC drivers of `tasks.ts` follow the same polyline. Sim code under the C02 lint.
 */
import type { WorldApi } from '@dv/shared';
import { dcos, dsin } from '@dv/shared';
import type { Vec3 } from './actors.ts';

function soft<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && e.name === 'NotYetAvailable') return undefined;
    throw e;
  }
}

/** Metres between the waypoints sampled along an edge (M05c1: an edge of a real bake can be hundreds of metres long and bend). */
const ROUTE_STEP_M = 12;
const ROUTE_MAX_POINTS = 600;
const ROUTE_LANE_OFFSET_M = 3;
/** A route point closer than this to the one before it is dropped (the joins of two edges). */
const ROUTE_MIN_GAP_M = 3.5;

/**
 * Route waypoints from a C08 route: the lane centre of each edge every `ROUTE_STEP_M` metres, then the end point. `avoid` is a set of
 * edge ids the route must not use (an edge a bot got stuck on); `edgesOut` receives the edge of each returned point.
 */
export function routeWaypoints(world: WorldApi, a: Vec3, b: Vec3, yaw?: number, avoid?: ReadonlySet<number>, edgesOut?: number[]): Vec3[] | null {
  // A router snaps a point to the edge whose right-hand side it lies on. A driver that faces a heading starts 3 m to the right of it, so
  // that it gets the lane it points along, not the twin lane that would need a U-turn (M05c1).
  const fromX = yaw === undefined ? a[0] : a[0] + dcos(yaw) * ROUTE_LANE_OFFSET_M;
  const fromZ = yaw === undefined ? a[2] : a[2] - dsin(yaw) * ROUTE_LANE_OFFSET_M;
  // A walker has no heading: the router starts it on the lane whose right-hand side it stands on and cannot turn it round on that
  // edge, so it is routed from the point and from four points 3 m around it and takes the shortest answer. It also ignores one-way
  // streets (M05c2).
  // `routeDetailed` also says which edges are driven backwards (a one-way street walked the wrong way); the graph of a real world has it
  type Detailed = { edges: number[]; lengthM: number; wrongWay?: boolean[] };
  const graph = world.graph as unknown as { routeDetailed?: (r: unknown) => Detailed | null; route: (r: unknown) => Detailed | null };
  const ask = (x: number, z: number): Detailed | null | undefined =>
    soft(() => {
      const req = { from: { x, z }, to: { x: b[0], z: b[2] }, maxExpand: 6000, ...(yaw === undefined ? { allowWrongWay: true } : {}), ...(avoid && avoid.size > 0 ? { avoid } : {}) };
      return graph.routeDetailed ? graph.routeDetailed(req) : graph.route(req);
    });
  let r: Detailed | null | undefined;
  if (yaw === undefined) {
    for (const [ox, oz] of [[0, 0], [ROUTE_LANE_OFFSET_M, 0], [-ROUTE_LANE_OFFSET_M, 0], [0, ROUTE_LANE_OFFSET_M], [0, -ROUTE_LANE_OFFSET_M]] as const) {
      const c = ask(fromX + ox, fromZ + oz);
      if (c && c.edges.length > 0 && (!r || c.lengthM < r.lengthM)) r = c;
    }
  } else r = ask(fromX, fromZ);
  if (!r || r.edges.length === 0) return null;
  const out: Vec3[] = [];
  const buf = new Float64Array(4);
  const d2 = (x: number, z: number, q: Vec3): number => (x - q[0]) * (x - q[0]) + (z - q[2]) * (z - q[2]);
  for (let k = 0; k < r.edges.length; k++) {
    const e = r.edges[k] as number;
    const reversed = r.wrongWay?.[k] === true;
    // the last edge is only entered: the goal (appended below) lies somewhere along it, so its samples stop at the one nearest the goal
    const lastEdge = k === r.edges.length - 1;
    const edgePts: Vec3[] = [];
    for (let at = 0; at < 4000 && out.length + edgePts.length < ROUTE_MAX_POINTS; at += ROUTE_STEP_M) {
      soft(() => world.graph.laneCentre({ edge: e, s: at, lane: 0 }, buf));
      // NaN: the edge is not resident; a sample that did not move: past the end of the edge (the lane point clamps)
      if (Number.isNaN(buf[0] as number)) break;
      const last = edgePts[edgePts.length - 1] ?? out[out.length - 1];
      if (at > 0 && last && d2(buf[0] as number, buf[2] as number, last) < 0.25) break;
      edgePts.push([buf[0] as number, buf[1] as number, buf[2] as number]);
    }
    // an edge walked against its direction is sampled from its far end
    if (reversed) edgePts.reverse();
    // the first edge starts wherever the edge starts, maybe far behind the driver: drop the samples before the one nearest to it
    if (k === 0 && edgePts.length > 1) {
      let first = 0;
      for (let i = 1; i < edgePts.length; i++) if (d2((edgePts[i] as Vec3)[0], (edgePts[i] as Vec3)[2], a) < d2((edgePts[first] as Vec3)[0], (edgePts[first] as Vec3)[2], a)) first = i;
      edgePts.splice(0, first);
    }
    if (lastEdge && edgePts.length > 1) {
      let best = 0;
      for (let i = 1; i < edgePts.length; i++) if (d2((edgePts[i] as Vec3)[0], (edgePts[i] as Vec3)[2], b) < d2((edgePts[best] as Vec3)[0], (edgePts[best] as Vec3)[2], b)) best = i;
      edgePts.length = best + 1;
    }
    out.push(...edgePts);
    if (edgesOut) for (let i = 0; i < edgePts.length; i++) edgesOut.push(e);
  }
  out.push([b[0], b[1], b[2]]);
  if (edgesOut) edgesOut.push(r.edges[r.edges.length - 1] as number);
  // Where two edges meet, the end of one lane and the start of the next lie a metre or two apart and sideways: such samples make a
  // zig-zag that no driver should follow, so a point within ROUTE_MIN_GAP_M of the one kept before it is dropped (the goal stays).
  const kept: Vec3[] = [];
  const keptEdges: number[] = [];
  for (let i = 0; i < out.length; i++) {
    const q = out[i] as Vec3;
    const last = kept[kept.length - 1];
    if (last && i < out.length - 1 && d2(q[0], q[2], last) < ROUTE_MIN_GAP_M * ROUTE_MIN_GAP_M) continue;
    if (last && i === out.length - 1 && d2(q[0], q[2], last) < 0.25) {
      kept[kept.length - 1] = q;
      continue;
    }
    kept.push(q);
    if (edgesOut) keptEdges.push(edgesOut[i] as number);
  }
  if (edgesOut) edgesOut.splice(0, edgesOut.length, ...keptEdges);
  return kept;
}

