/**
 * M02g2 AC-4: nothing floats. On every level of the `synth` and `civic-excerpt` bakes (L0 chunks, L1 tiles, L2 blocks, the far massing
 * and the skyline cards): no building or massing vertex is above its unit's maximum top plus 10 m, and no wall foot is above the
 * terrain it stands on (the heightfield and the mesh the player sees).
 *
 * The culprit of the floating dark slab of the study (staging `03-play-02`, mobile-low) was the skyline cards: `cardsLayout` counted
 * the atlas rows from the bottom while the texture is uploaded with its top row first, so every card showed its silhouette upside
 * down, the solid base at the top of the quad and the roofline hanging under it. The cases below hold it: the top of a card is the
 * top of its cell of the atlas, and the opaque part of the cell, drawn from the bottom up, is at the bottom of the card.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { decodeFarDem, decodeFarMassing, decodeL0, decodeLod, decodeP0, sampleHeight, TERRAIN_POSTS, type LodUnit, type QualityTierId, type RenderChunk, type SimChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { BACKDROP, cardsLayout, demHeightAt, massingInstances } from '../src/client/backdrop/far-mesh.ts';
import { meshLod } from '../src/client/chunks/lod-mesher.ts';
import { MESHER, MeshBuilder, addBuilding, meshChunk, meshSurfaceAt, profileOf, wallFoot } from '../src/client/chunks/mesher.ts';
import type { MeshBuffers } from '../src/client/chunks/mesh-types.ts';
import { decodePng } from '../../../tests/support/image-diff.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const TIERS: QualityTierId[] = ['desktop', 'mobile', 'mobile-low'];
/** A vertex may stand this far above the top of the tallest building record of its unit: the roof lift, a parapet or a rooftop box. */
const SLACK_M = 10;

interface Pack { name: string; sims: SimChunk[]; renders: RenderChunk[] }

function l0Packs(area: 'synth' | 'civic-excerpt', suite: string, limit: number): { packs: Pack[]; dir: string } | null {
  const bake = requireBake(area, suite);
  if (!bake) return null;
  const dir = `${bake.dir}/packs`;
  const names = readdirSync(dir).filter((n) => /^p0-\d+-\d+\.pack$/.test(n)).sort();
  const wanted = area === 'synth' ? names.filter((n) => ['p0-64-64.pack', 'p0-65-64.pack', 'p0-64-65.pack', 'p0-63-64.pack'].includes(n)) : names;
  const packs: Pack[] = [];
  for (const n of wanted.slice(0, limit)) {
    try {
      const sims = decodeP0(new Uint8Array(readFileSync(`${dir}/${n}`)));
      packs.push({ name: n, sims, renders: decodeL0(new Uint8Array(readFileSync(`${dir}/${n.replace('p0-', 'l0-')}`)), sims) });
    } catch {
      // a tile without an l0 pack has no buildings
    }
  }
  return { packs, dir };
}

