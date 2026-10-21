/**
 * `PursuitWorld` over the C08 `WorldApi` the world module registers on `services.world` (M03c). Only public interface members are
 * used (`graph`, `query`), plus the engine's own `WorldBoundsPort` and `WorldTagsPort`; the engine never imports `@dv/world` (DL-692).
 *
 * `RoadGraphQuery` has no edge length, so the adapter finds it once per edge by walking `laneCentre` until the point stops moving
 * and refining the end by bisection; lengths and nothing else are cached.
 *
 * Sim code under the C02 lint.
 */
import { dsqrt } from '@dv/shared';
import type { ChokePoint, EdgeId, HidingSpot, Portal, WorldApi } from '@dv/shared';
import type { WorldBoundsPort } from '../world/index.ts';
import type { LanePoint, PursuitWorld, RoadHit, RoutePath, WorldTagsPort } from './ports.ts';

const ROUTE_EXPAND = 6000;
const LENGTH_STEP_M = 10;
const LENGTH_MAX_M = 3000;

export interface WorldPortParts {
  api: WorldApi;
  bounds: WorldBoundsPort | null;
  tags: WorldTagsPort | null;
}

export function pursuitWorldFrom(parts: WorldPortParts): PursuitWorld {
  const { api, bounds, tags } = parts;
  const out = new Float64Array(4);
  const lengths = new Map<EdgeId, number>();

  const point = (edge: EdgeId, s: number): LanePoint | null => {
    api.graph.laneCentre({ edge, s, lane: 0 }, out);
    if (Number.isNaN(out[0] as number)) return null;
    return { x: out[0] as number, y: out[1] as number, z: out[2] as number, yaw: out[3] as number };
  };
  const apart = (a: LanePoint, b: LanePoint): number => dsqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));

  const lengthOf = (edge: EdgeId): number => {
    const have = lengths.get(edge);
    if (have !== undefined) return have;
    let prev = point(edge, 0);
    if (!prev) return 0;
    let lo = 0;
    let hi = -1;
    for (let s = LENGTH_STEP_M; s <= LENGTH_MAX_M; s += LENGTH_STEP_M) {
      const p = point(edge, s);
      if (!p) return 0;
      if (apart(prev, p) < 0.25) {
        hi = s;
        break;
      }
      prev = p;
      lo = s;
    }
    if (hi < 0) hi = lo;
    // the end lies in (lo, hi]: bisect on "has the point stopped moving"
    const endPt = point(edge, hi);
    for (let k = 0; k < 7 && endPt; k++) {
      const mid = (lo + hi) / 2;
      const p = point(edge, mid);
      if (p && apart(p, endPt) < 0.25) hi = mid;
      else lo = mid;
    }
    lengths.set(edge, hi);
    return hi;
  };

  return {
    nearestRoad(x, z, maxM): RoadHit | null {
      const h = api.graph.nearestEdge(x, z, undefined, maxM);
      return h ? { edge: h.edge, s: h.s, distM: h.distM } : null;
    },
    route(from, to): RoutePath | null {
      const r = api.graph.route({ from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, maxExpand: ROUTE_EXPAND });
      return r ? { edges: r.edges, lengthM: r.lengthM, complete: r.complete } : null;
    },
    lanePoint: point,
    edgeLength: lengthOf,
    edgeWidth(edge) {
      const e = api.graph.edge(edge);
      return e ? e.lanes * e.laneWidthM : 0;
    },
    hidingSpotAt(x, z): HidingSpot | null {
      return tags ? tags.hidingSpotAt(x, z) : null;
    },
    chokePointsNear(x, z, r): ChokePoint[] {
      return tags ? tags.chokePointsNear(x, z, r) : [];
    },
    portals: (): readonly Portal[] => (bounds ? bounds.portals() : []),
    setPortalState: (id, state, by) => (bounds ? bounds.setPortalState(id, state, by) : false),
    releasePortals(by) {
      bounds?.release(by);
    },
    sealedPortals: () => (bounds ? bounds.sealedPortals() : []),
  };
}
