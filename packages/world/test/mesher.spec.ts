/**
 * AC-3: the mesher is deterministic (twice, identical buffers), every terrain vertex lies on `sampleHeight` within 1 mm, each
 * chunk yields at most six render objects, and the triangle count of one building respects the profile of each tier. Also
 * the winding of every face agrees with its stored normal, and the profile skip rule.
 */
import { readFileSync } from 'node:fs';
import { decodeL0, decodeP0, sampleHeight, type QualityTierId, type RenderChunk, type SimChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { MESHER, MeshBuilder, addBuilding, meshChunk, objectCountOf, profileOf, signedArea } from '../src/client/chunks/mesher.ts';
import type { MeshBuffers, UnitMesh } from '../src/client/chunks/mesh-types.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/world/civic-graybox/${name}`, import.meta.url)));
const sim = decodeP0(fixture('p0-64-64.pack'));
const render = decodeL0(fixture('l0-64-64.pack'), sim);
const renderOf = (c: SimChunk): RenderChunk | null => render.find((r) => r.key === c.key) ?? null;

const TIERS: QualityTierId[] = ['desktop-ultra', 'desktop', 'xr-visionpro', 'mobile', 'xr-quest', 'mobile-low'];

function sameBuffers(a: MeshBuffers, b: MeshBuffers): boolean {
  const eq = (x: ArrayBufferView, y: ArrayBufferView): boolean => Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength)) === 0;
  return a.kind === b.kind && eq(a.positions, b.positions) && eq(a.normals, b.normals) && eq(a.colors, b.colors) && eq(a.ao, b.ao) && eq(a.indices, b.indices);
}

describe('meshChunk on the gray-box fixture', () => {
  it.each(TIERS)('%s: two runs give identical buffers', (tier) => {
    for (const c of sim) {
      const a = meshChunk(c, renderOf(c), { tier, distM: 0 });
      const b = meshChunk(c, renderOf(c), { tier, distM: 0 });
      expect(a.objects.length).toBe(b.objects.length);
      a.objects.forEach((o, i) => expect(sameBuffers(o, b.objects[i] as MeshBuffers)).toBe(true));
      expect(Buffer.compare(Buffer.from(a.trees.buffer), Buffer.from(b.trees.buffer))).toBe(0);
    }
  });

  it.each(TIERS)('%s: every terrain vertex lies on the physics surface within 1 mm, and a chunk has at most six render objects', (tier) => {
    for (const c of sim) {
      const m = meshChunk(c, renderOf(c), { tier, distM: 0 });
      expect(objectCountOf(m)).toBeLessThanOrEqual(6);
      const terrain = m.objects.find((o) => o.kind === 'terrain') as MeshBuffers;
      const stride = profileOf(tier).profile.terrainStride;
      expect(terrain.positions.length / 3).toBe((64 / stride + 1) ** 2);
      for (let i = 0; i < terrain.positions.length; i += 3) {
        const x = (terrain.positions[i] as number) + m.originX;
        const z = (terrain.positions[i + 2] as number) + m.originZ;
        expect(Math.abs((terrain.positions[i + 1] as number) - sampleHeight(c.height, x, z))).toBeLessThan(1e-3);
      }
    }
  });

  it.each(TIERS)('%s: no building exceeds the triangles of the profile', (tier) => {
    const cap = profileOf(tier).profile.trisPerBuilding;
    let buildings = 0;
    for (const c of sim) {
      const m = meshChunk(c, renderOf(c), { tier, distM: 0 });
      expect(m.stats.maxBuildingTris).toBeLessThanOrEqual(cap);
      buildings += m.stats.buildings;
    }
    expect(buildings).toBeGreaterThan(0);
  });

  it('the profile table is 80 / 60 / 40 / 18 triangles per building and maps every tier', () => {
    expect(Object.values(MESHER.profiles).map((p) => p.trisPerBuilding)).toEqual([80, 60, 40, 18]);
    expect(TIERS.map((t) => profileOf(t).id)).toEqual(['desktop', 'desktop', 'visionpro', 'mobile', 'mobile', 'low']);
    expect(profileOf('mobile-low').profile.terrainStride).toBe(4);
    expect(profileOf('mobile').profile.terrainStride).toBe(2);
    expect(profileOf('desktop').profile.terrainStride).toBe(1);
  });

  it('the skip rule drops small buildings beyond the distance and flags the chunk as filtered', () => {
    const c = sim.find((s) => (renderOf(s)?.buildings.length ?? 0) > 0) as SimChunk;
    const near = meshChunk(c, renderOf(c), { tier: 'mobile-low', distM: 10 });
    const far = meshChunk(c, renderOf(c), { tier: 'mobile-low', distM: 1000 });
    expect(near.stats.filtered).toBe(false);
    expect(far.stats.filtered).toBe(true);
    expect(far.stats.skipped + far.stats.buildings).toBe(near.stats.buildings);
    // The desktop profile has no skip rule.
    expect(meshChunk(c, renderOf(c), { tier: 'desktop', distM: 5000 }).stats.filtered).toBe(false);
  });
});

