/**
 * The junction protocol of ambient agents (02-world-living.md sections 1.5, 1.6 and 2.1.3; M03b1).
 *
 *  - The stop line sits 0.5 m before the junction box (`BOX_HALF_M` before the end of the edge). An agent stops there when the aspect of
 *    its movement is not green, or amber while it can still stop at 3.5 m/s^2, and when the conflict set is not free.
 *  - Entry needs the conflict set free: no agent crossing a conflicting movement and, for movements that give way (a permissive left
 *    on green, a junction without control), no conflicting agent that will reach the box first within 3.5 s.
 *  - All-way stops and dark signals: stop, dwell 0.75 s, then go in the order of stopping (ties by `StableKey` ascending).
 *  - A claim (an agent entitled to go and held only by the conflict set) times out after 20 s: the lowest `StableKey` of the agents
 *    whose claims timed out proceeds (the deadlock breaker).
 *  - Inside the box an agent follows a cubic Bezier connector between the lane it leaves and the lane it lands in.
 *
 * Pure; C02 lint applies.
 */
import {
  NodeControl, TWO_PI, datan2, dsqrt,
  type Aspect, type Junction, type Movement, type NodeId,
} from '@dv/shared';
import type { RoadNetwork } from '../graph/adjacency.ts';
import type { RoadGraph } from '../graph/query.ts';
import { type Agent } from './agent.ts';
import { AgentState, Turn } from './components.ts';
import { curveLimit, stopDistance } from './idm.ts';
import { BOX_HALF_M, type EdgePaths, landingLane } from './plan.ts';

/** Ticks after which a held claim lets the lowest key of the overdue claimants through (20 s at 60 Hz). */
export const CLAIM_TIMEOUT_TICKS = 1200;
/** Ticks an agent stands at an all-way stop or a dark signal before it may go (0.75 s). */
export const STOP_DWELL_TICKS = 45;
/** Metres in front of the box at which the stop line is drawn. */
export const STOP_LINE_GAP_M = 0.5;
/** An approaching conflicting agent counts as a threat when it reaches the box within this many seconds. */
export const THREAT_ETA_S = 3.5;
/** Only agents within this many metres of their box are looked at for threats. */
export const THREAT_RANGE_M = 45;
/** Where decisions start: stopping distance plus this margin. */
const DECIDE_MARGIN_M = 40;

export type Rule = 'free' | 'signal' | 'allway' | 'yield';

/** What an agent should do about the junction ahead; filled by `JunctionBook.evaluate` and read at once. */
export interface Decision {
  /** Treat the stop line as a stationary obstacle. */
  stop: boolean;
  /** The agent may enter the box now. */
  go: boolean;
  /** The wait is a signal or a stop sign (the gridlock rule leaves it alone). */
  legit: boolean;
  rule: Rule;
  aspect: Aspect | 'none';
  /** The junction is dark (a blackout at a signalised junction). */
  dark: boolean;
}

export const newDecision = (): Decision => ({ stop: false, go: true, legit: false, rule: 'free', aspect: 'none', dark: false });

/** Half length of the box on an edge of length `len`. */
export const boxHalf = (len: number): number => (len * 0.45 < BOX_HALF_M ? len * 0.45 : BOX_HALF_M);

const key = (jct: number, mov: number): number => jct * 4096 + mov;

export class JunctionBook {
  private readonly occ = new Map<number, number>();
  private readonly rear = new Map<number, Agent>();
  private readonly force = new Map<number, string>();
  private byEdge: ReadonlyMap<number, Agent[]> = new Map();
  private tick = 0;
  private readonly tmp = new Float64Array(6);
  private readonly tmpB = new Float64Array(6);

  constructor(private readonly net: RoadNetwork, private readonly graph: RoadGraph, private readonly paths: EdgePaths) {}

  /** Rebuilt at the start of every AI step: who is inside which movement, and who has an overdue claim. */
  begin(tick: number, agents: readonly Agent[], byEdge: ReadonlyMap<number, Agent[]>): void {
    this.tick = tick;
    this.byEdge = byEdge;
    this.occ.clear();
    this.rear.clear();
    this.force.clear();
    for (const a of agents) {
      if (a.state === AgentState.Cross && a.jct >= 0) {
        const k = key(a.jct, a.mov);
        this.occ.set(k, (this.occ.get(k) ?? 0) + 1);
        const r = this.rear.get(k);
        if (!r || a.jPos < r.jPos) this.rear.set(k, a);
      } else if (a.claimTick >= 0 && tick - a.claimTick >= CLAIM_TIMEOUT_TICKS && a.jct >= 0) {
        const f = this.force.get(a.jct);
        if (f === undefined || a.key < f) this.force.set(a.jct, a.key);
      }
    }
  }

