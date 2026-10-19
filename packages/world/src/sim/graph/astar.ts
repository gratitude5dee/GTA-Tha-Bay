/**
 * The road router (M02c1; C08 `RoadGraphQuery.route`): A* over directed edges with a binary heap.
 *
 * - **State** is a directed edge: the cost of a state is the distance from the start position to the END of that edge, in whole
 *   decimetres, so sums are exact and a route is the same on every device. The estimate is the straight-line distance from the
 *   end node to the goal, floored to a decimetre (never above the road distance, so the first route found is a shortest one).
 * - **Ties.** The heap orders equal scores by state id, and a state keeps its first predecessor unless a later one with an equal
 *   cost has a lower edge id: of two equal-length routes the one with the lower edge ids near the goal wins.
 * - **Moves.** Inside resident junctions the move set is the junction's movements (turn restrictions, no U-turns except at dead
 *   ends); elsewhere it is every out-edge of the end node except the street just left (a dead end allows the U-turn). With
 *   `useTopology` the resident movements are ignored, so the answer does not depend on which chunks happen to be resident.
 * - **Wrong way.** With `allowWrongWay` a one-way edge may also be driven backwards (a state of its own). The route repeats the
 *   edge id; `Route.wrongWay` says which entries are reversed.
 * - **Cap.** `maxExpand` bounds the number of states taken from the heap; when it stops the search the route leads to the expanded
 *   state closest to the goal and `complete` is false.
 * Pure; C02 lint applies.
 */
import { dsqrt, type EdgeId } from '@dv/shared';
import { MinHeap } from './heap.ts';
import { EDGE_ONEWAY, type RoadNetwork } from './adjacency.ts';

export interface RouteEndpoint {
  edge: EdgeId;
  /** Metres along the directed edge. */
  s: number;
}

export interface RouteGoal extends RouteEndpoint {
  /** The point the goal stands for, for the estimate. */
  x: number;
  z: number;
}

export interface RouteQuery {
  start: RouteEndpoint;
  goal: RouteGoal;
  maxExpand: number;
  avoid?: ReadonlySet<EdgeId> | undefined;
  /** Edges closed by `TrafficControl`; the start and the goal edge are exempt. */
  closed?: ((e: EdgeId) => boolean) | undefined;
  /** Bit `1 << RoadClass` set means the class may be used. */
  classMask?: number | undefined;
  allowWrongWay?: boolean | undefined;
  useTopology?: boolean | undefined;
}

export interface RouteResult {
  edges: EdgeId[];
  /** Same length as `edges`: true where the edge is driven against its direction. */
  wrongWay: boolean[];
  lengthM: number;
  etaS: number;
  complete: boolean;
  /** States taken from the heap. */
  expanded: number;
}

/** A speed floor for the ETA of an edge whose baked speed is 0. */
const MIN_SPEED_MPS = 1;

export class Router {
  private stamp = new Uint32Array(0);
  private g = new Int32Array(0);
  private parent = new Int32Array(0);
  private run = 0;
  private readonly heap = new MinHeap();

  constructor(private readonly net: RoadNetwork) {}

