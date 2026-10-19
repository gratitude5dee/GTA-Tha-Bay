/**
 * `WorldResolver` (M02c1; C08 section 3, A-C08-1): the load-time resolver the mission and event compilers and the tools use to
 * turn authored latitude and longitude (or a landmark) into ENU positions on real geometry.
 *
 *  - `snap` returns the nearest valid target of a kind and its distance, or null when that is more than 25 m away (a mission
 *    reference the compilers then reject): `ground` is land (water is skipped), `road` the centreline of the nearest drivable
 *    edge, `sidewalk` the pedestrian graph, `none` the point itself;
 *  - `route` plans the edges between consecutive points on the topology graph, so it does not depend on residency.
 * Yaw is in radians (engine convention: forward is (-sin yaw, -cos yaw)). Pure; C02 lint applies.
 */
import {
  TWO_PI, datan2, dsqrt, enuFromLatLng,
  type ChunkKey, type LandmarkId, type LatLng, type SnapRequest, type WorldResolver,
} from '@dv/shared';
import type { RoadGraph } from '../graph/query.ts';
import type { PlaceIndexImpl } from './places.ts';
import type { WorldQueryImpl } from './query.ts';

/** Farthest a snap may move a point, metres (C08 `WorldResolver.snap`). */
export const SNAP_MAX_M = 25;
/** Route budget of a resolver route leg. */
export const RESOLVER_EXPAND = 200_000;

const DEG = Math.PI / 180;
const normYaw = (y: number): number => {
  const m = y % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
};

export class WorldResolverImpl implements WorldResolver {
  private readonly tmp = new Float64Array(5);

  constructor(
    readonly bake: string,
    private readonly graph: RoadGraph,
    private readonly query: WorldQueryImpl,
    private readonly places: PlaceIndexImpl,
  ) {}

  toEnu(ll: LatLng): [number, number, number] {
    const p = enuFromLatLng(ll.lat, ll.lng);
    return [p.x, this.query.groundY(p.x, p.z) ?? 0, p.z];
  }

  landmark(id: LandmarkId): { enu: [number, number, number]; chunkKey: ChunkKey } | null {
    const l = this.places.landmark(id);
    if (!l) return null;
    return { enu: [l.x, this.query.groundY(l.x, l.z) ?? 0, l.z], chunkKey: l.chunk };
  }

  snap(p: SnapRequest): { pos: [number, number, number]; yaw: number; distM: number } | null {
    let x: number, z: number, y = p.y;
    if ('landmark' in p.at) {
      const l = this.places.landmark(p.at.landmark);
      if (!l) return null;
      x = l.x;
      z = l.z;
    } else {
      const e = enuFromLatLng(p.at.lat, p.at.lng);
      x = e.x;
      z = e.z;
    }
    const yawArg = p.yawDeg !== undefined ? normYaw(p.yawDeg * DEG) : undefined;
    switch (p.snap) {
      case 'none':
        return { pos: [x, y ?? this.query.groundY(x, z) ?? 0, z], yaw: yawArg ?? 0, distM: 0 };
      case 'ground': {
        const gy = this.query.groundY(x, z, y);
        // chunks that are not resident cannot be checked at load time: the point stands as authored
        if (gy === null) return { pos: [x, y ?? 0, z], yaw: yawArg ?? 0, distM: 0 };
        if (!this.query.isWater(x, z)) return { pos: [x, gy, z], yaw: yawArg ?? 0, distM: 0 };
        let best: { x: number; z: number; d: number } | null = null;
        for (let dz = -SNAP_MAX_M; dz <= SNAP_MAX_M; dz += 1) {
          for (let dx = -SNAP_MAX_M; dx <= SNAP_MAX_M; dx += 1) {
            const d = dsqrt(dx * dx + dz * dz);
            if (d > SNAP_MAX_M || (best !== null && d >= best.d)) continue;
            if (this.query.groundY(x + dx, z + dz) !== null && !this.query.isWater(x + dx, z + dz)) best = { x: x + dx, z: z + dz, d };
          }
        }
        if (!best) return null;
        y = this.query.groundY(best.x, best.z) ?? 0;
        return { pos: [best.x, y, best.z], yaw: yawArg ?? 0, distM: best.d };
      }
      case 'road': {
        const h = this.graph.nearestEdge(x, z, y, SNAP_MAX_M);
        if (!h || !this.graph.pointOnEdge(h.edge, h.s, this.tmp)) return null;
        const t = this.tmp;
        const heading = normYaw(datan2(-(t[3] as number), -(t[4] as number)));
        return { pos: [t[0] as number, t[1] as number, t[2] as number], yaw: yawArg ?? heading, distM: h.distM };
      }
      case 'sidewalk': {
        const w = this.query.nearestWalkable(x, z, SNAP_MAX_M);
        if (!w) return null;
        return { pos: [w.x, w.y, w.z], yaw: yawArg ?? 0, distM: dsqrt((w.x - x) * (w.x - x) + (w.z - z) * (w.z - z)) };
      }
    }
  }

  route(via: LatLng[]): number[] | null {
    if (via.length < 2) return null;
    const edges: number[] = [];
    for (let i = 0; i + 1 < via.length; i++) {
      const a = enuFromLatLng((via[i] as LatLng).lat, (via[i] as LatLng).lng);
      const b = enuFromLatLng((via[i + 1] as LatLng).lat, (via[i + 1] as LatLng).lng);
      const r = this.graph.route({ from: { x: a.x, z: a.z }, to: { x: b.x, z: b.z }, maxExpand: RESOLVER_EXPAND, useTopology: true });
      if (!r) return null;
      for (const e of r.edges) if (edges.length === 0 || edges[edges.length - 1] !== e) edges.push(e);
    }
    return edges;
  }
}