  /** Whether no other agent of the same lane is ahead of `b` on its edge (only queue heads take part in the order of stopping). */
  private isHead(b: Agent): boolean {
    const list = this.byEdge.get(b.edge);
    if (!list) return true;
    for (const c of list) if (c !== b && c.lane === b.lane && c.state !== AgentState.Cross && c.s > b.s) return false;
    return true;
  }

  /** The movement `mov` of junction `j`. */
  movement(j: Junction, mov: number): Movement | undefined {
    const m = j.movements[mov];
    if (m && m.id === mov) return m;
    for (const x of j.movements) if (x.id === mov) return x;
    return undefined;
  }

  /** Agents crossing the movement `mov` of junction `jct` now. */
  occupancy(jct: number, mov: number): number {
    return this.occ.get(key(jct, mov)) ?? 0;
  }

  /** The agent furthest back inside the movement, or undefined when it is empty. */
  rearOf(jct: number, mov: number): Agent | undefined {
    return this.rear.get(key(jct, mov));
  }

  /** Distance from an agent's front to the stop line, metres (negative once it is past the line). */
  distToLine(a: Agent): number {
    const len = this.paths.len(a.edge);
    return len - boxHalf(len) - STOP_LINE_GAP_M - a.s;
  }

  /** Distance from an agent's front to the entry of the box, metres. */
  distToBox(a: Agent): number {
    const len = this.paths.len(a.edge);
    return len - boxHalf(len) - a.s;
  }

  // ---- the decision ------------------------------------------------------------------------------------------------------

  /**
   * What `a` does about the junction at the end of its edge. The agent must have a plan (`nextEdge`, `mov`, `jct`). Fills `d`.
   * Side effects on the agent: `stoppedTick`, `claimTick` and `committed`.
   */
  evaluate(a: Agent, d: Decision): void {
    d.stop = false;
    d.go = true;
    d.legit = false;
    d.rule = 'free';
    d.aspect = 'none';
    d.dark = false;
    if (a.jct < 0 || a.mov < 0) {
      a.committed = false;
      return;
    }
    const j = this.net.junction(a.jct);
    const m = j ? this.movement(j, a.mov) : undefined;
    if (!j || !m) return;
    const dist = this.distToLine(a);
    const reach = stopDistance(a.speed) + DECIDE_MARGIN_M;
    if (dist > reach) {
      // far from the line: nothing to decide yet, and a stale claim is dropped
      a.claimTick = -1;
      a.stoppedTick = -1;
      a.committed = false;
      return;
    }
    const node: NodeId = this.net.to(a.edge);
    const canStop = stopDistance(a.speed) <= dist - 0.3;
    if (!canStop) a.committed = true;
    else if (dist > 8) a.committed = false;

    let rule: Rule = 'free';
    let aspect: Aspect | 'none' = 'none';
    switch (j.control) {
      case NodeControl.Signal: {
        if (!j.program) break;
        aspect = this.graph.signal(node, m.id);
        rule = aspect === 'dark' ? 'allway' : 'signal';
        break;
      }
      case NodeControl.AllWayStop:
        rule = 'allway';
        break;
      case NodeControl.MinorStop:
        rule = j.stopApproaches.indexOf(a.edge) >= 0 ? 'allway' : 'free';
        break;
      case NodeControl.Yield:
      case NodeControl.Roundabout:
        rule = 'yield';
        break;
      case NodeControl.None:
        rule = m.conflicts.length > 0 ? 'yield' : 'free';
        break;
      default:
        break;
    }
    d.rule = rule;
    d.aspect = aspect;
    d.dark = aspect === 'dark';
    if (rule === 'free') {
      a.claimTick = -1;
      return;
    }

    if (rule === 'signal') {
      if (aspect === 'red') {
        this.hold(d, true);
        a.claimTick = -1;
        return;
      }
      if (aspect === 'amber') {
        if (a.committed) {
          d.go = true;
          return;
        }
        this.hold(d, true);
        a.claimTick = -1;
        return;
      }
      // green: only the conflict set can hold the agent
      const blocked = this.conflictBlocked(a, j, m, true);
      this.claim(a, d, blocked, dist, j.id);
      return;
    }

    if (rule === 'allway') {
      // at the line: at rest there, or pulling away from the rest it already made (stoppedTick stays set until the box)
      const atLine = dist < 1.5 && (a.speed < 0.3 || a.stoppedTick >= 0);
      if (!atLine) {
        if (!(a.speed < 0.3)) a.stoppedTick = -1;
        this.hold(d, true);
        return;
      }
      if (a.stoppedTick < 0) a.stoppedTick = this.tick;
      if (this.tick - a.stoppedTick < STOP_DWELL_TICKS) {
        this.hold(d, true);
        return;
      }
      const blocked = this.conflictBlocked(a, j, m, false);
      this.claim(a, d, blocked, dist, j.id);
      return;
    }

    // yield
    const blocked = this.conflictBlocked(a, j, m, true);
    this.claim(a, d, blocked, dist, j.id);
  }

