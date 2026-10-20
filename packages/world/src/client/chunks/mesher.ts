/**
 * The L0 mesher (02-world.md section 5.2 rule 4, 02-world-bake.md section 6; M02b1). Turns a decoded chunk (`SimChunk` for
 * the heightfield, ground classes and road segments, `RenderChunk` for the footprints and trees) into at most six render
 * objects: `terrain`, `buildings`, `roads` and `vegetation` (the tree instances); `furniture` and `extras` stay empty until their
 * milestones. It imports nothing from `three`, so it runs in asset.worker, and it is deterministic: the same chunk and options
 * give the same bytes.
 *
 *  - terrain: every 1st / 2nd / 4th post (desktop / mobile / mobile-low), so every vertex lies on the physics surface, with the
 *    colour of the ground class and the height gradient as normal;
 *  - buildings: walls with the 1.5 m foundation skirt, flat roofs triangulated by earcut (a parapet rim on the profiles that
 *    have one), gable and hip roofs on four-corner footprints, a rooftop box on commercial towers; the triangle count of one
 *    building never exceeds the profile (rings are simplified down to fit); baked vertex AO (`ao`) from the height above the
 *    foundation;
 *  - roads: ribbons along the `p0` segment centrelines, lifted 0.12 m, at the carriageway width;
 *  - trees: one instance record per tree (x, y, z, scale, species), drawn as one instanced mesh.
 *
 * Positions are local to the chunk's north-west corner (`x`, `z`), with `y` absolute, so a float32 position keeps its precision
 * 10 km from the origin.
 */
import earcut from 'earcut';
import {
  TERRAIN_POSTS, chunkBounds, sampleHeight, type BuildingRecord, type ChunkKey, type QualityTierId, type RenderChunk, type SimChunk,
} from '@dv/shared';
import mesherJson from '../../../../../config/world/mesher.json';
import { facadeClassOf, lookProfileFor } from '../look/config.ts';
import { FLAG_PARAPET, Surf, facadeDm, groundSurf, roadSurf, roofSurf, wallSurf } from '../look/surfaces.ts';
import { meshBytes, type MeshBuffers, type MeshStats, type UnitMesh } from './mesh-types.ts';

// ---- configuration -------------------------------------------------------------------------------------------------------

export type ProfileId = 'desktop' | 'visionpro' | 'mobile' | 'low';
export interface MesherProfile {
  trisPerBuilding: number;
  terrainStride: 1 | 2 | 4;
  roofs: boolean;
  parapets: boolean;
  equipment: boolean;
  skip: { minAreaM2: number; maxHeightM: number | null; beyondM: number } | null;
  lodStride: 1 | 2 | 4;
}
export interface MesherConfig {
  tierProfile: Record<QualityTierId, ProfileId>;
  profiles: Record<ProfileId, MesherProfile>;
  foundationM: number;
  parapetM: number;
  roofLiftMaxM: number;
  palette: string[];
  kindTint: Record<string, number>;
  roofColor: string;
  ground: string[];
  road: Record<string, string>;
  landuse: Record<string, string>;
  tree: { trunk: string; leaves: string[] };
  lod: { skirtM: number; roadWidthM: Record<string, number>; roadLiftM: number; waterLevelM: number; massingRoof: string };
}
export const MESHER: MesherConfig = mesherJson as unknown as MesherConfig;

