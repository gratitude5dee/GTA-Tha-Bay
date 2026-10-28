/**
 * The backdrop geometry (02-world-maps.md section 4.3, R-MAP-02; M02b1): the DEM ring, the far massing boxes and the skyline cards,
 * as plain buffers. No `three` import, so the far job runs them in asset.worker.
 *
 *  - ring: the `far-bay-dem` posts (256 m) as a grid mesh, land coloured by height and hill shade, the sea flat at the sea level;
 *  - massing: one 4 x 4 matrix per box of `far-bay-massing` (the unit cube stands on y = 0 and is scaled to w x h x d), for one
 *    instanced draw; the box base sits on the DEM;
 *  - cards: one quad per cluster, facing the spawn, with the atlas cell of the azimuth nearest to the view direction.
 */
import { dhypot, datan2, dcos, dsin, TWO_PI, type FarDem, type FarMassing } from '@dv/shared';
import backdropJson from '../../../../../config/world/backdrop.json';
import { MeshBuilder, hexToLinear, type Rgb } from '../chunks/mesher.ts';
import { Surf } from '../look/surfaces.ts';
import type { MeshBuffers } from '../chunks/mesh-types.ts';

export interface BackdropCluster { id: string; col: number; enu: [number, number]; widthM: number; heightM: number }
export interface BackdropConfig {
  atlas: { cols: number; rows: number; cardPx: [number, number]; sizePx: [number, number]; azimuthsDeg: number[] };
  clusters: BackdropCluster[];
  ring: { minCardM: number; seaLevelM: number };
  colors: { low: string; high: string; water: string; massing: string; card: string; sky: string };
}
export const BACKDROP: BackdropConfig = backdropJson as unknown as BackdropConfig;

const LOW: Rgb = hexToLinear(BACKDROP.colors.low);
const HIGH: Rgb = hexToLinear(BACKDROP.colors.high);
const SEA: Rgb = hexToLinear(BACKDROP.colors.water);

/** Bilinear height (metres) of the DEM at ENU (x, z); the edge value outside. */
export function demHeightAt(dem: FarDem, x: number, z: number): number {
  const fx = Math.min(dem.nx - 1.000001, Math.max(0, (x - dem.minX) / dem.cellM));
  const fz = Math.min(dem.nz - 1.000001, Math.max(0, (z - dem.minZ) / dem.cellM));
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const h = (a: number, b: number): number => (dem.heights[b * dem.nx + a] as number) / 10;
  const n0 = h(i, j) + (h(i + 1, j) - h(i, j)) * tx;
  const n1 = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * tx;
  return n0 + (n1 - n0) * tz;
}

export interface RingMesh {
  buffers: MeshBuffers;
  /** The mesh is positioned at this ENU corner. */
  originX: number;
  originZ: number;
}

/** The ring mesh from the DEM, at every `stride`-th post. */
export function ringMesh(dem: FarDem, stride: 1 | 2 | 4 = 1): RingMesh {
  const vx = Math.floor((dem.nx - 1) / stride) + 1;
  const vz = Math.floor((dem.nz - 1) / stride) + 1;
  const sea = BACKDROP.ring.seaLevelM;
  const b = new MeshBuilder();
  const h = (i: number, j: number): number => (dem.heights[Math.min(dem.nz - 1, j * stride) * dem.nx + Math.min(dem.nx - 1, i * stride)] as number) / 10;
  const land = (i: number, j: number): boolean => dem.land[Math.min(dem.nz - 1, j * stride) * dem.nx + Math.min(dem.nx - 1, i * stride)] === 1;
  const step = dem.cellM * stride;
  for (let j = 0; j < vz; j++) {
    for (let i = 0; i < vx; i++) {
      const dry = land(i, j);
      const y = dry ? Math.max(h(i, j), sea + 0.5) : sea;
      const gx = (h(i + 1, j) - h(i - 1, j)) / (2 * step);
      const gz = (h(i, j + 1) - h(i, j - 1)) / (2 * step);
      const l = Math.sqrt(gx * gx + 1 + gz * gz);
      const shade = dry ? 0.75 + 0.25 * (1 / l) : 1;
      b.setSurf(dry ? Surf.GroundBase : Surf.Sea);
      const t = Math.min(1, Math.max(0, y / 400));
      const base: Rgb = dry ? [LOW[0] + (HIGH[0] - LOW[0]) * t, LOW[1] + (HIGH[1] - LOW[1]) * t, LOW[2] + (HIGH[2] - LOW[2]) * t] : SEA;
      b.vertex(i * step, y, j * step, dry ? [-gx / l, 1 / l, -gz / l] : [0, 1, 0], [base[0] * shade, base[1] * shade, base[2] * shade]);
    }
  }
  for (let j = 0; j < vz - 1; j++) {
    for (let i = 0; i < vx - 1; i++) {
      const a = j * vx + i;
      b.triUp(a, a + vx, a + 1, true);
      b.triUp(a + 1, a + vx, a + vx + 1, true);
    }
  }
  return { buffers: b.build('terrain') as MeshBuffers, originX: dem.minX, originZ: dem.minZ };
}

