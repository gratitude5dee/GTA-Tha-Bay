/**
 * The traffic brain (02-world-living.md section 2; M03b1): every ambient agent, one AI step at a time. `TrafficSim` is independent of
 * the ECS and of Rapier: it reads the road network, the signals and `TrafficControl`, takes the player's position and the things
 * that must not be driven through as inputs, and reports spawns, despawns, promotions and honks through hooks. `system.ts` binds it to
 * the engine (entities, near-level bodies, the promoted vehicles).
 *
 * One call to `step` is one AI tick (30 Hz, `AI_DIVISOR 2`): agents are visited in `StableKey` order and write their own state only
 * (C01 rule 4; C02 rule: component writes in `SimStage.AI` and `Rules`). All randomness is the agent's private stream or the
 * counter hash of its slot. Pure; C02 lint applies.
 */
import {
  AI_DIVISOR, ambientKey, dsqrt, datan2, TWO_PI,
  type ChunkKey, type EdgeId, type QualityTierId, type SimChunk, type WeatherPreset,
} from '@dv/shared';
import type { RoadNetwork } from '../graph/adjacency.ts';
import type { RoadGraph } from '../graph/query.ts';
import type { TrafficControlImpl } from './control.ts';
import { Agent, AgentSet, NONE } from './agent.ts';
import { ARCH, ARCHETYPES, AgentKind, AgentState, LightBit, PALETTE, Turn, pickArchetype } from './components.ts';
import { AMBIENT_RADIUS_M, NEAR_CAP, NEAR_RADIUS_M, PROMOTED_CAP, activeFor, profileName, trafficCap } from './density.ts';
import { IDM_B, PERSONALITY_MAX, PERSONALITY_MIN, advance, idmAccel, stopDistance } from './idm.ts';
import { JunctionBook, STOP_LINE_GAP_M, boxHalf, newDecision, type Decision } from './junction.ts';
import { EdgePaths, PLAN_DISTANCE_M, laneForTurn, landingLane, planTurn } from './plan.ts';
import { PromotionBook, findHit, velocityAfterHit, type Hit, type Mover } from './promote.ts';
import {
  HONK_COOLDOWN_TICKS, HONK_DECEL, INTRUDER_RANGE_M, nearestIntruder, sirenBehind, sirenNear,
  type Intruder, type Obstacle, type Siren,
} from './reactions.ts';
import {
  AUTO_YIELD_RADIUS_M, PED_LATERAL_M, PED_LOOKAHEAD_M, STALL_TRIGGER_M, autoYieldAccel, robotaxiSpeedCap, rollStall,
} from './robotaxi.ts';
import {
  CONE_COS, DESPAWN, SPAWN_MAX, candidateFor, cellReach, parkedPose, ringAllows, slotUnit, type Focus,
} from './spawn.ts';
import {
  INFRACTION_CODE, REPORT_DELAY_TICKS, ROBOTAXI_RAYS_PER_TICK, WITNESS_RANGE_M, type Infraction, type WitnessBoard,
} from './witness.ts';

export type { Focus };

/** Sim ticks per AI step and seconds per AI step. */
export const AI_TICKS = AI_DIVISOR;
export const AI_DT = AI_DIVISOR / 60;

/** An agent stuck this many ticks (30 s) with nothing legitimate to wait for is despawned if unseen, nudged if seen. */
export const GRIDLOCK_TICKS = 1800;
/** An agent on an unloaded edge freezes for this many ticks (2 s) and is then removed. */
export const FREEZE_TICKS = 120;
/** Spawn attempts per AI step across all slots. */
export const MAX_ATTEMPTS = 24;
/** Seconds of cruise a new agent starts with, as a share of its desired speed. */
const START_SPEED_SHARE = 0.7;
/** The stop line is a stationary obstacle this much beyond the line, so that the IDM minimum gap leaves the car about 0.5 m short of it. */
const STOP_BIAS_M = 1.5;
/** Ticks a dead end holds an agent before the U-turn (1 s). */
const DEAD_END_TICKS = 60;
/** Same-lane spacing under which a spawn point is rejected, metres. */
const SPAWN_GAP_M = 14;
/** Lane changes are made when the target lane is clear this far each way, metres. */
const LANE_CLEAR_M = 9;
/** Lateral easing speed, m/s. */
const LATERAL_SPEED = 2;

/** What the traffic reads of the world. `WorldServices` plus a chunk lookup fits (see `trafficWorldOf`). */
export interface TrafficWorld {
  readonly net: RoadNetwork;
  readonly graph: RoadGraph;
  readonly control: TrafficControlImpl;
  /** The resident `p0` chunk of a cell, or null. */
  chunk(key: ChunkKey): Readonly<SimChunk> | null;
  /** Resident `p0` cells, ascending. */
  cells(): readonly ChunkKey[];
}

export interface TrafficEnv {
  hour: number;
  weather: WeatherPreset;
}

