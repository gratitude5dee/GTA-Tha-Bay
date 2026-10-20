/**
 * The pedestrian brain (02-world-living.md section 4; M03b2): every ambient pedestrian, one AI step at a time. Like `TrafficSim` it
 * is independent of the ECS: it reads the resident chunks' ped graphs, the junction programs and the vehicles near the player, takes
 * the player (and the XR head) as inputs, and reports spawns and despawns through hooks. `system.ts` binds it to the engine.
 *
 * One call to `step` is one AI step (30 Hz). Pedestrians are visited in `StableKey` order and write their own state only; all
 * randomness is the pedestrian's private stream or the counter hash of its slot. Pure; C02 lint applies.
 */
import { PedEdgeKind, ambientKey, ctrU32, dsqrt, type ChunkKey, type QualityTierId, type SimChunk } from '@dv/shared';
import type { Obstacle } from '../traffic/reactions.ts';
import type { TrafficWorld } from '../traffic/sim.ts';
import { AI_DT } from '../traffic/sim.ts';
import { DESPAWN, cellReach, ringAllows, type TrafficFocus } from '../traffic/spawn.ts';
import type { WeatherPreset } from '@dv/shared';
import type { WitnessBoard } from '../traffic/witness.ts';
import { PED_NONE, Ped, PedSet } from './agent.ts';
import { AttractBoard } from './attract.ts';
import { avoidSet, clearOfHead, decayOffset, repulse, AVOID_EVERY, type Head } from './avoidance.ts';
import { PED_FREEZE_TICKS, PED_BODIES, PED_OUTFITS, PedState, WALK_MPS, WALK_SPREAD_MPS } from './components.ts';
import { NEAR_PED_M, PED_SLOT0, pedBudget, pedCap, pedRadius } from './density.ts';
import { STEP_TICKS, placePed, stepPed, type PedCtx, type PedHooks, type PedVehicle } from './fsm.ts';
import { pedIndexOf } from './graph.ts';

export { AI_DT };

/** Spawn attempts per AI step across all slots. */
export const PED_ATTEMPTS = 32;

export interface PedStepInput {
  tick: number;
  focus: TrafficFocus;
  env: { hour: number; weather: WeatherPreset };
  /** Moving vehicles near the focus (traffic and the player's). */
  vehicles: readonly PedVehicle[];
  /** The XR head, or null. The player's position stands in for it when the head pose is not known (BD-M03b2-03). */
  head: Head | null;
}

export interface PedOptions {
  world: TrafficWorld;
  /** `WorldIndex.worldSeed`. */
  seed: number;
  /** The tier whose factors and radii apply; `canonical` passes `mobile-low`. */
  tier: QualityTierId;
  board: WitnessBoard;
  hooks?: PedHooks & { spawned?(p: Ped): void; despawned?(p: Ped, why: string): void };
  initialFill?: boolean;
  /** 0..1 of the C13 cap (the governor's `crowdDensity`). */
  crowdDensity?: () => number;
}

export interface PedStats {
  spawns: number;
  despawns: number;
  hits: number;
  attempts: number;
  avoidPasses: number;
  avoidPairs: number;
  headClears: number;
}

const INV = 1 / 4294967296;
const slotUnit = (seed: number, cell: ChunkKey, slot: number, epoch: number, n: number): number => ctrU32(seed, ambientKey(cell, slot), epoch * 8 + n) * INV;