export type Rgb = readonly [number, number, number];
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** `#rrggbb` (sRGB) to linear floats, which is what vertex colours are in. */
export function hexToLinear(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}
const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const PALETTE: readonly Rgb[] = MESHER.palette.map(hexToLinear);
export const GROUND: readonly Rgb[] = MESHER.ground.map(hexToLinear);
export const ROOF: Rgb = hexToLinear(MESHER.roofColor);
const ROAD_COLORS = {
  freeway: hexToLinear(MESHER.road['freeway'] as string),
  ramp: hexToLinear(MESHER.road['ramp'] as string),
  arterial: hexToLinear(MESHER.road['arterial'] as string),
  local: hexToLinear(MESHER.road['local'] as string),
  service: hexToLinear(MESHER.road['service'] as string),
};
export const roadColor = (cls: number): Rgb =>
  cls === 0 ? ROAD_COLORS.freeway : cls === 1 ? ROAD_COLORS.ramp : cls === 2 ? ROAD_COLORS.arterial : cls === 5 ? ROAD_COLORS.service : ROAD_COLORS.local;

export function profileOf(tier: QualityTierId): { id: ProfileId; profile: MesherProfile } {
  const id = MESHER.tierProfile[tier];
  return { id, profile: MESHER.profiles[id] };
}

// ---- buffers -------------------------------------------------------------------------------------------------------------

export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly ao: number[] = [];
  readonly idx: number[] = [];
  /** M02e: surface id, palette index, kind/roof code, flags per vertex. */
  readonly surf: number[] = [];
  /** M02e: `Int16x4` per vertex (decimetres); only when the builder was made with `facade`. */
  readonly fac: number[] | null;
  private cur: [number, number, number, number] = [Surf.GroundBase + 3, 0, 0, 0];

  constructor(o: { facade?: boolean } = {}) {
    this.fac = o.facade ? [] : null;
  }

  /** The surface the next vertices belong to: id (look/surfaces.ts), palette index, kind/roof code, flags. */
  setSurf(id: number, palette = 0, code = 0, flags = 0): void {
    this.cur = [id, palette & 255, code & 255, flags & 255];
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** `fac` is the building vertex's `facade` record in decimetres (u, v, wall height, seed); zeros when absent. */
  vertex(x: number, y: number, z: number, n: Rgb, c: Rgb, ao = 1, fac?: readonly [number, number, number, number]): number {
    this.pos.push(x, y, z);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.ao.push(ao);
    this.surf.push(this.cur[0], this.cur[1], this.cur[2], this.cur[3]);
    if (this.fac) {
      if (fac) this.fac.push(fac[0], fac[1], fac[2], fac[3]);
      else this.fac.push(0, 0, 0, 0);
    }
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** A triangle wound so that its geometric normal points up (`up`) or down. */
  triUp(a: number, b: number, c: number, up = true): void {
    const g = (i: number, o: number): number => this.pos[i * 3 + o] as number;
    const cross = (g(b, 2) - g(a, 2)) * (g(c, 0) - g(a, 0)) - (g(b, 0) - g(a, 0)) * (g(c, 2) - g(a, 2));
    if ((cross > 0) === up) this.tri(a, b, c);
    else this.tri(a, c, b);
  }

  /** Two triangles over four vertices given in order around the quad, facing up. */
  quadUp(a: number, b: number, c: number, d: number): void {
    this.triUp(a, b, c);
    this.triUp(a, c, d);
  }

  build(kind: MeshBuffers['kind']): MeshBuffers | null {
    if (this.idx.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.pos.length; i += 3) {
      const x = this.pos[i] as number, y = this.pos[i + 1] as number, z = this.pos[i + 2] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const big = this.vertexCount > 65535;
    return {
      kind,
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      colors: new Float32Array(this.col),
      ao: new Float32Array(this.ao),
      indices: big ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
      surf: new Uint8Array(this.surf),
      ...(this.fac ? { facade: new Int16Array(this.fac) } : {}),
      bounds: [minX, minY, minZ, maxX, maxY, maxZ],
    };
  }
}

const UP: Rgb = [0, 1, 0];

// ---- terrain -------------------------------------------------------------------------------------------------------------

/** The terrain of a 65 x 65 grid at every `stride`-th post, local to (originX, originZ). Vertices are on the posts. */
export function terrainMesh(heights: Int16Array, ground: Uint8Array, cellM: number, stride: 1 | 2 | 4): MeshBuffers {
  const n = TERRAIN_POSTS;
  const verts = (n - 1) / stride + 1;
  const b = new MeshBuilder();
  const h = (col: number, row: number): number => (heights[Math.min(n - 1, Math.max(0, row)) * n + Math.min(n - 1, Math.max(0, col))] as number) / 10;
  for (let j = 0; j < verts; j++) {
    for (let i = 0; i < verts; i++) {
      const col = i * stride;
      const row = j * stride;
      const nx = (h(col - stride, row) - h(col + stride, row)) / (2 * stride * cellM);
      const nz = (h(col, row - stride) - h(col, row + stride)) / (2 * stride * cellM);
      const len = Math.sqrt(nx * nx + 1 + nz * nz);
      const cls = ground[Math.min(63, row + (stride >> 1)) * 64 + Math.min(63, col + (stride >> 1))] ?? 3;
      const color = GROUND[cls] ?? (GROUND[3] as Rgb);
      b.setSurf(groundSurf(cls));
      b.vertex(col * cellM, h(col, row), row * cellM, [nx / len, 1 / len, nz / len], color);
    }
  }
  for (let j = 0; j < verts - 1; j++) {
    for (let i = 0; i < verts - 1; i++) {
      const a = j * verts + i;
      b.triUp(a, a + verts, a + 1, true);
      b.triUp(a + 1, a + verts, a + verts + 1, true);
    }
  }
  return b.build('terrain') as MeshBuffers;
}

// ---- footprints ----------------------------------------------------------------------------------------------------------

export function signedArea(pts: readonly number[]): number {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (pts[i * 2] as number) * (pts[j * 2 + 1] as number) - (pts[j * 2] as number) * (pts[i * 2 + 1] as number);
  }
  return a / 2;
}

/** Removes the vertex whose triangle with its two neighbours has the smallest area until `target` remain (Visvalingam). */
export function simplifyRing(pts: number[], target: number): number[] {
  const out = pts.slice();
  while (out.length / 2 > Math.max(3, target)) {
    const n = out.length / 2;
    let best = 0;
    let bestArea = Infinity;
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n;
      const c = (i + 1) % n;
      const area = Math.abs(((out[i * 2] as number) - (out[a * 2] as number)) * ((out[c * 2 + 1] as number) - (out[a * 2 + 1] as number)) - ((out[c * 2] as number) - (out[a * 2] as number)) * ((out[i * 2 + 1] as number) - (out[a * 2 + 1] as number)));
      if (area < bestArea) {
        bestArea = area;
        best = i;
      }
    }
    out.splice(best * 2, 2);
  }
  return out;
}

