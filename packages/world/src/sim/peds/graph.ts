/**
 * The pedestrian graph of the resident `p0` chunks (living part 4.1; M03b2). A chunk's ped graph is self-contained: an edge that
 * crosses a chunk border is split with a duplicate node at the same position in the neighbour, so a walker at a border node hops to
 * the node of the neighbouring chunk at the same spot. Adjacency is built once per decoded chunk (a `WeakMap` on the chunk object).
 * Pure; C02 lint applies.
 */
import { PedEdgeKind, PedNodeFlag, dsqrt, parseChunkKey, type ChunkKey, type PedEdge, type PedNode, type SimChunk } from '@dv/shared';

export interface PedOut {
  to: number;
  kind: number;
  junction: number;
  movement: number;
  len: number;
}

export interface WalkEdge {
  a: number;
  b: number;
  len: number;
}

export interface ChunkPedIndex {
  nodes: Map<number, PedNode>;
  out: Map<number, PedOut[]>;
  /** Edges a ped can be placed on (sidewalks, paths, plazas), for a length-weighted pick. */
  walk: WalkEdge[];
  walkTotal: number;
}

const cache = new WeakMap<object, ChunkPedIndex>();

const lenOf = (a: PedNode, b: PedNode): number => dsqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));

export function pedIndexOf(c: Readonly<SimChunk>): ChunkPedIndex {
  const have = cache.get(c);
  if (have) return have;
  const nodes = new Map<number, PedNode>();
  for (const n of c.pedNodes) nodes.set(n.id, n);
  const out = new Map<number, PedOut[]>();
  const walk: WalkEdge[] = [];
  let total = 0;
  const push = (from: number, o: PedOut): void => {
    const l = out.get(from);
    if (l) l.push(o);
    else out.set(from, [o]);
  };
  for (const e of c.pedEdges as readonly PedEdge[]) {
    const a = nodes.get(e.a), b = nodes.get(e.b);
    if (!a || !b) continue;
    const len = lenOf(a, b);
    push(e.a, { to: e.b, kind: e.kind, junction: e.junction, movement: e.movement, len });
    push(e.b, { to: e.a, kind: e.kind, junction: e.junction, movement: e.movement, len });
    if (e.kind !== PedEdgeKind.Crosswalk && e.kind !== PedEdgeKind.Stairs && len > 0.5) {
      walk.push({ a: e.a, b: e.b, len });
      total += len;
    }
  }
  const idx: ChunkPedIndex = { nodes, out, walk, walkTotal: total };
  cache.set(c, idx);
  return idx;
}

/** The nine chunk keys around (and including) `key`, own chunk first. */
export function neighbourKeys(key: ChunkKey): ChunkKey[] {
  const p = parseChunkKey(key);
  if (!p) return [key];
  const out: ChunkKey[] = [key];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      out.push(`9/${p.x + dx}/${p.y + dy}` as ChunkKey);
    }
  }
  return out;
}

/** Two nodes closer than this are the same spot split by a chunk border (the pack quantises to 0.1 m). */
export const HOP_M = 0.35;

/**
 * The node of a neighbouring chunk at the position of `node`, with the chunk that holds it, or null. `chunk` returns a resident
 * chunk or null. The own chunk is skipped.
 */
export function hopTo(key: ChunkKey, node: PedNode, chunk: (k: ChunkKey) => Readonly<SimChunk> | null): { key: ChunkKey; node: PedNode } | null {
  const ks = neighbourKeys(key);
  for (let i = 1; i < ks.length; i++) {
    const nk = ks[i] as ChunkKey;
    const c = chunk(nk);
    if (!c) continue;
    for (const n of c.pedNodes) {
      const dx = n.x - node.x, dz = n.z - node.z;
      if (dx * dx + dz * dz <= HOP_M * HOP_M && (pedIndexOf(c).out.get(n.id)?.length ?? 0) > 0) return { key: nk, node: n };
    }
  }
  return null;
}

export const isWaiting = (n: PedNode): boolean => (n.flags & PedNodeFlag.Waiting) !== 0;
export const isStairs = (n: PedNode): boolean => (n.flags & PedNodeFlag.Stairs) !== 0;
