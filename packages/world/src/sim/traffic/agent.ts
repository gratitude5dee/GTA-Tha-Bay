/**
 * One ambient agent (M03b1): the sim state of a traffic car, a robotaxi or a parked car. The `TrafficAgent`, `RobotaxiBrain`,
 * `ParkedCar` and `WorldWitness` components mirror the fields the spec lists (section 8); the rest of what the brain needs
 * (the connector it is on, its claim and stall timers, its private stream) lives here and is hashed and checkpointed with
 * the agents as the `world.traffic.agents` resource.
 *
 * Pure; C02 lint applies.
 */
import { Rng, type ChunkKey, type Fnv64 } from '@dv/shared';
import type { ByteReader, ByteWriter } from '@dv/engine/sim';
import { AgentKind, AgentState, Turn } from './components.ts';

/** "No edge" and "no movement" in the u32 component fields. */
export const NONE = 0xffffffff;

export class Agent {
  readonly key: string;
  readonly cell: ChunkKey;
  readonly slot: number;
  /** Spawn attempts of the slot so far; with the cell and the slot it fixes the plan (rooms, later). */
  epoch = 0;
  kind: number = AgentKind.Traffic;
  arch = 0;
  color = 0;
  spawnTick = 0;
  /** The agent fills a baked slot: the density rules (a thinned prefix, the hour) remove it. Agents placed by hand are not bound. */
  bound = 0;
  /** The ECS entity handle once the system created one (not hashed). */
  handle = 0;

  // ---- on an edge --------------------------------------------------------------------------------------------------------
  edge = NONE;
  /** Front bumper, metres along the directed edge. */
  s = 0;
  lane = 0;
  /** Lateral offset from the centreline, metres, positive to the right of travel (eased toward the lane centre). */
  lat = 0;
  speed = 0;
  accel = 0;
  nextEdge = NONE;
  turn: number = Turn.None;
  state: number = AgentState.Drive;

  // ---- in a junction -----------------------------------------------------------------------------------------------------
  /** Movement and junction ids of the planned turn (-1: the end of the edge is not a junction). */
  mov = -1;
  jct = -1;
  /** Metres along the connector, and its length. */
  jPos = 0;
  jLen = 0;
  /** Connector control points: x0 z0 x1 z1 x2 z2 x3 z3, then the heights at both ends. */
  readonly cp = new Float64Array(10);
  /** Cumulative arc length at t = i / 8 (the lookup from distance to t). */
  readonly lut = new Float64Array(9);

  // ---- timers (sim ticks) ------------------------------------------------------------------------------------------------
  /** Tick it came to rest at the stop line; -1 while it has not. */
  stoppedTick = -1;
  /** Tick it became entitled to go but was held by the conflict set; -1 while it is not. */
  claimTick = -1;
  /** Ticks of speed below 0.5 m/s that count toward the gridlock rule. */
  stuckTicks = 0;
  /** Ticks since it was last near a player or the camera. */
  unseenTicks = 0;
  /** Tick it froze on an unloaded edge; -1 otherwise. */
  frozenSince = -1;
  /** Tick the dead-end pause or a pull-over ends. */
  holdUntil = 0;
  /** It can no longer stop at the line and goes on (judged against 3.5 m/s^2). */
  committed = false;

  personality = 1;
  rng: Rng;

  // ---- robotaxi ----------------------------------------------------------------------------------------------------------
  /** Junction the dark-signal stall was decided for (one roll per junction visit). */
  rtJct = -1;
  stallPending = false;
  /** The seeded hold of the stall decided for `rtJct`, ticks. */
  stallTicks = 0;
  rtMode = 0;
  fare = 0;

  // ---- parked ------------------------------------------------------------------------------------------------------------
  seg = NONE;
  side = 0;
  locked = 1;

  // ---- witness -----------------------------------------------------------------------------------------------------------
  witnessTarget = '';
  reportAt = 0;
  witnessKind = 0;
  witnessId = 0;
  /** The last infraction this robotaxi cast a line-of-sight ray for (one ray per robotaxi and infraction). */
  losDone = 0;

  // ---- derived (not hashed) ----------------------------------------------------------------------------------------------
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  /** Unit heading on the ground plane. */
  fx = 0;
  fz = -1;
  lights = 0;
  /** The agent waits for something that is not its fault (a red signal, a queue behind one): the gridlock rule leaves it alone. */
  legitWait = false;
  /** Within the near radius of a player or the camera at the last step. */
  near = false;
  /** Physics body of the near level, 0 when it has none. */
  body = 0;
  /** Tick before which it does not honk again. */
  honkAt = 0;

  constructor(key: string, cell: ChunkKey, slot: number, seed: number) {
    this.key = key;
    this.cell = cell;
    this.slot = slot;
    this.rng = new Rng(seed);
  }