function pointInRing(pts: readonly number[], x: number, z: number): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2] as number, zi = pts[i * 2 + 1] as number, xj = pts[j * 2] as number, zj = pts[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Cheap per-building hash in [0, 1) from the record's seed and kind. */
const jitter = (seed: number, salt: number): number => (((seed * 2654435761 + salt * 40503) >>> 0) % 1000) / 1000;

const AO_BASE = 0.55;

export interface BuildingStats {
  triangles: number;
}

/**
 * Meshes one building into `b` and returns its triangle count. `pts` is the footprint (local x, z pairs, counter-clockwise after
 * the call), `base` the foundation-free ground height, `height` the wall height. The count never exceeds `maxTris`.
 */
export function addBuilding(
  b: MeshBuilder, ringIn: number[], base: number, height: number, rec: Pick<BuildingRecord, 'kind' | 'roof' | 'palette' | 'seed'>, profile: MesherProfile,
  /** The coarse levels draw every vertex of the footprint as one surface (the massing of an L1 or L2 unit). */
  surfOverride?: number,
): number {
  let ring = ringIn.slice();
  if (signedArea(ring) < 0) {
    const rev: number[] = [];
    for (let i = ring.length / 2 - 1; i >= 0; i--) rev.push(ring[i * 2] as number, ring[i * 2 + 1] as number);
    ring = rev;
  }
  const max = profile.trisPerBuilding;
  const pitchedAllowed = profile.roofs && (rec.roof === 1 || rec.roof === 2);
  let n = ring.length / 2;
  // A pitched roof needs a four-corner footprint; everything else is flat and costs 3n - 2 triangles.
  if (n > 4 || !pitchedAllowed) {
    const cap = Math.floor((max + 2) / 3);
    if (n > cap) {
      ring = simplifyRing(ring, cap);
      n = ring.length / 2;
    }
  }
  const pitched = pitchedAllowed && n === 4;
  const wallTris = 2 * n;
  const roofTris = pitched ? 6 : n - 2;
  let tris = wallTris + roofTris;
  const tower = rec.kind === 3 || rec.kind === 2;
  const equipment = profile.equipment && !pitched && tower && tris + 10 <= max;
  if (equipment) tris += 10;
  const parapet = !pitched && profile.parapets && rec.kind !== 0;

  const tint = (MESHER.kindTint[String(rec.kind)] ?? 1) * (0.94 + 0.12 * jitter(rec.seed, 1));
  const wall = scale(PALETTE[rec.palette % PALETTE.length] as Rgb, tint);
  const roofColor = mix(scale(wall, 0.62), scale(ROOF, 0.8 + 0.4 * jitter(rec.seed, 2)), 0.5);
  const foundation = MESHER.foundationM;
  const eave = base + height;
  const wallTop = parapet ? eave + MESHER.parapetM : eave;

  // M02e: the facade record (decimetres): u along the wall from its start, stretched to a whole number of bays so a wall ends on a
  // pier; v above the foot of the foundation skirt (the shader subtracts `foundationM`, so the ground floor starts at the ground
  // without a second vertex row); the wall height from the same foot (v of the top edge); the seed (BD-M02E-01).
  const withFacade = b.fac !== null;
  const bayM = withFacade ? facadeClassOf(rec.kind).bayM : 1;
  const wallH = wallTop - (base - foundation);
  const wallHdm = facadeDm(wallH);
  const seed15 = rec.seed & 0x7fff;
  const code = (rec.kind & 15) | ((rec.roof & 3) << 4);

  // Walls: outward normal (dz, 0, -dx) for a counter-clockwise ring in (x, z).
  b.setSurf(surfOverride ?? wallSurf(rec.kind), rec.palette, code, parapet ? FLAG_PARAPET : 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = ring[i * 2] as number, z0 = ring[i * 2 + 1] as number, x1 = ring[j * 2] as number, z1 = ring[j * 2 + 1] as number;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nrm: Rgb = [dz / len, 0, -dx / len];
    const uEnd = facadeDm(withFacade ? Math.max(1, Math.round(len / bayM)) * bayM : len);
    const v0 = b.vertex(x0, base - foundation, z0, nrm, scale(wall, 0.72), AO_BASE, [0, 0, wallHdm, seed15]);
    const v1 = b.vertex(x1, base - foundation, z1, nrm, scale(wall, 0.72), AO_BASE, [uEnd, 0, wallHdm, seed15]);
    const v2 = b.vertex(x1, wallTop, z1, nrm, wall, 1, [uEnd, wallHdm, wallHdm, seed15]);
    const v3 = b.vertex(x0, wallTop, z0, nrm, wall, 1, [0, wallHdm, wallHdm, seed15]);
    b.tri(v0, v2, v1);
    b.tri(v0, v3, v2);
  }
  // Roof vertices: no wall coordinates, the height above the base and the seed.
  b.setSurf(surfOverride ?? roofSurf(pitched ? rec.roof : 0), rec.palette, code, 0);
  const roofFac = (y: number): [number, number, number, number] => [0, facadeDm(y - (base - foundation)), wallHdm, seed15];

  if (pitched) {
    // Ridge along the long axis, through the midpoints of the two short edges.
    const px = (k: number): number => ring[k * 2] as number;
    const pz = (k: number): number => ring[k * 2 + 1] as number;
    const l01 = Math.hypot(px(1) - px(0), pz(1) - pz(0));
    const l12 = Math.hypot(px(2) - px(1), pz(2) - pz(1));
    // Rotate so that edges 0-1 and 2-3 are the long ones.
    const r = l01 >= l12 ? 0 : 1;
    const q = (k: number): [number, number] => [px((k + r) % 4), pz((k + r) % 4)];
    const [p0x, p0z] = q(0), [p1x, p1z] = q(1), [p2x, p2z] = q(2), [p3x, p3z] = q(3);
    const short = Math.min(l01, l12);
    const lift = Math.min(MESHER.roofLiftMaxM, 0.3 * short);
    const topY = eave + lift;
    // Ridge ends: midpoints of the short edges 1-2 (B) and 3-0 (A); a hip pulls them in by half the short side.
    let ax = (p3x + p0x) / 2, az = (p3z + p0z) / 2, bx = (p1x + p2x) / 2, bz = (p1z + p2z) / 2;
    if (rec.roof === 2) {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const inset = Math.min(short / 2, len / 2 - 0.05);
      ax += (dx / len) * inset; az += (dz / len) * inset; bx -= (dx / len) * inset; bz -= (dz / len) * inset;
    }
    let cx = 0, cz = 0;
    for (let k = 0; k < 4; k++) { cx += px(k); cz += pz(k); }
    cx /= 4; cz /= 4;
    // One roof face: its normal points away from the building centre, and the triangles are wound to agree with it.
    const face = (pts: [number, number, number][]): void => {
      const [a, bb, c] = pts as [[number, number, number], [number, number, number], [number, number, number]];
      let nx = (bb[1] - a[1]) * (c[2] - a[2]) - (bb[2] - a[2]) * (c[1] - a[1]);
      let ny = (bb[2] - a[2]) * (c[0] - a[0]) - (bb[0] - a[0]) * (c[2] - a[2]);
      let nz = (bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0]);
      let fx = 0, fz = 0;
      for (const p of pts) { fx += p[0]; fz += p[2]; }
      fx = fx / pts.length - cx;
      fz = fz / pts.length - cz;
      // Outward: away from the centre in plan; a sloped face also points up.
      if (nx * fx + nz * fz < 0 || (Math.abs(nx * fx + nz * fz) < 1e-9 && ny < 0)) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const nrm: Rgb = [nx / l, ny / l, nz / l];
      const ids = pts.map((p) => b.vertex(p[0], p[1], p[2], nrm, roofColor, 0.95, roofFac(p[1])));
      const g = (i: number, o: number): number => b.pos[(ids[i] as number) * 3 + o] as number;
      for (let k = 1; k < ids.length - 1; k++) {
        const ux = g(k, 0) - g(0, 0), uy = g(k, 1) - g(0, 1), uz = g(k, 2) - g(0, 2);
        const vx = g(k + 1, 0) - g(0, 0), vy = g(k + 1, 1) - g(0, 1), vz = g(k + 1, 2) - g(0, 2);
        const dot = (uy * vz - uz * vy) * nrm[0] + (uz * vx - ux * vz) * nrm[1] + (ux * vy - uy * vx) * nrm[2];
        if (dot >= 0) b.tri(ids[0] as number, ids[k] as number, ids[k + 1] as number);
        else b.tri(ids[0] as number, ids[k + 1] as number, ids[k] as number);
      }
    };
    const ridgeA: [number, number, number] = [ax, topY, az];
    const ridgeB: [number, number, number] = [bx, topY, bz];
    face([[p0x, eave, p0z], [p1x, eave, p1z], ridgeB, ridgeA]);
    face([[p2x, eave, p2z], [p3x, eave, p3z], ridgeA, ridgeB]);
    face([[p1x, eave, p1z], [p2x, eave, p2z], ridgeB]);
    face([[p3x, eave, p3z], [p0x, eave, p0z], ridgeA]);
    return tris;
  }

  const idx = earcut(ring);
  const first = b.vertexCount;
  for (let i = 0; i < n; i++) b.vertex(ring[i * 2] as number, eave, ring[i * 2 + 1] as number, UP, roofColor, 1, roofFac(eave));
  let emitted = 0;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    b.triUp(first + (idx[i] as number), first + (idx[i + 1] as number), first + (idx[i + 2] as number), true);
    emitted++;
  }
  // earcut can return fewer triangles than n - 2 for a degenerate ring: the count is what was emitted.
  tris = wallTris + emitted + (equipment ? 10 : 0);

  if (equipment) {
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += ring[i * 2] as number; cz += ring[i * 2 + 1] as number; }
    cx /= n; cz /= n;
    if (pointInRing(ring, cx, cz) && pointInRing(ring, cx + 1.6, cz + 1.2) && pointInRing(ring, cx - 1.6, cz - 1.2)) {
      b.setSurf(surfOverride ?? Surf.Equipment, rec.palette, code, 0);
      box(b, cx, cz, eave, 2.4, 1.6, 1.8, scale(roofColor, 0.9));
    } else {
      tris -= 10;
    }
  }
  return tris;
}

