/**
 * M02h3 AC-5 on the `synth` bake: the L0 chunks of the tiles with the most ground cover are meshed twice per profile with the cover on and
 * once with it off. Runs are byte-identical; posts over a cover cell carry the `cover.<class>` surface and colour; the cover-off mesh is the
 * mesh without a cover argument (the code path before M02h3); vertices, triangles, indices, positions and render objects match on and
 * off (only the terrain's colours and surface ids differ); no `mobile-low` L0 unit passes its 2 MiB upload cap.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { COVER_CELLS, decodeCoverTile, decodeL0, decodeP0, type ChunkKey, type QualityTierId, type RenderChunk, type SimChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import type { MeshBuffers, UnitMesh } from '../src/client/chunks/mesh-types.ts';
import { COVER_COLORS, meshChunk, objectCountOf } from '../src/client/chunks/mesher.ts';
import { SURFACE_COUNT, SURFACE_NAMES, Surf, coverSurf } from '../src/client/look/surfaces.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const TIERS: QualityTierId[] = ['desktop', 'mobile', 'mobile-low', 'xr-quest'];
const MOBILE_LOW_CAP = 2 * 1024 * 1024;

interface CoverTile { name: string; sims: SimChunk[]; renders: RenderChunk[]; cover: Map<ChunkKey, Uint8Array> }

/** The `max` tiles of the synth bake with the most cells of the classes other than yard and park (so every class is meshed). */
function coverTiles(max: number): CoverTile[] {
  const bake = requireBake('synth', 'cover.mesher');
  if (!bake) return [];
  const scored: { name: string; score: number }[] = [];
  for (const f of readdirSync(`${bake.dir}/packs`).filter((n) => n.startsWith('l0-')).sort()) {
    const cover = decodeCoverTile(new Uint8Array(readFileSync(`${bake.dir}/packs/${f}`)));
    const seen = new Set<number>();
    let rare = 0;
    for (const c of cover.values()) for (const v of c) {
      if (v !== 0) seen.add(v);
      if (v !== 0 && v !== 1 && v !== 7) rare++;
    }
    scored.push({ name: f.slice(3, -5), score: seen.size * 100_000 + rare });
  }
  scored.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
  return scored.slice(0, max).map(({ name }) => {
    const l0 = new Uint8Array(readFileSync(`${bake.dir}/packs/l0-${name}.pack`));
    const sims = decodeP0(new Uint8Array(readFileSync(`${bake.dir}/packs/p0-${name}.pack`)));
    return { name, sims, renders: decodeL0(l0, sims), cover: decodeCoverTile(l0) };
  });
}

const TILES = coverTiles(2);

const eq = (x: ArrayBufferView | undefined, y: ArrayBufferView | undefined): boolean =>
  (x === undefined && y === undefined) || (x !== undefined && y !== undefined && Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength)) === 0);
const same = (a: MeshBuffers, b: MeshBuffers): boolean =>
  a.kind === b.kind && eq(a.positions, b.positions) && eq(a.normals, b.normals) && eq(a.colors, b.colors) && eq(a.ao, b.ao) && eq(a.indices, b.indices) && eq(a.surf, b.surf) && eq(a.road, b.road);
const sameMesh = (a: UnitMesh, b: UnitMesh): boolean => a.objects.length === b.objects.length && a.objects.every((o, i) => same(o, b.objects[i] as MeshBuffers)) && eq(a.trees, b.trees);

describe('ground cover in the mesher (M02h3 AC-5)', () => {
  it('finds synth tiles with every cover class', () => {
    if (TILES.length === 0) return;
    const seen = new Set<number>();
    for (const t of TILES) for (const c of t.cover.values()) for (const v of c) seen.add(v);
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it.each(TIERS)('%s: byte-identical runs, cover ids on the posts, off equals the pre-M02h3 path, same geometry and objects', (tier) => {
    let covered = 0;
    for (const t of TILES) {
      for (const sim of t.sims) {
        const render = t.renders.find((r) => r.key === sim.key) ?? null;
        const cover = t.cover.get(sim.key) ?? null;
        const base = { tier, distM: 0, tile: t.sims } as const;
        const on = meshChunk(sim, render, { ...base, cover });
        const again = meshChunk(sim, render, { ...base, cover });
        const off = meshChunk(sim, render, { ...base, cover: null });
        const before = meshChunk(sim, render, base);
        expect(sameMesh(on, again), `${sim.key} twice`).toBe(true);
        expect(sameMesh(off, before), `${sim.key} cover off is the path without cover`).toBe(true);
        expect(on.stats.triangles).toBe(off.stats.triangles);
        expect(on.stats.vertices).toBe(off.stats.vertices);
        expect(on.stats.bytes).toBe(off.stats.bytes);
        expect(objectCountOf(on)).toBe(objectCountOf(off));
        on.objects.forEach((o, i) => {
          const p = off.objects[i] as MeshBuffers;
          expect(o.kind).toBe(p.kind);
          expect(eq(o.positions, p.positions) && eq(o.indices, p.indices) && eq(o.normals, p.normals) && eq(o.ao, p.ao), `${sim.key} ${o.kind} geometry`).toBe(true);
          if (o.kind !== 'terrain') expect(same(o, p), `${sim.key} ${o.kind} untouched`).toBe(true);
          for (let v = 0; v < o.surf.length; v += 4) expect(o.surf[v] as number).toBeLessThan(SURFACE_COUNT);
        });
        if (tier === 'mobile-low') expect(on.stats.bytes, `${sim.key} on mobile-low`).toBeLessThanOrEqual(MOBILE_LOW_CAP);
        if (!cover) {
          expect(sameMesh(on, off)).toBe(true);
          continue;
        }
        expect(cover.length).toBe(COVER_CELLS);
        expect(on.stats.cover?.reduce((a, b) => a + b, 0)).toBe(COVER_CELLS);
        expect(off.stats.cover).toBeUndefined();
        // each top post reads the cell its ground class comes from
        const terrain = on.objects.find((o) => o.kind === 'terrain') as MeshBuffers;
        const stride = on.stats.terrainStride ?? 1;
        const verts = 64 / stride + 1;
        for (let j = 0; j < verts; j++) {
          for (let i = 0; i < verts; i++) {
            const v = j * verts + i;
            const cell = Math.min(63, j * stride + (stride >> 1)) * 64 + Math.min(63, i * stride + (stride >> 1));
            const c = cover[cell] as number;
            const id = terrain.surf[v * 4] as number;
            if (c === 0) {
              expect(id < Surf.CoverYard, `${sim.key} post ${i},${j} without cover`).toBe(true);
              continue;
            }
            covered++;
            expect(id, `${sim.key} post ${i},${j}`).toBe(coverSurf(c));
            expect(SURFACE_NAMES[id]?.startsWith('cover.')).toBe(true);
            const want = COVER_COLORS[c] as readonly number[];
            // the min profile bakes no macro tone into a cover post (macroApplies leaves the ids out), so the colour is the class colour
            expect(Math.abs((terrain.colors[v * 3] as number) - (want[0] as number))).toBeLessThan(1e-6);
          }
        }
      }
    }
    if (TILES.length > 0) expect(covered).toBeGreaterThan(1000);
  });
});
