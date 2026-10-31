/**
 * The L0 mesher (02-world.md section 5.2 rule 4, 02-world-bake.md section 6; M02b1). Turns a decoded chunk (`SimChunk` for
 * the heightfield, ground classes and road segments, `RenderChunk` for the footprints and trees) into at most six render
 * objects: `terrain`, `buildings`, `roads` and `vegetation` (the tree instances); `furniture` and `extras` stay empty until their
 * milestones. It imports nothing from `three`, so it runs in asset.worker, and it is deterministic: the same chunk and options
 * give the same bytes.
 *
 *  - terrain: every 1st / 2nd / 4th post (desktop / mobile / mobile-low), so every vertex lies on the physics surface, with the
 *    colour of the ground class and a Sobel normal over the stride-1 posts; since M02g2 the chunks within `terrain.nearRingM` of the
 *    focus use the finer `nearStride`, a profile with two strides hangs a 1 m skirt under every border (a stride seam), and the posts
 *    next to a footprint carry baked ambient occlusion;
 *  - buildings: walls with the 1.5 m foundation skirt, flat roofs triangulated by earcut (a parapet rim on the profiles that
 *    have one), gable and hip roofs on four-corner footprints, a rooftop box on commercial towers; the triangle count of one
 *    building never exceeds the profile (rings are simplified down to fit); baked vertex AO (`ao`): the wall foot, a row at 1.2 m
 *    when the triangle budget has room, and the pitched eaves;
 *  - roads: ribbons along the `p0` segment centrelines, lifted 0.12 m plus 0.01 m per class rank (the busier road on top, drawn
 *    last), at the carriageway width;
 *  - trees: one instance record per tree (x, y, z, scale, species), drawn as one instanced mesh; the foot is the lowest terrain
 *    under the trunk and the height stays under the nearest eave.
 *
 * Positions are local to the chunk's north-west corner (`x`, `z`), with `y` absolute, so a float32 position keeps its precision
 * 10 km from the origin.
 */
import earcut from 'earcut';
import {
  NodeControl, PedEdgeKind, PedNodeFlag, TERRAIN_POSTS, chunkBounds, sampleHeight, type BuildingRecord, type ChunkKey, type QualityTierId, type RenderChunk, type SimChunk,
} from '@dv/shared';
import mesherJson from '../../../../../config/world/mesher.json';
import { LOOK, LOOK_FLAG, facadeClassOf, lookProfileFor } from '../look/config.ts';
import { packRoad, roadFields, roadVertex, wrapAlong, type RoadFields } from '../look/road-layout.ts';
import { FLAG_PARAPET, Surf, facadeDm, facadeSignedDm, groundSurf, roadSurf, roofSurf, wallSurf } from '../look/surfaces.ts';
import {
  approachesOf, clipKey, clippedPolyline, armsOf, crosswalkQuad, planRoads, ribbonSides, roadsContext, simplifyPoints, stopBarQuad, tileOf, type DecalQuad, type PlannedJunction,
  type RibbonPoint, type RoadsContext, type RoadsPlan,
} from './junction-patch.ts';
import { meshBytes, type MeshBuffers, type MeshStats, type UnitMesh } from './mesh-types.ts';
import { bakeMacro } from './macro.ts';
import { CURBS, GUTTER_COLOR, buildSidewalks, curbedSides, type CurbSample, type CurbStats } from './sidewalks.ts';

// ---- configuration -------------------------------------------------------------------------------------------------------

