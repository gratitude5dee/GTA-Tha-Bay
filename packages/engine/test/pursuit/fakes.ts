/**
 * Fakes for the pursuit suites: a flat world where a road runs under every point, a host whose bodies the test moves by hand, and a
 * director wired to both. No ECS, no physics, no world package (the bake-backed suites are in `@dv/world`, DL-692).
 */
import { RngStreams, type ChokePoint, type HeatLevel, type HidingSpot, type Portal, type PursuitConfig, type StableKey } from '@dv/shared';
import type { SimEvent } from '../../src/sim/events.ts';
import { DEFAULT_PURSUIT_CONFIG } from '../../src/sim/pursuit/config.ts';
import { PursuitDirector } from '../../src/sim/pursuit/director.ts';
import {
  MemoryWallet, type DriveInput, type LanePoint, type PlayerView, type PursuitHost, type PursuitWorld, type RoadHit, type RoutePath, type UnitRole,
  type UnitView, type Vec3, type VehicleDamagePort, type VehicleView,
} from '../../src/sim/pursuit/ports.ts';

export class FakeWorld implements PursuitWorld {
  private segs = new Map<number, { a: [number, number]; b: [number, number] }>();
  private nextEdge = 1;
  chokes: ChokePoint[] = [];
  hiding: HidingSpot[] = [];
  portalList: Portal[] = [
    { id: 'portal.ggb', x: -4000, y: 0, z: -3000, yaw: 0, widthM: 20, kind: 'bridge', state: 'open', toArea: null, edges: [] },
    { id: 'portal.baybridge', x: 5000, y: 0, z: 1000, yaw: 0, widthM: 20, kind: 'bridge', state: 'open', toArea: null, edges: [] },
  ];
  routes = 0;
  /** Edge ids the next `route` call returns, with the polyline each follows; set by tests that need a particular route. */
  fixedRoute: { edges: number[]; points: [number, number][] } | null = null;

  segment(a: [number, number], b: [number, number]): number {
    const id = this.nextEdge++;
    this.segs.set(id, { a, b });
    return id;
  }

  nearestRoad(x: number, z: number): RoadHit | null {
    const id = this.segment([x - 15, z], [x + 15, z]);
    return { edge: id, s: 15, distM: 0 };
  }

  route(from: { x: number; z: number }, to: { x: number; z: number }): RoutePath | null {
    this.routes++;
    if (this.fixedRoute) return { edges: this.fixedRoute.edges, lengthM: 1000, complete: true };
    const id = this.segment([from.x, from.z], [to.x, to.z]);
    return { edges: [id], lengthM: this.edgeLength(id), complete: true };
  }

  lanePoint(edge: number, s: number): LanePoint | null {
    const g = this.segs.get(edge);
    if (!g) return null;
    const len = this.edgeLength(edge);
    const t = len === 0 ? 0 : Math.min(1, Math.max(0, s / len));
    const x = g.a[0] + (g.b[0] - g.a[0]) * t, z = g.a[1] + (g.b[1] - g.a[1]) * t;
    const yaw = Math.atan2(-(g.b[0] - g.a[0]), -(g.b[1] - g.a[1]));
    return { x, y: 0, z, yaw };
  }

  edgeLength(edge: number): number {
    const g = this.segs.get(edge);
    return g ? Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) : 0;
  }

  edgeWidth(): number {
    return 7;
  }

  hidingSpotAt(x: number, z: number): HidingSpot | null {
    return this.hiding.find((h) => Math.hypot(h.x - x, h.z - z) <= h.radiusM) ?? null;
  }

  chokePointsNear(x: number, z: number, r: number): ChokePoint[] {
    return this.chokes.filter((c) => Math.hypot(c.x - x, c.z - z) <= r);
  }

  portals(): readonly Portal[] {
    return this.portalList;
  }

  setPortalState(id: string, state: Portal['state']): boolean {
    const p = this.portalList.find((q) => q.id === id);
    if (!p) return false;
    p.state = state;
    return true;
  }

  releasePortals(): void {
    for (const p of this.portalList) if (p.state === 'sealed') p.state = 'closed';
  }

  sealedPortals(): readonly string[] {
    return this.portalList.filter((p) => p.state === 'sealed').map((p) => p.id).sort();
  }
}