export interface TrafficHooks {
  spawned?(a: Agent): void;
  despawned?(a: Agent, why: string): void;
  /** A near agent was hit: it leaves the traffic as a dynamic vehicle with this velocity. */
  promoted?(a: Agent, vx: number, vz: number, hit: Hit): void;
  /** A promotion ran out (8 s): the vehicle becomes a wreck. */
  wrecked?(key: string): void;
  honk?(a: Agent): void;
  /** An agent left a stop line and entered a junction box (the tests judge the red-light rule here). */
  crossed?(info: CrossInfo): void;
  /** A robotaxi began a dark-signal stall. */
  stalled?(a: Agent, holdTicks: number): void;
  /** A line-of-sight ray, from and to (the system casts it against the static colliders). */
  los?(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
}

export interface CrossInfo {
  agent: Agent;
  tick: number;
  junction: number;
  movement: number;
  rule: string;
  aspect: string;
  /** Speed and distance to the stop line at the step before the crossing. */
  speedBefore: number;
  distBefore: number;
  /** Aspect of the movement at the crossing tick (what the red-light rule is judged against). */
  aspectNow: string;
}

export interface StepInput {
  tick: number;
  focus: Focus;
  env: TrafficEnv;
  obstacles?: readonly Obstacle[];
  movers?: readonly Mover[];
  sirens?: readonly Siren[];
}

export interface TrafficOptions {
  world: TrafficWorld;
  /** `WorldIndex.worldSeed`: the first 4 bytes of the bake id. */
  seed: number;
  /** The tier whose factors and radii apply; `canonical` passes `mobile-low`. */
  tier: QualityTierId;
  board: WitnessBoard;
  hooks?: TrafficHooks;
  /** First population anywhere within `R_amb` instead of the ring (default true; the ring tests turn it off). */
  initialFill?: boolean;
  /** 0..1 of the C13 cap (the governor's `crowdDensity`). */
  crowdDensity?: () => number;
  /** Include parked cars (default true). */
  parked?: boolean;
}

export interface PlaceOptions {
  key: string;
  cell: ChunkKey;
  slot: number;
  epoch: number;
  /** Archetype index (`ARCH`). */
  arch: number;
  color?: number;
  edge: EdgeId;
  /** Front bumper, metres along the edge. */
  s: number;
  lane: number;
  speed?: number;
}

export interface TrafficStats {
  spawns: number;
  despawns: number;
  promotions: number;
  emergencyStops: number;
  honks: number;
  stalls: number;
  rays: number;
  raysMax: number;
  attempts: number;
}

const byKeyAsc = (a: Agent, b: Agent): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export class TrafficSim {
  readonly agents = new AgentSet();
  readonly paths: EdgePaths;
  readonly junction: JunctionBook;
  readonly promotions: PromotionBook;
  readonly stats: TrafficStats = { spawns: 0, despawns: 0, promotions: 0, emergencyStops: 0, honks: 0, stalls: 0, rays: 0, raysMax: 0, attempts: 0 };
  /** Spawn attempts per slot key (the `epoch` of the slot's plan). */
  readonly epochs = new Map<string, number>();
  tick = 0;
  /** Set until the first population has run (and again after a jump of the focus). */
  fill: boolean;
  hooks: TrafficHooks;
  lastFocus: Focus | null = null;
  private cursor = 0;
  private readonly pool: Agent[][] = [];
  private byEdge = new Map<number, Agent[]>();
  private readonly dec: Decision = newDecision();
  private readonly pose = new Float64Array(6);
  private readonly pose2 = new Float64Array(6);
  private readonly stepOut = { v: 0, ds: 0 };
  private readonly hit: Intruder = { gap: 0, vLead: 0, closing: 0, obstacle: { id: '', kind: 'vehicle', x: 0, z: 0, vx: 0, vz: 0, halfW: 0, halfL: 0 } };
  private obstacles: readonly Obstacle[] = [];
  private sirens: readonly Siren[] = [];
  private focus: Focus = { x: 0, z: 0, vx: 0, vz: 0 };
  private env: TrafficEnv = { hour: 12, weather: 'clear' };
  private rays = 0;
  private readonly w: TrafficWorld;
  private readonly opts: TrafficOptions;
  private cellCache: { tick: number; cells: readonly ChunkKey[] } = { tick: -1, cells: [] };

  constructor(opts: TrafficOptions) {
    this.opts = opts;
    this.w = opts.world;
    this.hooks = opts.hooks ?? {};
    this.fill = opts.initialFill !== false;
    this.paths = new EdgePaths(this.w.net, this.w.graph);
    this.junction = new JunctionBook(this.w.net, this.w.graph, this.paths);
    this.promotions = new PromotionBook(PROMOTED_CAP[opts.tier]);
  }

  get tier(): QualityTierId {
    return this.opts.tier;
  }

  /** `R_amb` of the tier, metres. */
  get radius(): number {
    return AMBIENT_RADIUS_M[this.opts.tier];
  }

  // ---- budgets -----------------------------------------------------------------------------------------------------------

  /** Live-agent cap (C13 `maxTrafficInstances` x the governor's crowd density). */
  cap(): number {
    const d = this.opts.crowdDensity ? this.opts.crowdDensity() : 1;
    return Math.floor(trafficCap(this.opts.tier) * (d < 0 ? 0 : d > 1 ? 1 : d));
  }

  /** The traffic slots of a cell that may be live now (a prefix of its slot range). */
  trafficBudget(c: Readonly<SimChunk>): number {
    return activeFor({
      capacity: c.spawn.trafficSlots, kind: 'traffic', tier: this.opts.tier, profile: c.spawn.densityProfile,
      hour: this.env.hour, weather: this.env.weather, override: this.w.control.densityOf('traffic'),
    });
  }

  /** The parked slots of a cell that may be live now. */
  parkedBudget(c: Readonly<SimChunk>): number {
    return activeFor({
      capacity: c.spawn.parked.length, kind: 'parked', tier: this.opts.tier, profile: c.spawn.densityProfile,
      hour: this.env.hour, weather: this.env.weather, override: this.w.control.densityOf('parked'),
    });
  }

  // ---- the step ----------------------------------------------------------------------------------------------------------

  step(input: StepInput): void {
    this.tick = input.tick;
    this.focus = input.focus;
    this.env = input.env;
    this.obstacles = input.obstacles ?? [];
    this.sirens = input.sirens ?? [];
    this.rays = 0;
    const jumped = this.lastFocus !== null && this.dist(this.lastFocus.x, this.lastFocus.z) > this.radius * 0.5;
    if (jumped) this.fill = this.opts.initialFill !== false;
    this.lastFocus = { ...input.focus };

    this.indexByEdge();
    this.refreshNear();
    const list = this.agents.list();
    this.junction.begin(this.tick, list, this.byEdge);
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Agent;
      if (a.isParked) continue;
      this.stepAgent(a);
    }
    this.promote(input.movers ?? []);
    this.witnesses();
    this.despawnPass();
    this.spawnPass();
    if (this.fill && this.agents.size > 0) this.fill = false;
    if (this.rays > this.stats.raysMax) this.stats.raysMax = this.rays;
    this.stats.rays += this.rays;
  }