export type ProfileId = 'desktop' | 'visionpro' | 'mobile' | 'low';
export interface MesherProfile {
  trisPerBuilding: number;
  terrainStride: 1 | 2 | 4;
  /** The stride of the L0 chunks within `terrain.nearRingM` of the focus (M02g2); equal to `terrainStride` where there is no near ring. */
  nearStride: 1 | 2 | 4;
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
  /** Baked vertex ambient occlusion (M02g2). */
  ao: { ringM: number; ringStrength: number; wallRowM: number; wallRowAo: number; eaveAo: number };
  /** The near ring of the terrain and the seam skirt (M02g2). */
  terrain: { nearRingM: number; leaveFactor: number; skirtM: number };
  /**
   * The road material's polygon offset in the standard-depth sense (negative: towards the camera; `materials.ts` flips the sign
   * on a reversed depth buffer, which is what the renderer host asks for) and the ribbon lift per class rank, metres.
   */
  depth: { roadFactor: number; roadUnits: number; ribbonStepM: number };
  tree: {
    trunk: string;
    leaves: string[];
    heightM: number;
    minHeightM: number;
    maxHeightM: number;
    eaveRadiusM: number;
    eaveClearM: number;
    sinkM: number;
    trunkRadiusM: number;
    drawM: Record<ProfileId, number>;
    drawHysteresis: number;
  };
  lod: { skirtM: number; roadWidthM: Record<string, number>; roadLiftM: number; waterLevelM: number; massingRoof: string };
  /** M02h2: curbs, gutters and sidewalk ribbons (chunks/sidewalks.ts reads the block). */
  curbs: unknown;
  /** M02h2: `Paved` posts within `plazaM` of a plaza ped edge or node are a plaza, the rest lots; their vertex colours on `min`. */
  lotPlaza: { plazaM: number; lot: string; plaza: string };
  /** M02h2: the macro variation (chunks/macro.ts reads the block). */
  macro: unknown;
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
export const LOT_COLOR: Rgb = hexToLinear(MESHER.lotPlaza.lot);
export const PLAZA_COLOR: Rgb = hexToLinear(MESHER.lotPlaza.plaza);
export const roadColor = (cls: number): Rgb =>
  cls === 0 ? ROAD_COLORS.freeway : cls === 1 ? ROAD_COLORS.ramp : cls === 2 ? ROAD_COLORS.arterial : cls === 5 ? ROAD_COLORS.service : ROAD_COLORS.local;

export function profileOf(tier: QualityTierId): { id: ProfileId; profile: MesherProfile } {
  const id = MESHER.tierProfile[tier];
  return { id, profile: MESHER.profiles[id] };
}

/**
 * Whether an L0 chunk at `distM` from the focus has its terrain at the profile's `nearStride` (M02g2): it enters the near ring under
 * `terrain.nearRingM` and, once in, stays until it is over `nearRingM x leaveFactor`, so a chunk at the edge is not meshed back and forth.
 * `meshChunk` decides a first mesh with the plain ring (`wasNear` false); the streaming view asks again with what it holds.
 */
export function wantNearStride(wasNear: boolean, distM: number): boolean {
  const ring = MESHER.terrain.nearRingM;
  return wasNear ? distM <= ring * MESHER.terrain.leaveFactor : distM <= ring;
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
  /** M02h1: `Int16x4` per vertex, the lane coordinates of the street markings (`look/road-layout.ts`); only when the builder was made with `road`. */
  readonly roadAttr: number[] | null;
  private cur: [number, number, number, number] = [Surf.GroundBase + 3, 0, 0, 0];

  constructor(o: { facade?: boolean; road?: boolean } = {}) {
    this.fac = o.facade ? [] : null;
    this.roadAttr = o.road ? [] : null;
  }

  /** The surface the next vertices belong to: id (look/surfaces.ts), palette index, kind/roof code, flags. */
  setSurf(id: number, palette = 0, code = 0, flags = 0): void {
    this.cur = [id, palette & 255, code & 255, flags & 255];
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }
  /** The surface id the next vertices get (`setSurf`). */
  get currentSurf(): number {
    return this.cur[0];
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** `fac` is the building vertex's `facade` record in decimetres (u, v, wall height, seed); zeros when absent. */
  vertex(x: number, y: number, z: number, n: Rgb, c: Rgb, ao = 1, fac?: readonly [number, number, number, number], road?: readonly [number, number, number, number]): number {
    this.pos.push(x, y, z);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.ao.push(ao);
    this.surf.push(this.cur[0], this.cur[1], this.cur[2], this.cur[3]);
    if (this.fac) {
      if (fac) this.fac.push(fac[0], fac[1], fac[2], fac[3]);
      else this.fac.push(0, 0, 0, 0);
    }
    if (this.roadAttr) {
      if (road) this.roadAttr.push(road[0], road[1], road[2], road[3]);
      else this.roadAttr.push(0, 0, 0, 0);
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

  /** A triangle wound so that its geometric normal has a non-negative dot product with (nx, ny, nz). */
  triFacing(a: number, b: number, c: number, nx: number, ny: number, nz: number): void {
    const g = (i: number, o: number): number => this.pos[i * 3 + o] as number;
    const ux = g(b, 0) - g(a, 0), uy = g(b, 1) - g(a, 1), uz = g(b, 2) - g(a, 2);
    const vx = g(c, 0) - g(a, 0), vy = g(c, 1) - g(a, 1), vz = g(c, 2) - g(a, 2);
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dot >= 0) this.tri(a, b, c);
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
      ...(this.roadAttr ? { road: new Int16Array(this.roadAttr) } : {}),
      bounds: [minX, minY, minZ, maxX, maxY, maxZ],
    };
  }
}

const UP: Rgb = [0, 1, 0];

// ---- terrain -------------------------------------------------------------------------------------------------------------

const POSTS = TERRAIN_POSTS;

/**
 * Height in metres at post (col, row), with linear extrapolation beyond the 65 x 65 grid, so a border post sees a one-sided slope
 * and not a clamped (halved) one.
 */
export function postHeight(heights: Int16Array, col: number, row: number): number {
  if (col < 0) return 2 * postHeight(heights, 0, row) - postHeight(heights, 1, row);
  if (col > POSTS - 1) return 2 * postHeight(heights, POSTS - 1, row) - postHeight(heights, POSTS - 2, row);
  if (row < 0) return 2 * postHeight(heights, col, 0) - postHeight(heights, col, 1);
  if (row > POSTS - 1) return 2 * postHeight(heights, col, POSTS - 1) - postHeight(heights, col, POSTS - 2);
  return (heights[row * POSTS + col] as number) / 10;
}

/** The terrain normal at stride-1 post (col, row): a 3 x 3 Sobel filter over the heights, whatever stride the mesh draws at. */
export function terrainNormal(heights: Int16Array, col: number, row: number, cellM: number): Rgb {
  const g = (c: number, r: number): number => postHeight(heights, c, r);
  const gx = (g(col + 1, row - 1) + 2 * g(col + 1, row) + g(col + 1, row + 1) - (g(col - 1, row - 1) + 2 * g(col - 1, row) + g(col - 1, row + 1))) / (8 * cellM);
  const gz = (g(col - 1, row + 1) + 2 * g(col, row + 1) + g(col + 1, row + 1) - (g(col - 1, row - 1) + 2 * g(col, row - 1) + g(col + 1, row - 1))) / (8 * cellM);
  const len = Math.sqrt(gx * gx + 1 + gz * gz);
  return [-gx / len, 1 / len, -gz / len];
}

/**
 * The ambient occlusion of a point at distance `d` (metres) from a footprint edge: 1 at and beyond the ring, `1 - strength` on the
 * edge, quadratic in between. Exported for the curbs of M02h2, which stand in the same ring.
 */
export function aoRing(d: number, ringM: number = MESHER.ao.ringM, strength: number = MESHER.ao.ringStrength): number {
  if (!(d < ringM)) return 1;
  const k = 1 - Math.max(0, d) / ringM;
  return 1 - strength * k * k;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/**
 * Baked ambient occlusion of every post of the 65 x 65 grid from the footprints of the same chunk (local metres, flat x, z pairs):
 * `aoRing` of the distance to the nearest footprint edge (0 inside a footprint). Null when no post lies within the ring of a footprint.
 */
export function terrainAo(rings: readonly (readonly number[])[], cellM: number, ringM: number = MESHER.ao.ringM): Float32Array | null {
  const ao = new Float32Array(POSTS * POSTS).fill(1);
  let any = false;
  for (const ring of rings) {
    const n = ring.length / 2;
    if (n < 3) continue;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = ring[i * 2] as number, z = ring[i * 2 + 1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const c0 = Math.max(0, Math.floor((minX - ringM) / cellM)), c1 = Math.min(POSTS - 1, Math.ceil((maxX + ringM) / cellM));
    const r0 = Math.max(0, Math.floor((minZ - ringM) / cellM)), r1 = Math.min(POSTS - 1, Math.ceil((maxZ + ringM) / cellM));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = c * cellM, z = r * cellM;
        let d = pointInRing(ring, x, z) ? 0 : Infinity;
        if (d !== 0) {
          for (let i = 0, j = n - 1; i < n; j = i++) {
            d = Math.min(d, distToSegment(x, z, ring[j * 2] as number, ring[j * 2 + 1] as number, ring[i * 2] as number, ring[i * 2 + 1] as number));
            if (d < 1e-9) break;
          }
        }
        const a = aoRing(d, ringM);
        if (a < (ao[r * POSTS + c] as number)) {
          ao[r * POSTS + c] = a;
          any = true;
        }
      }
    }
  }
  return any ? ao : null;
}

export interface TerrainOptions {
  /** Per post (65 x 65, row-major) occlusion, `terrainAo`; absent or null: every post open. */
  ao?: Float32Array | null | undefined;
  /** A skirt this deep hangs under every border segment: the cover of a stride seam. 0 or absent: none. */
  skirtM?: number | undefined;
  /**
   * M02h2: per post (65 x 65), 1 where a `Paved` post is a plaza (`plazaPosts`). With it, every `Paved` post is a `Lot` or a `Plaza` surface
   * with that colour; absent: `Paved` as before.
   */
  plaza?: Uint8Array | null | undefined;
}

/**
 * The terrain of a 65 x 65 grid at every `stride`-th post, local to (originX, originZ). The first `verts * verts` vertices are the
 * posts, on the physics surface; a skirt (`skirtM` > 0) adds `4 * (verts - 1)` more below them.
 */
export function terrainMesh(heights: Int16Array, ground: Uint8Array, cellM: number, stride: 1 | 2 | 4, o: TerrainOptions = {}): MeshBuffers {
  const n = POSTS;
  const verts = (n - 1) / stride + 1;
  const b = new MeshBuilder();
  for (let j = 0; j < verts; j++) {
    for (let i = 0; i < verts; i++) {
      const col = i * stride;
      const row = j * stride;
      const cls = ground[Math.min(63, row + (stride >> 1)) * 64 + Math.min(63, col + (stride >> 1))] ?? 3;
      let color = GROUND[cls] ?? (GROUND[3] as Rgb);
      if (cls === 3 && o.plaza) {
        // M02h2: a paved post is a plaza near a plaza ped edge or node, else a lot
        const plaza = o.plaza[row * n + col] === 1;
        color = plaza ? PLAZA_COLOR : LOT_COLOR;
        b.setSurf(plaza ? Surf.Plaza : Surf.Lot);
      } else b.setSurf(groundSurf(cls));
      b.vertex(col * cellM, (heights[row * n + col] as number) / 10, row * cellM, terrainNormal(heights, col, row, cellM), color, o.ao ? (o.ao[row * n + col] as number) : 1);
    }
  }
  for (let j = 0; j < verts - 1; j++) {
    for (let i = 0; i < verts - 1; i++) {
      const a = j * verts + i;
      b.triUp(a, a + verts, a + 1, true);
      b.triUp(a + 1, a + verts, a + verts + 1, true);
    }
  }
  const skirt = o.skirtM ?? 0;
  if (skirt > 0) {
    const lowered = new Map<number, number>();
    const down = (v: number): number => {
      let l = lowered.get(v);
      if (l === undefined) {
        b.setSurf(b.surf[v * 4] as number, b.surf[v * 4 + 1] as number, b.surf[v * 4 + 2] as number, b.surf[v * 4 + 3] as number);
        l = b.vertex(
          b.pos[v * 3] as number, (b.pos[v * 3 + 1] as number) - skirt, b.pos[v * 3 + 2] as number,
          [b.nor[v * 3] as number, b.nor[v * 3 + 1] as number, b.nor[v * 3 + 2] as number],
          [b.col[v * 3] as number, b.col[v * 3 + 1] as number, b.col[v * 3 + 2] as number], b.ao[v] as number,
        );
        lowered.set(v, l);
      }
      return l;
    };
    // The four borders, each as the posts along it and the outward direction.
    const line = (at: (k: number) => number): number[] => Array.from({ length: verts }, (_, k) => at(k));
    const sides: { ids: number[]; nx: number; nz: number }[] = [
      { ids: line((k) => k), nx: 0, nz: -1 },
      { ids: line((k) => k * verts + verts - 1), nx: 1, nz: 0 },
      { ids: line((k) => (verts - 1) * verts + k), nx: 0, nz: 1 },
      { ids: line((k) => k * verts), nx: -1, nz: 0 },
    ];
    for (const side of sides) {
      for (let k = 0; k < verts - 1; k++) {
        const a = side.ids[k] as number, c = side.ids[k + 1] as number;
        const la = down(a), lc = down(c);
        b.triFacing(a, c, lc, side.nx, 0, side.nz);
        b.triFacing(a, lc, la, side.nx, 0, side.nz);
      }
    }
  }
  return b.build('terrain') as MeshBuffers;
}

/**
 * M02h2: which posts of a chunk's 65 x 65 grid lie within `lotPlaza.plazaM` of a `Plaza` ped edge or a ped node flagged `Plaza` (C08), in
 * any chunk of `chunks` (the tile, so the border posts two chunks share agree). 1 = plaza, 0 = lot.
 */
export function plazaPosts(sim: SimChunk, chunks: readonly SimChunk[], plazaM: number = MESHER.lotPlaza.plazaM): Uint8Array {
  const out = new Uint8Array(POSTS * POSTS);
  const cellM = sim.height.cellM;
  const ox = sim.height.originX, oz = sim.height.originZ;
  const edge = (POSTS - 1) * cellM;
  const segs: number[] = [];
  for (const c of chunks) {
    const nodes = new Map<number, { x: number; z: number; flags: number }>();
    for (const nd of c.pedNodes) nodes.set(nd.id, nd);
    for (const nd of c.pedNodes) if ((nd.flags & PedNodeFlag.Plaza) !== 0) segs.push(nd.x, nd.z, nd.x, nd.z);
    for (const pe of c.pedEdges) {
      if (pe.kind !== PedEdgeKind.Plaza) continue;
      const a = nodes.get(pe.a), q = nodes.get(pe.b);
      if (a && q) segs.push(a.x, a.z, q.x, q.z);
    }
  }
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i] as number, az = segs[i + 1] as number, bx = segs[i + 2] as number, bz = segs[i + 3] as number;
    if (Math.max(ax, bx) < ox - plazaM || Math.min(ax, bx) > ox + edge + plazaM || Math.max(az, bz) < oz - plazaM || Math.min(az, bz) > oz + edge + plazaM) continue;
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - plazaM - ox) / cellM)), c1 = Math.min(POSTS - 1, Math.ceil((Math.max(ax, bx) + plazaM - ox) / cellM));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz) - plazaM - oz) / cellM)), r1 = Math.min(POSTS - 1, Math.ceil((Math.max(az, bz) + plazaM - oz) / cellM));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (out[r * POSTS + c] === 1) continue;
        if (distToSegment(ox + c * cellM, oz + r * cellM, ax, az, bx, bz) <= plazaM) out[r * POSTS + c] = 1;
      }
    }
  }
  return out;
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