describe('L0: buildings stay under their unit and wall feet stay under the ground', () => {
  for (const area of ['synth', 'civic-excerpt'] as const) {
    it.each(TIERS)(`${area} %s: no building vertex above the tallest record + 10 m, no wall foot above the terrain`, (tier) => {
      const found = l0Packs(area, `look.floating ${area}`, 6);
      if (!found) return;
      const stride = profileOf(tier).profile.nearStride;
      let feet = 0;
      let verts = 0;
      for (const p of found.packs) {
        for (const sim of p.sims) {
          const render = p.renders.find((r) => r.key === sim.key);
          if (!render || render.buildings.length === 0) continue;
          const m = meshChunk(sim, render, { tier, distM: 0 });
          const b = m.objects.find((o) => o.kind === 'buildings') as MeshBuffers | undefined;
          if (!b) continue;
          const top = Math.max(...render.buildings.map((r) => (r.baseDm + r.heightDm) / 10));
          for (let v = 0; v < b.positions.length / 3; v++) {
            verts++;
            expect(b.positions[v * 3 + 1] as number, `${sim.key} ${tier} vertex ${v}`).toBeLessThanOrEqual(top + SLACK_M);
          }
          // the wall feet: wall vertices on the nominal foot or below (the facade coordinate v is at or under 0), checked against the
          // heightfield and against the mesh at the chunk's stride (distM 0: the near stride)
          const fac = b.facade;
          if (!fac) continue;
          for (let v = 0; v < b.positions.length / 3; v++) {
            const id = b.surf[v * 4] as number;
            if (id < 19 || id > 24 || (fac[v * 4 + 1] as number) > 0) continue;
            feet++;
            // a footprint can reach over the chunk border: the ground there is the chunk's edge (as the mesher takes it)
            const x = Math.min(256, Math.max(0, b.positions[v * 3] as number)), z = Math.min(256, Math.max(0, b.positions[v * 3 + 2] as number)), y = b.positions[v * 3 + 1] as number;
            expect(y, `${sim.key} ${tier} wall foot at ${x.toFixed(1)}, ${z.toFixed(1)} over the heightfield`).toBeLessThanOrEqual(sampleHeight(sim.height, m.originX + x, m.originZ + z) + 1e-3);
            expect(y, `${sim.key} ${tier} wall foot over the mesh`).toBeLessThanOrEqual(meshSurfaceAt(sim.height.dm, sim.height.cellM, stride, x, z) + 1e-3);
          }
        }
      }
      if (process.env['DV_REQUIRE_BAKE'] === '1') {
        expect(verts).toBeGreaterThan(0);
        expect(feet).toBeGreaterThan(0);
      }
    });
  }

  it('a footprint on a steep street gets a foot that follows the falling ground, on a coarse mesh as on a fine one', () => {
    // a 20 m x 10 m house whose ground falls 6 m along its length: 0.3 m per metre, the plain skirt (1.5 m) would hang above the low end
    const dm = new Int16Array(TERRAIN_POSTS * TERRAIN_POSTS);
    for (let r = 0; r < TERRAIN_POSTS; r++) for (let c = 0; c < TERRAIN_POSTS; c++) dm[r * TERRAIN_POSTS + c] = Math.round((100 - c * 4 * 0.3) * 10);
    const ring = [8, 8, 28, 8, 28, 18, 8, 18];
    const base = 100 - 8 * 0.3 - 0.2; // the highest corner's ground: the bake takes the lowest, so this is the unfavourable case
    for (const stride of [1, 2, 4] as const) {
      const foot = wallFoot(dm, 4, stride, ring, base);
      expect(foot).toBeLessThan(base - MESHER.foundationM);
      for (let i = 0; i < ring.length; i += 2) expect(foot).toBeLessThanOrEqual(meshSurfaceAt(dm, 4, stride, ring[i] as number, ring[i + 1] as number) - 0.1 + 1e-9);
    }
    // on level ground the foot is the plain foundation skirt
    const flat = new Int16Array(TERRAIN_POSTS * TERRAIN_POSTS).fill(500);
    expect(wallFoot(flat, 4, 1, ring, 49.8)).toBeCloseTo(49.8 - MESHER.foundationM, 6);
    // addBuilding puts the wall foot there and keeps the facade coordinate on the nominal foot (v below 0 for the extra depth)
    const b = new MeshBuilder({ facade: true });
    const foot = wallFoot(dm, 4, 4, ring, base);
    addBuilding(b, ring, base, 8, { kind: 1, roof: 0, palette: 1, seed: 3 }, MESHER.profiles.low, undefined, foot);
    const out = b.build('buildings') as MeshBuffers;
    const fac = out.facade as Int16Array;
    let lowest = Infinity;
    for (let v = 0; v < out.positions.length / 3; v++) lowest = Math.min(lowest, out.positions[v * 3 + 1] as number);
    expect(lowest).toBeCloseTo(foot, 4);
    expect(Math.min(...Array.from({ length: out.positions.length / 3 }, (_, v) => fac[v * 4 + 1] as number))).toBeLessThan(0);
  });
});

describe('L1 and L2: massing stays under its unit and on its terrain', () => {
  it.each(['synth', 'civic-excerpt'] as const)('%s: no massing vertex above the tallest record + 10 m, no wall foot above the drawn terrain', (area) => {
    const bake = requireBake(area, `look.floating ${area} lod`);
    if (!bake) return;
    const dir = `${bake.dir}/packs`;
    const units: LodUnit[] = [];
    for (const f of readdirSync(dir).filter((n) => /^l[12]-\d+-\d+\.pack$/.test(n)).sort().slice(0, 14)) units.push(...decodeLod(new Uint8Array(readFileSync(`${dir}/${f}`))));
    let massing = 0;
    for (const unit of units) {
      if (unit.massing.length === 0) continue;
      for (const tier of TIERS) {
        const m = meshLod(unit, tier);
        const mass = m.objects.find((o) => o.kind === 'massing');
        if (!mass) continue;
        const stride = profileOf(tier).profile.lodStride;
        const top = Math.max(...unit.massing.map((r) => (r.baseDm + r.heightDm) / 10));
        for (let v = 0; v < mass.positions.length / 3; v++) {
          massing++;
          expect(mass.positions[v * 3 + 1] as number, `${unit.key} ${tier}`).toBeLessThanOrEqual(top + SLACK_M);
          // wall feet carry the wall's base occlusion (the foot of a coarse block has no wall row)
          if (mass.ao[v] !== Math.fround(0.55) || Math.abs(mass.normals[v * 3 + 1] as number) > 0.5) continue;
          const x = mass.positions[v * 3] as number, z = mass.positions[v * 3 + 2] as number;
          expect(mass.positions[v * 3 + 1] as number, `${unit.key} ${tier} foot at ${x.toFixed(0)}, ${z.toFixed(0)}`).toBeLessThanOrEqual(meshSurfaceAt(unit.heights, unit.postM, stride, x, z) + 1e-3);
        }
      }
    }
    if (process.env['DV_REQUIRE_BAKE'] === '1') expect(massing).toBeGreaterThan(0);
  }, 180_000);
});

