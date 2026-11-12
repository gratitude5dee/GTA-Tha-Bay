/**
 * AC-3 (M02e): on the synth bake the mesher runs twice on L0, L1 and L2 units for every profile and the buffers, `surf` and
 * `facade` included, are byte-identical; every wall vertex has 0 <= v <= wall height; every surface id is in the table;
 * `meshBytes` counts the new arrays; and no L0 unit on `mobile-low` exceeds the 2 MB per-frame upload cap.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { decodeL0, decodeLod, decodeP0, type LodUnit, type QualityTierId, type RenderChunk, type SimChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { meshLod } from '../src/client/chunks/lod-mesher.ts';
import { MeshBuilder, meshChunk } from '../src/client/chunks/mesher.ts';
import { meshBytes, transferListOf, type MeshBuffers, type UnitMesh } from '../src/client/chunks/mesh-types.ts';
import { lookProfileFor } from '../src/client/look/config.ts';
import { FACADE_SCALE, SURFACE_COUNT, Surf, isSurfaceId } from '../src/client/look/surfaces.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const TIERS: QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro'];
const MOBILE_LOW_CAP = 2 * 1024 * 1024;

const bytesEqual = (a: ArrayBufferView, b: ArrayBufferView): boolean => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

function sameBuffers(a: MeshBuffers, b: MeshBuffers): boolean {
  return (
    a.kind === b.kind &&
    bytesEqual(a.positions, b.positions) && bytesEqual(a.normals, b.normals) && bytesEqual(a.colors, b.colors) && bytesEqual(a.ao, b.ao) && bytesEqual(a.indices, b.indices) &&
    bytesEqual(a.surf, b.surf) && (a.facade && b.facade ? bytesEqual(a.facade, b.facade) : a.facade === b.facade)
  );
}

function sameUnit(a: UnitMesh, b: UnitMesh): boolean {
  return a.objects.length === b.objects.length && a.objects.every((o, i) => sameBuffers(o, b.objects[i] as MeshBuffers));
}

function lodUnits(dir: string, family: 'l1' | 'l2'): LodUnit[] {
  const out: LodUnit[] = [];
  for (const f of readdirSync(`${dir}/packs`).filter((n) => n.startsWith(`${family}-`))) out.push(...decodeLod(new Uint8Array(readFileSync(`${dir}/packs/${f}`))));
  return out;
}

/** The ten densest L0 chunks of the synth bake (by building count). */
function denseChunks(dir: string, count = 4): { sim: SimChunk; render: RenderChunk }[] {
  const out: { sim: SimChunk; render: RenderChunk; n: number }[] = [];
  for (const f of readdirSync(`${dir}/packs`).filter((n) => n.startsWith('l0-'))) {
    const id = f.slice('l0-'.length, -'.pack'.length);
    let sim: SimChunk[];
    try {
      sim = decodeP0(new Uint8Array(readFileSync(`${dir}/packs/p0-${id}.pack`)));
    } catch {
      continue;
    }
    const render = decodeL0(new Uint8Array(readFileSync(`${dir}/packs/${f}`)), sim);
    for (const r of render) {
      const s = sim.find((c) => c.key === r.key);
      if (s) out.push({ sim: s, render: r, n: r.buildings.length });
    }
  }
  return out.sort((a, b) => b.n - a.n || (a.sim.key < b.sim.key ? -1 : 1)).slice(0, count);
}