  private hold(d: Decision, legit: boolean): void {
    d.stop = true;
    d.go = false;
    d.legit = legit;
  }

  /** The agent is entitled to go; `blocked` says whether the conflict set holds it. Handles the claim clock and the deadlock breaker. */
  private claim(a: Agent, d: Decision, blocked: boolean, dist: number, jct: number): void {
    if (!blocked) {
      a.claimTick = -1;
      return;
    }
    if (dist < 3 && a.claimTick < 0) a.claimTick = this.tick;
    if (a.claimTick >= 0 && this.tick - a.claimTick >= CLAIM_TIMEOUT_TICKS && this.force.get(jct) === a.key) {
      a.claimTick = -1;
      return;
    }
    if (a.committed && d.rule !== 'allway') return;
    this.hold(d, false);
    d.legit = true;
  }

  /**
   * Whether the conflict set of movement `m` holds the agent: an agent inside a conflicting movement; with `gap` also a conflicting
   * agent that will reach its box first; without it (all-way stops) a conflicting agent that stopped before this one.
   */
  private conflictBlocked(a: Agent, j: Junction, m: Movement, gap: boolean): boolean {
    for (let i = 0; i < m.conflicts.length; i++) {
      const c = m.conflicts[i] as number;
      if (this.occ.get(key(j.id, c)) !== undefined) return true;
    }
    const myEta = this.distToBox(a) / (a.speed > 1.5 ? a.speed : 1.5);
    for (let i = 0; i < m.conflicts.length; i++) {
      const cm = this.movement(j, m.conflicts[i] as number);
      if (!cm) continue;
      const list = this.byEdge.get(cm.inEdge);
      if (!list) continue;
      for (const b of list) {
        if (b === a || b.state === AgentState.Cross || b.jct !== j.id || b.mov !== cm.id || !this.isHead(b)) continue;
        const db = this.distToBox(b);
        if (db > THREAT_RANGE_M) break;
        if (db < -1) continue;
        const waiting = b.speed < 0.5;
        if (!gap) {
          // all-way: earlier stop first, ties by key
          if (b.stoppedTick >= 0 && (a.stoppedTick < 0 || b.stoppedTick < a.stoppedTick || (b.stoppedTick === a.stoppedTick && b.key < a.key))) return true;
          continue;
        }
        const aspectB = j.control === NodeControl.Signal ? this.graph.signal(this.net.to(b.edge), cm.id) : 'none';
        if (aspectB === 'red' || aspectB === 'dark') continue;
        if (waiting) {
          // two cars standing at a yield: the one that stopped first goes
          if (a.speed < 0.5 && b.stoppedTick >= 0 && (a.stoppedTick < 0 || b.stoppedTick < a.stoppedTick || (b.stoppedTick === a.stoppedTick && b.key < a.key))) return true;
          continue;
        }
        const eta = db / (b.speed > 1.5 ? b.speed : 1.5);
        if (eta > THREAT_ETA_S) continue;
        if (j.control === NodeControl.Signal) return true;
        if (eta + 0.3 < myEta || (eta <= myEta + 0.3 && b.key < a.key)) return true;
      }
    }
    return false;
  }

  // ---- connectors --------------------------------------------------------------------------------------------------------