/**
 * The height of the wall foot of a footprint (M02g2): the foundation skirt under `base`, or lower where the ground falls away under
 * the walls: the lowest point of the heightfield and of the drawn terrain mesh (`stride`) along the walls, less 10 cm. So no wall foot
 * hangs above the ground it stands on, on a steep street or on a coarse mesh. `ring` is local to the unit corner, `extentM` the unit's
 * edge (256 m for an L0 chunk) and `field` an exact ground height to take the minimum with (L0 passes `sampleHeight`).
 */
export function wallFoot(heights: Int16Array, cellM: number, stride: 1 | 2 | 4, ring: readonly number[], base: number, field?: (x: number, z: number) => number, extentM = 256): number {
  let low = base - MESHER.foundationM;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = ring[i * 2] as number, z0 = ring[i * 2 + 1] as number, x1 = ring[j * 2] as number, z1 = ring[j * 2 + 1] as number;
    const steps = Math.min(64, Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0))));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = Math.min(extentM, Math.max(0, x0 + (x1 - x0) * t)), z = Math.min(extentM, Math.max(0, z0 + (z1 - z0) * t));
      const ground = Math.min(meshSurfaceAt(heights, cellM, stride, x, z), field ? field(x, z) : Infinity);
      if (ground - 0.1 < low) low = ground - 0.1;
    }
  }
  return low;
}

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
  /**
   * M02g2: the absolute height of the wall foot when the ground under the walls falls lower than the foundation skirt reaches
   * (`wallFoot`); absent, or above the skirt, the foot is `base - foundationM` as before. The facade coordinates stay anchored to
   * the nominal foot, so the floors and bands do not move; the extra depth is below them (a negative `v`).
   */
  footIn?: number,
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
  // M02g2: a wall vertex row just above the ground carries the contact shading, when the building's triangle budget has room for the
  // two extra triangles per wall (never on the coarse levels, which pass `surfOverride`).
  const rowTris = 2 * n;
  const wallRow = surfOverride === undefined && tris + rowTris <= max && base + MESHER.ao.wallRowM < base + height - 0.5;

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

  // Walls: outward normal (dz, 0, -dx) for a counter-clockwise ring in (x, z). The foot is the foundation skirt, 1.5 m under the ground.
  b.setSurf(surfOverride ?? wallSurf(rec.kind), rec.palette, code, parapet ? FLAG_PARAPET : 0);
  const nominalFoot = base - foundation;
  const footY = footIn !== undefined && footIn < nominalFoot ? footIn : nominalFoot;
  const footV = facadeSignedDm(footY - nominalFoot);
  const rowY = base + MESHER.ao.wallRowM;
  // The row keeps the linear shading ramp of the plain wall (0.72 at the foot, 1 at the top) so only the occlusion changes.
  const rowShade = 0.72 + 0.28 * ((rowY - footY) / (wallTop - footY));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = ring[i * 2] as number, z0 = ring[i * 2 + 1] as number, x1 = ring[j * 2] as number, z1 = ring[j * 2 + 1] as number;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nrm: Rgb = [dz / len, 0, -dx / len];
    const uEnd = facadeDm(withFacade ? Math.max(1, Math.round(len / bayM)) * bayM : len);
    const v0 = b.vertex(x0, footY, z0, nrm, scale(wall, 0.72), AO_BASE, [0, footV, wallHdm, seed15]);
    const v1 = b.vertex(x1, footY, z1, nrm, scale(wall, 0.72), AO_BASE, [uEnd, footV, wallHdm, seed15]);
    const v2 = b.vertex(x1, wallTop, z1, nrm, wall, 1, [uEnd, wallHdm, wallHdm, seed15]);
    const v3 = b.vertex(x0, wallTop, z0, nrm, wall, 1, [0, wallHdm, wallHdm, seed15]);
    if (wallRow) {
      const rowDm = facadeDm(rowY - nominalFoot);
      const r0 = b.vertex(x0, rowY, z0, nrm, scale(wall, rowShade), MESHER.ao.wallRowAo, [0, rowDm, wallHdm, seed15]);
      const r1 = b.vertex(x1, rowY, z1, nrm, scale(wall, rowShade), MESHER.ao.wallRowAo, [uEnd, rowDm, wallHdm, seed15]);
      b.tri(v0, r1, v1);
      b.tri(v0, r0, r1);
      b.tri(r0, v2, r1);
      b.tri(r0, v3, v2);
    } else {
      b.tri(v0, v2, v1);
      b.tri(v0, v3, v2);
    }
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
    // The base ring of the roof is the wall-top ring: the same corners at `wallTop` (M02g2, BD-M02g2-03).
    const topY = wallTop + lift;
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
      const ids = pts.map((p) => b.vertex(p[0], p[1], p[2], nrm, roofColor, p[1] <= wallTop + 1e-6 ? MESHER.ao.eaveAo : 0.95, roofFac(p[1])));
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
    face([[p0x, wallTop, p0z], [p1x, wallTop, p1z], ridgeB, ridgeA]);
    face([[p2x, wallTop, p2z], [p3x, wallTop, p3z], ridgeA, ridgeB]);
    face([[p1x, wallTop, p1z], [p2x, wallTop, p2z], ridgeB]);
    face([[p3x, wallTop, p3z], [p0x, wallTop, p0z], ridgeA]);
    return wallRow ? tris + rowTris : tris;
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
  tris = wallTris + emitted + (equipment ? 10 : 0) + (wallRow ? rowTris : 0);

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
/** The importance of a road class (`RoadClass` 0 freeway .. 5 service): the busier road is lifted more and drawn after the lesser. */
export const roadRank = (cls: number): number => 5 - Math.max(0, Math.min(5, cls));

