/**
 * `pnpm map:resolve -- --lat=<y> --lng=<x> [--area <id>]`: the edge id, arc length `s`, distance and chunk key of the road
 * nearest to a coordinate in a finished bake (authors and the S14 gates use it; the runtime `resolve` is M02c1).
 * Reads only the p0 packs around the point (the 3 x 3 chunks, so at most four z=7 tiles).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chunkKeyAt, decodeP0, enuFromLatLng, parseChunkKey, type ChunkKey, type RoadEdge, type RoadSegment, type SimChunk } from '../../../packages/shared/src/index.ts';
import { nearestOnPoly } from './geom/poly.ts';

export interface Resolved { edge: number; seg: number; s: number; distM: number; chunk: ChunkKey; x: number; z: number; name: string | null }

/** Loads the p0 chunks within one chunk of (x, z) from a bake directory. */
export function loadAround(bakeDir: string, x: number, z: number, rings = 1): SimChunk[] {
  const k = parseChunkKey(chunkKeyAt(9, x, z));
  if (!k) return [];
  const tiles = new Set<string>();
  for (let dy = -rings; dy <= rings; dy++) for (let dx = -rings; dx <= rings; dx++) tiles.add(`${Math.floor((k.x + dx) / 4)}-${Math.floor((k.y + dy) / 4)}`);
  const out: SimChunk[] = [];
  for (const t of [...tiles].sort()) {
    const f = path.join(bakeDir, 'packs', `p0-${t}.pack`);
    if (existsSync(f)) out.push(...decodeP0(readFileSync(f)));
  }
  return out;
}

/** Nearest directed edge to (x, z) among the given chunks: the edge whose right-hand side the point lies on wins, ties go to the lower id. */
export function resolveIn(chunks: readonly SimChunk[], x: number, z: number, maxM = 200): Resolved | null {
  const segs = new Map<number, RoadSegment>();
  for (const c of chunks) for (const s of c.segments) segs.set(s.id, s);
  const bySeg = new Map<number, RoadEdge[]>();
  for (const c of chunks) for (const e of c.edges) (bySeg.get(e.seg) ?? bySeg.set(e.seg, []).get(e.seg)!).push(e);
  let best: Resolved | null = null;
  let bestD = Infinity;
  for (const [sid, edges] of [...bySeg.entries()].sort((a, b) => a[0] - b[0])) {
    const seg = segs.get(sid);
    if (!seg) continue;
    const xz: number[] = [];
    for (let i = 0; i < seg.pts.length; i += 3) xz.push(seg.pts[i] as number, seg.pts[i + 2] as number);
    const near = nearestOnPoly(xz, x, z);
    if (near.d > maxM || near.d >= bestD - 1e-9) continue;
    // right side of the segment direction is (-tz, tx); a point on it belongs to the forward edge
    const side = (x - near.x) * -near.tz + (z - near.z) * near.tx;
    const sorted = [...edges].sort((a, b) => a.id - b.id);
    const fwd = sorted.find((e) => e.dir === 1), back = sorted.find((e) => e.dir === -1);
    const pick = (side >= 0 ? fwd ?? back : back ?? fwd) as RoadEdge;
    const total = near.s;
    const len = (() => { let l = 0; for (let i = 2; i < xz.length; i += 2) l += Math.hypot((xz[i] as number) - (xz[i - 2] as number), (xz[i + 1] as number) - (xz[i - 1] as number)); return l; })();
    const cand: Resolved = { edge: pick.id, seg: sid, s: Math.round((pick.dir === 1 ? total : len - total) * 10) / 10, distM: Math.round(near.d * 10) / 10, chunk: chunkKeyAt(9, x, z), x: Math.round(near.x * 10) / 10, z: Math.round(near.z * 10) / 10, name: null };
    best = cand;
    bestD = near.d;
  }
  return best;
}

export function resolveLatLng(bakeDir: string, lat: number, lng: number): Resolved | null {
  const p = enuFromLatLng(lat, lng);
  return resolveIn(loadAround(bakeDir, p.x, p.z), p.x, p.z);
}