  route(q: RouteQuery): RouteResult | null {
    const net = this.net;
    const E = net.edgeCount;
    if (!net.has(q.start.edge) || !net.has(q.goal.edge)) return null;
    const goalState = 2 * E;
    const size = 2 * E + 1;
    if (this.stamp.length !== size) {
      this.stamp = new Uint32Array(size);
      this.g = new Int32Array(size);
      this.parent = new Int32Array(size);
      this.run = 0;
    }
    const run = ++this.run;
    const { stamp, g, parent, heap } = this;
    heap.clear();

    const startS = Math.min(Math.max(q.start.s, 0), net.lenDm(q.start.edge) / 10);
    const goalS = Math.min(Math.max(q.goal.s, 0), net.lenDm(q.goal.edge) / 10);
    if (q.start.edge === q.goal.edge && goalS >= startS) {
      const lengthM = Math.round((goalS - startS) * 10) / 10;
      return { edges: [q.start.edge], wrongWay: [false], lengthM, etaS: lengthM / Math.max(net.speedMps(q.start.edge), MIN_SPEED_MPS), complete: true, expanded: 0 };
    }

    const gx = q.goal.x;
    const gz = q.goal.z;
    const edgeOf = (s: number): EdgeId => (s >= E ? s - E : s);
    const endNode = (s: number): number => (s >= E ? net.from(s - E) : net.to(s));
    const heur = (s: number): number => {
      const n = endNode(s);
      const dx = net.nodeX(n) - gx;
      const dz = net.nodeZ(n) - gz;
      return Math.floor(dsqrt(dx * dx + dz * dz) * 10);
    };
    const allowed = (e: EdgeId): boolean => {
      if (e === q.goal.edge) return true;
      if (q.avoid && q.avoid.has(e)) return false;
      if (q.closed && q.closed(e)) return false;
      if (q.classMask !== undefined && ((q.classMask >>> net.cls(e)) & 1) === 0) return false;
      return true;
    };

    const startState = q.start.edge;
    g[startState] = Math.max(0, net.lenDm(q.start.edge) - Math.round(startS * 10));
    stamp[startState] = run;
    parent[startState] = -1;
    heap.push((g[startState] as number) + heur(startState), startState);
    if (q.allowWrongWay && (net.flags(q.start.edge) & EDGE_ONEWAY) !== 0) {
      // a one-way edge may also be left backwards from where the vehicle stands
      const rs = E + q.start.edge;
      stamp[rs] = run;
      g[rs] = Math.round(startS * 10);
      parent[rs] = -1;
      heap.push((g[rs] as number) + heur(rs), rs);
    }
    let expanded = 0;
    let best = startState;
    let bestH = heur(startState);
    let reached = false;
    let capped = false;

    let goalReversed = false;
    const relax = (to: number, cost: number, from: number, reversedGoal = false): void => {
      if (stamp[to] !== run || cost < (g[to] as number)) {
        stamp[to] = run;
        g[to] = cost;
        parent[to] = from;
        if (to === goalState) goalReversed = reversedGoal;
        heap.push(to === goalState ? cost : cost + heur(to), to);
      } else if (cost === (g[to] as number) && edgeOf(from) < edgeOf(parent[to] as number)) {
        // an equal-cost way in: keep the one that arrives from the lower edge id (the queued key is unchanged)
        parent[to] = from;
        if (to === goalState) goalReversed = reversedGoal;
      }
    };

    for (;;) {
      const top = heap.pop();
      if (!top) break;
      const s = top.id;
      if (s === goalState) {
        if (top.key !== (g[s] as number)) continue;
        reached = true;
        break;
      }
      if (top.key !== (g[s] as number) + heur(s)) continue;   // a cheaper way to this state was found after this entry was queued
      if (expanded >= q.maxExpand) {
        capped = true;
        break;
      }
      expanded++;
      const h = heur(s);
      if (h < bestH || (h === bestH && s < best)) {
        best = s;
        bestH = h;
      }
      const base = g[s] as number;
      const forward = s < E;
      const node = endNode(s);
      const here = edgeOf(s);

      // forward moves
      let moved = false;
      const mv = forward && !q.useTopology ? net.movements(here) : undefined;
      if (mv !== undefined) {
        for (let i = 0; i < mv.length; i++) {
          const n = mv[i] as number;
          if (!net.has(n)) continue;
          moved = true;
          if (n === q.goal.edge) relax(goalState, base + Math.round(goalS * 10), s);
          else if (allowed(n)) relax(n, base + net.lenDm(n), s);
        }
      } else {
        const outs = net.out(node);
        let twin = -1;
        for (let i = 0; i < outs.length; i++) {
          const n = outs[i] as number;
          if (forward ? net.isReverseOf(n, here) : n === here) {
            if (twin < 0) twin = n;
            continue;
          }
          moved = true;
          if (n === q.goal.edge) relax(goalState, base + Math.round(goalS * 10), s);
          else if (allowed(n)) relax(n, base + net.lenDm(n), s);
        }
        if (!moved && twin >= 0) {
          // a dead end: the only way on is back
          if (twin === q.goal.edge) relax(goalState, base + Math.round(goalS * 10), s);
          else if (allowed(twin)) relax(twin, base + net.lenDm(twin), s);
        }
      }

      // one-way edges driven backwards
      if (q.allowWrongWay) {
        const ins = net.into(node);
        for (let i = 0; i < ins.length; i++) {
          const r = ins[i] as number;
          if (r === here || (net.flags(r) & EDGE_ONEWAY) === 0) continue;
          if (!allowed(r)) continue;
          if (r === q.goal.edge) relax(goalState, base + Math.max(0, net.lenDm(r) - Math.round(goalS * 10)), s, true);
          else relax(E + r, base + net.lenDm(r), s);
        }
      }
    }

    if (!reached && !capped) return null;
    const last = reached ? goalState : best;
    const chain: number[] = [];
    for (let s = last; s >= 0; s = parent[s] as number) chain.push(s);
    chain.reverse();
    const edges: EdgeId[] = [];
    const wrongWay: boolean[] = [];
    for (const s of chain) {
      if (s === goalState) {
        edges.push(q.goal.edge);
        wrongWay.push(goalReversed);
      } else {
        edges.push(edgeOf(s));
        wrongWay.push(s >= E);
      }
    }
    const totalDm = reached ? (g[goalState] as number) : (g[last] as number);
    let eta = 0;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i] as number;
      let m = net.lenDm(e) / 10;
      if (i === 0) m -= Math.min(m, Math.round(startS * 10) / 10);
      if (reached && i === edges.length - 1) m = Math.round(goalS * 10) / 10;
      eta += m / Math.max(net.speedMps(e), MIN_SPEED_MPS);
    }
    return { edges, wrongWay, lengthM: totalDm / 10, etaS: eta, complete: reached, expanded };
  }
}