describe('the far massing and the skyline cards', () => {
  it('far massing boxes stand on the DEM and stay under their own height + 10 m', () => {
    const bake = requireBake('synth', 'look.floating far');
    if (!bake) return;
    const dem = decodeFarDem(new Uint8Array(readFileSync(`${bake.dir}/packs/far-bay-dem.pack`)));
    const massing = decodeFarMassing(new Uint8Array(readFileSync(`${bake.dir}/packs/far-bay-massing.pack`)));
    const inst = massingInstances(massing, dem);
    expect(inst.count).toBeGreaterThan(0);
    let top = 0;
    for (let i = 0; i < inst.count; i++) top = Math.max(top, inst.matrices[i * 16 + 5] as number);
    let demMax = -Infinity;
    for (let i = 0; i < dem.heights.length; i++) demMax = Math.max(demMax, (dem.heights[i] as number) / 10);
    for (let i = 0; i < inst.count; i++) {
      const x = (inst.matrices[i * 16 + 12] as number) + inst.originX, z = (inst.matrices[i * 16 + 14] as number) + inst.originZ;
      const foot = inst.matrices[i * 16 + 13] as number;
      // the box is 1 box tall unit scaled to its height; its foot is the DEM height less half a metre (never above it), and at least the sea
      expect(foot).toBeLessThanOrEqual(Math.max(demHeightAt(dem, x, z), 0) + 1e-3);
      expect(foot + (inst.matrices[i * 16 + 5] as number)).toBeLessThanOrEqual(demMax + top + SLACK_M);
    }
  });

  it('the skyline cards: the top of a card is the top of its atlas cell, so the silhouette stands on its base (the culprit of the floating slab)', () => {
    const a = BACKDROP.atlas;
    for (const km of [10, 20]) {
      const layout = cardsLayout({ x: 0, z: 0 }, km);
      layout.cards.forEach((card, k) => {
        const cluster = BACKDROP.clusters[k];
        if (!cluster) return;
        // corners in the order bottom-left, bottom-right, top-right, top-left; v counts from the TOP row of the image (flipY = false)
        const vBottom = layout.uvs[k * 8 + 1] as number, vTop = layout.uvs[k * 8 + 5] as number;
        expect(vTop, `card ${card.id}`).toBeLessThan(vBottom);
        expect(vTop).toBeCloseTo((card.row * a.cardPx[1]) / a.sizePx[1], 6);
        expect(vBottom).toBeCloseTo(((card.row + 1) * a.cardPx[1]) / a.sizePx[1], 6);
        // every card stands on y = 0 and rises to its height (scaled when the distance is clamped), never past it + 10 m
        const ys = [1, 4, 7, 10].map((o) => layout.positions[k * 12 + o] as number);
        expect(ys.slice(0, 2)).toEqual([0, 0]);
        expect(ys[2]).toBeLessThanOrEqual(cluster.heightM + SLACK_M);
      });
    }
  });

  it('the placeholder atlas is solid at the bottom of each cell and clear at the top, which the corrected UVs put at the bottom and top of the card', () => {
    const bake = requireBake('synth', 'look.floating atlas');
    if (!bake) return;
    const png = decodePng(new Uint8Array(readFileSync(`${bake.dir}/packs/far-bay-cards.png`)));
    const a = BACKDROP.atlas;
    expect(png.width).toBe(a.sizePx[0]);
    expect(png.height).toBe(a.sizePx[1]);
    const layout = cardsLayout({ x: 0, z: 0 }, 10);
    // alpha of the atlas at a UV (v from the top row)
    const alphaAt = (u: number, v: number): number => (png.data[(Math.min(png.height - 1, Math.floor(v * png.height)) * png.width + Math.min(png.width - 1, Math.floor(u * png.width))) * 4 + 3] as number);
    let solidBottom = 0;
    let clearTop = 0;
    layout.cards.forEach((_, k) => {
      const u = ((layout.uvs[k * 8] as number) + (layout.uvs[k * 8 + 2] as number)) / 2;
      const vBottom = layout.uvs[k * 8 + 1] as number, vTop = layout.uvs[k * 8 + 5] as number;
      // the middle of the card's bottom edge samples the opaque base of the skyline, a line just under its top is clear of it
      if (alphaAt(u, vBottom - 0.002) === 255) solidBottom++;
      if (alphaAt(u, vTop + 0.002) === 0) clearTop++;
    });
    expect(solidBottom).toBe(layout.cards.length);
    expect(clearTop).toBeGreaterThan(0);
  });
});
