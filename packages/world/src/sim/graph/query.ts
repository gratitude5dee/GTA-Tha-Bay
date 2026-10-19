/**
 * `RoadGraphQuery` (M02c1; C08 section 3): the road network as the engine and the modes ask about it.
 *
 *  - `edge`, `neighbours`: the network, with detail (lanes, width) for resident chunks only;
 *  - `nearestEdge`, `resolve`: the closest directed edge to a point, from resident centrelines first and the topology chords
 *    beyond; with a height it separates layers (an overpass 8 m up is 8 m away from the road under it);
 *  - `laneCentre`: position and yaw at a distance along a lane (C08 rule 10);
 *  - `route`: the A* of `astar.ts` with the closures of `TrafficControl` avoided;
 *  - `signal`: the aspect of a movement now.
 * Pure; C02 lint applies.
 */
import {
  EdgeFlag, GRID_MIN_M, CHUNK_EDGE_M, TWO_PI, datan2, dsqrt, enuFromLatLng,
  type Aspect, type ChunkKey, type EdgeId, type EdgePos, type NodeId, type RoadEdge, type RoadGraphQuery, type Route, type RouteRequest,
} from '@dv/shared';
import { RoadNetwork } from './adjacency.ts';
import { Router, type RouteResult } from './astar.ts';
import { ChordIndex, nearestOnPolyline, pointAlong, polylineLength } from './geometry.ts';
import { JunctionRuntime, type JunctionClock } from './junctions.ts';

export interface RoadGraphDeps extends JunctionClock {
  /** Edges closed by `TrafficControl`. */
  closed(e: EdgeId): boolean;
}

/** How far an `{x, z}` route endpoint looks for a road, metres. */
export const ROUTE_SNAP_M = 150;
/** How far `resolve(lat, lng)` looks for a road, metres. */
export const RESOLVE_SNAP_M = 60;

export interface EdgeHit {
  edge: EdgeId;
  s: number;
  distM: number;
}

export interface DetailedRoute extends Route {
  wrongWay: boolean[];
  expanded: number;
}

export class RoadGraph implements RoadGraphQuery {
  readonly router: Router;
  readonly junctions: JunctionRuntime;
  private chords: ChordIndex | null = null;
  private readonly tmp = new Float64Array(5);

  constructor(readonly net: RoadNetwork, private readonly deps: RoadGraphDeps) {
    this.router = new Router(net);
    this.junctions = new JunctionRuntime(net, deps);
  }

  edge(id: EdgeId): Readonly<RoadEdge> | null {
    return this.net.resident(id)?.edge ?? null;
  }

  neighbours(node: NodeId): readonly EdgeId[] {
    return Array.from(this.net.out(node));
  }

  signal(node: NodeId, movement: number): Aspect {
    return this.junctions.aspect(node, movement);
  }

  // ---- nearest edge --------------------------------------------------------------------------------------------------------

  nearestEdge(x: number, z: number, y: number | undefined, maxM: number, classMask?: number): EdgeHit | null {
    return this.snap(x, z, y, maxM, classMask, false);
  }