/** An axis-aligned box standing on y0 (five faces, 10 triangles). */
function box(b: MeshBuilder, cx: number, cz: number, y0: number, w: number, d: number, h: number, color: Rgb): void {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
  const quad = (a: [number, number, number], bb: [number, number, number], c: [number, number, number], dd: [number, number, number], n: Rgb): void => {
    const ids = [a, bb, c, dd].map((p) => b.vertex(p[0], p[1], p[2], n, color, 0.9));
    // Wound so the geometric normal agrees with n.
    const g = (i: number, o: number): number => b.pos[(ids[i] as number) * 3 + o] as number;
    const ux = g(1, 0) - g(0, 0), uy = g(1, 1) - g(0, 1), uz = g(1, 2) - g(0, 2);
    const vx = g(2, 0) - g(0, 0), vy = g(2, 1) - g(0, 1), vz = g(2, 2) - g(0, 2);
    const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (dot > 0) { b.tri(ids[0] as number, ids[1] as number, ids[2] as number); b.tri(ids[0] as number, ids[2] as number, ids[3] as number); }
    else { b.tri(ids[0] as number, ids[2] as number, ids[1] as number); b.tri(ids[0] as number, ids[3] as number, ids[2] as number); }
  };
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
}

// ---- roads ---------------------------------------------------------------------------------------------------------------