/** What `addRibbon` takes beyond the plain ribbon (M02h1). */
export interface RibbonOptions {
  /** Metres cut off the start and the end of the polyline: the ribbons end short of a junction patch. */
  clipStart?: number;
  clipEnd?: number;
  /** The lane fields of the segment: every vertex then carries its `road` coordinates, and collinear vertices are dropped. */
  road?: RoadFields;
  /**
   * M02h2: the gutters: bit 0 the `left` side of `ribbonSides`, bit 1 the `right` (`curbedSides`). Each curbed side's outer `widthM` is an
   * edge strip of its own (`Surf.Gutter`) that shares its inner edge with the carriageway: the vertices on that edge are computed by the same
   * interpolation, so the two strips meet without a gap and never overlap.
   */
  gutter?: { sides: number; widthM: number };
}

/**
 * A ribbon of constant width along a polyline of (x, y, z) triples, local to (ox, oz). With `road`, each vertex also gets its position
 * along the segment (`x`, wrapped; the far row of a quad adds the quad's length to its near row's, so the wrap never falls inside a quad)
 * and across it (`y`: + on the left of the point order, which is the `right` side of `ribbonSides`).
 */
export function addRibbon(b: MeshBuilder, pts: Float32Array, ox: number, oz: number, width: number, lift: number, color: Rgb, o: RibbonOptions = {}): void {
  const cut = clippedPolyline(pts, o.clipStart ?? 0, o.clipEnd ?? 0);
  if (!cut) return;
  const points: RibbonPoint[] = o.road ? simplifyPoints(cut) : cut;
  const half = width / 2;
  const sides = ribbonSides(points, half);
  const at = (p: { x: number; y: number; z: number }): [number, number, number] => [p.x - ox, p.y + lift, p.z - oz];
  const gw = o.gutter ? Math.min(o.gutter.widthM, half * 0.45) : 0;
  if (o.gutter && o.gutter.sides !== 0 && gw > 0) {
    addGutteredRibbon(b, points, sides, half, gw, o.gutter.sides, at, color, o.road);
    return;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i] as RibbonPoint, p1 = points[i + 1] as RibbonPoint;
    let r0: [number, number, number, number] | undefined, r1: [number, number, number, number] | undefined, l0: [number, number, number, number] | undefined, l1: [number, number, number, number] | undefined;
    if (o.road) {
      const near = wrapAlong(p0.s), far = near + (p1.s - p0.s);
      l0 = roadVertex(near, -half, o.road);
      r0 = roadVertex(near, half, o.road);
      l1 = roadVertex(far, -half, o.road);
      r1 = roadVertex(far, half, o.road);
    }
    const a = b.vertex(...at(sides.left[i] as RibbonPoint), UP, color, 1, undefined, l0);
    const bb = b.vertex(...at(sides.right[i] as RibbonPoint), UP, color, 1, undefined, r0);
    const c = b.vertex(...at(sides.right[i + 1] as RibbonPoint), UP, color, 1, undefined, r1);
    const d = b.vertex(...at(sides.left[i + 1] as RibbonPoint), UP, color, 1, undefined, l1);
    b.quadUp(a, bb, c, d);
  }
}

