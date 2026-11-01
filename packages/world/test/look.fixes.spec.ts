/**
 * M02g2 AC-2 and AC-3: the mesher's render fixes, on the `synth` and `civic-excerpt` bakes (and on built-in cases where the bakes do
 * not hold the shape): baked vertex AO, the Sobel terrain with its near ring and seam skirts, roofs that sit on their walls, and trees
 * that stand on the ground and under the eaves. The mesher stays deterministic: two runs give the same bytes.
 *
 * The references here are written out again, not imported from the mesher, so a fault in the mesher's own helper is not a fault in
 * the proof: the distance to a footprint, the Sobel filter, the lowest ground under a trunk.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { TERRAIN_POSTS, decodeL0, decodeP0, sampleHeight, type QualityTierId, type RenderChunk, type SimChunk } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import {
  MESHER, MeshBuilder, addBuilding, aoRing, meshChunk, meshSurfaceAt, profileOf, roadRank, terrainAo, treeHeightCap, wantNearStride, type MesherProfile,
} from '../src/client/chunks/mesher.ts';
import type { MeshBuffers } from '../src/client/chunks/mesh-types.ts';
import { Surf } from '../src/client/look/surfaces.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const TIERS: QualityTierId[] = ['desktop', 'mobile', 'mobile-low'];
const MIB = 1024 * 1024;

interface Sample { area: string; sim: SimChunk; render: RenderChunk }

/** The densest chunks of a bake: the most buildings, the most trees, and the most pitched four-corner footprints. */
function samplesOf(area: 'synth' | 'civic-excerpt', suite: string): Sample[] {
  const bake = requireBake(area, suite);
  if (!bake) return [];
  const dir = `${bake.dir}/packs`;
  const names = readdirSync(dir).filter((n) => /^p0-\d+-\d+\.pack$/.test(n)).sort();
  // the downtown tile of the synth world; every tile of the small excerpt
  const wanted = area === 'synth' ? names.filter((n) => n === 'p0-64-64.pack' || n === 'p0-65-64.pack' || n === 'p0-64-65.pack') : names;
  const all: Sample[] = [];
  for (const n of wanted) {
    const l0 = n.replace('p0-', 'l0-');
    let sims: SimChunk[];
    let renders: RenderChunk[];
    try {
      sims = decodeP0(new Uint8Array(readFileSync(`${dir}/${n}`)));
      renders = decodeL0(new Uint8Array(readFileSync(`${dir}/${l0}`)), sims);
    } catch {
      continue;
    }
    for (const sim of sims) {
      const render = renders.find((r) => r.key === sim.key);
      if (render && (render.buildings.length > 0 || render.trees.length > 0)) all.push({ area, sim, render });
    }
  }
  const pitched = (s: Sample): number => s.render.buildings.filter((b) => b.ring.length === 8 && (b.roof === 1 || b.roof === 2)).length;
  const picks = new Set<Sample>();
  for (const key of [(s: Sample) => s.render.buildings.length, (s: Sample) => s.render.trees.length, pitched]) {
    for (const s of [...all].sort((a, b) => key(b) - key(a)).slice(0, 3)) picks.add(s);
  }
  return [...picks];
}

const SAMPLES: Sample[] = [...samplesOf('synth', 'look.fixes synth bake'), ...samplesOf('civic-excerpt', 'look.fixes civic-excerpt bake')];

const eq = (a: ArrayBufferView, b: ArrayBufferView): boolean => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
const sameMesh = (a: MeshBuffers, b: MeshBuffers): boolean =>
  a.kind === b.kind && eq(a.positions, b.positions) && eq(a.normals, b.normals) && eq(a.colors, b.colors) && eq(a.ao, b.ao) && eq(a.indices, b.indices) && eq(a.surf, b.surf);

// ---- references ----------------------------------------------------------------------------------------------------------

const ringOf = (b: { ring: ArrayLike<number> }): number[] => Array.from({ length: b.ring.length }, (_, i) => (b.ring[i] as number) / 10);

