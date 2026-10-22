/**
 * `MapApi` data side (M02c1; C08 `MapApi`): the blip table, the waypoint and the GPS route. The minimap and the full map that
 * draw them are M02c2.
 *
 *  - Blips are kept sorted by priority (high first), then id; `setBlip` replaces by id.
 *  - The waypoint is the blip `waypoint` (kind `waypoint`).
 *  - `setRoute(to)` sets a GPS target; the polyline (from the player to the target on the drivable graph, along the resident
 *    centrelines and the topology chords beyond) is planned at the next `flush`, and again when the player is more than 25 m off
 *    the planned line (or has no line and moved 25 m) and three seconds have passed since the last plan (M02c2, 02-world-maps.md 3.3).
 *  - `flush(tick)` runs at `SimStage.Publish` and returns the view-model patch to publish, or null when nothing changed.
 * Pure; C02 lint applies.
 */
import { RoadClass, type MapApi, type MapBlip } from '@dv/shared';
import type { RoadGraph } from '../graph/query.ts';
import { thin } from '../api/places.ts';

export const WAYPOINT_BLIP_ID = 'waypoint';
export const WAYPOINT_PRIORITY = 100;
/** Route polylines are thinned to this many points. */
export const ROUTE_MAX_POINTS = 400;
/** Replan period and distance of a live GPS route, ticks and metres. */
export const REPLAN_TICKS = 180;
export const REPLAN_MOVE_M = 25;
/** The route is rebuilt when the player is farther than this from it. */
export const OFF_ROUTE_M = REPLAN_MOVE_M;
const ROUTE_EXPAND = 120_000;
const NO_SERVICE_MASK = (1 << RoadClass.Freeway) | (1 << RoadClass.Ramp) | (1 << RoadClass.Arterial) | (1 << RoadClass.Collector) | (1 << RoadClass.Local);

/** Distance from (x, z) to a polyline of x, z pairs, metres; Infinity for an empty line. */
export function distToPolyline(pts: readonly number[], x: number, z: number): number {
  const n = pts.length >> 1;
  if (n === 0) return Infinity;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2] as number, az = pts[i * 2 + 1] as number;
    const bx = i + 1 < n ? (pts[i * 2 + 2] as number) : ax, bz = i + 1 < n ? (pts[i * 2 + 3] as number) : az;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - x, ez = az + t * dz - z;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) best = d2;
  }
  return best === Infinity ? Infinity : Math.sqrt(best);
}

export interface RouteView {
  /** x, z pairs. */
  points: number[];
  lengthM: number;
  etaS: number;
  complete: boolean;
}

export interface MapPatch {
  /** Counts the patches; a consumer that missed one asks for the whole state through `snapshot`. */
  rev: number;
  blips: MapBlip[];
  route: RouteView | null;
}

export interface MapDeps {
  graph: RoadGraph;
  /** The local player's feet position, or null before there is one. */
  player(): { x: number; z: number } | null;
}

const validBlip = (b: MapBlip): boolean =>
  typeof b.id === 'string' && b.id !== '' && Number.isFinite(b.x) && Number.isFinite(b.z) && Number.isFinite(b.priority);

export class MapApiImpl implements MapApi {
  private readonly table = new Map<string, MapBlip>();
  private sorted: MapBlip[] | null = [];
  private target: { x: number; z: number } | null = null;
  private route: RouteView | null = null;
  private routeOrigin: { x: number; z: number } | null = null;
  private routeTick = 0;
  private dirty = false;
  private routeDirty = false;
  private rev = 0;

  constructor(private readonly deps: MapDeps) {}

  setBlip(b: MapBlip): void {
    if (!validBlip(b)) return;
    this.table.set(b.id, { ...b });
    this.sorted = null;
    this.dirty = true;
  }

  removeBlip(id: string): void {
    if (this.table.delete(id)) {
      this.sorted = null;
      this.dirty = true;
    }
  }