export interface MassingInstances {
  count: number;
  /** 16 floats per box, column-major, local to (originX, originZ). */
  matrices: Float32Array;
  originX: number;
  originZ: number;
}

export function massingInstances(m: FarMassing, dem: FarDem | null): MassingInstances {
  const count = m.boxes.length / 6;
  const matrices = new Float32Array(count * 16);
  const ox = m.originX, oz = m.originZ;
  for (let i = 0; i < count; i++) {
    const x = m.boxes[i * 6] as number, z = m.boxes[i * 6 + 1] as number;
    const w = m.boxes[i * 6 + 2] as number, d = m.boxes[i * 6 + 3] as number, h = m.boxes[i * 6 + 4] as number;
    const theta = m.boxes[i * 6 + 5] as number;
    const c = dcos(theta), s = dsin(theta);
    const y = dem ? demHeightAt(dem, x, z) : 0;
    const o = i * 16;
    matrices[o] = w * c; matrices[o + 1] = 0; matrices[o + 2] = w * s; matrices[o + 3] = 0;
    matrices[o + 4] = 0; matrices[o + 5] = h; matrices[o + 6] = 0; matrices[o + 7] = 0;
    matrices[o + 8] = -d * s; matrices[o + 9] = 0; matrices[o + 10] = d * c; matrices[o + 11] = 0;
    matrices[o + 12] = x - ox; matrices[o + 13] = Math.max(y, 0) - 0.5; matrices[o + 14] = z - oz; matrices[o + 15] = 1;
  }
  return { count, matrices, originX: ox, originZ: oz };
}

export interface CardsLayout {
  /** Quad corners, world ENU metres (the mesh sits at the origin). */
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  /** Per card: cluster id, distance from the spawn, row of the atlas. */
  cards: { id: string; distM: number; row: number; x: number; z: number }[];
}

/**
 * One quad per cluster, facing `spawn`, at the true bearing and the true distance clamped to `cardsKm`. The atlas row is the azimuth
 * (west, south-west, north-west) nearest to the direction from the card to the spawn.
 */
export function cardsLayout(spawn: { x: number; z: number }, cardsKm: number): CardsLayout {
  const a = BACKDROP.atlas;
  const n = BACKDROP.clusters.length;
  const positions = new Float32Array(n * 12);
  const uvs = new Float32Array(n * 8);
  const indices = new Uint16Array(n * 6);
  const cards: CardsLayout['cards'] = [];
  const maxM = cardsKm * 1000;
  BACKDROP.clusters.forEach((c, k) => {
    const dx = c.enu[0] - spawn.x, dz = c.enu[1] - spawn.z;
    const trueD = dhypot(dx, dz);
    const d = Math.min(maxM, Math.max(BACKDROP.ring.minCardM, trueD));
    const scale = d / trueD;
    const px = spawn.x + dx * scale, pz = spawn.z + dz * scale;
    // Direction from the card to the spawn as a compass azimuth (0 = north = -Z, 90 = east): the atlas shows the cluster seen from there.
    const toX = spawn.x - px, toZ = spawn.z - pz;
    let az = (datan2(toX, -toZ) * 360) / TWO_PI;
    if (az < 0) az += 360;
    let row = 0;
    let best = Infinity;
    a.azimuthsDeg.forEach((deg, r) => {
      const diff = Math.min(Math.abs(az - deg), 360 - Math.abs(az - deg));
      if (diff < best) { best = diff; row = r; }
    });
    const hw = (c.widthM * scale) / 2;
    const h = c.heightM * scale;
    // Right-hand vector across the card, perpendicular to the direction to the spawn.
    const len = dhypot(toX, toZ) || 1;
    const rx = toZ / len, rz = -toX / len;
    const o = k * 12;
    positions.set([px - rx * hw, 0, pz - rz * hw, px + rx * hw, 0, pz + rz * hw, px + rx * hw, h, pz + rz * hw, px - rx * hw, h, pz - rz * hw], o);
    const u0 = (c.col * a.cardPx[0]) / a.sizePx[0], u1 = ((c.col + 1) * a.cardPx[0]) / a.sizePx[0];
    // The atlas texture is uploaded unflipped (`atlasTexture`: `flipY = false`), so v = 0 is the TOP row of the image, in WebGL2 and in
    // WebGPU. Before M02g2 the v values counted from the bottom (1 - y / height), which hung every skyline silhouette upside down:
    // the solid base of the card at its top and the jagged roofline under it, a dark slab floating over the horizon (BD-M02G2-04).
    const vTop = (row * a.cardPx[1]) / a.sizePx[1], vBottom = ((row + 1) * a.cardPx[1]) / a.sizePx[1];
    uvs.set([u0, vBottom, u1, vBottom, u1, vTop, u0, vTop], k * 8);
    indices.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
    cards.push({ id: c.id, distM: d, row, x: px, z: pz });
  });
  return { positions, uvs, indices, cards };
}