/**
 * M02h2: a ribbon split across into the carriageway and one or two gutter strips. `u` runs from `-half` (the `left` of `ribbonSides`) to
 * `+half`; a vertex at `u` is the interpolation of the two side points, so the strip edges two quads share are the same floats.
 */
function addGutteredRibbon(
  b: MeshBuilder, points: readonly RibbonPoint[], sides: { left: { x: number; y: number; z: number }[]; right: { x: number; y: number; z: number }[] }, half: number, gw: number,
  curbed: number, at: (p: { x: number; y: number; z: number }) => [number, number, number], color: Rgb, road: RoadFields | undefined,
): void {
  const cuts: number[] = [-half];
  if (curbed & 1) cuts.push(-half + gw);
  if (curbed & 2) cuts.push(half - gw);
  cuts.push(half);
  const surfId = b.currentSurf;
  const pos = (i: number, u: number): [number, number, number] => {
    const l = sides.left[i] as { x: number; y: number; z: number }, r = sides.right[i] as { x: number; y: number; z: number };
    const t = (u + half) / (2 * half);
    return at({ x: l.x + (r.x - l.x) * t, y: l.y + (r.y - l.y) * t, z: l.z + (r.z - l.z) * t });
  };
  const foot = 1 - CURBS.footAo;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i] as RibbonPoint, p1 = points[i + 1] as RibbonPoint;
    const near = road ? wrapAlong(p0.s) : 0, far = near + (p1.s - p0.s);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const u0 = cuts[k] as number, u1 = cuts[k + 1] as number;
      const gutterL = (curbed & 1) !== 0 && k === 0;
      const gutterR = (curbed & 2) !== 0 && k === cuts.length - 2;
      const isGutter = gutterL || gutterR;
      b.setSurf(isGutter ? Surf.Gutter : surfId);
      const col = isGutter ? GUTTER_COLOR : color;
      // the foot of the curb (the ribbon's outer edge on a curbed side) is darker
      const ao = (u: number): number => ((gutterL && u === -half) || (gutterR && u === half) ? foot : 1);
      const rv = (s: number, u: number): [number, number, number, number] | undefined => (road ? roadVertex(s, u, road) : undefined);
      const a = b.vertex(...pos(i, u0), UP, col, ao(u0), undefined, rv(near, u0));
      const bb = b.vertex(...pos(i, u1), UP, col, ao(u1), undefined, rv(near, u1));
      const c = b.vertex(...pos(i + 1, u1), UP, col, ao(u1), undefined, rv(far, u1));
      const d = b.vertex(...pos(i + 1, u0), UP, col, ao(u0), undefined, rv(far, u0));
      b.quadUp(a, bb, c, d);
    }
  }
  b.setSurf(surfId);
}