const ROAD_LIFT_M = 0.12;

/** A ribbon of constant width along a polyline of (x, y, z) triples, local to (ox, oz). */
export function addRibbon(b: MeshBuilder, pts: Float32Array, ox: number, oz: number, width: number, lift: number, color: Rgb): void {
  const n = pts.length / 3;
  if (n < 2) return;
  const left: [number, number, number][] = [];
  const right: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let tx = (pts[i1 * 3] as number) - (pts[i0 * 3] as number);
    let tz = (pts[i1 * 3 + 2] as number) - (pts[i0 * 3 + 2] as number);
    const len = Math.sqrt(tx * tx + tz * tz) || 1;
    tx /= len;
    tz /= len;
    const x = (pts[i * 3] as number) - ox, z = (pts[i * 3 + 2] as number) - oz, y = (pts[i * 3 + 1] as number) + lift;
    left.push([x - tz * (width / 2), y, z + tx * (width / 2)]);
    right.push([x + tz * (width / 2), y, z - tx * (width / 2)]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = b.vertex(...(left[i] as [number, number, number]), UP, color);
    const bb = b.vertex(...(right[i] as [number, number, number]), UP, color);
    const c = b.vertex(...(right[i + 1] as [number, number, number]), UP, color);
    const d = b.vertex(...(left[i + 1] as [number, number, number]), UP, color);
    b.quadUp(a, bb, c, d);
  }
}

