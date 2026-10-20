/**
 * The pedestrian FSM (living part 4.2; M03b2). One call to `stepPed` is one AI step (30 Hz) of one pedestrian. Transitions use the
 * agent's own stream only (C01 rule 4); the world is read-only here.
 *
 *   Walk    1.4 +- 0.2 m/s along the sidewalk graph, stairs x 0.6, a seeded choice of edge at every node
 *   Wait    at the kerb of a crossing that is not open (the signal gate, or traffic at a crossing without one)
 *   Idle    5 to 40 s at a node flagged `Waiting`
 *   Dodge   a vehicle within 6 m at more than 6 m/s: a sidestep of 1.4 m, then Walk again
 *   Flee    2.8 m/s, away from a very fast vehicle, 10 s
 *   Record, Cheer   within 40 m of a `crowd.attract` source: walk toward it, stop within 8 to 19 m and face it
 *   Hit     a vehicle at 3 m/s or more hit it: down for 3 s (the canned fall; the dynamic ragdoll is M03a1's, BD-M03b2-04)
 *   Witness stands still until the seeded report time of an infraction (`witness.ts`)
 *
 * Pure; C02 lint applies.
 */
import { PedEdgeKind, datan2, dsqrt, type ChunkKey, type PedNode, type SimChunk } from '@dv/shared';
import type { RoadNetwork } from '../graph/adjacency.ts';
import type { WitnessBoard } from '../traffic/witness.ts';
import type { Ped } from './agent.ts';
import type { AttractBoard } from './attract.ts';
import {
  DODGE_TICKS, FLEE_MPS, FLEE_TICKS, HIT_TICKS, IDLE_MAX_TICKS, IDLE_MIN_TICKS, PedState, STAIRS_FACTOR,
} from './components.ts';
import { crossingGate, trafficOnCrosswalk } from './crossing.ts';
import { hopTo, isWaiting, pedIndexOf, type ChunkPedIndex, type PedOut } from './graph.ts';
import { ATTRACT_RANGE_M } from './attract.ts';
import { noticeInfraction, reportIfDue } from './witness.ts';

/** Sim ticks per AI step. */
export const STEP_TICKS = 2;
/** Sidestep of a dodge, metres. */
export const DODGE_M = 1.4;
/** A vehicle faster than this makes a pedestrian dodge, m/s; faster than `FLEE_VEHICLE_MPS` within 10 m it makes one flee. */
export const DODGE_VEHICLE_MPS = 6;
export const DODGE_RANGE_M = 6;
export const FLEE_VEHICLE_MPS = 14;
export const FLEE_RANGE_M = 10;
/** A vehicle at or above this speed that touches a pedestrian knocks it down, m/s. */
export const HIT_VEHICLE_MPS = 3;
/** Share of the idle rolls at a `Waiting` node. */
export const IDLE_CHANCE = 0.3;
/** Share of the gatherers that film rather than cheer. */
export const RECORD_SHARE = 0.6;

export interface PedVehicle {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Unit heading and speed. */
  hx: number;
  hz: number;
  speed: number;
  halfW: number;
  halfL: number;
}

export interface PedWorldView {
  chunk(key: ChunkKey): Readonly<SimChunk> | null;
  readonly net: RoadNetwork;
  /** Whether the signals are dark. */
  blackout(): boolean;
}

export interface PedHooks {
  /** A vehicle knocked a pedestrian down at this velocity. */
  hit?(p: Ped, vx: number, vz: number): void;
}

export interface PedCtx {
  tick: number;
  dt: number;
  world: PedWorldView;
  vehicles: readonly PedVehicle[];
  board: WitnessBoard;
  attract: AttractBoard;
  hooks: PedHooks;
}

const dist2 = (ax: number, az: number, bx: number, bz: number): number => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

/** Radius around an attractor at which a gatherer stops: 8 to 19 m, fixed per slot. */
export const gatherRingOf = (p: Ped): number => 8 + (p.slot % 12);

// ---- the edge ---------------------------------------------------------------------------------------------------------------