  private dist(x: number, z: number): number {
    const dx = x - this.focus.x, dz = z - this.focus.z;
    return dsqrt(dx * dx + dz * dz);
  }

  private indexByEdge(): void {
    for (const l of this.byEdge.values()) {
      l.length = 0;
      this.pool.push(l);
    }
    this.byEdge.clear();
    for (const a of this.agents.list()) {
      if (a.isParked || a.edge === NONE) continue;
      let l = this.byEdge.get(a.edge);
      if (!l) {
        l = this.pool.pop() ?? [];
        this.byEdge.set(a.edge, l);
      }
      l.push(a);
    }
    for (const l of this.byEdge.values()) if (l.length > 1) l.sort((p, q) => (q.s !== p.s ? q.s - p.s : byKeyAsc(p, q)));
  }

  // ---- one agent ---------------------------------------------------------------------------------------------------------

  private stepAgent(a: Agent): void {
    const near = this.dist(a.x, a.z) <= NEAR_RADIUS_M;
    a.near = near;
    a.unseenTicks = near ? 0 : a.unseenTicks + AI_TICKS;
    if (!this.w.net.resident(a.edge)) {
      this.freeze(a);
      return;
    }
    if (a.state === AgentState.Frozen) {
      a.state = AgentState.Drive;
      a.frozenSince = -1;
    }
    if (a.state === AgentState.Cross) this.crossStep(a);
    else this.driveStep(a);
    this.refreshPose(a);
  }

  private freeze(a: Agent): void {
    a.state = AgentState.Frozen;
    a.speed = 0;
    a.accel = 0;
    if (a.frozenSince < 0) a.frozenSince = this.tick;
  }

  private archOf(a: Agent): { hl: number; hw: number } {
    const ar = ARCHETYPES[a.arch] as (typeof ARCHETYPES)[number];
    return { hl: ar.halfLength, hw: ar.halfWidth };
  }

  private planFor(a: Agent): void {
    const u = a.rng.nextFloat();
    const c = planTurn({ net: this.w.net, graph: this.w.graph, isClosed: (e) => this.w.control.isClosed(e) }, this.paths, a.edge, u);
    if (!c) {
      a.nextEdge = NONE;
      a.turn = Turn.None;
      a.mov = -1;
      a.jct = -1;
      return;
    }
    a.nextEdge = c.next;
    a.turn = c.turn;
    a.mov = c.mov;
    a.jct = c.jct;
  }