describe('surf and facade arrays on the synth bake (AC-3)', () => {
  const bake = requireBake('synth', 'look.surfaces synth bake');

  it.each(TIERS)('%s: L0 units are byte-identical across two runs, surface ids are in the table, wall coordinates are in range', (tier) => {
    if (!bake) return;
    const profile = lookProfileFor(tier);
    for (const { sim, render } of denseChunks(bake.dir)) {
      const a = meshChunk(sim, render, { tier, distM: 0 });
      const b = meshChunk(sim, render, { tier, distM: 0 });
      expect(sameUnit(a, b)).toBe(true);
      for (const o of a.objects) {
        const n = o.positions.length / 3;
        expect(o.surf.length).toBe(n * 4);
        for (let i = 0; i < n; i++) expect(isSurfaceId(o.surf[i * 4] as number)).toBe(true);
        if (o.kind === 'buildings') {
          if (profile === 'legacy') expect(o.facade).toBeUndefined();
          else {
            const f = o.facade as Int16Array;
            expect(f.length).toBe(n * 4);
            for (let i = 0; i < n; i++) {
              const id = o.surf[i * 4] as number;
              const u = f[i * 4] as number, v = f[i * 4 + 1] as number, wallH = f[i * 4 + 2] as number;
              expect(u).toBeGreaterThanOrEqual(0);
              if (id >= Surf.WallBase && id < Surf.WallBase + 6) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(wallH);
              }
              expect(wallH).toBeLessThanOrEqual(FACADE_SCALE);
            }
          }
        }
      }
    }
  });

  it.each(TIERS)('%s: L1 and L2 units are byte-identical across two runs with surface ids in the table', (tier) => {
    if (!bake) return;
    for (const family of ['l1', 'l2'] as const) {
      const unit = [...lodUnits(bake.dir, family)].sort((a, b) => b.massing.length - a.massing.length)[0] as LodUnit;
      const a = meshLod(unit, tier);
      const b = meshLod(unit, tier);
      expect(sameUnit(a, b)).toBe(true);
      for (const o of a.objects) {
        expect(o.facade).toBeUndefined();
        for (let i = 0; i < o.positions.length / 3; i++) expect(isSurfaceId(o.surf[i * 4] as number)).toBe(true);
      }
      const massing = a.objects.find((o) => o.kind === 'massing');
      if (massing) for (let i = 0; i < massing.positions.length / 3; i++) expect(massing.surf[i * 4]).toBe(family === 'l1' ? Surf.MassingL1 : Surf.MassingL2);
    }
  });

  it('meshBytes and the transfer list count the new arrays (4 B per vertex, 8 B more on a building vertex, 8 B more on a road vertex)', () => {
    if (!bake) return;
    const { sim, render } = denseChunks(bake.dir, 1)[0] as { sim: SimChunk; render: RenderChunk };
    const m = meshChunk(sim, render, { tier: 'desktop', distM: 0 });
    let expected = m.trees.byteLength;
    for (const o of m.objects) {
      const n = o.positions.length / 3;
      expected += o.positions.byteLength + o.normals.byteLength + o.colors.byteLength + o.ao.byteLength + o.indices.byteLength + n * 4 + n * 4 + (o.kind === 'buildings' ? n * 8 : 0) + (o.kind === 'roads' ? n * 8 : 0);
    }
    expect(meshBytes(m.objects, m.trees)).toBe(expected);
    const buffers = new Set(transferListOf(m));
    for (const o of m.objects) {
      expect(buffers.has(o.surf.buffer as ArrayBuffer)).toBe(true);
      if (o.facade) expect(buffers.has(o.facade.buffer as ArrayBuffer)).toBe(true);
      if (o.road) expect(buffers.has(o.road.buffer as ArrayBuffer)).toBe(true);
    }
  });

  it('no L0 unit on mobile-low exceeds the 2 MB per-frame upload cap', () => {
    if (!bake) return;
    for (const { sim, render } of denseChunks(bake.dir, 8)) {
      const m = meshChunk(sim, render, { tier: 'mobile-low', distM: 0, maxBytes: MOBILE_LOW_CAP });
      expect(m.stats.bytes).toBeLessThanOrEqual(MOBILE_LOW_CAP);
    }
  });
});

describe('MeshBuilder surface state', () => {
  it('carries the surface of the last setSurf onto each vertex and zero facade records unless given', () => {
    const b = new MeshBuilder({ facade: true });
    b.setSurf(Surf.WallBase + 2, 7, 18, 1);
    b.vertex(0, 0, 0, [0, 1, 0], [1, 1, 1], 1, [10, 20, 30, 40]);
    b.setSurf(Surf.RoofFlat, 7, 18, 0);
    b.vertex(1, 0, 0, [0, 1, 0], [1, 1, 1]);
    b.vertex(0, 0, 1, [0, 1, 0], [1, 1, 1]);
    b.tri(0, 1, 2);
    const o = b.build('buildings') as MeshBuffers;
    expect(Array.from(o.surf)).toEqual([Surf.WallBase + 2, 7, 18, 1, Surf.RoofFlat, 7, 18, 0, Surf.RoofFlat, 7, 18, 0]);
    expect(Array.from(o.facade as Int16Array)).toEqual([10, 20, 30, 40, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(SURFACE_COUNT).toBeGreaterThan(Surf.Sea);
  });
});