  /**
   * Starts the crossing of agent `a` onto `a.nextEdge`: fixes the connector between the lane it leaves and the lane it lands in.
   * Returns false when an edge has no geometry.
   */
  enter(a: Agent): boolean {
    const out = a.nextEdge;
    const inLen = this.paths.len(a.edge);
    const outLen = this.paths.len(out);
    const r0 = boxHalf(inLen);
    const r1 = boxHalf(outLen);
    const outEdge = this.paths.edge(out);
    const landing = landingLane(a.turn, outEdge ? outEdge.lanes : 1, a.lane);
    const p = this.tmp, q = this.tmpB;
    if (!this.paths.pose(a.edge, inLen - r0, this.paths.laneOffset(a.edge, a.lane), p)) return false;
    if (!this.paths.pose(out, r1, this.paths.laneOffset(out, landing), q)) return false;
    const dx = (q[0] as number) - (p[0] as number), dz = (q[2] as number) - (p[2] as number);
    const chord = dsqrt(dx * dx + dz * dz);
    const h = chord > 6 ? chord / 3 : 2;
    const cp = a.cp;
    cp[0] = p[0] as number;
    cp[1] = p[2] as number;
    cp[2] = (p[0] as number) + (p[4] as number) * h;
    cp[3] = (p[2] as number) + (p[5] as number) * h;
    cp[4] = (q[0] as number) - (q[4] as number) * h;
    cp[5] = (q[2] as number) - (q[5] as number) * h;
    cp[6] = q[0] as number;
    cp[7] = q[2] as number;
    cp[8] = p[1] as number;
    cp[9] = q[1] as number;
    // arc length lookup at t = i / 8, each piece measured with four chords
    const lut = a.lut;
    lut[0] = 0;
    let px = cp[0] as number, pz = cp[1] as number;
    let acc = 0;
    for (let i = 1; i <= 32; i++) {
      this.bezier(a.cp, i / 32, this.tmp2);
      const ex = (this.tmp2[0] as number) - px, ez = (this.tmp2[1] as number) - pz;
      acc += dsqrt(ex * ex + ez * ez);
      px = this.tmp2[0] as number;
      pz = this.tmp2[1] as number;
      if (i % 4 === 0) lut[i / 4] = acc;
    }
    a.jLen = acc > 0.5 ? acc : 0.5;
    a.jPos = 0;
    a.state = AgentState.Cross;
    a.claimTick = -1;
    a.stoppedTick = -1;
    a.committed = false;
    return true;
  }

  private readonly tmp2 = new Float64Array(4);

  /** Point and heading at `t` of a connector: x, z, tangent x, tangent z. */
  private bezier(cp: Float64Array, t: number, out: Float64Array): void {
    const u = 1 - t;
    const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    out[0] = b0 * (cp[0] as number) + b1 * (cp[2] as number) + b2 * (cp[4] as number) + b3 * (cp[6] as number);
    out[1] = b0 * (cp[1] as number) + b1 * (cp[3] as number) + b2 * (cp[5] as number) + b3 * (cp[7] as number);
    const d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t;
    out[2] = d0 * ((cp[2] as number) - (cp[0] as number)) + d1 * ((cp[4] as number) - (cp[2] as number)) + d2 * ((cp[6] as number) - (cp[4] as number));
    out[3] = d0 * ((cp[3] as number) - (cp[1] as number)) + d1 * ((cp[5] as number) - (cp[3] as number)) + d2 * ((cp[7] as number) - (cp[5] as number));
  }

  /**
   * Writes x, y, z, yaw and the unit heading (tx, tz) of the point `d` metres along the agent's connector into `out` (six slots).
   * `d` is clamped to the connector.
   */
  connectorPose(a: Agent, d0: number, out: Float64Array): void {
    const lut = a.lut;
    const d = d0 < 0 ? 0 : d0 > a.jLen ? a.jLen : d0;
    let i = 0;
    while (i < 7 && d > (lut[i + 1] as number)) i++;
    const l0 = lut[i] as number, l1 = lut[i + 1] as number;
    const f = l1 > l0 ? (d - l0) / (l1 - l0) : 0;
    const t = (i + (f < 0 ? 0 : f > 1 ? 1 : f)) / 8;
    this.bezier(a.cp, t, this.tmp2);
    const w = a.jLen > 0 ? d / a.jLen : 0;
    let tx = this.tmp2[2] as number, tz = this.tmp2[3] as number;
    const tl = dsqrt(tx * tx + tz * tz);
    if (tl > 1e-9) {
      tx /= tl;
      tz /= tl;
    } else {
      tx = 0;
      tz = -1;
    }
    out[0] = this.tmp2[0] as number;
    out[1] = (a.cp[8] as number) + ((a.cp[9] as number) - (a.cp[8] as number)) * w;
    out[2] = this.tmp2[1] as number;
    let yaw = datan2(-tx, -tz);
    if (yaw < 0) yaw += TWO_PI;
    out[3] = yaw;
    out[4] = tx;
    out[5] = tz;
  }

  /** The speed a connector allows from its sharpest part, m/s (Infinity for a straight one). */
  connectorCap(a: Agent): number {
    if (a.turn === Turn.Straight) return Infinity;
    // heading change from the end tangents of the control polygon
    const ax = (a.cp[2] as number) - (a.cp[0] as number), az = (a.cp[3] as number) - (a.cp[1] as number);
    const bx = (a.cp[6] as number) - (a.cp[4] as number), bz = (a.cp[7] as number) - (a.cp[5] as number);
    const ang = datan2(ax * bz - az * bx, ax * bx + az * bz);
    const k = (ang < 0 ? -ang : ang) / (a.jLen > 1 ? a.jLen : 1);
    const cap = curveLimit(k);
    return cap < 3 ? 3 : cap;
  }
}