// ---- the roads object: ribbons, junction patches, crosswalks and stop bars (M02h1) ------------------------------------------------

/** The height of a ribbon of road class `cls` over the road's own points: lifts by rank, the busier road higher (M02g2). */
export const ribbonLift = (cls: number): number => ROAD_LIFT_M + MESHER.depth.ribbonStepM * roadRank(cls);

/** What the roads object of a chunk holds, for the QA bridge and the ledger. */
export interface RoadMarkStats {
  /** Vertices of the `roads` object (each carries a `road` record). */
  roadVerts: number;
  /** Junction patches (junctions of three or more roads that lie in this chunk and got a convex patch). */
  patches: number;
  crosswalks: number;
  stopBars: number;
  /** Stop-bar approaches the junctions of this chunk name (`stopBars` plus those whose edge is not in the tile). */
  approaches: number;
  /** Junctions of this chunk with three or more roads that kept the overlapping ribbons of M02g2 (no patch). */
  skipped: number;
  /** Ribbon ends clipped short of a patch (counted for the segments of this chunk). */
  clipped: number;
}

/**
 * A junction patch: the convex outline of the clipped ribbon corners as a fan from its first corner (n - 2 triangles), each corner at the
 * lift of its own road, so the patch meets every ribbon end at the ribbon's height.
 */
function addPatch(b: MeshBuilder, pj: PlannedJunction, ox: number, oz: number): void {
  b.setSurf(Surf.Junction);
  const ring = pj.hull.map((i) => {
    const c = pj.corners[i] as PlannedJunction['corners'][number];
    return b.vertex(c.x - ox, c.y + ribbonLift(c.cls), c.z - oz, UP, roadColor(c.cls));
  });
  for (let k = 1; k + 1 < ring.length; k++) b.triUp(ring[0] as number, ring[k] as number, ring[k + 1] as number, true);
}

const clampI = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

/** A crosswalk or stop-bar quad. A crosswalk's vertices carry the crossing coordinates in `road` (`look/road-layout.ts`); a stop bar's carry zeros. */
function addDecal(b: MeshBuilder, q: DecalQuad, surf: number, ox: number, oz: number, crosswalk: boolean): void {
  b.setSurf(surf);
  const ids = q.corners.map((c) =>
    b.vertex(
      c.x - ox, c.y, c.z - oz, UP, roadColor(q.cls), 1, undefined,
      crosswalk ? [clampI(c.u * 10, 0, 32767), clampI(c.v * 100, -32767, 32767), clampI(q.lengthM * 10, 0, 16000) * 2 + (q.ladder ? 1 : 0), 0] : undefined,
    ),
  );
  b.quadUp(ids[0] as number, ids[1] as number, ids[2] as number, ids[3] as number);
}

/**
 * The `roads` object of an L0 chunk. Ribbons lowest rank first, each rank a little higher (M02g2): where two ribbons cross, the busier road
 * is the later and the higher. With `markings`, each vertex carries its lane coordinates, the ribbons of a junction of three or more roads
 * end short of a convex patch (`junction-patch.ts`), and the crosswalk and stop-bar quads follow. `tile` is the chunks of the z7 tile the
 * job decoded (the roads of a junction are often in the next chunk); without it only this chunk's roads are known.
 */