/** Puts `p` at the start of the edge `from` to `o.to` of the chunk `idx` belongs to. */
function setEdge(p: Ped, idx: ChunkPedIndex, from: PedNode, o: PedOut): void {
  const to = idx.nodes.get(o.to) as PedNode;
  p.prev = p.from;
  p.from = from.id;
  p.to = to.id;
  p.fx = from.x;
  p.fy = from.y;
  p.fz = from.z;
  p.tx = to.x;
  p.ty = to.y;
  p.tz = to.z;
  p.len = o.len;
  p.s = 0;
  p.kind = o.kind;
  p.junction = o.junction;
  p.movement = o.movement;
}

/** Recomputes the point on the graph line, the heading and the yaw. */
export function placePed(p: Ped, c: Pick<PedCtx, 'attract'>): void {
  const t = p.len > 0 ? p.s / p.len : 1;
  const dx = p.tx - p.fx, dz = p.tz - p.fz;
  const l = p.len > 0 ? p.len : 1;
  const hx = dx / l, hz = dz / l;
  if (dx !== 0 || dz !== 0) {
    p.hx = hx;
    p.hz = hz;
  }
  const lane = p.kind === PedEdgeKind.Crosswalk ? p.lane * 1.4 : p.lane;
  p.gx = p.fx + dx * t + -p.hz * lane;
  p.gz = p.fz + dz * t + p.hx * lane;
  p.y = p.fy + (p.ty - p.fy) * t;
  p.x = p.gx + p.ox;
  p.z = p.gz + p.oz;
  let fx = p.hx, fz = p.hz;
  if (p.state === PedState.Record || p.state === PedState.Cheer) {
    const ax = p.threatX - p.x, az = p.threatZ - p.z;
    const al = dsqrt(ax * ax + az * az);
    if (al > 0.01) {
      fx = ax / al;
      fz = az / al;
    }
  }
  void c;
  p.yaw = datan2(-fx, -fz);
  if (p.yaw < 0) p.yaw += 6.283185307179586;
}

// ---- crossings --------------------------------------------------------------------------------------------------------------

/** Whether `p` may step onto the crosswalk it stands at the start of. */
export function crossingOpen(p: Ped, c: PedCtx): boolean {
  const j = p.junction >= 0 ? c.world.net.junction(p.junction) : undefined;
  const g = crossingGate(j, p.movement, c.tick, c.world.blackout());
  if (g.mode === 'signal') return g.go;
  return !trafficOnCrosswalk(p.fx, p.fz, p.tx, p.tz, c.vehicles);
}

// ---- choosing the next edge -------------------------------------------------------------------------------------------------

const pool: PedOut[] = [];

function weight(p: Ped, o: PedOut, node: PedNode, idx: ChunkPedIndex): number {
  let w = 1;
  if (o.kind === PedEdgeKind.Crosswalk) w = 0.35;
  else if (o.kind === PedEdgeKind.Stairs) w = 0.4;
  const to = idx.nodes.get(o.to);
  if (to && p.len > 0) {
    const dx = to.x - node.x, dz = to.z - node.z;
    const l = dsqrt(dx * dx + dz * dz);
    if (l > 0) {
      const dot = (dx * p.hx + dz * p.hz) / l;
      if (dot > 0) w *= 1 + 1.5 * dot;
    }
  }
  return w;
}

/**
 * Picks the edge to take at `node`. The ped never turns back unless the node is a dead end; at a chunk border it hops to the
 * duplicate node of the neighbour. Returns the chunk index and node it ended up on, and the edge, or null when the ped has no edge.
 */
