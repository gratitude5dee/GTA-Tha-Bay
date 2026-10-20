/**
 * The transit brain (02-world-living.md section 5; M03b2): every mover on its route, one AI step at a time. It is independent of the
 * ECS. Movers exist as logical points on the baked routes whatever the player does (the counts of a tier are exact); only their
 * pose reads the world (the edge geometry of a resident bus edge, the ground height). Routes come from `data/transit-routes.v1` and
 * nothing is hand-placed.
 *
 * Pure; C02 lint applies.
 */
import { datan2, TWO_PI, type QualityTierId } from '@dv/shared';
import type { RoadNetwork } from '../graph/adjacency.ts';
import { AI_DT } from '../traffic/sim.ts';
import { EdgePaths } from '../traffic/plan.ts';
import type { RoadGraph } from '../graph/query.ts';
import { corridors, type Corridor } from './aircraft.ts';
import { busPose, busRoutes, stepBus, type BusRoute } from './bus.ts';
import { cablecarEndDwell, cablecarPaths, cablecarSpeed } from './cablecar.ts';
import { TRANSIT_CONFIG, countOf, moverKey, type MoverKind, type TransitRows } from './components.ts';
import { FERRY_DRAFT_M, ferryEndDwell, ferryPaths, ferrySpeed } from './ferry.ts';
import { metroEndDwell, metroPaths, metroSpeed } from './metro.ts';
import { TransitMover, sortedMovers, stepShuttle } from './mover.ts';
import { EMPTY_ROUTES, type Path, type TransitRoutesData } from './path.ts';

/** Sim ticks per AI step. */
const STEP_TICKS = 2;

export interface TransitWorld {
  readonly net: RoadNetwork;
  readonly graph: RoadGraph;
  /** Ground height at (x, z), or null when the chunk is not resident. */
  groundY(x: number, z: number): number | null;
}

export interface TransitOptions {
  world: TransitWorld;
  /** The tier whose counts apply; `canonical` passes `mobile-low`. */
  tier: QualityTierId;
  config?: TransitRows;
}

export interface TransitCounts {
  metro: number;
  bus: number;
  cablecar: number;
  ferry: number;
  air: number;
}

export class TransitSim {
  routes: TransitRoutesData = EMPTY_ROUTES;
  readonly movers: TransitMover[] = [];
  /** Paths by kind, parallel to the route lists of `routes`. */
  readonly paths: Record<'metro' | 'cablecar' | 'ferry', Path[]> = { metro: [], cablecar: [], ferry: [] };
  buses: BusRoute[] = [];
  air: Corridor[] = [];
  airCount = 0;
  tick = 0;
  /** True once the movers got their starting places from the focus. */
  placed = false;
  private readonly w: TransitWorld;
  private readonly cfg: TransitRows;
  private readonly tier: QualityTierId;
  private readonly epaths: EdgePaths;
  private readonly pose = new Float64Array(6);
  private readonly at = new Float64Array(4);
  /** Last ground height per mover (used when the chunk is not resident). */
  private readonly lastY = new Map<string, number>();

  constructor(o: TransitOptions) {
    this.w = o.world;
    this.cfg = o.config ?? TRANSIT_CONFIG;
    this.tier = o.tier;
    this.epaths = new EdgePaths(o.world.net, o.world.graph);
  }

