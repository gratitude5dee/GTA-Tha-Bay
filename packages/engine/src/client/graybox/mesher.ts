import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardNodeMaterial, Uint32BufferAttribute,
} from 'three/webgpu';
import { sampleHeight, TERRAIN_POSTS, type BuildingRecord, type HeightGrid, type RenderChunk, type SimChunk } from '@dv/shared';

/**
 * The gray-box mesher (M01b2): turns the decoded fixture chunks into at most six render objects per chunk, all vertex
 * coloured. It is a placeholder for the real `ChunkRenderer` of M02b1 and reads only C08 data (`SimChunk`, `RenderChunk`).
 *
 * `buildChunkMesh` is pure and returns plain arrays, so the tests count objects and triangles without a GPU. `chunkGroup`
 * wraps them in three objects with one shared TSL node material.
 *
 * Objects per chunk: terrain (a coloured quad per 4 m cell, tinted by ground class), roads (ribbons along the segment
 * centrelines with lane lines), buildings (merged extrusions from the l0 records), trees and lamps.
 */
export const MAX_OBJECTS_PER_CHUNK = 6;

export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export type MeshPart = 'terrain' | 'roads' | 'buildings' | 'trees' | 'lamps';
export interface ChunkMesh {
  key: string;
  parts: Partial<Record<MeshPart, MeshBuffers>>;
}

type Rgb = readonly [number, number, number];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
/** 0xRRGGBB (sRGB) to linear floats, which is what vertex colours are in. */
export function hexToLinear(hex: number): Rgb {
  return [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)];
}
const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

class Builder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  vertex(x: number, y: number, z: number, n: Rgb, c: Rgb): number {
    this.positions.push(x, y, z);
    this.normals.push(n[0], n[1], n[2]);
    this.colors.push(c[0], c[1], c[2]);
    return this.positions.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /** Two triangles over four vertices given in order around the quad; the winding is flipped when it faces away from `up`. */
  quadUp(a: number, b: number, c: number, d: number, up: boolean): void {
    const p = this.positions;
    const ay = (b: number, o: number): number => p[b * 3 + o] as number;
    // y component of (b - a) x (c - a)
    const cross = (ay(b, 2) - ay(a, 2)) * (ay(c, 0) - ay(a, 0)) - (ay(b, 0) - ay(a, 0)) * (ay(c, 2) - ay(a, 2));
    const facesUp = cross > 0;
    if (facesUp === up) {
      this.tri(a, b, c);
      this.tri(a, c, d);
    } else {
      this.tri(a, c, b);
      this.tri(a, d, c);
    }
  }

  /** One triangle, wound to face up or down. */
  triUp(a: number, b: number, c: number, up: boolean): void {
    const p = this.positions;
    const g = (i: number, o: number): number => p[i * 3 + o] as number;
    const cross = (g(b, 2) - g(a, 2)) * (g(c, 0) - g(a, 0)) - (g(b, 0) - g(a, 0)) * (g(c, 2) - g(a, 2));
    if ((cross > 0) === up) this.tri(a, b, c);
    else this.tri(a, c, b);
  }

  build(): MeshBuffers | undefined {
    if (this.indices.length === 0) return undefined;
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
    };
  }
}

const UP: Rgb = [0, 1, 0];

// ---- terrain -------------------------------------------------------------------------------------------------------

/** Ground colours by `GroundClass` (0 Grass ... 11 Rail), sRGB. */
const GROUND_COLORS: readonly number[] = [
  0x6f9d4f, 0x5c9449, 0xd7c58b, 0x9a9ea5, 0x8f7a5a, 0x7b7d80, 0x44474d, 0xb9bbb4, 0x8d7456, 0x5aa2d8, 0x2f6fb5, 0x6c5e55,
];
const GROUND_LINEAR = GROUND_COLORS.map(hexToLinear);