  /** Leader candidates fold into one acceleration: the smallest wins. */
  private driveStep(a: Agent): void {
    const t = this.tick;
    const e = a.edge;
    const len = this.paths.len(e);
    const { hl, hw } = this.archOf(a);
    const boxS = len - boxHalf(len);
    const lineS = boxS - STOP_LINE_GAP_M;

    // timers that hold the agent where it is
    if (a.state === AgentState.Stalled) {
      if (t < a.holdUntil) {
        a.speed = 0;
        a.accel = 0;
        a.legitWait = true;
        return;
      }
      a.state = AgentState.Wait;
    }
    if (a.state === AgentState.DeadEnd && t >= a.holdUntil) {
      if (!this.uTurn(a)) {
        this.remove(a, 'dead-end');
        return;
      }
    }

    // plan the next edge 40 m before the end
    if (a.nextEdge === NONE && a.state !== AgentState.DeadEnd && len - a.s <= PLAN_DISTANCE_M) {
      this.planFor(a);
      if (a.nextEdge === NONE) {
        // dead end with no way on: an unseen car leaves, a seen one stops and turns round
        if (!a.near) {
          this.remove(a, 'dead-end');
          return;
        }
        a.state = AgentState.DeadEnd;
      } else if (a.turn === Turn.UTurn && !a.near) {
        this.remove(a, 'dead-end');
        return;
      }
    }
    const edgeNow = this.paths.edge(e);

    // lane for the turn
    if (a.nextEdge !== NONE && edgeNow && len - a.s <= PLAN_DISTANCE_M) {
      const want = laneForTurn(a.turn, edgeNow.lanes, a.lane);
      if (want !== a.lane && this.laneFree(a, want)) a.lane = want;
    }
    // lateral easing toward the lane centre
    let latWant = this.paths.laneOffset(e, a.lane);
    const sirenSide = this.sirens.length > 0 ? sirenBehind(a, this.sirens) : null;
    if (sirenSide && a.state !== AgentState.Pulled && !a.isParked) {
      a.state = AgentState.Pulled;
    } else if (a.state === AgentState.Pulled && !sirenNear(a, this.sirens)) {
      a.state = AgentState.Drive;
    }
    if (a.state === AgentState.Pulled) latWant += 1.4;
    const dLat = latWant - a.lat;
    const maxLat = LATERAL_SPEED * AI_DT;
    a.lat += dLat > maxLat ? maxLat : dLat < -maxLat ? -maxLat : dLat;

    // desired speed
    const limit = this.paths.limit(e);
    let v0 = a.isRobotaxi ? robotaxiSpeedCap(limit) : limit * a.personality;
    const cap = this.paths.curveCap(e, a.s, 30);
    if (cap < v0) v0 = cap;
    v0 *= this.paths.grade(e);
    if (a.state === AgentState.Pulled) v0 = 0;

    // the junction ahead
    const distBefore = lineS - a.s;
    const speedBefore = a.speed;
    let acc = idmAccel(a.speed, v0, Infinity, 0);
    const d = this.dec;
    let hasJunction = false;
    if (a.nextEdge !== NONE || a.state === AgentState.DeadEnd) {
      if (a.nextEdge !== NONE) {
        this.junction.evaluate(a, d);
        hasJunction = true;
        if (a.turn === Turn.UTurn && d.rule === 'free') this.uTurnWait(a, d, distBefore);
      } else {
        d.stop = true; d.go = false; d.legit = true; d.rule = 'allway'; d.aspect = 'none'; d.dark = false;
        hasJunction = true;
      }
    } else {
      d.stop = false; d.go = true; d.legit = false; d.rule = 'free'; d.aspect = 'none'; d.dark = false;
    }
    if (d.stop && hasJunction) {
      const gap = distBefore < 0.1 ? 0.1 : distBefore;
      const aa = idmAccel(a.speed, v0, gap + STOP_BIAS_M, 0);
      if (aa < acc) acc = aa;
    }

    // robotaxi at a dark signal: the once-per-junction stall roll
    if (a.isRobotaxi && d.dark && a.jct >= 0) {
      if (distBefore < STALL_TRIGGER_M && a.rtJct !== a.jct) {
        const hold = rollStall(a, a.jct);
        if (hold > 0) {
          a.stallPending = true;
          a.stallTicks = hold;
        }
      }
      if (a.stallPending && a.speed < 0.3 && distBefore < 1.5) {
        a.stallPending = false;
        a.state = AgentState.Stalled;
        a.holdUntil = t + a.stallTicks;
        a.speed = 0;
        a.accel = 0;
        this.stats.stalls++;
        this.hooks.stalled?.(a, a.stallTicks);
        a.legitWait = true;
        return;
      }
    }

    // leaders
    const lead = this.leaderAccel(a, v0, len);
    if (lead < acc) acc = lead;
    const reaction = this.reactionAccel(a, hl, hw, v0);
    if (reaction < acc) acc = reaction;

    // honk
    if (acc < -HONK_DECEL && a.speed > 2 && t >= a.honkAt && this.intrudedLast) {
      a.honkAt = t + HONK_COOLDOWN_TICKS;
      this.stats.honks++;
      this.hooks.honk?.(a);
    }

    advance(a.speed, acc, AI_DT, this.stepOut);
    let ds = this.stepOut.ds;
    let nv = this.stepOut.v;
    if (a.isRobotaxi && nv > limit * 0.95) nv = limit * 0.95;
    a.accel = acc;

    // the stop line is a wall for an agent that has to stop
    if (hasJunction && d.stop && a.s + ds > lineS) {
      const room = lineS - a.s;
      if (room < ds) {
        if (a.speed > 3 && room < 0.5) this.stats.emergencyStops++;
        ds = room > 0 ? room : 0;
        nv = 0;
      }
    }
    a.s += ds;
    a.speed = nv;

    // into the box
    if (a.nextEdge !== NONE && a.s >= boxS - 1e-9 && d.go) {
      const carry = a.s - boxS;
      const aspectNow = d.aspect === 'none' || a.jct < 0 ? 'none' : this.w.graph.signal(this.w.net.to(a.edge), a.mov);
      const info: CrossInfo | null = this.hooks.crossed
        ? { agent: a, tick: t, junction: a.jct, movement: a.mov, rule: d.rule, aspect: d.aspect, speedBefore, distBefore, aspectNow }
        : null;
      if (this.junction.enter(a)) {
        a.jPos = carry;
        a.s = boxS;
        if (info) this.hooks.crossed?.(info);
      } else {
        this.remove(a, 'no-geometry');
        return;
      }
    } else if (a.nextEdge === NONE && a.state !== AgentState.DeadEnd && a.s > len - 1) {
      a.s = len - 1;
      a.speed = 0;
    }

    // stuck bookkeeping
    a.legitWait = d.legit || this.leaderLegit;
    if (a.speed < 0.5 && !a.legitWait && a.state !== AgentState.Stalled) a.stuckTicks += AI_TICKS;
    else a.stuckTicks = 0;
    if (a.state === AgentState.Drive || a.state === AgentState.Wait) a.state = a.speed < 0.3 && a.nextEdge !== NONE && d.stop ? AgentState.Wait : AgentState.Drive;
    if (a.state === AgentState.DeadEnd && a.speed < 0.3 && a.holdUntil <= t) a.holdUntil = t + DEAD_END_TICKS;
  }

  /** A U-turn at a junction waits like an all-way stop for a second. */
  private uTurnWait(a: Agent, d: Decision, dist: number): void {
    const atLine = a.speed < 0.3 && dist < 1.5;
    if (!atLine) {
      d.stop = true; d.go = false; d.legit = true;
      return;
    }
    if (a.stoppedTick < 0) a.stoppedTick = this.tick;
    if (this.tick - a.stoppedTick < DEAD_END_TICKS) {
      d.stop = true; d.go = false; d.legit = true;
    }
  }