  /** `topologyOnly` ignores resident geometry, so the answer does not depend on which chunks are resident. */
  snap(x: number, z: number, y: number | undefined, maxM: number, mask: number | undefined, topologyOnly: boolean): EdgeHit | null {
    const net = this.net;
    if (!topologyOnly) {
      const e = CHUNK_EDGE_M[9];
      const i0 = Math.floor((x - maxM - GRID_MIN_M) / e), i1 = Math.floor((x + maxM - GRID_MIN_M) / e);
      const j0 = Math.floor((z - maxM - GRID_MIN_M) / e), j1 = Math.floor((z + maxM - GRID_MIN_M) / e);
      let best: (EdgeHit & { key: number; right: number }) | null = null;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const key = `9/${i}/${j}` as ChunkKey;
          if (!net.hasChunk(key)) continue;
          for (const id of net.chunkEdges(key)) {
            const r = net.resident(id);
            if (!r) continue;
            if (mask !== undefined && ((mask >>> r.edge.cls) & 1) === 0) continue;
            const near = nearestOnPolyline(r.seg.pts, x, z);
            const dist = y === undefined ? near.d : dsqrt(near.d * near.d + (y - near.y) * (y - near.y));
            if (dist > maxM) continue;
            const side = (x - near.x) * -near.tz + (z - near.z) * near.tx;
            const right = r.edge.dir === 1 ? (side >= 0 ? 1 : 0) : side < 0 ? 1 : 0;
            const k = Math.round(dist * 100);
            if (best === null || k < best.key || (k === best.key && (right > best.right || (right === best.right && id < best.edge)))) {
              const poly = polylineLength(r.seg.pts);
              const scale = poly > 0 ? r.seg.lengthM / poly : 1;
              const along = near.s * scale;
              best = { edge: id, s: r.edge.dir === 1 ? along : r.seg.lengthM - along, distM: dist, key: k, right };
            }
          }
        }
      }
      if (best) return { edge: best.edge, s: best.s, distM: best.distM };
    }
    if (!net.hasTopology) return null;
    this.chords ??= new ChordIndex(net);
    const h = this.chords.nearest(x, z, y, maxM, mask, topologyOnly ? undefined : (e) => net.resident(e) !== undefined);
    return h ? { edge: h.edge, s: h.s, distM: h.d } : null;
  }

  // ---- positions on edges --------------------------------------------------------------------------------------------------

  /**
   * Position and heading at `s` metres along a directed edge, on its centreline (no lane offset): x, y, z, then the unit travel
   * direction (tx, tz). Resident geometry when the chunk is resident (and `topologyOnly` is false), else the chord of the
   * topology. Returns false when the edge is unknown or has no geometry.
   */
  pointOnEdge(edge: EdgeId, s: number, out: Float64Array, topologyOnly = false): boolean {
    const net = this.net;
    if (!net.has(edge)) return false;
    const len = net.lenDm(edge) / 10;
    const ss = s < 0 ? 0 : s > len ? len : s;
    const r = topologyOnly ? undefined : net.resident(edge);
    if (r) {
      const poly = polylineLength(r.seg.pts);
      pointAlong(r.seg.pts, len > 0 ? (ss * poly) / len : 0, r.edge.dir === -1, out);
      return true;
    }
    if (!net.hasTopology) return false;
    const a = net.from(edge), b = net.to(edge);
    const ax = net.nodeX(a), az = net.nodeZ(a), bx = net.nodeX(b), bz = net.nodeZ(b);
    const t = len > 0 ? ss / len : 0;
    const dx = bx - ax, dz = bz - az;
    const l = dsqrt(dx * dx + dz * dz);
    out[0] = ax + dx * t;
    out[1] = net.nodeY(a) + (net.nodeY(b) - net.nodeY(a)) * t;
    out[2] = az + dz * t;
    out[3] = l > 0 ? dx / l : 0;
    out[4] = l > 0 ? dz / l : -1;
    return true;
  }

  /** x, y, z and yaw of a lane position (C08 rule 10); NaN when the edge has no geometry. */
  laneCentre(e: EdgePos, out: Float64Array): void {
    const t = this.tmp;
    if (!this.pointOnEdge(e.edge, e.s, t)) {
      out[0] = out[1] = out[2] = out[3] = Number.NaN;
      return;
    }
    const tx = t[3] as number, tz = t[4] as number;
    let off = 1.5 * (e.lane + 0.5);
    const r = this.net.resident(e.edge);
    if (r) {
      const ed = r.edge;
      off = (ed.flags & EdgeFlag.OneWay) !== 0 || ed.twin < 0
        ? (e.lane + 0.5 - ed.lanes / 2) * ed.laneWidthM
        : ed.medianM / 2 + (e.lane + 0.5) * ed.laneWidthM;
    }
    // positive to the right of travel: (-tz, tx) in ENU with -Z north
    out[0] = (t[0] as number) - tz * off;
    out[1] = t[1] as number;
    out[2] = (t[2] as number) + tx * off;
    let yaw = datan2(-tx, -tz);
    if (yaw < 0) yaw += TWO_PI;
    out[3] = yaw;
  }

  resolve(lat: number, lng: number): { edge: EdgeId; s: number } | null {
    const p = enuFromLatLng(lat, lng);
    const h = this.nearestEdge(p.x, p.z, undefined, RESOLVE_SNAP_M);
    return h ? { edge: h.edge, s: h.s } : null;
  }

  // ---- routes --------------------------------------------------------------------------------------------------------------

  route(r: RouteRequest): Route | null {
    const d = this.routeDetailed(r);
    return d ? { edges: d.edges, lengthM: d.lengthM, etaS: d.etaS, complete: d.complete } : null;
  }

  routeDetailed(r: RouteRequest): DetailedRoute | null {
    const topo = r.useTopology === true;
    const from = this.endpoint(r.from, r.classMask, topo);
    const to = this.endpoint(r.to, r.classMask, topo);
    if (!from || !to) return null;
    const res: RouteResult | null = this.router.route({
      start: { edge: from.edge, s: from.s },
      goal: { edge: to.edge, s: to.s, x: to.x, z: to.z },
      maxExpand: r.maxExpand,
      avoid: r.avoid,
      closed: (e) => this.deps.closed(e),
      classMask: r.classMask,
      allowWrongWay: r.allowWrongWay,
      useTopology: topo,
    });
    if (!res) return null;
    return { edges: res.edges, lengthM: res.lengthM, etaS: res.etaS, complete: res.complete, wrongWay: res.wrongWay, expanded: res.expanded };
  }

  private endpoint(p: RouteRequest['from'], mask: number | undefined, topo: boolean): { edge: EdgeId; s: number; x: number; z: number } | null {
    const t = this.tmp;
    if ('edge' in p) {
      if (!this.net.has(p.edge) || !this.pointOnEdge(p.edge, p.s, t, topo)) return null;
      return { edge: p.edge, s: p.s, x: t[0] as number, z: t[2] as number };
    }
    const h = this.snap(p.x, p.z, undefined, ROUTE_SNAP_M, mask, topo);
    if (!h) return null;
    // the estimate aims at the point on the road, not at the requested point (which may be off the road)
    return this.pointOnEdge(h.edge, h.s, t, topo) ? { edge: h.edge, s: h.s, x: t[0] as number, z: t[2] as number } : { edge: h.edge, s: h.s, x: p.x, z: p.z };
  }
}