function terrain(h: HeightGrid, ground: Uint8Array): MeshBuffers | undefined {
  const b = new Builder();
  const n = TERRAIN_POSTS;
  const cells = n - 1;
  const cell = h.cellM;
  const at = (col: number, row: number): number => (h.dm[Math.min(n - 1, Math.max(0, row)) * n + Math.min(n - 1, Math.max(0, col))] as number) / 10;
  const normal = (col: number, row: number): Rgb => {
    const nx = (at(col - 1, row) - at(col + 1, row)) / (2 * cell);
    const nz = (at(col, row - 1) - at(col, row + 1)) / (2 * cell);
    const len = Math.hypot(nx, 1, nz);
    return [nx / len, 1 / len, nz / len];
  };
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const cls = ground[row * cells + col] ?? 3;
      const base = GROUND_LINEAR[cls] ?? (GROUND_LINEAR[3] as Rgb);
      // A faint checker every 4 m shows scale and speed on flat ground.
      const col0 = scale(base, (col + row) % 2 === 0 ? 1 : 0.93);
      const x0 = h.originX + col * cell;
      const z0 = h.originZ + row * cell;
      const x1 = x0 + cell;
      const z1 = z0 + cell;
      const a = b.vertex(x0, at(col, row), z0, normal(col, row), col0);
      const bb = b.vertex(x1, at(col + 1, row), z0, normal(col + 1, row), col0);
      const c = b.vertex(x1, at(col + 1, row + 1), z1, normal(col + 1, row + 1), col0);
      const d = b.vertex(x0, at(col, row + 1), z1, normal(col, row + 1), col0);
      b.quadUp(a, bb, c, d, true);
    }
  }
  return b.build();
}

// ---- roads ---------------------------------------------------------------------------------------------------------

/** Terrain height at (x, z), or null outside the chunk's grid (a road segment runs on past the chunk that stores it). */
function heightOrNull(h: HeightGrid, x: number, z: number): number | null {
  const span = h.cellM * (TERRAIN_POSTS - 1);
  if (x < h.originX || x > h.originX + span || z < h.originZ || z > h.originZ + span) return null;
  return sampleHeight(h, x, z);
}

const ROAD_COLOR = hexToLinear(0x2f3238);
const LINE_WHITE = hexToLinear(0xeeeeee);
const LINE_YELLOW = hexToLinear(0xe8b923);
const ROAD_LIFT = 0.1;
const LINE_LIFT = 0.14;

/** A strip of constant width along a polyline of (x, y, z) triples, offset sideways by `offset`, at `lift` above the points. */
function ribbon(b: Builder, pts: Float32Array, width: number, offset: number, lift: number, color: Rgb, h: HeightGrid | null): void {
  const n = pts.length / 3;
  const left: [number, number, number][] = [];
  const right: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    let tx = (pts[i1 * 3] as number) - (pts[i0 * 3] as number);
    let tz = (pts[i1 * 3 + 2] as number) - (pts[i0 * 3 + 2] as number);
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const x = pts[i * 3] as number;
    const z = pts[i * 3 + 2] as number;
    const ground = h ? heightOrNull(h, x, z) : null;
    const y = Math.max(pts[i * 3 + 1] as number, ground ?? -Infinity) + lift;
    const cx = x - tz * offset;
    const cz = z + tx * offset;
    left.push([cx - tz * (width / 2), y, cz + tx * (width / 2)]);
    right.push([cx + tz * (width / 2), y, cz - tx * (width / 2)]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = b.vertex(...(left[i] as [number, number, number]), UP, color);
    const bb = b.vertex(...(right[i] as [number, number, number]), UP, color);
    const c = b.vertex(...(right[i + 1] as [number, number, number]), UP, color);
    const d = b.vertex(...(left[i + 1] as [number, number, number]), UP, color);
    b.quadUp(a, bb, c, d, true);
  }
}