  /** The dead end has no junction: the agent turns round onto the twin of its edge. */
  private uTurn(a: Agent): boolean {
    const ed = this.paths.edge(a.edge);
    if (!ed || ed.twin < 0 || !this.w.net.resident(ed.twin)) return false;
    const tw = ed.twin;
    const twinLen = this.paths.len(tw);
    const here = this.paths.len(a.edge);
    a.edge = tw;
    a.s = twinLen - here + a.s > 0 ? Math.min(twinLen - 8, Math.max(8, twinLen - here + a.s)) : 8;
    a.s = Math.max(a.s, 10);
    a.lane = 0;
    a.lat = this.paths.laneOffset(tw, 0);
    a.nextEdge = NONE;
    a.turn = Turn.None;
    a.mov = -1;
    a.jct = -1;
    a.state = AgentState.Drive;
    a.speed = 0;
    return true;
  }

  private laneFree(a: Agent, lane: number): boolean {
    const list = this.byEdge.get(a.edge);
    if (!list) return true;
    for (const b of list) {
      if (b === a || b.lane !== lane || b.state === AgentState.Cross) continue;
      const ds = b.s - a.s;
      if (ds > -LANE_CLEAR_M && ds < LANE_CLEAR_M) return false;
    }
    return true;
  }

  /** Whether the same-lane leader of the last `leaderAccel` call was waiting for a legitimate reason. */
  private leaderLegit = false;
  private intrudedLast = false;

  private leaderAccel(a: Agent, v0: number, len: number): number {
    let best = Infinity;
    this.leaderLegit = false;
    const list = this.byEdge.get(a.edge);
    // 1. the nearest agent ahead in the same lane
    let lead: Agent | null = null;
    if (list) {
      for (const b of list) {
        if (b === a || b.lane !== a.lane || b.state === AgentState.Cross || b.s <= a.s) continue;
        if (lead === null || b.s < lead.s) lead = b;
      }
    }
    if (lead) {
      const lh = this.archOf(lead).hl;
      // `s` is the front bumper: the leader's rear is its length behind it
      const g = lead.s - 2 * lh - a.s;
      const acc = idmAccel(a.speed, v0, g, lead.speed);
      if (acc < best) best = acc;
      this.leaderLegit = lead.legitWait;
    }
    // 2. the last agent on the next edge, and the agent still inside the box on my movement
    if (a.nextEdge !== NONE) {
      const boxS = len - boxHalf(len);
      const inside = a.jct >= 0 ? this.junction.rearOf(a.jct, a.mov) : undefined;
      if (inside) {
        const il = this.archOf(inside).hl;
        const g = boxS + (inside.jPos - 2 * il) - a.s;
        const acc = idmAccel(a.speed, v0, g, inside.speed);
        if (acc < best) best = acc;
      }
      if (len - a.s < 80) {
        const nl = this.byEdge.get(a.nextEdge);
        if (nl) {
          const ne = this.paths.edge(a.nextEdge);
          const landing = landingLane(a.turn, ne ? ne.lanes : 1, a.lane);
          let rear: Agent | null = null;
          for (const b of nl) {
            if (b.lane !== landing || b.state === AgentState.Cross) continue;
            if (rear === null || b.s < rear.s) rear = b;
          }
          if (rear) {
            const bl = this.archOf(rear).hl;
            const r1 = boxHalf(this.paths.len(a.nextEdge));
            // my front would be at r1 on the next edge when it leaves the box; the box is about 2 * BOX_HALF long
            const g = boxS + 2 * Math.min(boxHalf(len), r1) + (rear.s - 2 * bl - r1) - a.s;
            const acc = idmAccel(a.speed, v0, g, rear.speed);
            if (acc < best) best = acc;
          }
        }
      }
    }
    return best;
  }

  /** Reactions to things that are not traffic: intruders, and the robotaxi's pedestrian and autoYield rules. */
  private reactionAccel(a: Agent, hl: number, hw: number, v0: number): number {
    this.intrudedLast = false;
    let best = Infinity;
    if (this.obstacles.length === 0) return best;
    if (nearestIntruder(a, hl, hw, this.obstacles, INTRUDER_RANGE_M, 0.3, this.hit)) {
      const acc = idmAccel(a.speed, v0, this.hit.gap, this.hit.vLead);
      if (acc < best) best = acc;
      this.intrudedLast = true;
    }
    if (a.isRobotaxi) {
      // pedestrians within 3 m of the lane ahead inside 20 m
      if (nearestIntruder(a, hl, hw, this.peds(), PED_LOOKAHEAD_M, PED_LATERAL_M, this.hit)) {
        const gap = this.hit.gap - 1.5;
        const acc = idmAccel(a.speed, v0, gap < 0.1 ? 0.1 : gap, this.hit.vLead);
        if (acc < best) best = acc;
      }
      // autoYield: anything inside 14 m closing faster than 4 m/s
      if (nearestIntruder(a, hl, hw, this.obstacles, AUTO_YIELD_RADIUS_M, 0.5, this.hit)) {
        const ay = autoYieldAccel(this.hit);
        if (ay < 0 && ay < best) best = ay;
      }
    }
    return best;
  }

  private pedList: Obstacle[] = [];
  private pedSource: readonly Obstacle[] | null = null;
  private peds(): readonly Obstacle[] {
    if (this.pedSource !== this.obstacles) {
      this.pedSource = this.obstacles;
      this.pedList = this.obstacles.filter((o) => o.kind === 'ped');
    }
    return this.pedList;
  }