  get isParked(): boolean {
    return this.kind === AgentKind.Parked;
  }

  get isRobotaxi(): boolean {
    return this.kind === AgentKind.Robotaxi;
  }
}

const byKey = (a: Agent, b: Agent): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The live agents by key, with a list in ascending key order (the iteration order of every pass; C01 rule 4). */
export class AgentSet {
  private readonly map = new Map<string, Agent>();
  private sorted: Agent[] = [];
  private dirty = false;

  get size(): number {
    return this.map.size;
  }

  get(key: string): Agent | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  add(a: Agent): void {
    this.map.set(a.key, a);
    this.dirty = true;
  }

  remove(a: Agent): void {
    if (this.map.delete(a.key)) this.dirty = true;
  }

  clear(): void {
    this.map.clear();
    this.sorted = [];
    this.dirty = false;
  }

  /** Agents in ascending key order. The array is rebuilt after a change and shared until the next one. */
  list(): readonly Agent[] {
    if (this.dirty) {
      this.sorted = [...this.map.values()].sort(byKey);
      this.dirty = false;
    }
    return this.sorted;
  }
}

const NUM_FIELDS = [
  'epoch', 'bound', 'kind', 'arch', 'color', 'spawnTick', 'edge', 'lane', 'nextEdge', 'turn', 'state', 'mov', 'jct', 'stoppedTick', 'claimTick',
  'stuckTicks', 'unseenTicks', 'frozenSince', 'holdUntil', 'rtJct', 'rtMode', 'fare', 'seg', 'side', 'locked', 'reportAt', 'witnessKind',
  'witnessId', 'losDone', 'stallTicks',
] as const;
const F64_FIELDS = ['s', 'lat', 'speed', 'accel', 'jPos', 'jLen', 'personality'] as const;
const BOOL_FIELDS = ['committed', 'stallPending'] as const;

type Num = Record<(typeof NUM_FIELDS)[number] | (typeof F64_FIELDS)[number], number>;
type Flags = Record<(typeof BOOL_FIELDS)[number], boolean>;

/** Feeds the persistent state of the agents (ascending key) into a state hash. */
export function hashAgents(h: Fnv64, agents: readonly Agent[]): void {
  h.u32(agents.length);
  for (const a of agents) {
    h.str(a.key);
    for (const f of NUM_FIELDS) h.u32((a as unknown as Num)[f] >>> 0);
    for (const f of F64_FIELDS) h.f64((a as unknown as Num)[f]);
    for (const f of BOOL_FIELDS) h.u8((a as unknown as Flags)[f] ? 1 : 0);
    if (a.state === AgentState.Cross) {
      for (let i = 0; i < a.cp.length; i++) h.f64(a.cp[i] as number);
    }
    h.str(a.witnessTarget);
    for (const w of a.rng.getState()) h.u32(w);
  }
}

export function saveAgents(w: ByteWriter, agents: readonly Agent[]): void {
  w.u32(agents.length);
  for (const a of agents) {
    w.str(a.key);
    w.str(a.cell);
    w.u32(a.slot);
    w.u32(a.handle);
    w.u32(a.body);
    for (const f of NUM_FIELDS) w.f64((a as unknown as Num)[f]);
    for (const f of F64_FIELDS) w.f64((a as unknown as Num)[f]);
    for (const f of BOOL_FIELDS) w.u8((a as unknown as Flags)[f] ? 1 : 0);
    for (let i = 0; i < a.cp.length; i++) w.f64(a.cp[i] as number);
    for (let i = 0; i < a.lut.length; i++) w.f64(a.lut[i] as number);
    w.str(a.witnessTarget);
    for (const word of a.rng.getState()) w.u32(word);
  }
}

export function loadAgents(r: ByteReader, into: AgentSet): void {
  into.clear();
  for (let n = r.u32(); n > 0; n--) {
    const key = r.str();
    const cell = r.str() as ChunkKey;
    const slot = r.u32();
    const a = new Agent(key, cell, slot, 0);
    a.handle = r.u32();
    a.body = r.u32();
    for (const f of NUM_FIELDS) (a as unknown as Num)[f] = r.f64();
    for (const f of F64_FIELDS) (a as unknown as Num)[f] = r.f64();
    for (const f of BOOL_FIELDS) (a as unknown as Flags)[f] = r.u8() !== 0;
    for (let i = 0; i < a.cp.length; i++) a.cp[i] = r.f64();
    for (let i = 0; i < a.lut.length; i++) a.lut[i] = r.f64();
    a.witnessTarget = r.str();
    a.rng.setState([r.u32(), r.u32(), r.u32(), r.u32()]);
    into.add(a);
  }
}
