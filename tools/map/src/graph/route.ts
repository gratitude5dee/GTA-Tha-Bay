/**
 * Bake-side road graph over edges (M02a2): edge-to-edge transitions through junction movements (or straight through a
 * plain node), shortest routes by length with ties broken by edge id, and reachability. The runtime `RoadGraphQuery` is
 * M02c1; this is the build and verification copy.
 */
import type { Junction, RoadEdge } from '../../../../packages/shared/src/index.ts';

export interface EdgeGraph {
  n: number;
  /** transitions[e] = edges that may follow e, ascending by id */
  next: number[][];
  lengthM: Float64Array;
}

export function buildEdgeGraph(edges: readonly RoadEdge[], junctions: readonly Junction[], nodeJunction: (node: number) => number, lengthOf: (e: RoadEdge) => number, outOf: (node: number) => readonly number[]): EdgeGraph {
  const n = edges.length;
  const byIn = new Map<number, number[]>();
  for (const j of junctions) for (const m of j.movements) {
    const l = byIn.get(m.inEdge) ?? [];
    l.push(m.outEdge);
    byIn.set(m.inEdge, l);
  }
  const next: number[][] = new Array(n);
  const lengthM = new Float64Array(n);
  for (const e of edges) {
    lengthM[e.id] = lengthOf(e);
    if (nodeJunction(e.to) >= 0) next[e.id] = [...new Set(byIn.get(e.id) ?? [])].sort((a, b) => a - b);
    else next[e.id] = outOf(e.to).filter((o) => o !== e.twin).slice().sort((a, b) => a - b);
  }
  return { n, next, lengthM };
}

/** Strongly connected components (iterative Tarjan): component id per edge, component sizes, id of the largest. */
export function scc(g: EdgeGraph): { comp: Int32Array; sizes: number[]; largest: number } {
  const n = g.n;
  const index = new Int32Array(n).fill(-1), low = new Int32Array(n), comp = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const sizes: number[] = [];
  let idx = 0;
  const call: { v: number; i: number }[] = [];
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    call.push({ v: s, i: 0 });
    index[s] = low[s] = idx++;
    stack.push(s);
    onStack[s] = 1;
    while (call.length > 0) {
      const top = call[call.length - 1] as { v: number; i: number };
      const nb = g.next[top.v] as number[];
      if (top.i < nb.length) {
        const w = nb[top.i++] as number;
        if (index[w] === -1) {
          index[w] = low[w] = idx++;
          stack.push(w);
          onStack[w] = 1;
          call.push({ v: w, i: 0 });
        } else if (onStack[w]) low[top.v] = Math.min(low[top.v] as number, index[w] as number);
      } else {
        if (low[top.v] === index[top.v]) {
          const id = sizes.length;
          let size = 0;
          for (;;) {
            const w = stack.pop() as number;
            onStack[w] = 0;
            comp[w] = id;
            size++;
            if (w === top.v) break;
          }
          sizes.push(size);
        }
        call.pop();
        if (call.length > 0) {
          const parent = call[call.length - 1] as { v: number };
          low[parent.v] = Math.min(low[parent.v] as number, low[top.v] as number);
        }
      }
    }
  }
  let largest = 0;
  sizes.forEach((s, i) => { if (s > (sizes[largest] as number)) largest = i; });
  return { comp, sizes, largest };
}

class Heap {
  private h: { k: number; e: number }[] = [];
  get size(): number { return this.h.length; }
  push(k: number, e: number): void {
    const h = this.h;
    h.push({ k, e });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const a = h[i] as { k: number; e: number }, b = h[p] as { k: number; e: number };
      if (a.k < b.k || (a.k === b.k && a.e < b.e)) { h[i] = b; h[p] = a; i = p; } else break;
    }
  }
  pop(): { k: number; e: number } {
    const h = this.h;
    const top = h[0] as { k: number; e: number };
    const last = h.pop() as { k: number; e: number };
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        const less = (x: number, y: number): boolean => { const a = h[x] as { k: number; e: number }, b = h[y] as { k: number; e: number }; return a.k < b.k || (a.k === b.k && a.e < b.e); };
        if (l < h.length && less(l, m)) m = l;
        if (r < h.length && less(r, m)) m = r;
        if (m === i) break;
        const t = h[i] as { k: number; e: number };
        h[i] = h[m] as { k: number; e: number };
        h[m] = t;
        i = m;
      }
    }
    return top;
  }
}

export interface RouteResult { edges: number[]; lengthM: number }

/** Shortest route from the end of edge `from` to the end of edge `to` (both included), or null. Ties break by edge id. */
export function route(g: EdgeGraph, from: number, to: number, allowed?: (e: number) => boolean, maxExpand = 4_000_000): RouteResult | null {
  if (from === to) return { edges: [from], lengthM: g.lengthM[from] as number };
  const dist = new Float64Array(g.n).fill(Infinity);
  const prev = new Int32Array(g.n).fill(-1);
  const heap = new Heap();
  dist[from] = g.lengthM[from] as number;
  heap.push(dist[from] as number, from);
  let expanded = 0;
  while (heap.size > 0 && expanded++ < maxExpand) {
    const { k, e } = heap.pop();
    if (k > (dist[e] as number)) continue;
    if (e === to) break;
    for (const w of g.next[e] as number[]) {
      if (allowed && !allowed(w)) continue;
      const nd = k + (g.lengthM[w] as number);
      if (nd < (dist[w] as number) - 1e-9) { dist[w] = nd; prev[w] = e; heap.push(nd, w); }
    }
  }
  if (!Number.isFinite(dist[to] as number)) return null;
  const out: number[] = [];
  for (let e = to; e !== -1; e = prev[e] as number) out.push(e);
  out.reverse();
  return { edges: out, lengthM: dist[to] as number };
}

/** Edges reachable from `from` (including it). */
export function reachable(g: EdgeGraph, from: number): Uint8Array {
  const seen = new Uint8Array(g.n);
  const q: number[] = [from];
  seen[from] = 1;
  for (let h = 0; h < q.length; h++) for (const w of g.next[q[h] as number] as number[]) if (!seen[w]) { seen[w] = 1; q.push(w); }
  return seen;
}
