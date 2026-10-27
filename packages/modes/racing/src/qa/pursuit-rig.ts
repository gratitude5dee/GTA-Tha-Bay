/**
 * The pursuit rig (M07a2): a pursuit event run headless against the engine's real `PursuitDirector` and the real `RaceSession`,
 * with a small world around them instead of Rapier and the bake. QA builds and Node only; the `bot.pursuit` tests and the par tool
 * use it.
 *
 *   player   `RoutePort`: a car that follows the route centreline, its speed from the class power curve and brakes
 *   police   `RigHost`: units with a kinematic bicycle model, driven by the director's own `DriveInput`
 *   world    `RigWorld`: the route is the only road (edge k is route metres 50 (k-1) to 50 k, negative ids drive it backwards)
 *   sight    `karl-fog` (the event's weather): a unit sees the car within `FOG_SIGHT_M` when the route between them has no corner
 *            over `CORNER_RAD`, and never a car inside a hiding spot
 *
 * What the rig proves: the racing side of a pursuit (profile, route hint, bounty, evade and bust endings, the repair fee, telemetry,
 * the 1.06 speed cap through the director) and that a bot which reaches the hiding spot ends the event. What it does not: police
 * driving on Rapier, or sight against buildings. Those are the sf scenarios (the known gap of `config/autoplay/known-gaps.json`).
 */
import {
  MemoryWallet, PursuitDirector, DEFAULT_PURSUIT_CONFIG,
  type DriveInput, type PlayerView, type PursuitHost, type PursuitWorld, type RoadHit, type RoutePath, type UnitRole, type UnitView, type VehicleView,
  type VehicleDamagePort,
} from '@dv/engine/sim';
import { CLASS_ENVELOPE, datan2, dsin, dcos, dsqrt, projectToRoute, RngStreams, SIM_DT, routePoint, centreline, type DamageState, type HandlingProfile, type HidingSpot, type InputFrame, type RaceDef, type SimEvent } from '@dv/shared';
import { raceCar } from '../cars.ts';
import { RACING_CONFIG } from '../config.ts';
import type { CarCommand, CarImpact, CarReadout, RaceWorldPort } from '../sim/port.ts';
import { PursuitBinder, racePursuitFile } from '../sim/pursuit-binder.ts';
import { accelAt, brakeDecel } from '../sim/speed-profile.ts';
import { yawOf } from '../sim/pose.ts';
import { RaceSession, type AttemptRecord } from '../sim/session.ts';
import { PursuitBrain, standStillFrame } from './pursuit-bot.ts';

/** Sight in `karl-fog`, metres. */
export const FOG_SIGHT_M = 45;
/** A corner this sharp between a unit and the car (radians over the route between them) blocks the view. */
export const CORNER_RAD = 0.45;
const EDGE_M = 50;

// ---------------------------------------------------------------------------------------------------------- the player's car

/** The player's car on the route: it keeps to the centreline and follows the throttle and brake commands. */
export class RoutePort implements RaceWorldPort {
  s = 0;
  speed = 0;
  private cmd: CarCommand = { throttle: 0, brake: 0, steer: 0, handbrake: true };
  private placed = false;
  damage: DamageState | null = null;
  released = false;

  constructor(private readonly def: RaceDef, private readonly prof: HandlingProfile) {}

  collidersReady(): boolean {
    return true;
  }
  groundY(x: number, z: number): number | null {
    return routePoint(this.def, this.nearestS(x, z)).y;
  }
  spawnCar(_prefab: string, pos: [number, number, number]): boolean {
    this.s = this.nearestS(pos[0], pos[2]);
    this.placed = true;
    return true;
  }
  read(): CarReadout | null {
    if (!this.placed) return null;
    const p = routePoint(this.def, this.s);
    const yaw = yawOf(p.tx, p.tz);
    return {
      pos: [p.x, p.y + 0.5, p.z], front: [p.x + p.tx * 1.3, p.y + 0.5, p.z + p.tz * 1.3], yaw, speedMps: this.speed, vel: [p.tx * this.speed, 0, p.tz * this.speed],
      upY: 1, airTicks: 0, gear: this.speed > 1 ? 3 : 0, rpm: 2500 + this.speed * 70, slipDeg: 0,
    };
  }
  place(pos: [number, number, number]): void {
    this.s = this.nearestS(pos[0], pos[2]);
    this.speed = 0;
  }
  drive(c: CarCommand): void {
    this.cmd = c;
  }
  setNitro(): void {}
  setDamage(d: DamageState): void {
    this.damage = d;
  }
  takeImpacts(): CarImpact[] {
    return [];
  }
  release(): void {
    this.released = true;
  }