  /** Installs the baked routes and creates the movers of the tier: every count that has routes behind it. */
  setRoutes(d: TransitRoutesData): void {
    this.routes = d;
    this.paths.metro = metroPaths(d);
    this.paths.cablecar = cablecarPaths(d);
    this.paths.ferry = ferryPaths(d);
    this.buses = busRoutes(d, this.w.net);
    this.air = corridors(d);
    this.movers.length = 0;
    const add = (kind: MoverKind, want: number, routes: number): void => {
      const n = routes === 0 ? 0 : want;
      for (let i = 0; i < n; i++) {
        const m = new TransitMover(moverKey(kind, i), kind);
        m.n = i;
        m.route = i % routes;
        this.movers.push(m);
      }
    };
    add('metro', countOf('metro', this.tier, this.cfg), this.paths.metro.length);
    add('bus', countOf('bus', this.tier, this.cfg), this.buses.length);
    add('cablecar', countOf('cablecar', this.tier, this.cfg), this.paths.cablecar.length);
    add('ferry', countOf('ferry', this.tier, this.cfg), this.paths.ferry.length);
    this.airCount = this.air.length === 0 ? 0 : countOf('air', this.tier, this.cfg);
    this.placed = false;
    this.movers.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /** The live count of each kind (the figures AC-5 and AC-12 compare with the config row). */
  counts(): TransitCounts {
    const c: TransitCounts = { metro: 0, bus: 0, cablecar: 0, ferry: 0, air: this.airCount };
    for (const m of this.movers) c[m.kind]++;
    return c;
  }

  /** The vehicles of one route of a kind, in vehicle number order. */
  onRoute(kind: MoverKind, route: number): TransitMover[] {
    return this.movers.filter((m) => m.kind === kind && m.route === route);
  }

  private routeLength(m: TransitMover): number {
    if (m.kind === 'bus') return (this.buses[m.route] as BusRoute).length;
    return (this.paths[m.kind][m.route] as Path).length;
  }

  /**
   * Starting places: the vehicles of a route are spread evenly along it, the first one starting at the point nearest to `focus`
   * (the player's start, so the first minutes show transit near the player). Alternate vehicles of a shuttle start in opposite
   * directions. Runs once per route install.
   */
  private place(focus: { x: number; z: number }): void {
    const perRoute = new Map<string, number>();
    for (const m of this.movers) perRoute.set(`${m.kind}:${m.route}`, (perRoute.get(`${m.kind}:${m.route}`) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const m of this.movers) {
      const id = `${m.kind}:${m.route}`;
      const k = seen.get(id) ?? 0;
      seen.set(id, k + 1);
      const count = perRoute.get(id) as number;
      const len = this.routeLength(m);
      let base = 0;
      if (m.kind === 'bus') base = this.busNearest(this.buses[m.route] as BusRoute, focus.x, focus.z);
      else base = (this.paths[m.kind][m.route] as Path).nearest(focus.x, focus.z).s;
      let s = base + (k * len) / count;
      s = len > 0 ? s % len : 0;
      m.s = s;
      m.dir = m.kind === 'bus' ? 1 : k % 2 === 0 ? 1 : -1;
      m.dwell = 0;
      m.speed = 0;
      m.stop = 0;
      if (m.kind === 'bus') {
        const r = this.buses[m.route] as BusRoute;
        while (m.stop < r.stops.length && (r.stops[m.stop] as { s: number }).s < m.s) m.stop++;
      }
    }
    this.placed = true;
  }

  /** The distance along a pattern of the edge start nearest to (x, z). */
  private busNearest(r: BusRoute, x: number, z: number): number {
    let best = Infinity, bs = 0;
    for (let i = 0; i < r.edges.length; i++) {
      const e = r.edges[i] as number;
      const a = this.w.net.from(e);
      const dx = this.w.net.nodeX(a) - x, dz = this.w.net.nodeZ(a) - z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bs = r.cum[i] as number;
      }
    }
    return bs;
  }

  /** One AI step (30 Hz). */
  step(tick: number, focus: { x: number; z: number }): void {
    this.tick = tick;
    if (!this.placed) this.place(focus);
    const c = this.cfg;
    for (const m of this.movers) {
      switch (m.kind) {
        case 'metro':
          stepShuttle(m, this.paths.metro[m.route] as Path, metroSpeed(c), metroEndDwell(c), AI_DT, STEP_TICKS);
          break;
        case 'cablecar':
          stepShuttle(m, this.paths.cablecar[m.route] as Path, cablecarSpeed(c), cablecarEndDwell(c), AI_DT, STEP_TICKS);
          break;
        case 'ferry':
          stepShuttle(m, this.paths.ferry[m.route] as Path, ferrySpeed(c), ferryEndDwell(c), AI_DT, STEP_TICKS);
          break;
        case 'bus':
          stepBus(m, this.buses[m.route] as BusRoute, (e) => this.w.net.speedMps(e), c, AI_DT, STEP_TICKS);
          break;
      }
      this.poseOf(m);
    }
  }

  /** Writes x, y, z, yaw and the heading of a mover from its route position. */
  poseOf(m: TransitMover): void {
    if (m.kind === 'bus') {
      busPose(m, this.buses[m.route] as BusRoute, this.epaths, this.w.net, this.pose);
      return;
    }
    const path = this.paths[m.kind][m.route] as Path;
    path.at(m.s, this.at);
    const dir = m.dir;
    m.x = this.at[0] as number;
    m.z = this.at[1] as number;
    m.hx = (this.at[2] as number) * dir;
    m.hz = (this.at[3] as number) * dir;
    m.yaw = yawOf(m.hx, m.hz);
    if (m.kind === 'ferry') {
      m.y = FERRY_DRAFT_M;
    } else {
      const g = this.w.groundY(m.x, m.z);
      if (g !== null) this.lastY.set(m.key, g);
      m.y = g ?? this.lastY.get(m.key) ?? 0;
    }
  }

  sorted(): TransitMover[] {
    return sortedMovers(this.movers);
  }
}

function yawOf(hx: number, hz: number): number {
  let yaw = datan2(-hx, -hz);
  if (yaw < 0) yaw += TWO_PI;
  return yaw;
}
