/**
 * Connectivity numbers of the S14 gates: the largest strongly connected component of the drivable edge graph and the
 * disconnected pieces (with the `cnn` and OSM way of one segment each, so an author can find the gap; M02a2 risk row).
 */
import type { RoadEdge } from '../../../../packages/shared/src/index.ts';
import { scc, type EdgeGraph } from './route.ts';

export interface SccReport {
  edges: number;
  largest: number;
  fraction: number;
  components: number;
  /** The five biggest components outside the largest, each with sample segment provenance. */
  stray: { edges: number; cnn: number; osmWay: number }[];
}

export function sccReport(g: EdgeGraph, edges: readonly RoadEdge[], segOf: (e: RoadEdge) => { cnn: number; osmWay: number }): SccReport {
  const r = scc(g);
  const total = g.n;
  const largest = total === 0 ? 0 : (r.sizes[r.largest] as number);
  const order = r.sizes.map((s, i) => ({ s, i })).filter((x) => x.i !== r.largest).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 5);
  const stray = order.map((o) => {
    const e = edges.find((q) => r.comp[q.id] === o.i) as RoadEdge;
    const seg = segOf(e);
    return { edges: o.s, cnn: seg.cnn, osmWay: seg.osmWay };
  });
  return { edges: total, largest, fraction: total === 0 ? 1 : largest / total, components: r.sizes.length, stray };
}
