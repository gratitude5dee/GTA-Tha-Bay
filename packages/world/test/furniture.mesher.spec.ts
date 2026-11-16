/**
 * M02h6 AC-2 (mesher half) on the `synth` and `civic-excerpt` bakes: every L0 chunk of the busiest tiles meshed twice per tier gives the same
 * furniture and parked records byte for byte; each profile keeps only the kinds its pools draw (`full` all, `lite` no pole or wire, `min`
 * signal and post without meters, the XR tiers none); a chunk whose `RenderChunk.furniture` was filled by the S13 bake fill and went
 * through an l0 pack meshes the same records as an empty one (DL-740: the fill stays off, both paths agree); every signal record points at
 * a head; no `mobile-low` L0 unit passes the 2 MiB upload cap. The placement rules are `packages/shared/test/world-furniture.spec.ts`.
 */
import { decodeL0, type ChunkKey, type QualityTierId, type RenderChunk, type SimChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { encodeL0 } from '../../../tools/map/src/pack/encode.ts';
import { fillFurniture } from '../../../tools/map/src/stages/s13-pack.ts';
import { FURNITURE_STRIDE, FurnitureKind, type UnitMesh } from '../src/client/chunks/mesh-types.ts';
import { FURNITURE, furnitureKindsOf, meshChunk } from '../src/client/chunks/mesher.ts';
import { lookProfileFor } from '../src/client/look/config.ts';
import { bakeTiles, type Tile } from './curbs.support.ts';

const TIERS: QualityTierId[] = ['desktop', 'mobile', 'mobile-low', 'xr-quest'];
const MOBILE_LOW_CAP = 2 * 1024 * 1024;
const AREAS = ['synth', 'civic-excerpt'] as const;
const TILES: Record<string, Tile[]> = Object.fromEntries(AREAS.map((a) => [a, bakeTiles(a, `furniture.mesher ${a}`, 2)]));

const same = (a: Float32Array | undefined, b: Float32Array | undefined): boolean =>
  (a?.length ?? 0) === (b?.length ?? 0) && (!a || !b || Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0);

function mesh(t: Tile, sim: SimChunk, tier: QualityTierId, render?: RenderChunk | null): UnitMesh {
  return meshChunk(sim, render === undefined ? (t.renders.find((r) => r.key === sim.key) ?? null) : render, { tier, distM: 0, tile: t.sims });
}

describe.each(AREAS)('furniture records on %s (AC-2)', (area) => {
  const tiles = TILES[area] as Tile[];

  it.each(TIERS)('%s: two runs are byte-identical, the profile keeps its kinds, signals point at heads, mobile-low stays under 2 MiB', (tier) => {
    if (tiles.length === 0) return;
    const kinds = furnitureKindsOf(lookProfileFor(tier));
    let records = 0, heads = 0, parked = 0;
    for (const t of tiles) {
      for (const sim of t.sims) {
        const a = mesh(t, sim, tier), b = mesh(t, sim, tier);
        expect(same(a.furniture, b.furniture), `${sim.key} furniture`).toBe(true);
        expect(same(a.parked, b.parked), `${sim.key} parked`).toBe(true);
        expect(a.heads).toEqual(b.heads);
        for (let i = 0; i < a.furniture.length; i += FURNITURE_STRIDE) {
          const k = a.furniture[i] as number;
          expect(kinds.has(k), `${sim.key}: kind ${k} on ${tier}`).toBe(true);
          if (k === FurnitureKind.signal) expect(a.heads[a.furniture[i + 5] as number], `${sim.key} head ${a.furniture[i + 5]}`).toBeDefined();
          expect(Number.isFinite(a.furniture[i + 2] as number)).toBe(true);
        }
        if (tier === 'mobile-low') expect(a.stats.bytes, `${sim.key} on mobile-low`).toBeLessThanOrEqual(MOBILE_LOW_CAP);
        if (tier === 'xr-quest') {
          expect(a.furniture.length).toBe(0);
          expect(a.parked?.length ?? 0).toBe(0);
        }
        records += a.furniture.length / FURNITURE_STRIDE;
        heads += a.heads.length;
        parked += (a.parked?.length ?? 0) / 6;
      }
    }
    if (tier !== 'xr-quest') {
      expect(records).toBeGreaterThan(0);
      expect(heads).toBeGreaterThan(0);
      if (area === 'synth') expect(parked).toBeGreaterThan(0);
    }
  });

  it('a chunk filled by the bake (through an l0 pack) meshes the same records as an empty one', () => {
    if (tiles.length === 0) return;
    expect(FURNITURE.bakeFill, 'DL-740: the fill stays off in v1').toBe(false);
    let filledRecords = 0;
    for (const t of tiles) {
      const sims = new Map(t.sims.map((s) => [s.key as ChunkKey, s] as const));
      const renders = new Map(t.renders.map((r) => [r.key as ChunkKey, r] as const));
      const bakeId = t.sims[0]?.bakeId as string;
      fillFurniture({ ...FURNITURE, bakeFill: true }, bakeId, new Map([[t.name, t.sims.map((s) => s.key as ChunkKey)]]), sims, renders);
      const [tx, ty] = t.name.split('-').map(Number) as [number, number];
      const ordered = t.renders.map((r) => renders.get(r.key as ChunkKey) as RenderChunk);
      const decoded = decodeL0(encodeL0(ordered, { tileX: tx, tileY: ty, hostZ: 7, bakeId }), t.sims);
      for (const tier of ['desktop', 'mobile-low'] as QualityTierId[]) {
        for (const sim of t.sims) {
          const dr = decoded.find((r) => r.key === sim.key) ?? null;
          if (!dr) continue;
          const empty = mesh(t, sim, tier);
          const filled = mesh(t, sim, tier, dr);
          filledRecords += dr.furniture.length / 4;
          expect(same(filled.furniture, empty.furniture), `${sim.key} on ${tier}: filled vs empty`).toBe(true);
          expect(filled.heads).toEqual(empty.heads);
          if (dr.furniture.length > 0) expect(filled.stats.furniture?.source).toBe('bake');
          expect(empty.stats.furniture?.source).toBe('mesher');
        }
      }
    }
    expect(filledRecords).toBeGreaterThan(0);
  });
});