  /** One sim tick of the car's own motion. */
  advance(): void {
    const c = this.cmd;
    if (c.handbrake) this.speed = Math.max(0, this.speed - 14 * SIM_DT);
    else if (c.brake > 3) this.speed = Math.max(0, this.speed - (c.brake / 127) * brakeDecel(this.prof) * SIM_DT);
    else this.speed = Math.max(0, this.speed + (c.throttle / 127) * accelAt(this.prof, this.speed) * SIM_DT);
    this.s = Math.min(this.def.routeLenM, this.s + this.speed * SIM_DT);
  }

  /** The route metre of a point: the nearest 5 m sample, refined on the segment around it. */
  private nearestS(x: number, z: number): number {
    const n = nearestRouteMetre(this.def, x, z);
    return projectToRoute(this.def, [x, 0, z], Math.max(0, n.s - 2)).s;
  }
}

let cache: { def: RaceDef; pts: Float64Array } | null = null;
function pointsOf(def: RaceDef): Float64Array {
  if (!cache || cache.def !== def) cache = { def, pts: centreline(def) };
  return cache.pts;
}

/** The route metre of the centreline sample nearest to (x, z), and the distance. */
export function nearestRouteMetre(def: RaceDef, x: number, z: number): { s: number; distM: number } {
  const pts = pointsOf(def);
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < pts.length / 2; i++) {
    const d = ((pts[2 * i] as number) - x) ** 2 + ((pts[2 * i + 1] as number) - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { s: best * def.line.stepM, distM: dsqrt(bd) };
}

// ---------------------------------------------------------------------------------------------------------- the world

export class RigWorld implements PursuitWorld {
  constructor(private readonly def: RaceDef) {}

  private edgeCount(): number {
    return Math.ceil(this.def.routeLenM / EDGE_M);
  }
  private edgeOf(s: number): number {
    return Math.min(this.edgeCount(), Math.max(1, Math.floor(s / EDGE_M) + 1));
  }

  nearestRoad(x: number, z: number, maxM: number): RoadHit | null {
    const n = nearestRouteMetre(this.def, x, z);
    if (n.distM > maxM) return null;
    const e = this.edgeOf(n.s);
    return { edge: e, s: n.s - (e - 1) * EDGE_M, distM: n.distM };
  }
  route(from: { x: number; z: number }, to: { x: number; z: number }): RoutePath | null {
    const a = nearestRouteMetre(this.def, from.x, from.z).s;
    const b = nearestRouteMetre(this.def, to.x, to.z).s;
    const ea = this.edgeOf(a);
    const eb = this.edgeOf(b);
    const edges: number[] = [];
    if (a <= b) for (let e = ea; e <= eb; e++) edges.push(e);
    else for (let e = ea; e >= eb; e--) edges.push(-e);
    return { edges, lengthM: Math.abs(b - a), complete: true };
  }
  lanePoint(edge: number, s: number): { x: number; y: number; z: number; yaw: number } | null {
    const e = Math.abs(edge);
    if (e < 1 || e > this.edgeCount()) return null;
    const len = this.edgeLength(edge);
    const along = edge > 0 ? s : len - s;
    const p = routePoint(this.def, (e - 1) * EDGE_M + Math.max(0, Math.min(len, along)));
    return { x: p.x, y: p.y, z: p.z, yaw: edge > 0 ? yawOf(p.tx, p.tz) : yawOf(-p.tx, -p.tz) };
  }
  edgeLength(edge: number): number {
    const e = Math.abs(edge);
    return Math.max(0, Math.min(EDGE_M, this.def.routeLenM - (e - 1) * EDGE_M));
  }
  edgeWidth(): number {
    return 7;
  }
  hidingSpotAt(x: number, z: number): HidingSpot | null {
    for (const h of this.def.hidingSpots ?? []) if (dsqrt((h.x - x) * (h.x - x) + (h.z - z) * (h.z - z)) <= h.radiusM) return { id: 'hs.rig', x: h.x, y: 0, z: h.z, radiusM: h.radiusM, kind: 'viaduct' };
    return null;
  }
  chokePointsNear(): never[] {
    return [];
  }
  portals(): readonly never[] {
    return [];
  }
  setPortalState(): boolean {
    return false;
  }
  releasePortals(): void {}
  sealedPortals(): readonly string[] {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------------------- the police

interface RigUnit extends UnitView {
  prefab: string;
  key: string;
  input: DriveInput;
}

const WHEELBASE = 2.9;

export class RigHost implements PursuitHost, VehicleDamagePort {
  readonly units = new Map<number, RigUnit>();
  readonly events: SimEvent[] = [];
  private next = 1;
  /** The highest speed of any unit divided by the player's top speed, over the run. */
  maxRatio = 0;
  spawns = 0;
  private readonly listeners = new Map<string, ((e: SimEvent) => void)[]>();

  constructor(private readonly def: RaceDef, private readonly car: RoutePort, private readonly topMps: number) {}

  on(t: string, cb: (e: SimEvent) => void): () => void {
    const l = this.listeners.get(t) ?? [];
    l.push(cb);
    this.listeners.set(t, l);
    return () => this.listeners.set(t, (this.listeners.get(t) ?? []).filter((x) => x !== cb));
  }

  player(): PlayerView | null {
    const c = this.car.read();
    if (!c) return null;
    return { pos: c.pos, vel: c.vel, speed: c.speedMps < 0 ? -c.speedMps : c.speedMps, yaw: c.yaw, onFoot: false, vehicleKey: 'veh:player0', grappled: false, topMps: this.topMps };
  }
  spawnUnit(prefab: string, role: UnitRole, pos: [number, number, number], yaw: number, key: string): number {
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
  fly(id: number, pos: [number, number, number], yaw: number): void {
    const u = this.units.get(id);
    if (u) {
      u.pos = [...pos];
      u.yaw = yaw;
    }
  }
  los(a: [number, number, number], b: [number, number, number]): boolean {
    for (const h of this.def.hidingSpots ?? []) {
      if (dsqrt((h.x - b[0]) ** 2 + (h.z - b[2]) ** 2) <= h.radiusM || dsqrt((h.x - a[0]) ** 2 + (h.z - a[2]) ** 2) <= h.radiusM) return false;
    }
    if (dsqrt((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2) > FOG_SIGHT_M) return false;
    // a corner between the two: the heading of the route changes by more than CORNER_RAD over the metres between them
    const sa = nearestRouteMetre(this.def, a[0], a[2]).s;
    const sb = nearestRouteMetre(this.def, b[0], b[2]).s;
    const lo = Math.min(sa, sb);
    const hi = Math.max(sa, sb);
    const h0 = routePoint(this.def, lo);
    const h1 = routePoint(this.def, hi);
    const turn = Math.abs(datan2(h0.tx * h1.tz - h0.tz * h1.tx, h0.tx * h1.tx + h0.tz * h1.tz));
    return turn <= CORNER_RAD;
  }
  solid(): boolean {
    return true;
  }
  groundY(): number | null {
    return 0;
  }
  placeProp(): number {
    return this.next++;
  }
  removeProp(): void {}
  vehiclesNear(x: number, z: number, r: number): VehicleView[] {
    const c = this.car.read();
    if (!c || dsqrt((c.pos[0] - x) ** 2 + (c.pos[2] - z) ** 2) > r) return [];
    return [{ id: 1_000_000, key: 'veh:player0', pos: c.pos, yaw: c.yaw, speed: c.speedMps, police: false }];
  }
  impound(): void {}
  emit(e: SimEvent): void {
    this.events.push(e);
    for (const cb of this.listeners.get(e.t) ?? []) cb(e);
  }
  setTireHealth(): void {}

  /** One sim tick of every unit: a bicycle model driven by the director's input. */
  advance(): void {
    const top = this.topMps;
    for (const u of this.units.values()) {
      const i = u.input;
      let sp = u.speed;
      if (i.handbrake) sp = Math.max(0, sp - 16 * SIM_DT);
      else sp = Math.max(0, sp + (i.throttle * 7.5 - i.brake * 12 - 0.0012 * sp * sp) * SIM_DT);
      u.speed = sp;
      u.yaw -= (i.steer * Math.min(sp, 22) / WHEELBASE) * 0.55 * SIM_DT;
      u.pos = [u.pos[0] + -dsin(u.yaw) * sp * SIM_DT, u.pos[1], u.pos[2] + -dcos(u.yaw) * sp * SIM_DT];
      u.vel = [-dsin(u.yaw) * sp, 0, -dcos(u.yaw) * sp];
      if (sp / top > this.maxRatio) this.maxRatio = sp / top;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------- the run

export interface PursuitRigOptions {
  def: RaceDef;
  vehicleDef: string;
  seed: number;
  maxTicks: number;
  /** The frame source: the brain, or a fixture (`standStillFrame`). Gets the observation and the tick. */
  frame(obs: { phase: string; x: number; z: number; yaw: number; speed: number; s: number }, tick: number, brain: PursuitBrain): InputFrame;
  difficulty?: 'easy' | 'normal' | 'hard';
  /** Called once a tick after the step (tests and the tuning script read the run through it). */
  probe?: (i: { tick: number; session: RaceSession; director: PursuitDirector; host: RigHost; port: RoutePort }) => void;
}

export interface PursuitRigResult {
  outcome: 'evade' | 'survive' | 'bust' | 'dnf' | 'timeout';
  /** Race clock of the end, milliseconds. */
  ms: number;
  hash: string;
  ticks: number;
  maxHeat: number;
  /** Highest unit speed over the player's top speed. */
  maxUnitRatio: number;
  attempt: AttemptRecord | null;
  events: { t: string; tick: number; n?: number | undefined; s?: string | undefined }[];
  telemetry: { name: string; props: Record<string, string | number | boolean> }[];
  spawns: number;
  session: RaceSession;
}

export function runPursuitRig(o: PursuitRigOptions): PursuitRigResult {
  const car = raceCar(o.vehicleDef);
  if (!car) throw new Error(`unknown vehicle ${o.vehicleDef}`);
  const topMps = CLASS_ENVELOPE[car.class].topKph[1] / 3.6;
  const port = new RoutePort(o.def, car.profile);
  const host = new RigHost(o.def, port, topMps);
  const world = new RigWorld(o.def);
  const file = racePursuitFile();
  const streams = new RngStreams(o.seed);
  const wallet = new MemoryWallet(1_000_000);
  const director = new PursuitDirector({
    cfg: DEFAULT_PURSUIT_CONFIG, host, world, wallet, damage: host, rng: { pursuit: streams.get('pursuit'), police: streams.get('police') },
    loadConfig: () => file.cfg, loadRace: () => file.rules,
  });
  director.step(0);
  const binder = new PursuitBinder(director, host, o.def, file.rules);
  const events: PursuitRigResult['events'] = [];
  const telemetry: PursuitRigResult['telemetry'] = [];
  const session = new RaceSession({
    def: o.def,
    cfg: RACING_CONFIG as never,
    profile: car.profile,
    vehicleDef: o.vehicleDef,
    port,
    sinks: { event: (e) => events.push({ t: e.t, tick: e.tick, n: e.n, s: e.s }), hud: () => undefined },
    telemetry: { emit: (name, props) => telemetry.push({ name, props }) },
    seed: o.seed,
    simProfile: 'canonical',
    pursuit: binder,
    vehiclePriceCents: car.priceCents,
    difficulty: o.difficulty ?? 'normal',
  });
  const brain = new PursuitBrain(o.def, car.profile);
  let maxHeat = 0;
  let tick = 0;
  for (; tick < o.maxTicks; tick++) {
    const c = port.read();
    const f = o.frame({ phase: session.director.phase, x: c ? c.pos[0] : 0, z: c ? c.pos[2] : 0, yaw: c ? c.yaw : 0, speed: c ? c.speedMps : 0, s: port.s }, tick, brain);
    session.step(f, tick);
    port.advance();
    host.advance();
    if (tick % 2 === 0) director.step(tick);
    maxHeat = Math.max(maxHeat, director.state().level);
    o.probe?.({ tick, session, director, host, port });
    if (session.director.phase === 'Results') break;
  }
  const a = session.lastAttempt;
  const pursuit = a?.pursuit?.outcome ?? null;
  const outcome: PursuitRigResult['outcome'] = a === null ? 'timeout' : pursuit === 'evade' ? 'evade' : pursuit === 'survive' ? 'survive' : pursuit === 'bust' ? 'bust' : 'dnf';
  return {
    outcome, ms: a ? a.ms : 0, hash: a ? a.endHash : '', ticks: tick, maxHeat, maxUnitRatio: host.maxRatio, attempt: a, events, telemetry, spawns: host.spawns, session,
  };
}

/** The par of a pursuit event: the seed-1 run of the pursuit bot. */
export async function runPursuitPar(def: RaceDef, vehicleDef: string): Promise<{ ms: number; hash: string; outcome: string }> {
  const r = runPursuitRig({ def, vehicleDef, seed: 1, maxTicks: 60 * 60 * 6, frame: (obs, tick, brain) => brain.frame(obs as never, tick) });
  return { ms: r.ms, hash: r.hash, outcome: r.outcome };
}

export { standStillFrame };