function seedOf(seed: number, key: string, epoch: number): number {
  let h = (seed ^ (epoch * 0x9e3779b1)) | 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Half extent of the box a pedestrian on a crosswalk blocks for the cars (the crosswalk patch of a robotaxi's occupied-crosswalk rule), metres. */
export const CROSSWALK_PATCH_HALF_M = 1.2;
/** Half extent of an ordinary pedestrian, metres. */
export const PED_HALF_M = 0.3;

/** The `ped` obstacle of a pedestrian for the traffic: cars stop for it, a robotaxi keeps 3 m from its lane and stops at an occupied crosswalk. */
export function pedObstacle(p: Ped): Obstacle {
  const onCross = p.kind === PedEdgeKind.Crosswalk && p.s > 0 && p.state !== PedState.Wait;
  const half = onCross ? CROSSWALK_PATCH_HALF_M : PED_HALF_M;
  return { id: p.key, kind: 'ped', x: p.x, z: p.z, vx: p.hx * p.speed, vz: p.hz * p.speed, halfW: half, halfL: half };
}

export class PedSim {
  readonly peds = new PedSet();
  readonly attract = new AttractBoard();
  readonly stats: PedStats = { spawns: 0, despawns: 0, hits: 0, attempts: 0, avoidPasses: 0, avoidPairs: 0, headClears: 0 };
  readonly epochs = new Map<string, number>();
  tick = 0;
  /** AI steps run so far; the avoidance pass runs on every third. */
  aiStep = 0;
  fill: boolean;
  hooks: NonNullable<PedOptions['hooks']>;
  /** Keys visited by the last avoidance pass, in the order they were visited (tests read it). */
  lastAvoid: string[] = [];
  lastFocus: TrafficFocus | null = null;
  private cursor = 0;
  private focus: TrafficFocus = { x: 0, z: 0, vx: 0, vz: 0 };
  private env: PedStepInput['env'] = { hour: 12, weather: 'clear' };
  private head: Head | null = null;
  private readonly set: Ped[] = [];
  private cellCache: { tick: number; cells: readonly ChunkKey[] } = { tick: -1, cells: [] };
  private readonly w: TrafficWorld;
  private readonly opts: PedOptions;
  private readonly ctx: PedCtx;

  constructor(opts: PedOptions) {
    this.opts = opts;
    this.w = opts.world;
    this.fill = opts.initialFill !== false;
    this.hooks = opts.hooks ?? {};
    this.ctx = {
      tick: 0,
      dt: AI_DT,
      world: { chunk: (k) => this.w.chunk(k), net: this.w.net, blackout: () => this.w.control.blackout },
      vehicles: [],
      board: opts.board,
      attract: this.attract,
      hooks: { hit: (p, vx, vz) => { this.stats.hits++; this.hooks.hit?.(p, vx, vz); } },
    };
  }

  get tier(): QualityTierId {
    return this.opts.tier;
  }

  /** `R_ped` of the tier, metres. */
  get radius(): number {
    return pedRadius(this.opts.tier);
  }

  /** Live-agent cap (C13 `maxPedInstances` x the governor's crowd density). */
  cap(): number {
    const d = this.opts.crowdDensity ? this.opts.crowdDensity() : 1;
    return Math.floor(pedCap(this.opts.tier) * (d < 0 ? 0 : d > 1 ? 1 : d));
  }

  budget(c: Readonly<SimChunk>): number {
    return pedBudget(c, { tier: this.opts.tier, hour: this.env.hour, weather: this.env.weather, override: this.w.control.densityOf('ped') });
  }

  private dist(x: number, z: number): number {
    const dx = x - this.focus.x, dz = z - this.focus.z;
    return dsqrt(dx * dx + dz * dz);
  }

  // ---- the step ---------------------------------------------------------------------------------------------------------

  step(input: PedStepInput): void {
    this.tick = input.tick;
    this.focus = input.focus;
    this.env = input.env;
    this.head = input.head;
    this.aiStep++;
    const jumped = this.lastFocus !== null && this.dist(this.lastFocus.x, this.lastFocus.z) > this.radius * 0.5;
    if (jumped) this.fill = this.opts.initialFill !== false;
    this.lastFocus = { ...input.focus };

    const ctx = this.ctx;
    ctx.tick = input.tick;
    ctx.vehicles = input.vehicles;
    const list = this.peds.list();
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Ped;
      p.near = this.dist(p.x, p.z) <= NEAR_PED_M;
      p.unseen = p.near ? 0 : p.unseen + STEP_TICKS;
      if (!this.w.chunk(p.chunk)) {
        this.freeze(p);
        continue;
      }
      if (p.state !== PedState.Dodge) decayOffset(p, AI_DT);
      stepPed(p, ctx);
    }
    // local avoidance: every third AI step, the pedestrians near the player in key order
    if (this.aiStep % AVOID_EVERY === 0) {
      avoidSet(list, this.focus.x, this.focus.z, this.set);
      this.lastAvoid = this.set.map((p) => p.key);
      this.stats.avoidPairs += repulse(this.set, this.head);
      this.stats.avoidPasses++;
    }
    // the head keeps its 0.6 m clear on every step
    if (this.head) {
      const h = this.head;
      for (let i = 0; i < list.length; i++) {
        const p = list[i] as Ped;
        if (clearOfHead(p, h, p.gx, p.gz)) this.stats.headClears++;
        p.x = p.gx + p.ox;
        p.z = p.gz + p.oz;
      }
    } else {
      for (let i = 0; i < list.length; i++) {
        const p = list[i] as Ped;
        p.x = p.gx + p.ox;
        p.z = p.gz + p.oz;
      }
    }
    this.despawnPass();
    this.spawnPass();
    if (this.fill && this.peds.size > 0) this.fill = false;
  }

  private freeze(p: Ped): void {
    p.state = PedState.Frozen;
    p.speed = 0;
    if (p.frozenSince < 0) p.frozenSince = this.tick;
  }

  remove(p: Ped, why: string): void {
    this.peds.remove(p);
    this.stats.despawns++;
    this.hooks.despawned?.(p, why);
  }

  private despawnPass(): void {
    const far = this.radius * DESPAWN;
    const budgets = new Map<string, number>();
    const list = this.peds.list();
    for (const p of [...list]) {
      if (this.dist(p.x, p.z) > far) {
        this.remove(p, 'range');
        continue;
      }
      if (!p.near && p.bound !== 0) {
        let n = budgets.get(p.cell);
        if (n === undefined) {
          const c = this.w.chunk(p.cell);
          n = c ? this.budget(c) : Infinity;
          budgets.set(p.cell, n);
        }
        if (p.slot - PED_SLOT0 >= n) {
          this.remove(p, 'density');
          continue;
        }
      }
      if (p.state === PedState.Frozen && p.frozenSince >= 0 && this.tick - p.frozenSince >= PED_FREEZE_TICKS) this.remove(p, 'unloaded');
    }
    // the crowd cap trims the farthest first
    const cap = this.cap();
    if (this.peds.size > cap) {
      const all = [...this.peds.list()].map((p) => ({ p, d: this.dist(p.x, p.z) }));
      all.sort((a, b) => (a.d !== b.d ? b.d - a.d : a.p.key < b.p.key ? -1 : 1));
      for (let i = 0; i < this.peds.size - cap && i < all.length; i++) {
        const e = all[i];
        if (e && !e.p.near) this.remove(e.p, 'cap');
      }
    }
  }

  private cells(): readonly ChunkKey[] {
    if (this.cellCache.tick !== this.tick) this.cellCache = { tick: this.tick, cells: this.w.cells() };
    return this.cellCache.cells;
  }

  private spawnPass(): void {
    const r = this.radius;
    const cap = this.cap();
    let live = this.peds.size;
    if (live >= cap) return;
    const fill = this.fill;
    const slots: { cell: ChunkKey; chunk: Readonly<SimChunk>; slot: number }[] = [];
    for (const cell of this.cells()) {
      const reach = cellReach(cell, this.focus.x, this.focus.z);
      if (reach.near > r) continue;
      if (!fill && reach.far < r * 0.6) continue;
      const chunk = this.w.chunk(cell);
      if (!chunk || chunk.pedNodes.length === 0) continue;
      const n = this.budget(chunk);
      for (let k = 0; k < n; k++) {
        const slot = PED_SLOT0 + k;
        if (!this.peds.has(ambientKey(cell, slot))) slots.push({ cell, chunk, slot });
      }
    }
    let attempts = 0;
    if (slots.length > 0) {
      const start = this.cursor % slots.length;
      for (let i = 0; i < slots.length && attempts < PED_ATTEMPTS && live < cap; i++) {
        const sl = slots[(start + i) % slots.length] as (typeof slots)[number];
        attempts++;
        if (this.trySpawn(sl.cell, sl.chunk, sl.slot, fill)) live++;
      }
      this.cursor = start + attempts;
    }
    this.stats.attempts += attempts;
  }

  /** The seeded start of slot `(cell, slot)` at `epoch`, or null when the chunk has no walkable edge. */
  candidate(cell: ChunkKey, chunk: Readonly<SimChunk>, slot: number, epoch: number): { a: number; b: number; s: number; len: number; flip: boolean } | null {
    const idx = pedIndexOf(chunk);
    if (idx.walkTotal <= 0) return null;
    const seed = this.opts.seed;
    let t = slotUnit(seed, cell, slot, epoch, 0) * idx.walkTotal;
    let pick = idx.walk[idx.walk.length - 1];
    for (const e of idx.walk) {
      t -= e.len;
      if (t < 0) {
        pick = e;
        break;
      }
    }
    if (!pick) return null;
    const s = slotUnit(seed, cell, slot, epoch, 1) * pick.len;
    return { a: pick.a, b: pick.b, s, len: pick.len, flip: slotUnit(seed, cell, slot, epoch, 2) < 0.5 };
  }

  private trySpawn(cell: ChunkKey, chunk: Readonly<SimChunk>, slot: number, fill: boolean): boolean {
    const key = ambientKey(cell, slot);
    const epoch = (this.epochs.get(key) ?? 0) + 1;
    this.epochs.set(key, epoch);
    const c = this.candidate(cell, chunk, slot, epoch);
    if (!c) return false;
    const idx = pedIndexOf(chunk);
    const na = idx.nodes.get(c.a), nb = idx.nodes.get(c.b);
    if (!na || !nb) return false;
    const t = c.s / c.len;
    const px = na.x + (nb.x - na.x) * t, pz = na.z + (nb.z - na.z) * t;
    if (!ringAllows(this.focus, px, pz, this.radius, fill)) return false;
    if (this.head) {
      const dx = px - this.head.x, dz = pz - this.head.z;
      if (dx * dx + dz * dz < 4) return false;
    }
    const seed = this.opts.seed;
    const p = new Ped(key, cell, slot, seedOf(seed, key, epoch));
    p.epoch = epoch;
    p.bound = 1;
    p.body = Math.floor(slotUnit(seed, cell, slot, epoch, 3) * PED_BODIES) % PED_BODIES;
    p.outfit = Math.floor(slotUnit(seed, cell, slot, epoch, 4) * PED_OUTFITS) % PED_OUTFITS;
    p.pace = WALK_MPS + (slotUnit(seed, cell, slot, epoch, 5) - 0.5) * 2 * WALK_SPREAD_MPS;
    p.lane = slotUnit(seed, cell, slot, epoch, 6) < 0.5 ? -0.5 : 0.5;
    p.spawnTick = this.tick;
    p.chunk = cell;
    p.tickAtWait = PED_NONE;
    // walking from `from` toward `to`, `s` metres along
    const from = c.flip ? nb : na, to = c.flip ? na : nb;
    p.from = from.id;
    p.to = to.id;
    p.prev = PED_NONE;
    p.fx = from.x;
    p.fy = from.y;
    p.fz = from.z;
    p.tx = to.x;
    p.ty = to.y;
    p.tz = to.z;
    p.len = c.len;
    p.s = c.flip ? c.len - c.s : c.s;
    const out = idx.out.get(from.id);
    const edge = out?.find((o) => o.to === to.id);
    p.kind = edge ? edge.kind : 0;
    p.junction = -1;
    p.movement = -1;
    placePed(p, this.ctx);
    p.near = this.dist(p.x, p.z) <= NEAR_PED_M;
    this.peds.add(p);
    this.stats.spawns++;
    this.hooks.spawned?.(p);
    return true;
  }

  /** Puts a pedestrian on the edge `a`-`b` of `chunk` (tests and the QA tools build scenes with it). */
  place(o: { key: string; cell: ChunkKey; slot: number; epoch?: number; a: number; b: number; s: number; body?: number; outfit?: number; lane?: number; pace?: number }): Ped | null {
    const chunk = this.w.chunk(o.cell);
    if (!chunk) return null;
    const idx = pedIndexOf(chunk);
    const from = idx.nodes.get(o.a), to = idx.nodes.get(o.b);
    if (!from || !to) return null;
    const edge = idx.out.get(o.a)?.find((e) => e.to === o.b);
    if (!edge) return null;
    const epoch = o.epoch ?? 1;
    const p = new Ped(o.key, o.cell, o.slot, seedOf(this.opts.seed, o.key, epoch));
    p.epoch = epoch;
    p.body = o.body ?? 0;
    p.outfit = o.outfit ?? 0;
    p.pace = o.pace ?? WALK_MPS;
    p.lane = o.lane ?? 0.5;
    p.spawnTick = this.tick;
    p.chunk = o.cell;
    p.tickAtWait = PED_NONE;
    p.from = from.id;
    p.to = to.id;
    p.prev = PED_NONE;
    p.fx = from.x;
    p.fy = from.y;
    p.fz = from.z;
    p.tx = to.x;
    p.ty = to.y;
    p.tz = to.z;
    p.len = edge.len;
    p.s = o.s;
    p.kind = edge.kind;
    p.junction = edge.junction;
    p.movement = edge.movement;
    placePed(p, this.ctx);
    this.peds.add(p);
    this.stats.spawns++;
    this.hooks.spawned?.(p);
    return p;
  }

  cursorValue(): number {
    return this.cursor;
  }

  setCursor(v: number): void {
    this.cursor = v;
  }
}
