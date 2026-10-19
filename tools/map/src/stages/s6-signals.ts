/**
 * S6 signal programs (02-world-living.md section 1.5). Approaches are grouped by heading into phases: a 4-way gets two
 * (the two opposing pairs), a 3-way two (through road, side road), five or more approaches three. Defaults: green 20 s,
 * amber 3 s, all-red 1 s; when the groups differ in class the group of the best class (an arterial through phase) gets
 * 28 s and the other groups 16 s. `cycleTicks = sum(green + amber + clear) * 60`, `offsetTicks = fnv32(String(junctionId))
 * mod cycleTicks`, so the runtime recomputes it from the id alone. Pedestrians walk during the parallel vehicle green
 * minus its last 5 s; the pack does not store `pedWalkTicks` (decode gives 0), the runtime derives it the same way.
 */
import { fnv32, type Movement, type SignalPhase, type SignalProgram } from '../../../../packages/shared/src/index.ts';

export const TICKS_PER_S = 60;
export const GREEN_S = 20, AMBER_S = 3, CLEAR_S = 1, ARTERIAL_GREEN_S = 28, CROSS_GREEN_S = 16, WALK_TRIM_S = 5;

export interface Approach {
  edge: number;
  /** unit travel direction into the junction */
  hx: number;
  hz: number;
  /** road class of the edge (0 best) */
  cls: number;
}

/** Axis angle in [0, pi) of a heading: opposite headings share an axis. */
export function axisOf(hx: number, hz: number): number {
  let a = Math.atan2(hz, hx);
  if (a < 0) a += Math.PI;
  if (a >= Math.PI) a -= Math.PI;
  return a;
}

/**
 * Splits approaches into `k` groups of neighbouring axes on the circle (period pi) so that the summed squared spans are
 * smallest. Deterministic: ties keep the first combination.
 */
export function groupByHeading(ap: readonly Approach[], k: number): number[][] {
  const n = ap.length;
  if (k >= n) return ap.map((_a, i) => [i]);
  const order = ap.map((a, i) => ({ i, ax: axisOf(a.hx, a.hz) })).sort((p, q) => p.ax - q.ax || p.i - q.i);
  const m = order.length;
  let best: { cost: number; cuts: number[] } | null = null;
  // choose k cut positions among m circular gaps (gap g lies between order[g] and order[(g + 1) % m])
  const cuts: number[] = [];
  const rec = (start: number): void => {
    if (cuts.length === k) {
      const sorted = [...cuts];
      let cost = 0;
      for (let c = 0; c < k; c++) {
        const from = ((sorted[c] as number) + 1) % m;
        const to = sorted[(c + 1) % k] as number;
        const len = (to - from + m) % m + 1;
        const a0 = (order[from] as { ax: number }).ax, a1 = (order[to] as { ax: number }).ax;
        const span = len === 1 ? 0 : (a1 - a0 + Math.PI) % Math.PI;
        cost += span * span;
      }
      if (!best || cost < best.cost - 1e-12) best = { cost, cuts: sorted };
      return;
    }
    for (let g = start; g < m; g++) { cuts.push(g); rec(g + 1); cuts.pop(); }
  };
  rec(0);
  const chosen = (best as unknown as { cuts: number[] }).cuts;
  const groups: number[][] = [];
  for (let c = 0; c < k; c++) {
    const from = ((chosen[c] as number) + 1) % m;
    const to = chosen[(c + 1) % k] as number;
    const len = (to - from + m) % m + 1;
    const g: number[] = [];
    for (let q = 0; q < len; q++) g.push((order[(from + q) % m] as { i: number }).i);
    groups.push(g.sort((a, b) => a - b));
  }
  return groups.sort((a, b) => (a[0] as number) - (b[0] as number));
}

export interface SignalInputs {
  junctionId: number;
  approaches: readonly Approach[];
  movements: readonly Movement[];
}

/** The program, or null when fewer than two approaches exist. */
export function buildProgram(inp: SignalInputs): SignalProgram | null {
  const ap = inp.approaches;
  if (ap.length < 2) return null;
  const k = ap.length >= 5 ? 3 : 2;
  const groups = groupByHeading(ap, k);
  const bestCls = groups.map((g) => Math.min(...g.map((i) => (ap[i] as Approach).cls)));
  const top = Math.min(...bestCls);
  const classesDiffer = bestCls.some((c) => c !== top);
  const mainGroup = bestCls.indexOf(top);
  const greens = groups.map((_g, gi) => (!classesDiffer ? GREEN_S : gi === mainGroup ? ARTERIAL_GREEN_S : CROSS_GREEN_S));

  const phaseOfEdge = new Map<number, number>();
  groups.forEach((g, gi) => { for (const i of g) phaseOfEdge.set((ap[i] as Approach).edge, gi); });
  const phaseMoves: number[][] = groups.map(() => []);
  const unassigned: Movement[] = [];
  for (const m of inp.movements) {
    const gi = phaseOfEdge.get(m.inEdge);
    if (gi === undefined) unassigned.push(m); else (phaseMoves[gi] as number[]).push(m.id);
  }
  // movements entering from an edge inside the junction follow the phase of the movement that feeds that edge
  const phaseOfMove = new Map<number, number>();
  phaseMoves.forEach((ids, gi) => { for (const id of ids) phaseOfMove.set(id, gi); });
  for (let pass = 0; pass < 4 && unassigned.length > 0; pass++) {
    for (let u = unassigned.length - 1; u >= 0; u--) {
      const m = unassigned[u] as Movement;
      const feeder = inp.movements.find((f) => f.outEdge === m.inEdge && phaseOfMove.has(f.id));
      if (!feeder) continue;
      const gi = phaseOfMove.get(feeder.id) as number;
      (phaseMoves[gi] as number[]).push(m.id);
      phaseOfMove.set(m.id, gi);
      unassigned.splice(u, 1);
    }
  }
  for (const m of unassigned) { (phaseMoves[0] as number[]).push(m.id); phaseOfMove.set(m.id, 0); }

  let t = 0;
  const phases: SignalPhase[] = groups.map((_g, gi) => {
    const ph: SignalPhase = {
      startTick: t, greenTicks: (greens[gi] as number) * TICKS_PER_S, amberTicks: AMBER_S * TICKS_PER_S, clearTicks: CLEAR_S * TICKS_PER_S,
      movements: [...(phaseMoves[gi] as number[])].sort((a, b) => a - b),
    };
    t += ph.greenTicks + ph.amberTicks + ph.clearTicks;
    return ph;
  });
  const cycleTicks = t;
  const minGreen = Math.min(...greens);
  return {
    id: inp.junctionId, cycleTicks, offsetTicks: fnv32(String(inp.junctionId)) % cycleTicks, phases,
    pedWalkTicks: Math.max(0, minGreen - WALK_TRIM_S) * TICKS_PER_S,
  };
}
