/**
 * The L1 and L2 mesher (02-world.md section 5.3; M02b1): the coarse units of the LOD ladder from the S11 packs. An L1 unit is a
 * z=7 tile (1,024 m, HEIGHT at 16 m posts), an L2 unit a z=5 block (4,096 m, posts at 64 m). Objects: `terrain` (the posts at
 * every 1st / 2nd / 4th, coloured by land use, with an 8 m skirt around the edge so neighbours of different detail meet without a
 * crack), `massing` (extruded footprints, flat roofs) and `roads` (ribbons draped on the terrain mesh). No `three` import.
 *
 * Positions are local to the unit's north-west corner. The terrain of water is flattened to the sea level and coloured as water; a
 * unit without a land outline (all water) is one flat sheet.
 */
import { TERRAIN_POSTS, LOD_LAND_CLASS, type LodUnit, type QualityTierId } from '@dv/shared';
import { Surf, roadSurf } from '../look/surfaces.ts';
import { MESHER, MeshBuilder, addBuilding, addRibbon, hexToLinear, profileOf, roadColor, type MesherProfile, type Rgb } from './mesher.ts';
import { meshBytes, type MeshBuffers, type MeshStats, type UnitMesh } from './mesh-types.ts';

const LANDUSE_COLORS: readonly Rgb[] = [
  hexToLinear(MESHER.landuse['residential'] as string),
  hexToLinear(MESHER.landuse['commercial'] as string),
  hexToLinear(MESHER.landuse['industrial'] as string),
  hexToLinear(MESHER.landuse['grass'] as string),
  hexToLinear(MESHER.landuse['park'] as string),
  hexToLinear(MESHER.landuse['sand'] as string),
  hexToLinear(MESHER.landuse['plaza'] as string),
  hexToLinear(MESHER.landuse['rock'] as string),
];
/** The surface id of each coarse land-use class (residential, commercial, industrial, grass, park, sand, plaza, rock). */
const LANDUSE_SURF: readonly number[] = [Surf.GroundBase + 0, Surf.GroundBase + 3, Surf.GroundBase + 4, Surf.GroundBase + 0, Surf.GroundBase + 1, Surf.GroundBase + 2, Surf.GroundBase + 3, Surf.GroundBase + 5];
const WATER = hexToLinear(MESHER.landuse['water'] as string);
const LAND = hexToLinear(MESHER.landuse['land'] as string);

/** Massing needs no detail; a footprint costs at most this many triangles. */
const MASS_TRIS = 22;

interface Poly {
  cls: number;
  pts: Float32Array;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

function polyOf(cls: number, ring: Float32Array, ox: number, oz: number): Poly {
  const pts = new Float32Array(ring.length);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const x = (ring[i] as number) - ox, z = (ring[i + 1] as number) - oz;
    pts[i] = x;
    pts[i + 1] = z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { cls, pts, minX, minZ, maxX, maxZ };
}

function inside(p: Poly, x: number, z: number): boolean {
  if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) return false;
  let hit = false;
  const n = p.pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p.pts[i * 2] as number, zi = p.pts[i * 2 + 1] as number, xj = p.pts[j * 2] as number, zj = p.pts[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** Bilinear height of the (sub-sampled) post grid at local (x, z), metres. */
function surfaceAt(h: Int16Array, stride: number, post: number, x: number, z: number): number {
  const step = post * stride;
  const verts = (TERRAIN_POSTS - 1) / stride + 1;
  const fx = Math.min(verts - 1.000001, Math.max(0, x / step));
  const fz = Math.min(verts - 1.000001, Math.max(0, z / step));
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const at = (a: number, b: number): number => (h[b * stride * TERRAIN_POSTS + a * stride] as number) / 10;
  const n0 = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
  const n1 = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
  return n0 + (n1 - n0) * tz;
}

function densify(pts: Float32Array, step: number): number[] {
  const out: number[] = [];
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2] as number, z = pts[i * 2 + 1] as number;
    if (i === 0) {
      out.push(x, z);
      continue;
    }
    const px = pts[i * 2 - 2] as number, pz = pts[i * 2 - 1] as number;
    const len = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
    const k = Math.max(1, Math.ceil(len / step));
    for (let s = 1; s <= k; s++) out.push(px + ((x - px) * s) / k, pz + ((z - pz) * s) / k);
  }
  return out;
}

/**
 * Meshes one L1 tile or L2 block. `maxBytes` is the tier's upload cap (`mobile-low`, `xr-quest`: 2 MB per frame; null: none): when
 * the unit is over it, the least important massing footprints (low and small first) and the minor roads are dropped until it
 * fits, so a chunk is uploaded whole and still within the cap (C08 rule 13). The terrain is never reduced.
 */