  private crossStep(a: Agent): void {
    const { hl, hw } = this.archOf(a);
    const inLimit = this.paths.limit(a.edge);
    const outLimit = this.paths.limit(a.nextEdge);
    const limit = inLimit < outLimit ? inLimit : outLimit;
    let v0 = a.isRobotaxi ? robotaxiSpeedCap(limit) : limit * a.personality;
    const cc = this.junction.connectorCap(a);
    if (cc < v0) v0 = cc;
    let acc = idmAccel(a.speed, v0, Infinity, 0);

    // ahead of me in the same movement
    for (const b of this.agents.list()) {
      if (b === a || b.state !== AgentState.Cross || b.jct !== a.jct || b.mov !== a.mov || b.jPos <= a.jPos) continue;
      const g = b.jPos - 2 * this.archOf(b).hl - a.jPos;
      const aa = idmAccel(a.speed, v0, g, b.speed);
      if (aa < acc) acc = aa;
    }
    // the last agent on the road I am about to join
    const nl = this.byEdge.get(a.nextEdge);
    if (nl) {
      const ne = this.paths.edge(a.nextEdge);
      const landing = landingLane(a.turn, ne ? ne.lanes : 1, a.lane);
      const r1 = boxHalf(this.paths.len(a.nextEdge));
      let rear: Agent | null = null;
      for (const b of nl) if (b.lane === landing && b.state !== AgentState.Cross && (rear === null || b.s < rear.s)) rear = b;
      if (rear) {
        const g = a.jLen - a.jPos + (rear.s - 2 * this.archOf(rear).hl - r1);
        const aa = idmAccel(a.speed, v0, g, rear.speed);
        if (aa < acc) acc = aa;
      }
    }
    const reaction = this.reactionAccel(a, hl, hw, v0);
    if (reaction < acc) acc = reaction;
    advance(a.speed, acc, AI_DT, this.stepOut);
    let nv = this.stepOut.v;
    if (a.isRobotaxi && nv > limit * 0.95) nv = limit * 0.95;
    a.speed = nv;
    a.accel = acc;
    a.jPos += this.stepOut.ds;
    a.legitWait = false;
    a.stuckTicks = a.speed < 0.5 ? a.stuckTicks + AI_TICKS : 0;
    if (a.jPos >= a.jLen) this.land(a);
  }

  /** The agent leaves the box and drives on the edge it was heading for. */
  private land(a: Agent): void {
    const out = a.nextEdge;
    const oe = this.paths.edge(out);
    const lane = landingLane(a.turn, oe ? oe.lanes : 1, a.lane);
    const r1 = boxHalf(this.paths.len(out));
    const { hl } = this.archOf(a);
    a.s = r1 + (a.jPos - a.jLen);
    if (a.s < hl) a.s = hl;
    a.edge = out;
    a.lane = lane;
    a.lat = this.paths.laneOffset(out, lane);
    a.nextEdge = NONE;
    a.turn = Turn.None;
    a.mov = -1;
    a.jct = -1;
    a.jPos = 0;
    a.jLen = 0;
    a.state = AgentState.Drive;
    a.committed = false;
    a.stoppedTick = -1;
    a.claimTick = -1;
  }

  // ---- pose --------------------------------------------------------------------------------------------------------------

  private refreshPose(a: Agent): void {
    const { hl } = this.archOf(a);
    const p = this.pose;
    if (a.state === AgentState.Cross) {
      const c = a.jPos - hl;
      if (c >= 0) this.junction.connectorPose(a, c, p);
      else {
        const len = this.paths.len(a.edge);
        const s = len - boxHalf(len) + c;
        if (!this.paths.pose(a.edge, s < 0 ? 0 : s, this.paths.laneOffset(a.edge, a.lane), p)) return;
      }
    } else {
      const c = a.s - hl;
      if (!this.paths.pose(a.edge, c < 0 ? 0 : c, a.lat, p)) return;
    }
    a.x = p[0] as number;
    a.y = p[1] as number;
    a.z = p[2] as number;
    a.yaw = p[3] as number;
    a.fx = p[4] as number;
    a.fz = p[5] as number;
    let lights = 0;
    if (a.accel < -0.5 || (a.speed < 0.2 && a.state !== AgentState.Drive)) lights |= LightBit.Brake;
    if (a.state === AgentState.Stalled) lights |= LightBit.Hazard;
    if (a.isRobotaxi) lights |= LightBit.Dome;
    a.lights = lights;
  }

  // ---- promotion ---------------------------------------------------------------------------------------------------------

  private promote(movers: readonly Mover[]): void {
    for (const p of this.promotions.expire(this.tick)) this.hooks.wrecked?.(p.key);
    if (movers.length === 0) return;
    for (const a of this.agents.list()) {
      if (!a.near || !this.promotions.canPromote()) continue;
      const { hl, hw } = this.archOf(a);
      const hit = findHit(a, hw, hl, movers);
      if (!hit) continue;
      const mass = (ARCHETYPES[a.arch] as (typeof ARCHETYPES)[number]).massKg;
      const [vx, vz] = velocityAfterHit(a, mass, hit.mover);
      this.promotions.add(a.key, this.tick);
      this.agents.remove(a);
      this.stats.promotions++;
      this.hooks.promoted?.(a, vx, vz, hit);
    }
  }

  /** Promotes a named agent at once (the player entered it); false when the cap is reached or it is unknown. */
  promoteKey(key: string, vx: number, vz: number): boolean {
    const a = this.agents.get(key);
    if (!a || !this.promotions.canPromote()) return false;
    this.promotions.add(key, this.tick);
    this.agents.remove(a);
    this.stats.promotions++;
    const m: Mover = { id: 'player', x: a.x, z: a.z, vx, vz, hx: a.fx, hz: a.fz, halfW: 0.9, halfL: 2.3, massKg: 0 };
    this.hooks.promoted?.(a, vx, vz, { mover: m, dv: 0 });
    return true;
  }

  // ---- witnesses ---------------------------------------------------------------------------------------------------------