/** Points of the polyline at arc length `from`..`to` (linear interpolation), for dashes. */
function slice(pts: Float32Array, cum: number[], from: number, to: number): Float32Array {
  const out: number[] = [];
  const at = (s: number): [number, number, number] => {
    let i = 1;
    while (i < cum.length - 1 && (cum[i] as number) < s) i++;
    const s0 = cum[i - 1] as number;
    const s1 = cum[i] as number;
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const p = (k: number, o: number): number => pts[k * 3 + o] as number;
    return [p(i - 1, 0) + (p(i, 0) - p(i - 1, 0)) * t, p(i - 1, 1) + (p(i, 1) - p(i - 1, 1)) * t, p(i - 1, 2) + (p(i, 2) - p(i - 1, 2)) * t];
  };
  out.push(...at(from));
  for (let i = 1; i < cum.length - 1; i++) if ((cum[i] as number) > from && (cum[i] as number) < to) out.push(pts[i * 3] as number, pts[i * 3 + 1] as number, pts[i * 3 + 2] as number);
  out.push(...at(to));
  return new Float32Array(out);
}

function roads(c: SimChunk): MeshBuffers | undefined {
  if (c.segments.length === 0) return undefined;
  const b = new Builder();
  for (const seg of c.segments) {
    const pts = seg.pts;
    const n = pts.length / 3;
    if (n < 2) continue;
    ribbon(b, pts, seg.widthM, 0, ROAD_LIFT, ROAD_COLOR, c.height);
    // Centre line: two thin yellow strips.
    ribbon(b, pts, 0.14, 0.14, LINE_LIFT, LINE_YELLOW, c.height);
    ribbon(b, pts, 0.14, -0.14, LINE_LIFT, LINE_YELLOW, c.height);
    // Lane lines: white dashes, one lane (3.5 m) either side of the centre, and solid edge lines inside the parking lane.
    const cum: number[] = [0];
    for (let i = 1; i < n; i++) {
      cum.push((cum[i - 1] as number) + Math.hypot((pts[i * 3] as number) - (pts[i * 3 - 3] as number), (pts[i * 3 + 2] as number) - (pts[i * 3 - 1] as number)));
    }
    const total = cum[n - 1] as number;
    for (let s = 2; s + 3 <= total; s += 8) {
      const dash = slice(pts, cum, s, s + 3);
      ribbon(b, dash, 0.12, 3.5, LINE_LIFT, LINE_WHITE, c.height);
      ribbon(b, dash, 0.12, -3.5, LINE_LIFT, LINE_WHITE, c.height);
    }
    const edge = seg.widthM / 2 - 2.6;
    if (edge > 3.6) {
      ribbon(b, pts, 0.12, edge, LINE_LIFT, LINE_WHITE, c.height);
      ribbon(b, pts, 0.12, -edge, LINE_LIFT, LINE_WHITE, c.height);
    }
  }
  return b.build();
}

// ---- buildings -----------------------------------------------------------------------------------------------------

