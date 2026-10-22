/**
 * Race authoring, step 1 (M07a1; 06-racing.md 2.7): the road graph of a finished bake and the snap of a waypoint to a drivable edge.
 *
 * The bake gives the topology (`sf-graph.v1`, every edge, no geometry) and the `p0` tiles (geometry for 4 x 4 chunks each). The
 * compiler routes on the topology, then loads the chunks the route crosses so that gates, the centreline and the elevation come
 * from the real centrelines. This is the same router and snap the game uses (`packages/world/src/sim/graph`).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  chunkKeyAt, decodeGraph, decodeP0, enuFromLatLng, parseChunkKey,
  type ChunkKey, type EdgeId, type HeightGrid, type RoadEdge, type RoadSegment, type SegId, type SimChunk,
} from '../../../../packages/shared/src/index.ts';
import { RoadNetwork } from '../../../../packages/world/src/sim/graph/adjacency.ts';
import { RoadGraph } from '../../../../packages/world/src/sim/graph/query.ts';
import { loadContentWorld } from '../content.ts';
import { DIST_ROOT } from '../config.ts';

/** A waypoint further than this from a drivable edge is an authoring error (V1). */
export const SNAP_MAX_M = 25;

export interface BakeGraph {
  bakeId: string;
  dir: string;
  net: RoadNetwork;
  graph: RoadGraph;
  /** Every segment and edge record of the chunks loaded so far (a segment lives in one chunk, its edges may live in the next). */
  segs: Map<SegId, RoadSegment>;
  edgeRec: Map<EdgeId, RoadEdge>;
  /** The height grid of every chunk loaded so far (the corridor of the headless run reads them). */
  heights: Map<ChunkKey, HeightGrid>;
  /** Loads the chunks whose keys are not resident yet. */
  ensureChunks(keys: Iterable<ChunkKey>): void;
  /** Loads the chunks around an ENU point (`rings` chunks either way). */
  ensureAround(x: number, z: number, rings?: number): void;
}

/** The finished bake of `area` (default `sf`) in `dist/world`, or null when there is none. */
export function findBake(area = 'sf', root = DIST_ROOT): { bakeId: string; dir: string } | null {
  const latest = path.join(root, `latest-${area}.json`);
  if (!existsSync(latest)) return null;
  const bakeId = (JSON.parse(readFileSync(latest, 'utf8')) as { bakeId: string }).bakeId;
  const dir = path.join(root, bakeId);
  return existsSync(path.join(dir, 'bake-report.json')) ? { bakeId, dir } : null;
}

export function openBake(bake: { bakeId: string; dir: string }): BakeGraph {
  const topo = decodeGraph(readFileSync(path.join(bake.dir, 'packs', 'sf-graph.v1.pack')));
  const net = new RoadNetwork(topo);
  const graph = new RoadGraph(net, { tick: () => 0, blackout: () => false, closed: () => false });
  const loadedTiles = new Set<string>();
  const segs = new Map<SegId, RoadSegment>();
  const edgeRec = new Map<EdgeId, RoadEdge>();
  const heights = new Map<ChunkKey, HeightGrid>();
  const tileOf = (key: ChunkKey): string => {
    const k = parseChunkKey(key);
    return k ? `${Math.floor(k.x / 4)}-${Math.floor(k.y / 4)}` : '';
  };
  const ensureChunks = (keys: Iterable<ChunkKey>): void => {
    for (const key of keys) {
      const t = tileOf(key);
      if (!t || loadedTiles.has(t)) continue;
      loadedTiles.add(t);
      const f = path.join(bake.dir, 'packs', `p0-${t}.pack`);
      if (!existsSync(f)) continue;
      const chunks: SimChunk[] = decodeP0(readFileSync(f));
      for (const c of chunks) {
        net.addChunk(c);
        for (const sg of c.segments) segs.set(sg.id, sg);
        for (const ed of c.edges) edgeRec.set(ed.id, ed);
        heights.set(c.key, c.height);
      }
    }
  };
  return {
    ...bake,
    net,
    graph,
    segs,
    edgeRec,
    heights,
    ensureChunks,
    ensureAround(x, z, rings = 1) {
      const out: ChunkKey[] = [];
      const e = 256;
      for (let dz = -rings; dz <= rings; dz++) for (let dx = -rings; dx <= rings; dx++) out.push(chunkKeyAt(9, x + dx * e, z + dz * e));
      ensureChunks(out);
    },
  };
}

export interface Snapped { edge: EdgeId; s: number; distM: number; x: number; z: number }

/** A waypoint as ENU metres: lat/lng directly, a landmark through the authored seeds of `content/world`. */
export function waypointEnu(p: { lat: number; lng: number } | { landmark: string }): { x: number; z: number } {
  if ('landmark' in p) {
    const seed = loadContentWorld().landmarks.find((l) => l.id === p.landmark);
    if (!seed) throw new Error(`landmark ${p.landmark} is not in content/world/landmarks.json`);
    return { x: seed.x, z: seed.z };
  }
  return enuFromLatLng(p.lat, p.lng);
}

/** Snaps a point to the nearest drivable edge within 25 m (the right-hand side of the street wins a tie). */
export function snapPoint(bg: BakeGraph, x: number, z: number): Snapped | null {
  bg.ensureAround(x, z, 1);
  const h = bg.graph.snap(x, z, undefined, SNAP_MAX_M, undefined, false);
  if (!h) return null;
  const t = new Float64Array(5);
  bg.graph.pointOnEdge(h.edge, h.s, t);
  return { edge: h.edge, s: h.s, distM: h.distM, x: t[0] as number, z: t[2] as number };
}
