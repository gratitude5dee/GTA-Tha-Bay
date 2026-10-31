/**
 * M02h2 test support: the z7 tiles of a bake decoded the way the mesher job decodes one (`p0` and `l0` packs), so the curb suites mesh real
 * chunks with their tile.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { decodeL0, decodeP0, type RenderChunk, type SimChunk } from '@dv/shared';
import { requireBake } from '../../../tests/support/require-bake.ts';

export interface Tile {
  name: string;
  sims: SimChunk[];
  renders: RenderChunk[];
}

/** Up to `max` tiles of the bake of `area` (sorted by name), or none when the bake is missing (the suite then skips). */
export function bakeTiles(area: string, suite: string, max = 4): Tile[] {
  const bake = requireBake(area, suite);
  if (!bake) return [];
  const names = readdirSync(`${bake.dir}/packs`)
    .filter((f) => f.startsWith('p0-') && f.endsWith('.pack'))
    .map((f) => f.slice(3, -5))
    .sort();
  const out: Tile[] = [];
  for (const name of names) {
    const sims = decodeP0(new Uint8Array(readFileSync(`${bake.dir}/packs/p0-${name}.pack`)));
    let renders: RenderChunk[] = [];
    try {
      renders = decodeL0(new Uint8Array(readFileSync(`${bake.dir}/packs/l0-${name}.pack`)), sims);
    } catch {
      // a tile with no render pack
    }
    // the tiles with sidewalks first
    out.push({ name, sims, renders });
  }
  const score = (t: Tile): number => t.sims.reduce((n, s) => n + s.pedEdges.length, 0);
  return out.sort((a, b) => score(b) - score(a) || (a.name < b.name ? -1 : 1)).slice(0, max);
}