/** Every triangle of a mesh faces the way its vertex normals say. */
function windingProblems(o: MeshBuffers): number {
  let bad = 0;
  const p = o.positions;
  const n = o.normals;
  for (let t = 0; t < o.indices.length; t += 3) {
    const a = o.indices[t] as number, b = o.indices[t + 1] as number, c = o.indices[t + 2] as number;
    const ux = (p[b * 3] as number) - (p[a * 3] as number), uy = (p[b * 3 + 1] as number) - (p[a * 3 + 1] as number), uz = (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number);
    const vx = (p[c * 3] as number) - (p[a * 3] as number), vy = (p[c * 3 + 1] as number) - (p[a * 3 + 1] as number), vz = (p[c * 3 + 2] as number) - (p[a * 3 + 2] as number);
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const len = Math.hypot(gx, gy, gz);
    if (len < 1e-9) continue; // a degenerate sliver
    const dot = (gx * (n[a * 3] as number) + gy * (n[a * 3 + 1] as number) + gz * (n[a * 3 + 2] as number)) / len;
    if (dot < 0.05) bad++;
  }
  return bad;
}

describe('winding', () => {
  it('every face of the fixture meshes agrees with its normal (walls, flat roofs, terrain, roads)', () => {
    for (const tier of ['desktop', 'mobile-low'] as const) {
      for (const c of sim) {
        const m = meshChunk(c, renderOf(c), { tier, distM: 0 });
        for (const o of m.objects) expect(windingProblems(o), `${c.key} ${o.kind} ${tier}`).toBe(0);
      }
    }
  });

  it.each([1, 2] as const)('a pitched roof (%i) on a rectangle has six roof triangles and outward faces', (roof) => {
    const b = new MeshBuilder();
    const tris = addBuilding(b, [0, 0, 20, 0, 20, 10, 0, 10], 10, 9, { kind: 0, roof, palette: 3, seed: 7 }, MESHER.profiles.desktop);
    expect(tris).toBe(8 + 6);
    expect(b.triangleCount).toBe(14);
    const out = b.build('buildings') as MeshBuffers;
    expect(windingProblems(out)).toBe(0);
    // The ridge is higher than the eave and lower than eave + roofLiftMaxM.
    expect(out.bounds[4]).toBeGreaterThan(19);
    expect(out.bounds[4]).toBeLessThanOrEqual(19 + MESHER.roofLiftMaxM + 1e-6);
  });

  it('walls point away from the building (outward normals) for either ring orientation', () => {
    for (const ring of [[0, 0, 20, 0, 20, 10, 0, 10], [0, 10, 20, 10, 20, 0, 0, 0]]) {
      const b = new MeshBuilder();
      addBuilding(b, ring, 5, 8, { kind: 2, roof: 0, palette: 2, seed: 5 }, MESHER.profiles.desktop);
      const out = b.build('buildings') as MeshBuffers;
      let walls = 0;
      for (let i = 0; i < out.normals.length; i += 3) {
        const ny = out.normals[i + 1] as number;
        if (Math.abs(ny) > 0.5) continue;
        walls++;
        const px = (out.positions[i] as number) - 10;
        const pz = (out.positions[i + 2] as number) - 5;
        expect((out.normals[i] as number) * px + (out.normals[i + 2] as number) * pz).toBeGreaterThan(0);
      }
      expect(walls).toBeGreaterThan(0);
    }
  });

  it('a clockwise ring is wound like a counter-clockwise one and a many-cornered ring is simplified to fit', () => {
    const cw: number[] = [];
    const ccw: number[] = [];
    const n = 60;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ccw.push(30 + Math.cos(a) * 12, 30 + Math.sin(a) * 9);
    }
    for (let i = n - 1; i >= 0; i--) cw.push(ccw[i * 2] as number, ccw[i * 2 + 1] as number);
    expect(signedArea(ccw)).toBeGreaterThan(0);
    expect(signedArea(cw)).toBeLessThan(0);
    for (const profile of Object.values(MESHER.profiles)) {
      const b1 = new MeshBuilder();
      const b2 = new MeshBuilder();
      const t1 = addBuilding(b1, ccw, 0, 20, { kind: 2, roof: 0, palette: 1, seed: 2 }, profile);
      const t2 = addBuilding(b2, cw, 0, 20, { kind: 2, roof: 0, palette: 1, seed: 2 }, profile);
      expect(t1).toBeLessThanOrEqual(profile.trisPerBuilding);
      expect(t2).toBe(t1);
      expect(b1.triangleCount).toBeLessThanOrEqual(profile.trisPerBuilding);
      expect(windingProblems(b1.build('buildings') as MeshBuffers)).toBe(0);
    }
  });
});

describe('meshChunk on the synth bake', () => {
  it('the densest chunks stay inside the budgets of every profile', () => {
    const bake = requireBake('synth', 'mesher.spec synth bake');
    if (!bake) return;
    const dir = `${bake.dir}/packs`;
    // The downtown tile: City Hall is in 64-64.
    const p0 = decodeP0(new Uint8Array(readFileSync(`${dir}/p0-64-64.pack`)));
    const l0 = decodeL0(new Uint8Array(readFileSync(`${dir}/l0-64-64.pack`)), p0);
    let densest: { s: SimChunk; r: RenderChunk } | null = null;
    for (const s of p0) {
      const r = l0.find((x) => x.key === s.key);
      if (r && (!densest || r.buildings.length > densest.r.buildings.length)) densest = { s, r };
    }
    expect(densest).not.toBeNull();
    if (!densest) return;
    for (const tier of TIERS) {
      const m: UnitMesh = meshChunk(densest.s, densest.r, { tier, distM: 0 });
      const cap = profileOf(tier).profile.trisPerBuilding;
      expect(m.stats.maxBuildingTris).toBeLessThanOrEqual(cap);
      expect(objectCountOf(m)).toBeLessThanOrEqual(6);
      for (const o of m.objects) expect(windingProblems(o), `${tier} ${o.kind}`).toBe(0);
    }
  });
});