export function buildRoads(
  sim: SimChunk, ox: number, oz: number, markings: boolean, tile?: readonly SimChunk[],
  /** M02h2: the curbs, gutters and sidewalk ribbons for this mesher profile; absent: none (the roads object of M02h1). */
  curbs?: { profile: ProfileId; debug?: boolean },
): { mesh: MeshBuffers | null; stats: RoadMarkStats; curbs?: CurbStats; walk?: Uint8Array; walkLiftM?: number; samples?: CurbSample[] } {
  const stats: RoadMarkStats = { roadVerts: 0, patches: 0, crosswalks: 0, stopBars: 0, approaches: 0, skipped: 0, clipped: 0 };
  if (sim.segments.length === 0) return { mesh: null, stats };
  const cfg = LOOK.markings;
  const anyCtx: RoadsContext | null = markings || curbs ? roadsContext(tileOf(sim, tile)) : null;
  const rctx: RoadsContext | null = markings ? anyCtx : null;
  const plan: RoadsPlan | null = anyCtx ? planRoads(anyCtx, cfg.junctionExtraM) : null;
  const curbed = curbs && anyCtx && CURBS.gutter[curbs.profile] ? curbedSides(anyCtx) : null;
  const clsOf = new Map<number, number>();
  for (const e of sim.edges) if (!clsOf.has(e.seg)) clsOf.set(e.seg, e.cls);
  const rb = new MeshBuilder({ road: markings });
  const ranked = sim.segments
    .map((seg, i) => ({ seg, i, cls: clsOf.get(seg.id) ?? 4 }))
    .sort((a, b) => roadRank(a.cls) - roadRank(b.cls) || a.i - b.i);
  for (const { seg, cls } of ranked) {
    rb.setSurf(roadSurf(cls));
    const opts: RibbonOptions = {};
    if (rctx && plan) {
      const edges = rctx.edgesBySeg.get(seg.id) ?? sim.edges.filter((e) => e.seg === seg.id);
      opts.road = roadFields(packRoad(seg, edges, cfg));
      const c0 = plan.clip.get(clipKey(seg.id, 0)) ?? 0, c1 = plan.clip.get(clipKey(seg.id, 1)) ?? 0;
      if (c0 > 0) opts.clipStart = c0;
      if (c1 > 0) opts.clipEnd = c1;
      stats.clipped += (c0 > 0 ? 1 : 0) + (c1 > 0 ? 1 : 0);
    }
    const sidesCurbed = curbed?.get(seg.id) ?? 0;
    if (sidesCurbed !== 0) opts.gutter = { sides: sidesCurbed, widthM: CURBS.gutterM };
    addRibbon(rb, seg.pts, ox, oz, seg.widthM, ribbonLift(cls), roadColor(cls), opts);
  }
  if (rctx && plan) {
    for (const pj of plan.junctions.values()) {
      if (pj.chunk !== sim.key) continue;
      addPatch(rb, pj, ox, oz);
      stats.patches++;
    }
    for (const j of sim.junctions) {
      if (!plan.junctions.has(j.id)) {
        const arms = armsOf(rctx, j);
        if (arms === null || arms.length >= 3) stats.skipped++;
      }
    }
    const raise = ribbonLift(0) + cfg.decalLiftM;
    for (const rec of rctx.crosswalks.get(sim.key) ?? []) {
      const j = rec.junction >= 0 ? rctx.junctionById.get(rec.junction) : undefined;
      const q = crosswalkQuad(rctx, rec, j?.control === NodeControl.Signal, raise);
      if (!q) continue;
      addDecal(rb, q, Surf.Crosswalk, ox, oz, true);
      stats.crosswalks++;
    }
    for (const j of sim.junctions) {
      const planned = plan.junctions.get(j.id);
      for (const edge of approachesOf(j)) {
        stats.approaches++;
        const q = stopBarQuad(rctx, j, planned, edge, { depthM: cfg.stopBar.depthM, behindCrosswalkM: cfg.stopBar.behindCrosswalkM, raiseM: raise, layout: cfg });
        if (!q) continue;
        addDecal(rb, q, Surf.StopBar, ox, oz, false);
        stats.stopBars++;
      }
    }
  }
  // M02h2: the sidewalk ribbons, curbs and their walk mask, into the same object
  const side = curbs && anyCtx ? buildSidewalks(rb, sim, anyCtx, ox, oz, { profile: curbs.profile, plan, lift: ribbonLift, ...(curbs.debug ? { debug: true } : {}) }) : null;
  stats.roadVerts = rb.vertexCount;
  if (!side) return { mesh: rb.build('roads'), stats };
  return { mesh: rb.build('roads'), stats, curbs: side.stats, walk: side.walk, walkLiftM: side.liftM, ...(side.samples ? { samples: side.samples } : {}) };
}

// ---- the chunk -----------------------------------------------------------------------------------------------------------

export interface MeshChunkOptions {
  tier: QualityTierId;
  /**
   * Distance of the chunk centre from the stream focus when the job was requested: the profile's skip rule reads it, and a chunk
   * within `terrain.nearRingM` of it meshes its terrain at the profile's `nearStride` (M02g2).
   */
  distM: number;
  /** The upload cap of the tier (C13 `maxChunkUploadBytes`): a chunk over it drops its smallest buildings until it fits. */
  maxBytes?: number | null;
  /**
   * M02d1: `proxyOf` values (landmark index + 1) whose baked extrusions are left out because the landmark's glTF stands in their
   * place (`proxy-mask.ts`). Empty or absent: every proxy footprint is meshed as an ordinary building.
   */
  maskProxies?: readonly number[] | undefined;
  /**
   * M02h1: the sim chunks of the z7 tile the job decoded, `sim` among them. The roads of a junction are often in the next chunk of the
   * tile; the street markings plan their junction patches over all of them. Absent (or without `sim`): this chunk's roads only.
   */
  tile?: readonly SimChunk[] | undefined;
  /** M02h1: the street markings (the `road` attribute, junction patches, crosswalks, stop bars); defaults to the `world.look` flag. */
  markings?: boolean | undefined;
  /**
   * M02h2: curbs, gutters, sidewalk ribbons, lots and plazas, and the `min` profile's baked macro tone; defaults to the `world.look` flag
   * (off: the roads and the terrain of M02h1).
   */
  curbs?: boolean | undefined;
  /** M02h2, tests: keep the curb samples (`UnitMesh.curbSamples`). */
  curbDebug?: boolean | undefined;
}

/**
 * Meshes one L0 chunk. `render` may be null for a chunk that has a `p0` record but no `l0` (terrain and roads only).
 */
export function meshChunk(sim: SimChunk, render: RenderChunk | null, o: MeshChunkOptions): UnitMesh {
  const { id: profileId, profile } = profileOf(o.tier);
  const curbsOn = o.curbs ?? LOOK_FLAG;
  const bounds = chunkBounds(sim.key);
  const ox = bounds.minX;
  const oz = bounds.minZ;
  const objects: MeshBuffers[] = [];

  // M02g2: a profile with a finer stride for the chunks around the focus meshes those at `nearStride`, and every chunk of such a
  // profile hangs a skirt under its borders: two chunks of different strides meet at a seam one side of which the other cannot follow.
  const mixedStrides = profile.nearStride < profile.terrainStride;
  const near = mixedStrides && wantNearStride(false, o.distM);
  const stride = near ? profile.nearStride : profile.terrainStride;

  const stats: MeshStats = { triangles: 0, vertices: 0, buildings: 0, skipped: 0, maxBuildingTris: 0, filtered: false, bytes: 0, near, terrainStride: stride };
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
  // The terrain, now that the footprints are known: the posts next to one carry the contact shading.
  const cellM = sim.height.cellM;
  const ao = terrainAo(candidates.map((c) => c.ring), cellM);
  const plaza = curbsOn ? plazaPosts(sim, tileOf(sim, o.tile)) : null;
  const terrain = terrainMesh(sim.height.dm, sim.ground, cellM, stride, { ao, skirtM: mixedStrides ? MESHER.terrain.skirtM : 0, plaza });
  objects.push(terrain);

  // M02e: the facade record rides on the building vertices unless the tier's look is `legacy`.
  const withFacade = lookProfileFor(o.tier) !== 'legacy';
  const meshBuildings = (list: readonly Candidate[]): { built: MeshBuffers | null; maxTris: number } => {
    const bb = new MeshBuilder({ facade: withFacade });
    let maxTris = 0;
    for (const c of list) {
      const base = c.rec.baseDm / 10;
      const foot = wallFoot(sim.height.dm, cellM, stride, c.ring, base, (x, z) => sampleHeight(sim.height, ox + x, oz + z));
      const t = addBuilding(bb, c.ring, base, c.height, c.rec, profile, undefined, foot);
      if (t > maxTris) maxTris = t;
    }
    return { built: bb.build('buildings'), maxTris };
  };
  let kept: readonly Candidate[] = candidates;
  let b0 = meshBuildings(kept);
  const trees = treeRecords(sim, render, ox, oz, { stride, buildings: candidates.map((c) => ({ ring: c.ring, height: c.height })) });
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

  const roads = buildRoads(sim, ox, oz, o.markings ?? LOOK_FLAG, o.tile, curbsOn ? { profile: profileId, ...(o.curbDebug ? { debug: true } : {}) } : undefined);
  if (roads.mesh) {
    objects.push(roads.mesh);
    stats.markings = roads.stats;
    if (roads.curbs) stats.curbs = roads.curbs;
  }
  // M02h2: the `min` look has no macro term in its shader: the tone is baked into the terrain's and the roads' vertex colours
  if (curbsOn && lookProfileFor(o.tier) === 'min') {
    for (const obj of objects) if (obj.kind === 'terrain' || obj.kind === 'roads') bakeMacro(obj.positions, obj.colors, obj.surf, ox, oz);
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
    ...(roads.walk ? { walk: roads.walk, walkLiftM: roads.walkLiftM ?? 0 } : {}),
    ...(roads.samples ? { curbSamples: roads.samples } : {}),
  };
}

