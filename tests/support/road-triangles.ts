/**
 * Road triangles of the L0 chunks of a finished bake, with and without the street-markings geometry (M02h1, the ledger of
 * `tests/e2e/markings-ledger.spec.ts`). Run as `tsx tests/support/road-triangles.ts <packs dir> <tier> <chunk key>...`: it prints
 * `{"baseline": n, "after": m}` on one line (the curbs of M02h2 off on both sides, so the count is the markings' alone). A separate process
 * because the mesher reads JSON config by import, which the Playwright loader does not accept; `tsx` does.
 *
 * M02h2 (`tests/e2e/world-curbs.spec.ts`, @curbs-ledger): `tsx tests/support/road-triangles.ts --curbs <packs dir> <tier> <chunk key>...` prints
 * `{"maxDelta": n, "sumOff": a, "sumOn": b}`: the triangles of each whole L0 chunk (render records included) with the curbs, gutters and
 * sidewalk ribbons off and on, their sums, and the largest per-chunk difference.
 */
import { readFileSync } from 'node:fs';
import { decodeL0, decodeP0, parseChunkKey, type ChunkKey, type QualityTierId, type RenderChunk, type SimChunk } from '../../packages/shared/src/index.ts';
import { meshChunk } from '../../packages/world/src/client/chunks/mesher.ts';

const argv = process.argv.slice(2);
const curbsMode = argv[0] === '--curbs';
const [dir, tier, ...keys] = (curbsMode ? argv.slice(1) : argv) as [string, QualityTierId, ...ChunkKey[]];
const tiles = new Map<string, { sims: SimChunk[]; renders: RenderChunk[] }>();
const tileOf = (key: ChunkKey): { sims: SimChunk[]; renders: RenderChunk[] } => {
  const p = parseChunkKey(key) as { x: number; y: number };
  const name = `${p.x >> 2}-${p.y >> 2}`;
  let t = tiles.get(name);
  if (!t) {
    const sims = decodeP0(new Uint8Array(readFileSync(`${dir}/p0-${name}.pack`)));
    let renders: RenderChunk[] = [];
    if (curbsMode) {
      try {
        renders = decodeL0(new Uint8Array(readFileSync(`${dir}/l0-${name}.pack`)), sims);
      } catch {
        // a tile without render records
      }
    }
    t = { sims, renders };
    tiles.set(name, t);
  }
  return t;
};
const tris = (markings: boolean): number => {
  let n = 0;
  for (const key of keys) {
    const { sims } = tileOf(key);
    const sim = sims.find((s) => s.key === key);
    if (!sim) continue;
    const m = meshChunk(sim, null, { tier, distM: 0, tile: sims, markings, curbs: false });
    n += (m.objects.find((o) => o.kind === 'roads')?.indices.length ?? 0) / 3;
  }
  return n;
};
if (curbsMode) {
  let maxDelta = 0, sumOff = 0, sumOn = 0;
  for (const key of keys) {
    const { sims, renders } = tileOf(key);
    const sim = sims.find((s) => s.key === key);
    if (!sim) continue;
    const render = renders.find((r) => r.key === key) ?? null;
    const off = meshChunk(sim, render, { tier, distM: 0, tile: sims, curbs: false }).stats.triangles;
    const on = meshChunk(sim, render, { tier, distM: 0, tile: sims, curbs: true }).stats.triangles;
    sumOff += off;
    sumOn += on;
    maxDelta = Math.max(maxDelta, on - off);
  }
  process.stdout.write(`${JSON.stringify({ maxDelta, sumOff, sumOn })}\n`);
} else {
  process.stdout.write(`${JSON.stringify({ baseline: tris(false), after: tris(true) })}\n`);
}