function choose(p: Ped, c: PedCtx, idx: ChunkPedIndex, node: PedNode): { idx: ChunkPedIndex; node: PedNode; o: PedOut } | null {
  let useIdx = idx, useNode = node;
  pool.length = 0;
  const outs = idx.out.get(node.id) ?? [];
  for (const o of outs) if (o.to !== p.from) pool.push(o);
  if (pool.length === 0) {
    const hop = hopTo(p.chunk, node, (k) => c.world.chunk(k));
    if (hop) {
      const hc = c.world.chunk(hop.key);
      if (hc) {
        p.chunk = hop.key;
        useIdx = pedIndexOf(hc);
        useNode = hop.node;
        for (const o of useIdx.out.get(hop.node.id) ?? []) pool.push(o);
      }
    }
  }
  if (pool.length === 0) for (const o of outs) pool.push(o);
  if (pool.length === 0) return null;
  if (pool.length === 1) return { idx: useIdx, node: useNode, o: pool[0] as PedOut };

  if (p.state === PedState.Flee) {
    let best = pool[0] as PedOut, bd = -1;
    for (const o of pool) {
      const t = useIdx.nodes.get(o.to);
      if (!t) continue;
      const d = dist2(t.x, t.z, p.threatX, p.threatZ);
      if (d > bd || (d === bd && o.to < best.to)) {
        bd = d;
        best = o;
      }
    }
    return { idx: useIdx, node: useNode, o: best };
  }
  if (p.attractId !== 0) {
    const a = c.attract.get(p.attractId);
    if (a) {
      let best = pool[0] as PedOut, bd = Infinity;
      for (const o of pool) {
        const t = useIdx.nodes.get(o.to);
        if (!t) continue;
        const d = dist2(t.x, t.z, a.x, a.z);
        if (d < bd || (d === bd && o.to < best.to)) {
          bd = d;
          best = o;
        }
      }
      return { idx: useIdx, node: useNode, o: best };
    }
  }
  let total = 0;
  for (const o of pool) total += weight(p, o, useNode, useIdx);
  let t = p.rng.nextFloat() * total;
  for (const o of pool) {
    t -= weight(p, o, useNode, useIdx);
    if (t < 0) return { idx: useIdx, node: useNode, o };
  }
  return { idx: useIdx, node: useNode, o: pool[pool.length - 1] as PedOut };
}

/**
 * The ped reached its `to` node. Decides what happens there: gather at an attractor, idle at a waiting node, or take the next edge
 * (and wait at its start when it is a crossing that is not open). True when it goes on walking now.
 */
function arrive(p: Ped, c: PedCtx): boolean {
  const chunk = c.world.chunk(p.chunk);
  if (!chunk) return false;
  const idx = pedIndexOf(chunk);
  const node = idx.nodes.get(p.to);
  if (!node) return false;

  if (p.attractId !== 0) {
    const a = c.attract.get(p.attractId);
    if (a && dist2(node.x, node.z, a.x, a.z) <= gatherRingOf(p) * gatherRingOf(p)) {
      p.state = p.rng.nextFloat() < RECORD_SHARE ? PedState.Record : PedState.Cheer;
      p.threatX = a.x;
      p.threatZ = a.z;
      return false;
    }
  }
  if (p.state === PedState.Walk && isWaiting(node) && p.tickAtWait !== node.id && p.attractId === 0) {
    p.tickAtWait = node.id;
    if (p.rng.nextFloat() < IDLE_CHANCE) {
      p.state = PedState.Idle;
      p.timer = IDLE_MIN_TICKS + Math.floor(p.rng.nextFloat() * (IDLE_MAX_TICKS - IDLE_MIN_TICKS + 1));
      return false;
    }
  }
  const pick = choose(p, c, idx, node);
  if (!pick) return false;
  setEdge(p, pick.idx, pick.node, pick.o);
  if (pick.o.kind === PedEdgeKind.Crosswalk && p.state !== PedState.Flee && !crossingOpen(p, c)) {
    p.state = PedState.Wait;
    return false;
  }
  return true;
}

function advance(p: Ped, c: PedCtx, speed: number): void {
  let step = speed * c.dt;
  p.speed = speed;
  for (let guard = 0; step > 0 && guard < 6; guard++) {
    const rem = p.len - p.s;
    if (step < rem) {
      p.s += step;
      return;
    }
    p.s = p.len;
    step -= rem;
    if (!arrive(p, c)) {
      p.speed = 0;
      return;
    }
  }
}

// ---- reactions --------------------------------------------------------------------------------------------------------------