export interface FakeUnit extends UnitView {
  prefab: string;
  key: string;
  input: DriveInput;
}

export class FakeHost implements PursuitHost, VehicleDamagePort {
  p: PlayerView = { pos: [0, 0, 0], vel: [0, 0, 0], speed: 0, yaw: 0, onFoot: false, vehicleKey: 'veh:player0', grappled: false };
  readonly units = new Map<number, FakeUnit>();
  readonly props = new Map<number, { prefab: string; pos: Vec3; yaw: number }>();
  vehicles: VehicleView[] = [];
  events: SimEvent[] = [];
  tires: { vehicle: number; tire: number; health: number }[] = [];
  impounded: string[] = [];
  /** Line of sight between any two points. */
  sight: (a: Vec3, b: Vec3) => boolean = () => false;
  private next = 1;
  spawns = 0;

  player(): PlayerView | null {
    return this.p;
  }

  spawnUnit(prefab: string, role: UnitRole, pos: Vec3, yaw: number, key: StableKey): number {
    const id = this.next++;
    this.spawns++;
    this.units.set(id, { id, role, pos: [...pos], yaw, speed: 0, vel: [0, 0, 0], ready: true, tires: [1, 1, 1, 1], prefab, key, input: { throttle: 0, brake: 0, steer: 0, handbrake: false } });
    return id;
  }

  despawnUnit(id: number): void {
    this.units.delete(id);
  }

  unit(id: number): UnitView | null {
    return this.units.get(id) ?? null;
  }

  drive(id: number, input: DriveInput): void {
    const u = this.units.get(id);
    if (u) u.input = { ...input };
  }

  fly(id: number, pos: Vec3, yaw: number): void {
    const u = this.units.get(id);
    if (u) {
      u.pos = [...pos];
      u.yaw = yaw;
    }
  }

  los(a: Vec3, b: Vec3): boolean {
    return this.sight(a, b);
  }

  /** Ground below a point: everywhere unless the test says otherwise. */
  ground: (pos: Vec3) => boolean = () => true;

  solid(pos: Vec3): boolean {
    return this.ground(pos);
  }

  groundY(): number | null {
    return 0;
  }

  placeProp(prefab: string, pos: Vec3, yaw: number): number {
    const id = this.next++;
    this.props.set(id, { prefab, pos: [...pos], yaw });
    return id;
  }

  removeProp(id: number): void {
    this.props.delete(id);
  }

  vehiclesNear(x: number, z: number, r: number): VehicleView[] {
    return this.vehicles.filter((v) => Math.hypot(v.pos[0] - x, v.pos[2] - z) <= r);
  }

  impound(key: string): void {
    this.impounded.push(key);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  setTireHealth(vehicleId: number, tire: 0 | 1 | 2 | 3, health: number): void {
    this.tires.push({ vehicle: vehicleId, tire, health });
  }

  /** The events with this name. */
  named(t: string): SimEvent[] {
    return this.events.filter((e) => e.t === t);
  }
}

export interface Rig {
  host: FakeHost;
  world: FakeWorld;
  wallet: MemoryWallet;
  director: PursuitDirector;
  rng: RngStreams;
  /** Steps the director every second tick from `tick` for `n` ticks; returns the tick after. */
  run(n: number): number;
  tick: number;
}

export function makeRig(cfg: PursuitConfig = DEFAULT_PURSUIT_CONFIG, seed = 7): Rig {
  const host = new FakeHost();
  const world = new FakeWorld();
  const wallet = new MemoryWallet(1_000_000);
  const rng = new RngStreams(seed);
  const director = new PursuitDirector({ cfg, host, world, wallet, damage: host, rng: { pursuit: rng.get('pursuit'), police: rng.get('police') } });
  const rig: Rig = {
    host, world, wallet, director, rng, tick: 0,
    run(n) {
      const end = rig.tick + n;
      while (rig.tick < end) {
        rig.tick += 2;
        director.step(rig.tick);
      }
      return rig.tick;
    },
  };
  director.step(0);
  return rig;
}

export const level = (d: PursuitDirector): HeatLevel => d.state().level;