  private witnesses(): void {
    const board = this.opts.board;
    const pending = board.pending();
    const t = this.tick;
    if (pending.length > 0) {
      for (const inf of pending) {
        if (inf.reported) continue;
        this.seeInfraction(inf);
      }
    }
    for (const a of this.agents.list()) {
      if (a.witnessId === 0 || t < a.reportAt) continue;
      board.report(a.witnessId, a.key, a.reportAt);
      a.witnessId = 0;
      a.witnessTarget = '';
    }
    board.prune(t);
  }

  private seeInfraction(inf: Infraction): void {
    for (const a of this.agents.list()) {
      if (!a.isRobotaxi || a.witnessId !== 0 || a.losDone === inf.id) continue;
      const dx = inf.x - a.x, dz = inf.z - a.z;
      if (dx * dx + dz * dz > WITNESS_RANGE_M * WITNESS_RANGE_M) continue;
      if (this.rays >= ROBOTAXI_RAYS_PER_TICK) return;
      this.rays++;
      a.losDone = inf.id;
      const visible = this.hooks.los ? this.hooks.los(a.x, a.y + 1.6, a.z, inf.x, inf.y + 1, inf.z) : true;
      if (!visible) continue;
      a.witnessId = inf.id;
      a.witnessTarget = inf.actor;
      a.reportAt = this.tick + REPORT_DELAY_TICKS;
      a.witnessKind = INFRACTION_CODE[inf.kind];
    }
  }

  // ---- despawn and spawn -------------------------------------------------------------------------------------------------

  remove(a: Agent, why: string): void {
    this.agents.remove(a);
    this.stats.despawns++;
    this.hooks.despawned?.(a, why);
  }

  private despawnPass(): void {
    const far = this.radius * DESPAWN;
    for (const a of [...this.agents.list()]) {
      const d = this.dist(a.x, a.z);
      if (d > far) {
        this.remove(a, 'range');
        continue;
      }
      if (a.isParked) continue;
      if (a.state === AgentState.Frozen && a.frozenSince >= 0 && this.tick - a.frozenSince >= FREEZE_TICKS) this.remove(a, 'unloaded');
      else if (a.stuckTicks >= GRIDLOCK_TICKS && !a.near) this.remove(a, 'stuck');
    }
  }

  private cells(): readonly ChunkKey[] {
    if (this.cellCache.tick !== this.tick) this.cellCache = { tick: this.tick, cells: this.w.cells() };
    return this.cellCache.cells;
  }

  private spawnPass(): void {
    const r = this.radius;
    const cap = this.cap();
    let live = 0;
    for (const a of this.agents.list()) if (!a.isParked) live++;
    const fill = this.fill;
    const w = this.w;
    // the cells that can hold a spawn point, with their budgets
    const slots: { cell: ChunkKey; chunk: Readonly<SimChunk>; slot: number }[] = [];
    for (const cell of this.cells()) {
      const reach = cellReach(cell, this.focus.x, this.focus.z);
      if (reach.near > r * SPAWN_MAX) continue;
      if (!fill && reach.far < r * 0.6) continue;
      const chunk = w.chunk(cell);
      if (!chunk) continue;
      const n = this.trafficBudget(chunk);
      for (let k = 0; k < n; k++) {
        if (!this.agents.has(ambientKey(cell, k))) slots.push({ cell, chunk, slot: k });
      }
    }
    let attempts = 0;
    if (slots.length > 0 && live < cap) {
      const start = this.cursor % slots.length;
      for (let i = 0; i < slots.length && attempts < MAX_ATTEMPTS && live < cap; i++) {
        const sl = slots[(start + i) % slots.length] as (typeof slots)[number];
        attempts++;
        if (this.trySpawn(sl.cell, sl.chunk, sl.slot, fill)) live++;
      }
      this.cursor = start + attempts;
    }
    this.stats.attempts += attempts;
    if (this.opts.parked !== false) this.parkedPass(cap - live);
  }

  private trySpawn(cell: ChunkKey, chunk: Readonly<SimChunk>, slot: number, fill: boolean): boolean {
    const key = ambientKey(cell, slot);
    const epoch = (this.epochs.get(key) ?? 0) + 1;
    this.epochs.set(key, epoch);
    const w = this.w;
    const seed = this.opts.seed;
    const c = candidateFor(seed, cell, slot, epoch, w.net, this.paths, (e) => w.control.isClosed(e));
    if (!c) return false;
    const poseOk = this.paths.pose(c.edge, c.s, this.paths.laneOffset(c.edge, c.lane), this.pose2);
    if (!poseOk) return false;
    const px = this.pose2[0] as number, pz = this.pose2[2] as number;
    if (!ringAllows(this.focus, px, pz, this.radius, fill)) return false;
    // clear of the traffic on the same lane
    const list = this.byEdge.get(c.edge);
    if (list) for (const b of list) if (b.lane === c.lane && (b.s - c.s < SPAWN_GAP_M && c.s - b.s < SPAWN_GAP_M)) return false;
    const profile = profileName(chunk.spawn.densityProfile);
    const arch = pickArchetype(slotUnit(seed, cell, slot, epoch, 3), profile);
    const color = Math.floor(slotUnit(seed, cell, slot, epoch, 4) * PALETTE.length) % PALETTE.length;
    this.place({ key, cell, slot, epoch, arch, color, edge: c.edge, s: c.s, lane: c.lane });
    return true;
  }