function react(p: Ped, c: PedCtx): void {
  if (p.state === PedState.Hit || p.state === PedState.Frozen) return;
  const vs = c.vehicles;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i] as PedVehicle;
    if (v.speed < HIT_VEHICLE_MPS) continue;
    const rx = p.x - v.x, rz = p.z - v.z;
    const along = rx * v.hx + rz * v.hz;
    const across = rx * -v.hz + rz * v.hx;
    if (along < v.halfL + 0.3 && along > -(v.halfL + 0.3) && across < v.halfW + 0.3 && across > -(v.halfW + 0.3)) {
      p.state = PedState.Hit;
      p.timer = HIT_TICKS;
      p.speed = 0;
      p.attractId = 0;
      c.hooks.hit?.(p, v.vx, v.vz);
      return;
    }
    if (v.speed <= DODGE_VEHICLE_MPS || p.state === PedState.Dodge || p.state === PedState.Flee || along < -1) continue;
    const d2 = rx * rx + rz * rz;
    if (v.speed > FLEE_VEHICLE_MPS && d2 <= FLEE_RANGE_M * FLEE_RANGE_M) {
      p.state = PedState.Flee;
      p.timer = FLEE_TICKS;
      p.threatX = v.x;
      p.threatZ = v.z;
      p.attractId = 0;
    } else if (d2 <= DODGE_RANGE_M * DODGE_RANGE_M) {
      const side = across < 0 ? -1 : 1;
      const k = DODGE_M / (DODGE_TICKS / STEP_TICKS);
      p.state = PedState.Dodge;
      p.timer = DODGE_TICKS;
      p.threatX = -v.hz * side * k;
      p.threatZ = v.hx * side * k;
    }
  }
  noticeInfraction(p, c.board, c.tick);
  // gather at an attractor within 40 m
  if (p.state === PedState.Walk || p.state === PedState.Idle || p.state === PedState.Wait) {
    if (p.attractId === 0) {
      const a = c.attract.nearest(p.x, p.z);
      if (a) {
        p.attractId = a.id;
        if (p.state === PedState.Idle) p.state = PedState.Walk;
      }
    }
  }
  if (p.attractId !== 0) {
    const a = c.attract.get(p.attractId);
    if (!a || dist2(p.x, p.z, a.x, a.z) > ATTRACT_RANGE_M * ATTRACT_RANGE_M * 2.25) {
      p.attractId = 0;
      if (p.state === PedState.Record || p.state === PedState.Cheer) p.state = PedState.Walk;
    }
  }
}

/** Speed of the walk on the current edge for the current state. */
function paceOf(p: Ped): number {
  if (p.state === PedState.Flee) return FLEE_MPS;
  return p.kind === PedEdgeKind.Stairs ? p.pace * STAIRS_FACTOR : p.pace;
}

/** One AI step of one pedestrian whose chunk is resident. */
export function stepPed(p: Ped, c: PedCtx): void {
  p.speed = 0;
  if (p.state === PedState.Frozen) {
    p.state = PedState.Walk;
    p.frozenSince = -1;
  }
  react(p, c);
  reportIfDue(p, c.board, c.tick);
  switch (p.state) {
    case PedState.Hit:
      p.timer -= STEP_TICKS;
      if (p.timer <= 0) {
        p.state = PedState.Walk;
        p.timer = 0;
      }
      break;
    case PedState.Wait:
      if (crossingOpen(p, c)) {
        p.state = PedState.Walk;
        advance(p, c, paceOf(p));
      }
      break;
    case PedState.Idle:
      p.timer -= STEP_TICKS;
      if (p.timer <= 0) {
        p.state = PedState.Walk;
        p.timer = 0;
      }
      break;
    case PedState.Witness:
      p.timer -= STEP_TICKS;
      if (p.timer <= 0 && p.witnessInfraction === 0) p.state = PedState.Walk;
      break;
    case PedState.Record:
    case PedState.Cheer:
      break;
    case PedState.Dodge:
      p.ox += p.threatX;
      p.oz += p.threatZ;
      p.timer -= STEP_TICKS;
      if (p.timer <= 0) p.state = PedState.Walk;
      advance(p, c, paceOf(p));
      break;
    case PedState.Flee:
      p.timer -= STEP_TICKS;
      if (p.timer <= 0) p.state = PedState.Walk;
      advance(p, c, paceOf(p));
      break;
    default:
      advance(p, c, paceOf(p));
  }
  placePed(p, c);
}

export { HIT_VEHICLE_MPS as HIT_SPEED };
