/**
 * City Transit buses (living part 5; M03b2): a bus follows the edge list of a baked pattern (`data/transit-routes.v1`, snapped to the
 * road graph by M02a2), at 0.85 x the edge limit up to 11 m/s, and dwells 8 s at each baked stop of its pattern. At the end of the
 * pattern it starts again from the first edge. The route position is a distance along the summed edge lengths (`lenDm` of the
 * always-resident topology), so it does not depend on which chunks are resident; only the pose does (BD-M03b2-07).
 * Pure; C02 lint applies.
 */
import { datan2, dsqrt, TWO_PI } from '@dv/shared';
import type { RoadNetwork } from '../graph/adjacency.ts';
import type { EdgePaths } from '../traffic/plan.ts';
import { TRANSIT_CONFIG, type TransitRows } from './components.ts';
import type { TransitMover } from './mover.ts';
import type { TransitRoutesData } from './path.ts';

/** A bus drives this far right of the edge centreline, metres (inside the 0.5 m path tolerance of AC-12). */
export const BUS_LATERAL_M = 0.45;

export interface BusStop {
  id: string;
  /** Metres along the pattern. */
  s: number;
}

export class BusRoute {
  readonly id: string;
  readonly edges: readonly number[];
  /** Metres at the start of each edge, then the total as the last entry. */
  readonly cum: Float64Array;
  readonly stops: readonly BusStop[];
  readonly length: number;

  constructor(pattern: TransitRoutesData['bus'][number], lenOf: (e: number) => number) {
    this.id = pattern.id;
    this.edges = pattern.edges;
    this.cum = new Float64Array(pattern.edges.length + 1);
    let acc = 0;
    for (let i = 0; i < pattern.edges.length; i++) {
      this.cum[i] = acc;
      acc += lenOf(pattern.edges[i] as number);
    }
    this.cum[pattern.edges.length] = acc;
    this.length = acc;
    const stops: BusStop[] = [];
    for (const st of pattern.stops) {
      const at = pattern.edges.indexOf(st.edge);
      if (at < 0) continue;
      const s = (this.cum[at] as number) + Math.min(st.s, lenOf(st.edge));
      stops.push({ id: st.id, s });
    }
    stops.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.stops = stops;
  }

  /** Index of the edge that holds distance `s` along the pattern. */
  edgeAt(s: number): number {
    const n = this.edges.length;
    if (n === 0) return -1;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.cum[mid] as number) <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

export const busRoutes = (d: TransitRoutesData, net: Pick<RoadNetwork, 'lenDm'>): BusRoute[] =>
  d.bus.map((p) => new BusRoute(p, (e) => net.lenDm(e) / 10)).filter((r) => r.edges.length > 0 && r.length > 1);

/** Speed on the edge: 0.85 of the limit, capped. */
export const busSpeed = (limit: number, c: TransitRows = TRANSIT_CONFIG): number => {
  const v = limit * c.speeds.busFactor;
  return v < c.speeds.busMaxMps ? v : c.speeds.busMaxMps;
};
export const busDwellTicks = (c: TransitRows = TRANSIT_CONFIG): number => Math.round(c.dwell.busS * 60);

/** One AI step. The first stop at or after the bus's position is `m.stop`. */
export function stepBus(m: TransitMover, r: BusRoute, limitOf: (e: number) => number, c: TransitRows, step: number, stepTicks: number): void {
  if (m.dwell > 0) {
    m.dwell = m.dwell > stepTicks ? m.dwell - stepTicks : 0;
    m.speed = 0;
    return;
  }
  const at = r.edgeAt(m.s);
  const v = busSpeed(limitOf(r.edges[at < 0 ? 0 : at] as number), c);
  m.speed = v;
  let s = m.s + v * step;
  const stop = r.stops[m.stop];
  if (stop && m.s < stop.s && s >= stop.s) {
    s = stop.s;
    m.dwell = busDwellTicks(c);
    m.speed = 0;
    m.stop++;
  }
  if (s >= r.length) {
    s -= r.length;
    m.stop = 0;
    // a stop right at the start of the pattern is served on the next lap
    while (m.stop < r.stops.length && (r.stops[m.stop] as BusStop).s < s) m.stop++;
  }
  m.s = s;
}

/** Pose of a bus at `m.s`: the edge geometry when the edge is resident, else the straight line between its end nodes (never drawn near the player). */
export function busPose(m: TransitMover, r: BusRoute, paths: EdgePaths, net: RoadNetwork, out: Float64Array): void {
  const at = r.edgeAt(m.s);
  if (at < 0) return;
  const e = r.edges[at] as number;
  const within = m.s - (r.cum[at] as number);
  if (paths.pose(e, within, BUS_LATERAL_M, out)) {
    m.x = out[0] as number;
    m.y = out[1] as number;
    m.z = out[2] as number;
    m.yaw = out[3] as number;
    m.hx = out[4] as number;
    m.hz = out[5] as number;
    return;
  }
  const a = net.from(e), b = net.to(e);
  const x0 = net.nodeX(a), z0 = net.nodeZ(a), x1 = net.nodeX(b), z1 = net.nodeZ(b);
  const len = (r.cum[at + 1] as number) - (r.cum[at] as number);
  const u = len > 0 ? within / len : 0;
  const dx = x1 - x0, dz = z1 - z0;
  const dl = dsqrt(dx * dx + dz * dz);
  m.x = x0 + dx * u;
  m.z = z0 + dz * u;
  m.y = net.nodeY(a) + (net.nodeY(b) - net.nodeY(a)) * u;
  m.hx = dl > 0 ? dx / dl : 0;
  m.hz = dl > 0 ? dz / dl : -1;
  let yaw = datan2(-m.hx, -m.hz);
  if (yaw < 0) yaw += TWO_PI;
  m.yaw = yaw;
}