/** A muted colour from a hue in degrees: saturation 0.35, lightness 0.62. */
function hslHex(hue: number, s = 0.35, l = 0.62): number {
  const k = (n: number): number => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

const ROOF_DARKEN = 0.7;
const FOUNDATION_M = 1.5;

function extrude(b: Builder, ring: readonly [number, number][], base: number, top: number, wall: Rgb): void {
  const n = ring.length;
  if (n < 3) return;
  let cx = 0;
  let cz = 0;
  for (const [x, z] of ring) {
    cx += x;
    cz += z;
  }
  cx /= n;
  cz /= n;
  const low = scale(wall, 0.72);
  for (let i = 0; i < n; i++) {
    let [x0, z0] = ring[i] as [number, number];
    let [x1, z1] = ring[(i + 1) % n] as [number, number];
    // The triangle (bottom a, bottom b, top b) has the geometric normal (-dz, 0, dx) for the edge direction (dx, dz). When that
    // points toward the centroid, walk the edge the other way round so that it points out.
    if (-(z1 - z0) * ((x0 + x1) / 2 - cx) + (x1 - x0) * ((z0 + z1) / 2 - cz) < 0) {
      [x0, z0, x1, z1] = [x1, z1, x0, z0];
    }
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    const nrm: Rgb = [-(z1 - z0) / len, 0, (x1 - x0) / len];
    const a = b.vertex(x0, base - FOUNDATION_M, z0, nrm, low);
    const bb = b.vertex(x1, base - FOUNDATION_M, z1, nrm, low);
    const c = b.vertex(x1, top, z1, nrm, wall);
    const d = b.vertex(x0, top, z0, nrm, wall);
    b.tri(a, bb, c);
    b.tri(a, c, d);
  }
  const roof = scale(wall, ROOF_DARKEN);
  const first = b.vertex((ring[0] as [number, number])[0], top, (ring[0] as [number, number])[1], UP, roof);
  let prev = b.vertex((ring[1] as [number, number])[0], top, (ring[1] as [number, number])[1], UP, roof);
  for (let i = 2; i < n; i++) {
    const cur = b.vertex((ring[i] as [number, number])[0], top, (ring[i] as [number, number])[1], UP, roof);
    b.triUp(first, prev, cur, true);
    prev = cur;
  }
}

function buildings(c: SimChunk, r: RenderChunk | null): MeshBuffers | undefined {
  if (!r || r.buildings.length === 0) return undefined;
  const b = new Builder();
  const ox = r.height.originX;
  const oz = r.height.originZ;
  r.buildings.forEach((rec: BuildingRecord, index) => {
    const ring: [number, number][] = [];
    for (let i = 0; i + 1 < rec.ring.length; i += 2) ring.push([ox + (rec.ring[i] as number) / 10, oz + (rec.ring[i + 1] as number) / 10]);
    const hue = ((rec.seed * 47 + index * 83 + rec.kind * 31) % 360 + 360) % 360;
    extrude(b, ring, rec.baseDm / 10, (rec.baseDm + rec.heightDm) / 10, hexToLinear(hslHex(hue)));
  });
  void c;
  return b.build();
}

// ---- trees and lamps -----------------------------------------------------------------------------------------------

function ringPoints(cx: number, cz: number, radius: number, sides: number, phase = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    out.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius]);
  }
  return out;
}

/** A prism (a ring extruded from y0 to y1), side faces only plus a top cap. */
function column(b: Builder, cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, sides: number, color: Rgb): void {
  const bottom = ringPoints(cx, cz, r0, sides);
  const topRing = ringPoints(cx, cz, r1, sides);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const mx = ((bottom[i] as [number, number])[0] + (bottom[j] as [number, number])[0]) / 2 - cx;
    const mz = ((bottom[i] as [number, number])[1] + (bottom[j] as [number, number])[1]) / 2 - cz;
    const l = Math.hypot(mx, mz) || 1;
    const nrm: Rgb = [mx / l, 0, mz / l];
    const a = b.vertex((bottom[i] as [number, number])[0], y0, (bottom[i] as [number, number])[1], nrm, color);
    const bb = b.vertex((bottom[j] as [number, number])[0], y0, (bottom[j] as [number, number])[1], nrm, color);
    const c = b.vertex((topRing[j] as [number, number])[0], y1, (topRing[j] as [number, number])[1], nrm, color);
    const d = b.vertex((topRing[i] as [number, number])[0], y1, (topRing[i] as [number, number])[1], nrm, color);
    // Ring points run counter-clockwise in (x, z); the outward-facing winding is a, c, bb / a, d, c.
    b.tri(a, c, bb);
    b.tri(a, d, c);
  }
}

const TRUNK = hexToLinear(0x6b4a2f);
const LEAF_COLORS = [0x3f7f3a, 0x4a8f3f, 0x356f35, 0x5a9a45].map(hexToLinear);

