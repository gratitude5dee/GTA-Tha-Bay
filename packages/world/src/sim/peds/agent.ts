/**
 * One ambient pedestrian (M03b2): the sim state behind component 257 `PedAgent` plus what the FSM needs (the edge it walks, its
 * private stream, its offset from the graph line). The persistent fields are hashed and checkpointed as the `world.peds.agents`
 * resource, in `StableKey` order. Pure; C02 lint applies.
 */
import { Rng, type ChunkKey, type Fnv64 } from '@dv/shared';
import type { ByteReader, ByteWriter } from '@dv/engine/sim';
import { PedState } from './components.ts';

export const PED_NONE = 0xffffffff;

export class Ped {
  readonly key: string;
  readonly cell: ChunkKey;
  readonly slot: number;
  epoch = 0;
  /** Filling a baked slot: the density rules remove it when its slot leaves the live prefix. */
  bound = 0;
  body = 0;
  outfit = 0;
  spawnTick = 0;
  /** Pace on flat ground, m/s. */
  pace = 1.4;
  /** Lateral lane of the sidewalk, metres to the right of the edge line (-0.5 or 0.5). */
  lane = 0.5;
  /** The ECS entity handle once the system made one (not hashed). */
  handle = 0;

  // ---- the edge it walks -------------------------------------------------------------------------------------------------
  /** The chunk whose ped graph holds `from` and `to`. */
  chunk: ChunkKey;
  from = PED_NONE;
  to = PED_NONE;
  /** Metres along the edge from `from`, and its length. */
  s = 0;
  len = 0;
  fx = 0;
  fy = 0;
  fz = 0;
  tx = 0;
  ty = 0;
  tz = 0;
  /** `PedEdgeKind` of the edge, and its crossing keys (-1: none). */
  kind = 0;
  junction = -1;
  movement = -1;
  /** The node it came from before `from` (never turned back to unless it is a dead end). */
  prev = PED_NONE;

  // ---- state -------------------------------------------------------------------------------------------------------------
  state: number = PedState.Walk;
  /** Ticks left in the timed states (Idle, Dodge, Flee, Hit, Witness). */
  timer = 0;
  /** Dodge and avoidance offset from the graph line, metres. */
  ox = 0;
  oz = 0;
  /** Where a flee runs from, and the attractor it gathers at. */
  threatX = 0;
  threatZ = 0;
  attractId = 0;
  /** Standing spot of Record and Cheer: reached when the node it stops at is within the ring. */
  tickAtWait = 0;

  // ---- witness -----------------------------------------------------------------------------------------------------------
  witnessInfraction = 0;
  witnessKind = 0;
  reportAt = 0;

  // ---- derived (not hashed) ----------------------------------------------------------------------------------------------
  x = 0;
  y = 0;
  z = 0;
  /** The point on the graph line (before the offset), and the unit heading. */
  gx = 0;
  gz = 0;
  hx = 0;
  hz = -1;
  yaw = 0;
  speed = 0;
  /** Within the near radius of the focus at the last step. */
  near = false;
  unseen = 0;
  frozenSince = -1;
  rng: Rng;

  constructor(key: string, cell: ChunkKey, slot: number, seed: number) {
    this.key = key;
    this.cell = cell;
    this.slot = slot;
    this.chunk = cell;
    this.rng = new Rng(seed);
  }
}

const byKey = (a: Ped, b: Ped): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The live pedestrians by key, with a list in ascending key order (the iteration order of every pass; C01 rule 4). */
export class PedSet {
  private readonly map = new Map<string, Ped>();
  private sorted: Ped[] = [];
  private dirty = false;

  get size(): number {
    return this.map.size;
  }
  get(key: string): Ped | undefined {
    return this.map.get(key);
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  add(p: Ped): void {
    this.map.set(p.key, p);
    this.dirty = true;
  }
  remove(p: Ped): void {
    if (this.map.delete(p.key)) this.dirty = true;
  }
  clear(): void {
    this.map.clear();
    this.sorted = [];
    this.dirty = false;
  }
  list(): readonly Ped[] {
    if (this.dirty) {
      this.sorted = [...this.map.values()].sort(byKey);
      this.dirty = false;
    }
    return this.sorted;
  }
}

const NUM_FIELDS = [
  'epoch', 'bound', 'body', 'outfit', 'spawnTick', 'from', 'to', 'prev', 'kind', 'junction', 'movement', 'state', 'timer', 'attractId',
  'tickAtWait', 'witnessInfraction', 'witnessKind', 'reportAt',
] as const;
const F64_FIELDS = ['pace', 'lane', 's', 'len', 'fx', 'fy', 'fz', 'tx', 'ty', 'tz', 'ox', 'oz', 'threatX', 'threatZ'] as const;
type Num = Record<(typeof NUM_FIELDS)[number] | (typeof F64_FIELDS)[number], number>;

export function hashPeds(h: Fnv64, peds: readonly Ped[]): void {
  h.u32(peds.length);
  for (const p of peds) {
    h.str(p.key).str(p.chunk);
    for (const f of NUM_FIELDS) h.u32((p as unknown as Num)[f] >>> 0);
    for (const f of F64_FIELDS) h.f64((p as unknown as Num)[f]);
    for (const w of p.rng.getState()) h.u32(w);
  }
}

export function savePeds(w: ByteWriter, peds: readonly Ped[]): void {
  w.u32(peds.length);
  for (const p of peds) {
    w.str(p.key);
    w.str(p.cell);
    w.str(p.chunk);
    w.u32(p.slot);
    w.u32(p.handle);
    for (const f of NUM_FIELDS) w.f64((p as unknown as Num)[f]);
    for (const f of F64_FIELDS) w.f64((p as unknown as Num)[f]);
    for (const word of p.rng.getState()) w.u32(word);
  }
}

export function loadPeds(r: ByteReader, into: PedSet): void {
  into.clear();
  for (let n = r.u32(); n > 0; n--) {
    const key = r.str();
    const cell = r.str() as ChunkKey;
    const chunk = r.str() as ChunkKey;
    const slot = r.u32();
    const p = new Ped(key, cell, slot, 0);
    p.chunk = chunk;
    p.handle = r.u32();
    for (const f of NUM_FIELDS) (p as unknown as Num)[f] = r.f64();
    for (const f of F64_FIELDS) (p as unknown as Num)[f] = r.f64();
    p.rng.setState([r.u32(), r.u32(), r.u32(), r.u32()]);
    into.add(p);
  }
}