// ---- the chunk -----------------------------------------------------------------------------------------------------------

export interface MeshChunkOptions {
  tier: QualityTierId;
  /** Distance of the chunk centre from the stream focus when the job was requested (the profile's skip rule reads it). */
  distM: number;
  /** The upload cap of the tier (C13 `maxChunkUploadBytes`): a chunk over it drops its smallest buildings until it fits. */
  maxBytes?: number | null;
  /**
   * M02d1: `proxyOf` values (landmark index + 1) whose baked extrusions are left out because the landmark's glTF stands in their
   * place (`proxy-mask.ts`). Empty or absent: every proxy footprint is meshed as an ordinary building.
   */
  maskProxies?: readonly number[] | undefined;
}

/**
 * Meshes one L0 chunk. `render` may be null for a chunk that has a `p0` record but no `l0` (terrain and roads only).
 */
export function meshChunk(sim: SimChunk, render: RenderChunk | null, o: MeshChunkOptions): UnitMesh {
  const { profile } = profileOf(o.tier);
  const bounds = chunkBounds(sim.key);
  const ox = bounds.minX;
  const oz = bounds.minZ;
  const objects: MeshBuffers[] = [];

  objects.push(terrainMesh(sim.height.dm, sim.ground, sim.height.cellM, profile.terrainStride));

  const stats: MeshStats = { triangles: 0, vertices: 0, buildings: 0, skipped: 0, maxBuildingTris: 0, filtered: false, bytes: 0 };
  interface Candidate { idx: number; rec: BuildingRecord; ring: number[]; area: number; height: number }
  const candidates: Candidate[] = [];
  const proxies = new Set<number>();
  const masked = new Set<number>();
  const mask = o.maskProxies && o.maskProxies.length > 0 ? new Set(o.maskProxies) : null;
  if (render && render.buildings.length > 0) {
    const skip = profile.skip && o.distM > profile.skip.beyondM ? profile.skip : null;
    if (skip) stats.filtered = true;
    render.buildings.forEach((rec, idx) => {
      if (rec.proxyOf > 0) {
        proxies.add(rec.proxyOf);
        if (mask?.has(rec.proxyOf)) {
          masked.add(rec.proxyOf);
          return;
        }
      }
      const ring: number[] = [];
      for (let i = 0; i + 1 < rec.ring.length; i += 2) ring.push((rec.ring[i] as number) / 10, (rec.ring[i + 1] as number) / 10);
      if (ring.length < 6) return;
      const height = rec.heightDm / 10;
      const area = Math.abs(signedArea(ring));
      if (skip && area < skip.minAreaM2 && (skip.maxHeightM === null || height < skip.maxHeightM)) {
        stats.skipped++;
        return;
      }
      candidates.push({ idx, rec, ring, area, height });
    });
  }
  // M02e: the facade record rides on the building vertices unless the tier's look is `legacy`.
  const withFacade = lookProfileFor(o.tier) !== 'legacy';
  const meshBuildings = (list: readonly Candidate[]): { built: MeshBuffers | null; maxTris: number } => {
    const bb = new MeshBuilder({ facade: withFacade });
    let maxTris = 0;
    for (const c of list) {
      const t = addBuilding(bb, c.ring, c.rec.baseDm / 10, c.height, c.rec, profile);
      if (t > maxTris) maxTris = t;
    }
    return { built: bb.build('buildings'), maxTris };
  };
  let kept: readonly Candidate[] = candidates;
  let b0 = meshBuildings(kept);
  const trees = treeRecords(sim, render, ox, oz);
  const bytesOf = (): number => meshBytes(b0.built ? [...objects, b0.built] : objects, trees);
  for (let pass = 0; pass < 6 && o.maxBytes && bytesOf() > o.maxBytes && kept.length > 1; pass++) {
    // Over the tier's upload cap: keep the largest footprints that fit.
    const ratio = Math.max(0.05, (o.maxBytes / bytesOf()) * 0.9);
    const bySize = [...candidates].sort((a, b) => b.area - a.area || a.idx - b.idx);
    kept = bySize.slice(0, Math.max(1, Math.floor(bySize.length * ratio))).sort((a, b) => a.idx - b.idx);
    b0 = meshBuildings(kept);
  }
  stats.buildings = kept.length;
  stats.skipped += candidates.length - kept.length;
  stats.maxBuildingTris = b0.maxTris;
  if (b0.built) objects.push(b0.built);

  if (sim.segments.length > 0) {
    const clsOf = new Map<number, number>();
    for (const e of sim.edges) if (!clsOf.has(e.seg)) clsOf.set(e.seg, e.cls);
    const rb = new MeshBuilder();
    for (const seg of sim.segments) {
      const cls = clsOf.get(seg.id) ?? 4;
      rb.setSurf(roadSurf(cls));
      addRibbon(rb, seg.pts, ox, oz, seg.widthM, ROAD_LIFT_M, roadColor(cls));
    }
    const built = rb.build('roads');
    if (built) objects.push(built);
  }

  for (const obj of objects) {
    stats.triangles += obj.indices.length / 3;
    stats.vertices += obj.positions.length / 3;
  }
  stats.bytes = meshBytes(objects, trees);
  const sorted = (set: ReadonlySet<number>): number[] => [...set].sort((a, b) => a - b);
  return {
    level: 'l0', key: sim.key as ChunkKey, originX: ox, originZ: oz, objects, trees, lamps: lampRecords(sim, render, ox, oz), stats,
    proxies: sorted(proxies), masked: sorted(masked),
  };
}