function trees(c: SimChunk, r: RenderChunk | null): MeshBuffers | undefined {
  if (!r || r.trees.length === 0) return undefined;
  const b = new Builder();
  for (let i = 0; i + 3 < r.trees.length; i += 4) {
    const x = r.trees[i] as number;
    const z = r.trees[i + 1] as number;
    const s = r.trees[i + 2] as number || 1;
    const species = r.trees[i + 3] as number;
    const y = sampleHeight(c.height, x, z);
    column(b, x, z, y - 0.2, y + 2.6 * s, 0.22 * s, 0.16 * s, 6, TRUNK);
    const leaf = LEAF_COLORS[species % LEAF_COLORS.length] as Rgb;
    column(b, x, z, y + 2.0 * s, y + 4.4 * s, 1.7 * s, 1.0 * s, 8, leaf);
    column(b, x, z, y + 4.2 * s, y + 6.2 * s, 1.2 * s, 0.05 * s, 8, scale(leaf, 1.12));
  }
  return b.build();
}

const POLE = hexToLinear(0x585d66);
const LAMP_HEAD = hexToLinear(0xfff2b0);

function lamps(c: SimChunk, r: RenderChunk | null): MeshBuffers | undefined {
  if (!r || r.lamps.length === 0) return undefined;
  const b = new Builder();
  for (let i = 0; i + 2 < r.lamps.length; i += 3) {
    const x = r.lamps[i] as number;
    const z = r.lamps[i + 1] as number;
    const yaw = r.lamps[i + 2] as number;
    const y = sampleHeight(c.height, x, z);
    column(b, x, z, y, y + 6.5, 0.1, 0.07, 6, POLE);
    // The head hangs 0.8 m off the pole toward the heading.
    const hx = x - Math.sin(yaw) * 0.8;
    const hz = z - Math.cos(yaw) * 0.8;
    column(b, hx, hz, y + 6.3, y + 6.6, 0.28, 0.22, 6, LAMP_HEAD);
  }
  return b.build();
}

// ---- entry points --------------------------------------------------------------------------------------------------

/** Pure: the buffers of one chunk. `render` may be null (sim-only chunk): then only terrain and roads exist. */
export function buildChunkMesh(sim: SimChunk, render: RenderChunk | null): ChunkMesh {
  const parts: Partial<Record<MeshPart, MeshBuffers>> = {};
  const set = (name: MeshPart, v: MeshBuffers | undefined): void => {
    if (v) parts[name] = v;
  };
  set('terrain', terrain(sim.height, sim.ground));
  set('roads', roads(sim));
  set('buildings', buildings(sim, render));
  set('trees', trees(sim, render));
  set('lamps', lamps(sim, render));
  return { key: sim.key, parts };
}

export const meshObjectCount = (m: ChunkMesh): number => Object.keys(m.parts).length;
export const meshTriangleCount = (m: ChunkMesh): number => Object.values(m.parts).reduce((a, p) => a + p.indices.length / 3, 0);

/** The one TSL node material of the gray-box: vertex colours, matte, double sided (the walls are single quads). */
export function createGrayboxMaterial(): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: DoubleSide });
}

/** The three objects of a chunk: one `Group` holding one `Mesh` per non-empty part. */
export function chunkGroup(mesh: ChunkMesh, material: MeshStandardNodeMaterial): Group {
  const group = new Group();
  group.name = `graybox:${mesh.key}`;
  for (const [name, buf] of Object.entries(mesh.parts) as [MeshPart, MeshBuffers][]) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(buf.positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(buf.normals, 3));
    g.setAttribute('color', new Float32BufferAttribute(buf.colors, 3));
    g.setIndex(new Uint32BufferAttribute(buf.indices, 1));
    g.computeBoundingSphere();
    const m = new Mesh(g, material);
    m.name = `${mesh.key}:${name}`;
    group.add(m);
  }
  return group;
}

export function disposeGroup(group: Group): void {
  for (const child of group.children) (child as Mesh).geometry?.dispose();
}