function insideRing(r: readonly number[], x: number, z: number): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2] as number, zi = r[i * 2 + 1] as number, xj = r[j * 2] as number, zj = r[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToRing(r: readonly number[], x: number, z: number): number {
  if (insideRing(r, x, z)) return 0;
  let best = Infinity;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2] as number, az = r[i * 2 + 1] as number, bx = r[j * 2] as number, bz = r[j * 2 + 1] as number;
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

/** The stride-1 Sobel normal at post (c, r); a post outside the grid takes its height by linear extrapolation of the two posts inside. */
function sobelNormal(dm: Int16Array, c: number, r: number, cell: number): [number, number, number] {
  const last = TERRAIN_POSTS - 1;
  const h = (cc: number, rr: number): number => {
    if (cc < 0) return 2 * h(0, rr) - h(1, rr);
    if (cc > last) return 2 * h(last, rr) - h(last - 1, rr);
    if (rr < 0) return 2 * h(cc, 0) - h(cc, 1);
    if (rr > last) return 2 * h(cc, last) - h(cc, last - 1);
    return (dm[rr * TERRAIN_POSTS + cc] as number) / 10;
  };
  const gx = (h(c + 1, r - 1) + 2 * h(c + 1, r) + h(c + 1, r + 1) - h(c - 1, r - 1) - 2 * h(c - 1, r) - h(c - 1, r + 1)) / (8 * cell);
  const gz = (h(c - 1, r + 1) + 2 * h(c, r + 1) + h(c + 1, r + 1) - h(c - 1, r - 1) - 2 * h(c, r - 1) - h(c + 1, r - 1)) / (8 * cell);
  const len = Math.hypot(gx, 1, gz);
  return [-gx / len, 1 / len, -gz / len];
}

const terrainOf = (m: { objects: MeshBuffers[] }): MeshBuffers => m.objects.find((o) => o.kind === 'terrain') as MeshBuffers;

describe('the bakes the fixes are proved on', () => {
  it('are present (DV_REQUIRE_BAKE=1 makes a missing bake an error; the unit cases below do not need them)', () => {
    if (process.env['DV_REQUIRE_BAKE'] === '1') expect(SAMPLES.length).toBeGreaterThan(0);
  });
});

// ---- AC-2: vertex AO -------------------------------------------------------------------------------------------------------

describe('vertex ambient occlusion (AC-2)', () => {
  it.each(TIERS)('%s: two runs give byte-identical buffers', (tier) => {
    for (const s of SAMPLES) {
      for (const distM of [0, 5000]) {
        const a = meshChunk(s.sim, s.render, { tier, distM });
        const b = meshChunk(s.sim, s.render, { tier, distM });
        expect(a.objects.length).toBe(b.objects.length);
        a.objects.forEach((o, i) => expect(sameMesh(o, b.objects[i] as MeshBuffers), `${s.sim.key} ${o.kind} ${tier} ${distM}`).toBe(true));
        expect(eq(a.trees, b.trees)).toBe(true);
      }
    }
  });

  it.each(TIERS)('%s: the posts within ao.ringM of a footprint have ao under 1 (aoRing of the distance), all the others exactly 1', (tier) => {
    const ring = MESHER.ao.ringM;
    let near = 0;
    let far = 0;
    for (const s of SAMPLES) {
      const m = meshChunk(s.sim, s.render, { tier, distM: 0 });
      const t = terrainOf(m);
      const stride = m.stats.terrainStride as number;
      const verts = (TERRAIN_POSTS - 1) / stride + 1;
      const rings = s.render.buildings.map(ringOf).filter((r) => r.length >= 6);
      for (let j = 0; j < verts; j++) {
        for (let i = 0; i < verts; i++) {
          const x = i * stride * s.sim.height.cellM, z = j * stride * s.sim.height.cellM;
          const d = rings.reduce((best, r) => Math.min(best, distToRing(r, x, z)), Infinity);
          const ao = t.ao[j * verts + i] as number;
          if (d < ring - 1e-6) {
            near++;
            expect(ao, `${s.sim.key} post ${i},${j} at ${d.toFixed(2)} m`).toBeLessThan(1);
            // a post a hair inside the ring is a hair under 1 (rounding of the footprint to a decimetre aside)
            expect(Math.abs(ao - aoRing(d))).toBeLessThan(1e-4);
          } else if (d > ring + 1e-6) {
            far++;
            expect(ao).toBe(1);
          }
        }
      }
    }
    if (SAMPLES.length > 0) {
      expect(near).toBeGreaterThan(0);
      expect(far).toBeGreaterThan(0);
    }
  });

  it('aoRing is 1 outside the ring, 1 - ringStrength on the edge, and falls off quadratically', () => {
    expect(aoRing(MESHER.ao.ringM)).toBe(1);
    expect(aoRing(MESHER.ao.ringM + 5)).toBe(1);
    expect(aoRing(0)).toBeCloseTo(1 - MESHER.ao.ringStrength, 10);
    expect(aoRing(MESHER.ao.ringM / 2)).toBeCloseTo(1 - MESHER.ao.ringStrength / 4, 10);
    expect(terrainAo([], 4)).toBeNull();
    // one footprint on a 1 m grid: a post 1 m from its edge is occluded by aoRing(1), a post on the edge by aoRing(0), a post 5 m away is open
    const ao = terrainAo([[8, 8, 16, 8, 16, 16, 8, 16]], 1) as Float32Array;
    expect(ao[12 * TERRAIN_POSTS + 17]).toBeCloseTo(aoRing(1), 6);
    expect(ao[12 * TERRAIN_POSTS + 16]).toBeCloseTo(aoRing(0), 6);
    expect(ao[12 * TERRAIN_POSTS + 21]).toBe(1);
    expect(ao[0]).toBe(1);
  });

  it('a wall row at wallRowM carries wallRowAo exactly when the triangle budget has room for it', () => {
    const rec = { kind: 1, roof: 0 as const, palette: 2, seed: 9 };
    const ring = [0, 0, 20, 0, 20, 10, 0, 10];
    // a flat roof on a four-corner footprint: 8 wall triangles and 2 roof triangles; the row adds 8
    const base = 8 + 2;
    for (let max = 12; max <= 40; max++) {
      const profile: MesherProfile = { ...MESHER.profiles.desktop, trisPerBuilding: max, parapets: false, equipment: false };
      const b = new MeshBuilder();
      const tris = addBuilding(b, ring, 10, 9, rec, profile);
      const built = b.build('buildings') as MeshBuffers;
      const rows = Array.from(built.ao).filter((a) => a === Math.fround(MESHER.ao.wallRowAo)).length;
      const room = base + 8 <= max;
      expect(tris, `max ${max}`).toBe(room ? base + 8 : base);
      expect(tris).toBeLessThanOrEqual(max);
      expect(rows > 0, `max ${max}`).toBe(room);
      if (room) {
        // the row is 1.2 m above the ground (base 10), one vertex per wall corner on each of the two sides of the corner
        const ys = new Set<number>();
        for (let v = 0; v < built.positions.length / 3; v++) if (built.ao[v] === Math.fround(MESHER.ao.wallRowAo)) ys.add(built.positions[v * 3 + 1] as number);
        expect([...ys].map((y) => Math.round(y * 1000) / 1000)).toEqual([10 + MESHER.ao.wallRowM]);
      }
    }
  });

  it.each(TIERS)('%s: no building exceeds trisPerBuilding, and no mobile-low L0 unit exceeds 2 MiB', (tier) => {
    const cap = profileOf(tier).profile.trisPerBuilding;
    for (const s of SAMPLES) {
      for (const distM of [0, 5000]) {
        const m = meshChunk(s.sim, s.render, { tier, distM, maxBytes: tier === 'mobile-low' ? 2 * MIB : null });
        expect(m.stats.maxBuildingTris, `${s.sim.key} ${tier}`).toBeLessThanOrEqual(cap);
        if (tier === 'mobile-low') expect(m.stats.bytes, `${s.sim.key} ${distM}`).toBeLessThanOrEqual(2 * MIB);
      }
    }
  });

  it('pitched eaves carry the eave AO and the ridge does not', () => {
    for (const roof of [1, 2] as const) {
      const b = new MeshBuilder();
      addBuilding(b, [0, 0, 20, 0, 20, 10, 0, 10], 10, 9, { kind: 0, roof, palette: 3, seed: 7 }, MESHER.profiles.desktop);
      const out = b.build('buildings') as MeshBuffers;
      let eaves = 0;
      let ridge = 0;
      for (let v = 0; v < out.positions.length / 3; v++) {
        const id = out.surf[v * 4] as number;
        if (id !== 26 && id !== 27) continue;
        const y = out.positions[v * 3 + 1] as number;
        if (Math.abs(y - 19) < 1e-4) {
          eaves++;
          expect(out.ao[v]).toBeCloseTo(MESHER.ao.eaveAo, 6);
        } else {
          ridge++;
          expect(out.ao[v]).toBeGreaterThan(MESHER.ao.eaveAo);
        }
      }
      expect(eaves).toBeGreaterThanOrEqual(4);
      expect(ridge).toBeGreaterThanOrEqual(2);
    }
  });
});

// ---- AC-3: terrain ---------------------------------------------------------------------------------------------------------

describe('terrain (AC-3)', () => {
  it.each(TIERS)('%s: every non-skirt vertex is within 1 mm of sampleHeight and its normal is the stride-1 Sobel normal (1e-3)', (tier) => {
    const prof = profileOf(tier).profile;
    for (const s of SAMPLES) {
      for (const distM of [0, 5000]) {
        const m = meshChunk(s.sim, s.render, { tier, distM });
        const t = terrainOf(m);
        const stride = m.stats.terrainStride as number;
        expect(stride).toBe(distM === 0 ? prof.nearStride : prof.terrainStride);
        const verts = (TERRAIN_POSTS - 1) / stride + 1;
        for (let j = 0; j < verts; j++) {
          for (let i = 0; i < verts; i++) {
            const v = j * verts + i;
            const x = (t.positions[v * 3] as number) + m.originX, z = (t.positions[v * 3 + 2] as number) + m.originZ;
            expect(Math.abs((t.positions[v * 3 + 1] as number) - sampleHeight(s.sim.height, x, z))).toBeLessThan(1e-3);
            const n = sobelNormal(s.sim.height.dm, i * stride, j * stride, s.sim.height.cellM);
            for (let k = 0; k < 3; k++) expect(Math.abs((t.normals[v * 3 + k] as number) - (n[k] as number))).toBeLessThan(1e-3);
          }
        }
      }
    }
  });

  it.each(TIERS)('%s: the near ring uses nearStride; a profile with two strides skirts every border segment 1 m down', (tier) => {
    const prof = profileOf(tier).profile;
    const mixed = prof.nearStride < prof.terrainStride;
    for (const s of SAMPLES.slice(0, 4)) {
      const near = meshChunk(s.sim, s.render, { tier, distM: MESHER.terrain.nearRingM });
      const far = meshChunk(s.sim, s.render, { tier, distM: MESHER.terrain.nearRingM + 0.5 });
      expect(near.stats.near).toBe(mixed);
      expect(far.stats.near).toBe(false);
      for (const [m, stride] of [[near, prof.nearStride], [far, prof.terrainStride]] as const) {
        const t = terrainOf(m);
        const verts = (TERRAIN_POSTS - 1) / stride + 1;
        const grid = verts * verts;
        expect(t.positions.length / 3).toBe(grid + (mixed ? 4 * (verts - 1) : 0));
        if (!mixed) continue;
        // every skirt vertex hangs skirtM under a border post, and every border segment has its quad (two triangles) in the index
        const borderPost = (v: number): boolean => v < grid && (v % verts === 0 || v % verts === verts - 1 || Math.floor(v / verts) === 0 || Math.floor(v / verts) === verts - 1);
        const segs = new Set<string>();
        const down = new Map<number, number>();
        for (let v = grid; v < t.positions.length / 3; v++) {
          let found = -1;
          for (let u = 0; u < grid && found < 0; u++) {
            if (!borderPost(u)) continue;
            if (t.positions[u * 3] === t.positions[v * 3] && t.positions[u * 3 + 2] === t.positions[v * 3 + 2]) found = u;
          }
          expect(found, `skirt vertex ${v}`).toBeGreaterThanOrEqual(0);
          expect((t.positions[found * 3 + 1] as number) - (t.positions[v * 3 + 1] as number)).toBeCloseTo(MESHER.terrain.skirtM, 5);
          down.set(v, found);
        }
        for (let k = 0; k < t.indices.length; k += 3) {
          const tri = [t.indices[k], t.indices[k + 1], t.indices[k + 2]] as number[];
          if (!tri.some((v) => v >= grid)) continue;
          const tops = tri.filter((v) => v < grid);
          const lows = tri.filter((v) => v >= grid).map((v) => down.get(v) as number);
          for (const a of [...tops, ...lows]) for (const b of [...tops, ...lows]) if (a < b) segs.add(`${a}-${b}`);
        }
        // 4 sides x (verts - 1) segments: each joins two neighbouring border posts
        let covered = 0;
        for (const key of segs) {
          const [a, b] = key.split('-').map(Number) as [number, number];
          if (borderPost(a) && borderPost(b) && (Math.abs(a - b) === 1 || Math.abs(a - b) === verts)) covered++;
        }
        expect(covered).toBeGreaterThanOrEqual(4 * (verts - 1));
      }
    }
  });

  it('the near ring is entered under nearRingM and left over nearRingM x leaveFactor (hysteresis)', () => {
    const ring = MESHER.terrain.nearRingM, k = MESHER.terrain.leaveFactor;
    expect(wantNearStride(false, ring - 1)).toBe(true);
    expect(wantNearStride(false, ring)).toBe(true);
    expect(wantNearStride(false, ring + 1)).toBe(false);
    expect(wantNearStride(false, ring * k)).toBe(false);
    expect(wantNearStride(true, ring + 1)).toBe(true);
    expect(wantNearStride(true, ring * k)).toBe(true);
    expect(wantNearStride(true, ring * k + 1)).toBe(false);
    // a chunk hovering at the edge of the ring is not asked for again between the two thresholds
    let near = false;
    let remeshes = 0;
    for (const d of [290, 310, 330, 305, 295, 320, 440, 460, 440, 310, 280]) {
      const want = wantNearStride(near, d);
      if (want !== near) {
        remeshes++;
        near = want;
      }
    }
    expect(remeshes).toBe(3);
  });

  it('only the profiles that have a finer near stride mesh the near ring finer: mobile 2 to 1; low stays at 4 (the mobile-low triangle budget, BD-M02g2-02), desktop 1 to 1', () => {
    expect(Object.entries(MESHER.profiles).map(([id, p]) => `${id}:${p.terrainStride}>${p.nearStride}`)).toEqual(['desktop:1>1', 'visionpro:1>1', 'mobile:2>1', 'low:4>4']);
    // the near grid at mobile is 8,192 triangles a chunk instead of 2,048; at mobile-low it would be 2,048 instead of 512 and, with the
    // skirts every chunk of a two-stride profile carries, took the tier 24,384 triangles over the parent (the budget is 16,000)
    expect((64 / MESHER.profiles.mobile.nearStride) ** 2 * 2 - (64 / MESHER.profiles.mobile.terrainStride) ** 2 * 2).toBe(6144);
    expect(MESHER.profiles.low.nearStride).toBe(MESHER.profiles.low.terrainStride);
  });
});

// ---- AC-3: roofs -----------------------------------------------------------------------------------------------------------

describe('roofs (AC-3)', () => {
  /** Every pitched eave vertex has a wall-top vertex at the same place (1 mm); returns how many it checked. */
  function checkRoofBase(ring: number[], base: number, height: number, roof: 1 | 2, profile: MesherProfile): number {
    const b = new MeshBuilder();
    addBuilding(b, ring, base, height, { kind: 0, roof, palette: 1, seed: 11 }, profile);
    const wallTops: [number, number, number][] = [];
    const roofBase: [number, number, number][] = [];
    const top = base + height;
    for (let v = 0; v < b.vertexCount; v++) {
      const id = b.surf[v * 4] as number;
      const p: [number, number, number] = [b.pos[v * 3] as number, b.pos[v * 3 + 1] as number, b.pos[v * 3 + 2] as number];
      if (id >= 19 && id <= 24 && Math.abs(p[1] - top) < 1e-3) wallTops.push(p);
      if ((id === 26 || id === 27) && Math.abs(p[1] - top) < 1e-3) roofBase.push(p);
    }
    expect(roofBase.length).toBeGreaterThan(0);
    for (const r of roofBase) expect(wallTops.some((w) => Math.hypot(w[0] - r[0], w[1] - r[1], w[2] - r[2]) < 1e-3), `eave vertex ${r.join(',')}`).toBe(true);
    return roofBase.length;
  }

  it('every pitched eave vertex of the baked footprints coincides with a wall-top vertex', () => {
    let checked = 0;
    for (const s of SAMPLES) {
      for (const rec of s.render.buildings) {
        if (!(rec.roof === 1 || rec.roof === 2) || rec.ring.length !== 8) continue;
        checked += checkRoofBase(ringOf(rec), rec.baseDm / 10, rec.heightDm / 10, rec.roof, MESHER.profiles.desktop);
      }
    }
    if (SAMPLES.length > 0 && process.env['DV_REQUIRE_BAKE'] === '1') expect(checked).toBeGreaterThan(0);
  });

  it('the reproduced Lombard case: a hip roof on a steep slope of a real footprint (sf-bake stage record 201006.0165557) sits on its walls', () => {
    // A four-corner footprint with a hip roof from the sf bake (Russian Hill), ring in metres relative to the chunk corner, on ground
    // that falls 7 m across the plan: the wall top is the same ring at the same height as the roof base, whatever the slope.
    const ring = [114.7, -2307.8, 109.2, -2306.9, 109.9, -2302.4, 115.4, -2303.2];
    expect(checkRoofBase(ring, 79.9, 11.8, 1, MESHER.profiles.desktop)).toBeGreaterThanOrEqual(4);
    expect(checkRoofBase(ring, 79.9, 11.8, 2, MESHER.profiles.mobile)).toBeGreaterThanOrEqual(4);
    // a clockwise ring, a rotated start corner and a tall wall: the same corners
    const cw = [ring[0], ring[1], ring[6], ring[7], ring[4], ring[5], ring[2], ring[3]] as number[];
    expect(checkRoofBase(cw, 79.9, 23.6, 2, MESHER.profiles.desktop)).toBeGreaterThanOrEqual(4);
  });
});

// ---- AC-3: trees -----------------------------------------------------------------------------------------------------------

describe('trees (AC-3)', () => {
  it.each(TIERS)('%s: every tree stands at or below the ground under its trunk and within 0.15 m of the lowest, and its height is in [3.5, cap]', (tier) => {
    const T = MESHER.tree;
    let trees = 0;
    for (const s of SAMPLES) {
      const m = meshChunk(s.sim, s.render, { tier, distM: 0 });
      const stride = m.stats.terrainStride as 1 | 2 | 4;
      const rings = s.render.buildings.map((b) => ({ ring: ringOf(b), height: b.heightDm / 10 })).filter((b) => b.ring.length >= 6);
      const count = m.trees.length / 5;
      expect(count).toBe(Math.floor(s.render.trees.length / 4));
      for (let i = 0; i < count; i++) {
        trees++;
        const [x, y, z, scale] = [m.trees[i * 5], m.trees[i * 5 + 1], m.trees[i * 5 + 2], m.trees[i * 5 + 3]] as number[];
        const r = (T.trunkRadiusM as number) * (scale as number);
        // the lowest ground under the trunk disc: the heightfield on 32 points and the centre, and the mesh the player sees
        let fieldMin = sampleHeight(s.sim.height, m.originX + x!, m.originZ + z!);
        let meshMin = Infinity;
        for (let k = 0; k <= 32; k++) {
          const px = Math.min(256, Math.max(0, x! + (k === 32 ? 0 : Math.cos((k / 32) * Math.PI * 2) * r)));
          const pz = Math.min(256, Math.max(0, z! + (k === 32 ? 0 : Math.sin((k / 32) * Math.PI * 2) * r)));
          fieldMin = Math.min(fieldMin, sampleHeight(s.sim.height, m.originX + px, m.originZ + pz));
          meshMin = Math.min(meshMin, meshSurfaceAt(s.sim.height.dm, s.sim.height.cellM, stride, px, pz));
        }
        expect(y!, `${s.sim.key} tree ${i}: at or below the heightfield`).toBeLessThanOrEqual(fieldMin + 1e-6);
        expect(y!, `${s.sim.key} tree ${i}: at or below the mesh`).toBeLessThanOrEqual(meshMin + 1e-6);
        expect(y!, `${s.sim.key} tree ${i}: within 0.15 m of the lowest ground`).toBeGreaterThanOrEqual(Math.min(fieldMin, meshMin) - 0.15);
        // the height: the 6.2 m cone scaled between the minimum and the cap under the nearest eave within eaveRadiusM
        const height = (T.heightM as number) * (scale as number);
        let eave = Infinity;
        let nearest = Infinity;
        for (const b of rings) {
          const d = distToRing(b.ring, x!, z!);
          if (d <= T.eaveRadiusM && d < nearest) {
            nearest = d;
            eave = b.height;
          }
        }
        const cap = Math.max(T.minHeightM, Math.min(T.maxHeightM, eave - T.eaveClearM));
        expect(height).toBeGreaterThanOrEqual(T.minHeightM - 1e-4);
        expect(height).toBeLessThanOrEqual(cap + 1e-4);
        expect(treeHeightCap(x!, z!, rings)).toBeCloseTo(cap, 6);
      }
    }
    if (process.env['DV_REQUIRE_BAKE'] === '1') expect(trees).toBeGreaterThan(0);
  });

  it('a tree beside a low eave is cut to it, a tree in the open keeps its size up to the maximum, and nothing is under the minimum', () => {
    const house = [{ ring: [0, 0, 10, 0, 10, 8, 0, 8], height: 6 }];
    expect(treeHeightCap(14, 4, house)).toBeCloseTo(6 - MESHER.tree.eaveClearM, 6);
    expect(treeHeightCap(30, 4, house)).toBe(MESHER.tree.maxHeightM);
    expect(treeHeightCap(5, 4, [{ ring: [0, 0, 10, 0, 10, 8, 0, 8], height: 3.5 }])).toBe(MESHER.tree.minHeightM);
    expect(treeHeightCap(5, 4, [{ ring: [0, 0, 10, 0, 10, 8, 0, 8], height: 40 }])).toBe(MESHER.tree.maxHeightM);
  });

  it('the mesh surface is the two triangles of a post cell: on the posts it equals the height, between them it follows the diagonal', () => {
    const dm = new Int16Array(TERRAIN_POSTS * TERRAIN_POSTS);
    for (let r = 0; r < TERRAIN_POSTS; r++) for (let c = 0; c < TERRAIN_POSTS; c++) dm[r * TERRAIN_POSTS + c] = (c * 7 + r * 13) % 50;
    expect(meshSurfaceAt(dm, 4, 1, 8, 12)).toBeCloseTo((dm[3 * TERRAIN_POSTS + 2] as number) / 10, 6);
    expect(meshSurfaceAt(dm, 4, 2, 16, 16)).toBeCloseTo((dm[4 * TERRAIN_POSTS + 4] as number) / 10, 6);
    // the middle of the cell (col 1, row 1) is on the diagonal that joins its (1, 0) and (0, 1) posts: the mean of those two
    const east = (dm[1 * TERRAIN_POSTS + 2] as number) / 10, south = (dm[2 * TERRAIN_POSTS + 1] as number) / 10;
    expect(meshSurfaceAt(dm, 4, 1, 6, 6)).toBeCloseTo((east + south) / 2, 6);
  });
});

describe('road ribbons (M02g2)', () => {
  it('the busier road has the higher rank, and the ribbons are emitted lowest rank first', () => {
    expect([0, 1, 2, 3, 4, 5].map(roadRank)).toEqual([5, 4, 3, 2, 1, 0]);
    for (const s of SAMPLES.slice(0, 3)) {
      const m = meshChunk(s.sim, s.render, { tier: 'desktop', distM: 0 });
      const roads = m.objects.find((o) => o.kind === 'roads');
      if (!roads) continue;
      // the surface id of the first vertex of each ribbon (4 vertices a quad): the rank never falls along the buffer
      // (M02h1: the junction patches, crosswalks and stop bars come after the ribbons, on surfaces 35 and up)
      let last = -1;
      for (let v = 0; v < roads.positions.length / 3; v++) {
        if ((roads.surf[v * 4] as number) >= Surf.Sidewalk) continue;
        const rank = roadRank((roads.surf[v * 4] as number) - 12);
        expect(rank).toBeGreaterThanOrEqual(last);
        last = rank;
      }
    }
  });
});