  setWaypoint(x: number, z: number): void {
    this.setBlip({ id: WAYPOINT_BLIP_ID, kind: 'waypoint', shape: 'pin', colorToken: 'map.waypoint', x, z, priority: WAYPOINT_PRIORITY });
  }

  clearWaypoint(): void {
    this.removeBlip(WAYPOINT_BLIP_ID);
  }

  setRoute(to: { x: number; z: number } | null): void {
    if (to === null) {
      if (this.target === null && this.route === null) return;
      this.target = null;
      this.route = null;
      this.routeOrigin = null;
      this.dirty = true;
      return;
    }
    if (!Number.isFinite(to.x) || !Number.isFinite(to.z)) return;
    this.target = { x: to.x, z: to.z };
    this.routeDirty = true;
  }

  blips(): readonly MapBlip[] {
    if (!this.sorted) {
      this.sorted = [...this.table.values()].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    return this.sorted;
  }

  get routeTarget(): { x: number; z: number } | null {
    return this.target;
  }

  get currentRoute(): RouteView | null {
    return this.route;
  }

  /** The whole state as a patch (for a consumer that attached late). */
  snapshot(): MapPatch {
    return { rev: this.rev, blips: [...this.blips()], route: this.route };
  }

  /** Plans the GPS route from `from` to the target; null when there is no target or no road joins them. */
  private plan(from: { x: number; z: number }, to: { x: number; z: number }): RouteView | null {
    const g = this.deps.graph;
    const req = { from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, maxExpand: ROUTE_EXPAND };
    const r = g.route({ ...req, classMask: NO_SERVICE_MASK }) ?? g.route(req);
    if (!r) return null;
    const pts: number[] = [from.x, from.z];
    const t = new Float64Array(5);
    for (const e of r.edges) {
      const res = g.net.resident(e);
      if (res) {
        const p = res.seg.pts;
        const n = Math.floor(p.length / 3);
        for (let k = 0; k < n; k++) {
          const i = res.edge.dir === 1 ? k : n - 1 - k;
          pts.push(p[i * 3] as number, p[i * 3 + 2] as number);
        }
      } else if (g.pointOnEdge(e, 0, t, true)) {
        pts.push(t[0] as number, t[2] as number);
        if (g.pointOnEdge(e, g.net.lenDm(e) / 10, t, true)) pts.push(t[0] as number, t[2] as number);
      }
    }
    pts.push(to.x, to.z);
    // drop repeated points, then thin
    const pairs: [number, number][] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const last = pairs[pairs.length - 1];
      if (!last || last[0] !== pts[i] || last[1] !== pts[i + 1]) pairs.push([pts[i] as number, pts[i + 1] as number]);
    }
    const flat: number[] = [];
    for (const [x, z] of thin(pairs, ROUTE_MAX_POINTS)) flat.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10);
    return { points: flat, lengthM: r.lengthM, etaS: r.etaS, complete: r.complete };
  }

  /** The Publish-stage step: replans when due, and returns the patch to publish or null. */
  flush(tick: number): MapPatch | null {
    const me = this.deps.player();
    if (this.target && me) {
      // with a line: off it by more than 25 m; without one (no road joined the ends): moved 25 m since the last try
      const off = this.route && this.route.points.length >= 4
        ? distToPolyline(this.route.points, me.x, me.z) > OFF_ROUTE_M
        : this.routeOrigin ? Math.abs(me.x - this.routeOrigin.x) + Math.abs(me.z - this.routeOrigin.z) >= REPLAN_MOVE_M : true;
      if (this.routeDirty || (off && tick - this.routeTick >= REPLAN_TICKS)) {
        this.route = this.plan(me, this.target);
        this.routeOrigin = { x: me.x, z: me.z };
        this.routeTick = tick;
        this.routeDirty = false;
        this.dirty = true;
      }
    }
    if (!this.dirty) return null;
    this.dirty = false;
    this.rev++;
    return { rev: this.rev, blips: [...this.blips()], route: this.route };
  }
}