function treeRecords(sim: SimChunk, render: RenderChunk | null, ox: number, oz: number): Float32Array {
  if (!render || render.trees.length < 4) return new Float32Array(0);
  const count = Math.floor(render.trees.length / 4);
  const trees = new Float32Array(count * 5);
  for (let i = 0; i < count; i++) {
    const x = render.trees[i * 4] as number, z = render.trees[i * 4 + 1] as number;
    const lx = Math.min(256, Math.max(0, x - ox)), lz = Math.min(256, Math.max(0, z - oz));
    trees[i * 5] = lx;
    trees[i * 5 + 1] = sampleHeight(sim.height, ox + lx, oz + lz);
    trees[i * 5 + 2] = lz;
    trees[i * 5 + 3] = (render.trees[i * 4 + 2] as number) || 1;
    trees[i * 5 + 4] = render.trees[i * 4 + 3] as number;
  }
  return trees;
}

/** The baked lamp records as local x, y, z triples, y on the terrain. */
function lampRecords(sim: SimChunk, render: RenderChunk | null, ox: number, oz: number): Float32Array {
  if (!render || render.lamps.length < 3) return new Float32Array(0);
  const count = Math.floor(render.lamps.length / 3);
  const lamps = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const lx = Math.min(256, Math.max(0, (render.lamps[i * 3] as number) - ox)), lz = Math.min(256, Math.max(0, (render.lamps[i * 3 + 1] as number) - oz));
    lamps[i * 3] = lx;
    lamps[i * 3 + 1] = sampleHeight(sim.height, ox + lx, oz + lz);
    lamps[i * 3 + 2] = lz;
  }
  return lamps;
}

/** Render objects of a chunk mesh as the renderer counts them: the mesh objects plus the instanced vegetation. */
export const objectCountOf = (m: UnitMesh): number => m.objects.length + (m.trees.length > 0 ? 1 : 0);