export function meshLod(unit: LodUnit, tier: QualityTierId, maxBytes: number | null = null): UnitMesh {
  const profile: MesherProfile = profileOf(tier).profile;
  const stride = profile.lodStride;
  const { originX: ox, originZ: oz, postM } = unit;
  const verts = (TERRAIN_POSTS - 1) / stride + 1;
  const step = postM * stride;
  const sea = MESHER.lod.waterLevelM;

  // ---- terrain -----------------------------------------------------------------------------------------------------------
  const polys = unit.landuse.map((l) => polyOf(l.cls, l.ring, ox, oz));
  const land = polys.filter((p) => p.cls === LOD_LAND_CLASS);
  const use = polys.filter((p) => p.cls !== LOD_LAND_CLASS);
  const hasOutline = land.length > 0;
  const hAt = (i: number, j: number): number => (unit.heights[Math.min(TERRAIN_POSTS - 1, j * stride) * TERRAIN_POSTS + Math.min(TERRAIN_POSTS - 1, i * stride)] as number) / 10;
  const isLand = (x: number, z: number, h: number): boolean => (hasOutline ? land.some((p) => inside(p, x, z)) : h > 0.2);

  const tb = new MeshBuilder();
  const isWater: boolean[] = [];
  for (let j = 0; j < verts; j++) {
    for (let i = 0; i < verts; i++) {
      const x = i * step, z = j * step;
      const h = hAt(i, j);
      const dry = isLand(x, z, h);
      isWater.push(!dry);
      let color: Rgb = WATER;
      let y = sea;
      let surf = Surf.Sea as number;
      if (dry) {
        y = h;
        color = LAND;
        surf = Surf.GroundBase;
        for (const p of use) {
          if (inside(p, x, z)) {
            color = LANDUSE_COLORS[p.cls] ?? LAND;
            surf = LANDUSE_SURF[p.cls] ?? Surf.GroundBase;
            break;
          }
        }
      }
      tb.setSurf(surf);
      const gx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * step);
      const gz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * step);
      const l = Math.sqrt(gx * gx + 1 + gz * gz);
      tb.vertex(x, y, z, dry ? [-gx / l, 1 / l, -gz / l] : [0, 1, 0], color);
    }
  }
  for (let j = 0; j < verts - 1; j++) {
    for (let i = 0; i < verts - 1; i++) {
      const a = j * verts + i;
      tb.triUp(a, a + verts, a + 1, true);
      tb.triUp(a + 1, a + verts, a + verts + 1, true);
    }
  }
  // Skirt: the edge vertices are repeated `skirtM` lower.
  const skirt = MESHER.lod.skirtM;
  const edgeIdx: number[] = [];
  for (let i = 0; i < verts; i++) edgeIdx.push(i);
  for (let j = 1; j < verts; j++) edgeIdx.push(j * verts + verts - 1);
  for (let i = verts - 2; i >= 0; i--) edgeIdx.push((verts - 1) * verts + i);
  for (let j = verts - 2; j >= 1; j--) edgeIdx.push(j * verts);
  const lower: number[] = edgeIdx.map((v) => {
    const x = tb.pos[v * 3] as number, y = tb.pos[v * 3 + 1] as number, z = tb.pos[v * 3 + 2] as number;
    tb.setSurf(tb.surf[v * 4] as number);
    return tb.vertex(x, y - skirt, z, [0, 1, 0], [tb.col[v * 3] as number, tb.col[v * 3 + 1] as number, tb.col[v * 3 + 2] as number]);
  });
  for (let k = 0; k < edgeIdx.length; k++) {
    const k2 = (k + 1) % edgeIdx.length;
    const a = edgeIdx[k] as number, b = edgeIdx[k2] as number, c = lower[k2] as number, d = lower[k] as number;
    // Both windings: the skirt is seen from outside on one side and never from inside, so draw it double-sided by emitting both.
    tb.tri(a, b, c);
    tb.tri(a, c, d);
    tb.tri(a, c, b);
    tb.tri(a, d, c);
  }
  const objects: MeshBuffers[] = [tb.build('terrain') as MeshBuffers];

  // ---- massing and roads, reduced to the byte cap when there is one -----------------------------------------------------------
  const massProfile: MesherProfile = { trisPerBuilding: MASS_TRIS, terrainStride: stride, nearStride: stride, roofs: false, parapets: false, equipment: false, skip: null, lodStride: stride };
  const massOrder = unit.massing
    .map((m, i) => {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let k = 0; k < m.ring.length; k += 2) {
        const x = m.ring[k] as number, z = m.ring[k + 1] as number;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      return { i, w: (m.heightDm + 100) * Math.max(1, (maxX - minX) * (maxZ - minZ)) };
    })
    .sort((p, q) => q.w - p.w || p.i - q.i)
    .map((e) => e.i);
  const roadOrder = unit.roads.map((r, i) => ({ i, cls: r.cls })).sort((p, q) => p.cls - q.cls || p.i - q.i).map((e) => e.i);

  const buildMass = (keep: number): { mesh: MeshBuffers | null; buildings: number; maxTris: number } => {
    const mb = new MeshBuilder();
    let buildings = 0;
    let maxTris = 0;
    // Original order among the kept, so the unreduced mesh is the same as before.
    const kept = massOrder.slice(0, keep).sort((p, q) => p - q);
    for (const idx of kept) {
      const m = unit.massing[idx] as (typeof unit.massing)[number];
      const ring: number[] = [];
      for (let i = 0; i < m.ring.length; i += 2) ring.push((m.ring[i] as number) - ox, (m.ring[i + 1] as number) - oz);
      if (ring.length < 6) continue;
      const t = addBuilding(mb, ring, m.baseDm / 10, m.heightDm / 10, { kind: m.kind, roof: 0, palette: m.palette, seed: m.seed }, massProfile, unit.level === 'l2' ? Surf.MassingL2 : Surf.MassingL1);
      buildings++;
      if (t > maxTris) maxTris = t;
    }
    return { mesh: mb.build('massing'), buildings, maxTris };
  };

  const lift = MESHER.lod.roadLiftM;
  const buildRoads = (keep: number): MeshBuffers | null => {
    const rb = new MeshBuilder();
    for (const idx of roadOrder.slice(0, keep).sort((p, q) => p - q)) {
      const r = unit.roads[idx] as (typeof unit.roads)[number];
      const width = MESHER.lod.roadWidthM[String(r.cls)] ?? 8;
      const local = new Float32Array(r.pts.length);
      for (let i = 0; i < r.pts.length; i += 2) {
        local[i] = (r.pts[i] as number) - ox;
        local[i + 1] = (r.pts[i + 1] as number) - oz;
      }
      const dense = densify(local, step / 2);
      const xyz = new Float32Array((dense.length / 2) * 3);
      for (let i = 0; i < dense.length / 2; i++) {
        const x = dense[i * 2] as number, z = dense[i * 2 + 1] as number;
        xyz[i * 3] = x;
        xyz[i * 3 + 1] = surfaceAt(unit.heights, stride, postM, x, z);
        xyz[i * 3 + 2] = z;
      }
      rb.setSurf(roadSurf(r.cls));
      addRibbon(rb, xyz, 0, 0, width, lift, roadColor(r.cls));
    }
    return rb.build('roads');
  };

  const terrain = objects[0] as MeshBuffers;
  const empty = new Float32Array(0);
  // The GPU bytes of the unit: the typed arrays plus the per-vertex cover mask and cell attributes the coarse levels carry (8 B).
  const COVER_ATTR_BYTES = 8;
  const bytesOf = (list: readonly MeshBuffers[]): number => meshBytes(list, empty) + list.reduce((n, o) => n + (o.positions.length / 3) * COVER_ATTR_BYTES, 0);
  const terrainBytes = bytesOf([terrain]);
  let massKeep = unit.massing.length;
  let roadKeep = unit.roads.length;
  let mass = buildMass(massKeep);
  let roads = buildRoads(roadKeep);
  const total = (): number => bytesOf([terrain, ...(mass.mesh ? [mass.mesh] : []), ...(roads ? [roads] : [])]);
  while (maxBytes !== null && total() > maxBytes && (massKeep > 0 || roadKeep > 0)) {
    const used = total() - terrainBytes;
    const scale = Math.min(0.9, Math.max(0.3, (((maxBytes - terrainBytes) / Math.max(1, used)) * 0.95)));
    massKeep = Math.floor(massKeep * scale);
    roadKeep = Math.floor(roadKeep * scale);
    mass = buildMass(massKeep);
    roads = buildRoads(roadKeep);
  }
  if (mass.mesh) objects.push(mass.mesh);
  if (roads) objects.push(roads);
  const buildings = mass.buildings;
  const maxTris = mass.maxTris;

  const stats: MeshStats = { triangles: 0, vertices: 0, buildings, skipped: unit.massing.length - buildings, maxBuildingTris: maxTris, filtered: false, bytes: 0 };
  for (const o of objects) {
    stats.triangles += o.indices.length / 3;
    stats.vertices += o.positions.length / 3;
  }
  const trees = new Float32Array(0);
  const lamps = new Float32Array(0);
  stats.bytes = bytesOf(objects);
  return { level: unit.level, key: unit.key, originX: ox, originZ: oz, objects, trees, lamps, stats, proxies: [], masked: [] };
}