/**
 * The height of the drawn terrain mesh at local (x, z): the two triangles of the post cell, split along the diagonal the mesher
 * uses, at `stride`. The vertices are on the posts, so this is the surface the player sees, which on a coarser stride is not the
 * heightfield between the posts.
 */
export function meshSurfaceAt(heights: Int16Array, cellM: number, stride: 1 | 2 | 4, x: number, z: number): number {
  const step = cellM * stride;
  const verts = (POSTS - 1) / stride + 1;
  const fx = Math.min(verts - 1.000001, Math.max(0, x / step));
  const fz = Math.min(verts - 1.000001, Math.max(0, z / step));
  const i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  const h = (a: number, b: number): number => (heights[b * stride * POSTS + a * stride] as number) / 10;
  const h00 = h(i, j), h10 = h(i + 1, j), h01 = h(i, j + 1), h11 = h(i + 1, j + 1);
  // The triangles are (00, 01, 10) and (10, 01, 11): the diagonal runs from (1, 0) to (0, 1).
  return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

export interface TreeContext {
  /** The stride the chunk's terrain mesh was built at. */
  stride: 1 | 2 | 4;
  /** The footprints of the chunk (local metres): a tree stays under the nearest eave. */
  buildings: readonly { ring: readonly number[]; height: number }[];
}

/** The most a tree may be tall next to a building: its nearest eave within `tree.eaveRadiusM`, never under `minHeightM`. */
export function treeHeightCap(x: number, z: number, buildings: readonly { ring: readonly number[]; height: number }[]): number {
  const T = MESHER.tree;
  let best = Infinity;
  let eave = Infinity;
  for (const b of buildings) {
    const r = b.ring;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      const px = r[i] as number, pz = r[i + 1] as number;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
    if (x < minX - T.eaveRadiusM || x > maxX + T.eaveRadiusM || z < minZ - T.eaveRadiusM || z > maxZ + T.eaveRadiusM) continue;
    let d = pointInRing(r, x, z) ? 0 : Infinity;
    if (d !== 0) for (let i = 0, j = r.length / 2 - 1; i < r.length / 2; j = i++) d = Math.min(d, distToSegment(x, z, r[j * 2] as number, r[j * 2 + 1] as number, r[i * 2] as number, r[i * 2 + 1] as number));
    if (d <= T.eaveRadiusM && d < best) {
      best = d;
      eave = b.height;
    }
  }
  return Math.max(T.minHeightM, Math.min(T.maxHeightM, eave - T.eaveClearM));
}

/**
 * One record per tree: local x, y, z, scale, species. The foot is the lowest terrain under the trunk (the heightfield and the mesh
 * the player sees, nine points over the trunk disc) minus `tree.sinkM`, so no root hangs in the air on a slope; the scale puts the
 * 6.2 m cone between `minHeightM` and the cap under the nearest eave.
 */
function treeRecords(sim: SimChunk, render: RenderChunk | null, ox: number, oz: number, ctx: TreeContext): Float32Array {
  if (!render || render.trees.length < 4) return new Float32Array(0);
  const T = MESHER.tree;
  const count = Math.floor(render.trees.length / 4);
  const trees = new Float32Array(count * 5);
  const cellM = sim.height.cellM;
  for (let i = 0; i < count; i++) {
    const x = render.trees[i * 4] as number, z = render.trees[i * 4 + 1] as number;
    const lx = Math.min(256, Math.max(0, x - ox)), lz = Math.min(256, Math.max(0, z - oz));
    const s0 = (render.trees[i * 4 + 2] as number) || 1;
    const height = Math.max(T.minHeightM, Math.min(treeHeightCap(lx, lz, ctx.buildings), T.heightM * s0));
    const s = height / T.heightM;
    const r = T.trunkRadiusM * s;
    let low = Infinity;
    for (let k = 0; k < 9; k++) {
      const a = (k / 8) * Math.PI * 2;
      const px = Math.min(256, Math.max(0, lx + (k === 8 ? 0 : Math.cos(a) * r)));
      const pz = Math.min(256, Math.max(0, lz + (k === 8 ? 0 : Math.sin(a) * r)));
      low = Math.min(low, sampleHeight(sim.height, ox + px, oz + pz), meshSurfaceAt(sim.height.dm, cellM, ctx.stride, px, pz));
    }
    trees[i * 5] = lx;
    trees[i * 5 + 1] = low - T.sinkM;
    trees[i * 5 + 2] = lz;
    trees[i * 5 + 3] = s;
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