  /**
   * Puts an agent on an edge. The spawn pass uses it for every slot; tests and the QA tools use it to build a scene. `speed` defaults to
   * 70 % of the desired speed. Returns null when the edge has no geometry.
   */
  place(o: PlaceOptions): Agent | null {
    const seed = this.opts.seed;
    const a = new Agent(o.key, o.cell, o.slot, ctrSeed(seed, o.key, o.epoch));
    a.epoch = o.epoch;
    a.arch = o.arch;
    a.kind = o.arch === ARCH.robotaxi ? AgentKind.Robotaxi : AgentKind.Traffic;
    a.color = o.color ?? 0;
    a.personality = PERSONALITY_MIN + a.rng.nextFloat() * (PERSONALITY_MAX - PERSONALITY_MIN);
    a.spawnTick = this.tick;
    a.edge = o.edge;
    a.s = o.s;
    a.lane = o.lane;
    a.lat = this.paths.laneOffset(o.edge, o.lane);
    const limit = this.paths.limit(o.edge);
    a.speed = o.speed ?? (a.isRobotaxi ? robotaxiSpeedCap(limit) : limit * a.personality) * START_SPEED_SHARE;
    a.state = AgentState.Drive;
    if (!this.paths.pose(o.edge, o.s, a.lat, this.pose2)) return null;
    a.x = this.pose2[0] as number;
    a.y = this.pose2[1] as number;
    a.z = this.pose2[2] as number;
    a.yaw = this.pose2[3] as number;
    a.fx = this.pose2[4] as number;
    a.fz = this.pose2[5] as number;
    a.near = this.dist(a.x, a.z) <= NEAR_RADIUS_M;
    this.agents.add(a);
    this.indexAdd(a);
    this.stats.spawns++;
    this.hooks.spawned?.(a);
    return a;
  }

  private indexAdd(a: Agent): void {
    let l = this.byEdge.get(a.edge);
    if (!l) {
      l = this.pool.pop() ?? [];
      this.byEdge.set(a.edge, l);
    }
    l.push(a);
  }

  /** Parked cars of the cells near the player, nearest first, within what the cap leaves after the traffic. */
  private parkedPass(room: number): void {
    const r = this.radius;
    const want = new Map<string, { cell: ChunkKey; chunk: Readonly<SimChunk>; idx: number; d: number }>();
    const p = this.pose2;
    const cand: { key: string; cell: ChunkKey; chunk: Readonly<SimChunk>; idx: number; d: number }[] = [];
    for (const cell of this.cells()) {
      const reach = cellReach(cell, this.focus.x, this.focus.z);
      if (reach.near > r) continue;
      const chunk = this.w.chunk(cell);
      if (!chunk) continue;
      const n = this.parkedBudget(chunk);
      const list = chunk.spawn.parked;
      for (let i = 0; i < n && i < list.length; i++) {
        const slot = list[i] as (typeof list)[number];
        if (!parkedPose(chunk as SimChunk, slot, p)) continue;
        const d = this.dist(p[0] as number, p[2] as number);
        if (d > r) continue;
        cand.push({ key: ambientKey(cell, slot.slot), cell, chunk, idx: i, d });
      }
    }
    void want;
    cand.sort((a, b) => (a.d !== b.d ? a.d - b.d : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const keep = new Set<string>();
    let budget = room < 0 ? 0 : room;
    // parked cars already live count against the room first
    let live = 0;
    for (const a of this.agents.list()) if (a.isParked) live++;
    budget += live;
    for (let i = 0; i < cand.length && keep.size < budget; i++) keep.add((cand[i] as (typeof cand)[number]).key);
    for (const a of [...this.agents.list()]) if (a.isParked && !keep.has(a.key)) this.remove(a, 'parked-out');
    let made = 0;
    for (const c of cand) {
      if (!keep.has(c.key) || this.agents.has(c.key) || made >= 24) continue;
      const slot = c.chunk.spawn.parked[c.idx] as (typeof c.chunk.spawn.parked)[number];
      if (!parkedPose(c.chunk as SimChunk, slot, p)) continue;
      const a = new Agent(c.key, c.cell, slot.slot, ctrSeed(this.opts.seed, c.key, 1));
      a.kind = AgentKind.Parked;
      const profile = profileName(c.chunk.spawn.densityProfile);
      const u = slotUnit(this.opts.seed, c.cell, slot.slot, 1, 3);
      let arch = pickArchetype(u, profile);
      if (arch === 3 || arch === 7) arch = 1;
      a.arch = arch;
      a.color = Math.floor(slotUnit(this.opts.seed, c.cell, slot.slot, 1, 4) * PALETTE.length) % PALETTE.length;
      a.seg = slot.seg;
      a.side = slot.side;
      a.s = slot.s;
      a.locked = 1;
      a.spawnTick = this.tick;
      a.x = p[0] as number;
      a.y = p[1] as number;
      a.z = p[2] as number;
      a.fx = p[4] as number;
      a.fz = p[5] as number;
      let yaw = datan2(-(p[4] as number), -(p[5] as number)) + (p[3] as number);
      if (yaw < 0) yaw += TWO_PI;
      a.yaw = yaw;
      a.near = this.dist(a.x, a.z) <= NEAR_RADIUS_M;
      this.agents.add(a);
      made++;
      this.stats.spawns++;
      this.hooks.spawned?.(a);
    }
  }

  /** The spawn rotation cursor (saved with the agents). */
  cursorValue(): number {
    return this.cursor;
  }

  setCursor(v: number): void {
    this.cursor = v;
  }

  /** Re-derives `near` of the parked cars (they do not move). */
  refreshNear(): void {
    for (const a of this.agents.list()) if (a.isParked) a.near = this.dist(a.x, a.z) <= NEAR_RADIUS_M;
  }

  /** The number of agents on the near level now, capped per tier by the system. */
  nearCap(): number {
    return NEAR_CAP[this.opts.tier];
  }
}

function ctrSeed(seed: number, key: string, epoch: number): number {
  // a stable u32 per (world seed, slot, epoch): the agent stream is seeded with it
  let h = (seed ^ (epoch * 0x9e3779b1)) | 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export { IDM_B, stopDistance, CONE_COS };
export type { EdgeId, Agent };
