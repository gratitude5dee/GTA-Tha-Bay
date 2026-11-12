/**
 * S11 far backdrop (02-world-maps.md section 4.3; DL-546): `world_pack/far-bay-dem`, `world_pack/far-bay-massing` and the
 * placeholder atlas `texture/far-bay-cards`.
 *
 * far-bay-dem     Terrarium z12 resampled to 256 m posts over `far` (z15 where only the area was fetched; a post with no tile
 *                 reads 0 m and is counted) plus a land mask. Inside the area box the baked terrain and land mask are used.
 * far-bay-massing buildings of 15 m and more as oriented boxes in 1 km cells, plus arterial road lines.
 * far-bay-cards   a 2048 x 1024 KTX2 atlas (Basis ETC1S, sRGB, mips) of 24 silhouette cards (8 clusters x 3 azimuths) drawn by the
 *                 software rasterizer `far/raster.ts` from the DEM above and seeded massing (M10d2; the PNG placeholder before it).
 *
 * Layout (BD-M02a2-09, a proposal): 64 B header { magic u32 'DVFA', version u8 1, kind u8 (1 dem, 2 massing), u16 0, bakeId[32],
 * then kind fields, zero padded }; dem fields i32 minX, i32 minZ, u16 nx, u16 nz, u16 cellM, then i16[nx * nz] in 0.1 m (z outer)
 * and ceil(nx * nz / 8) mask bytes (bit set = land); massing fields i32 originX, i32 originZ, u16 cellM, u32 boxes, u32 lines,
 * then per non-empty cell { u16 cx, u16 cz, u16 count, count * { i16 dx, i16 dz (0.1 m from the cell NW corner), u8 w, u8 d
 * (m), u16 hDm, u8 yaw (1/256 turn) } }, then lines { u8 cls, u16 n, n * { i32 x, i32 z } } in 0.1 m from the origin.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { WorldBounds } from '../../../../packages/shared/src/index.ts';
import { basisEncoder } from '../../../assets/src/import/texture-set.ts';
import { toolsRoot } from '../../../ci/lib/common.ts';
import { demSampler, rasterAtlas, type CardAtlasLayout, type CardCluster, type Rgba } from '../far/raster.ts';
import { Bytes, hexBytes } from '../pack/encode.ts';
import type { TerrariumMosaic } from '../sources/terrarium.ts';
import type { BuildingsProduct } from './s4-buildings.ts';
import type { SegB } from './s5-roads.ts';
import type { Bbox } from '../geom/rings.ts';

export const FAR_MAGIC = 0x41465644;
export const FAR_CELL_M = 256;
export const MASS_CELL_M = 1000;
export const MASS_MIN_HEIGHT_DM = 150;
export const CARD_COUNT = 24;

export interface FarInputs {
  bakeId: string;
  bounds: WorldBounds;
  mosaic12: TerrariumMosaic | null;
  mosaic15: TerrariumMosaic | null;
  area: Bbox;
  /** Baked terrain height inside the area box (null where no chunk exists) and the land test there. */
  areaHeight(x: number, z: number): number | null;
  isLand(x: number, z: number): boolean;
  buildings: BuildingsProduct;
  segs: readonly SegB[];
}
export interface FarOutput {
  dem: Uint8Array;
  massing: Uint8Array;
  /** The card atlas as RGBA; `encodeCards` makes the KTX2 pack of it. */
  cards: Rgba;
  report: { demPosts: number; demMissing: number; boxes: number; lines: number; cards: number; cardsFromDem: number };
}

/** The decoded DEM grid the cards are rasterised from (heights in m, land 0/1). */
export interface DemGrid { minX: number; minZ: number; nx: number; nz: number; cellM: number; heights: Float32Array; land: Uint8Array }

function header(kind: number, bakeId: string): Bytes {
  const w = new Bytes();
  w.u32(FAR_MAGIC); w.u8(1); w.u8(kind); w.u16(0); w.raw(hexBytes(bakeId));
  w.raw(new Uint8Array(64 - 40));
  return w;
}

export function runFar(inp: FarInputs): FarOutput {
  const f = inp.bounds.far;
  const minX = Math.floor(f.minX / FAR_CELL_M) * FAR_CELL_M, minZ = Math.floor(f.minZ / FAR_CELL_M) * FAR_CELL_M;
  const nx = Math.ceil((f.maxX - minX) / FAR_CELL_M) + 1, nz = Math.ceil((f.maxZ - minZ) / FAR_CELL_M) + 1;
  const useZ12 = inp.mosaic12 !== null && inp.mosaic12.tileCount > 0;
  const mosaic = useZ12 ? (inp.mosaic12 as TerrariumMosaic) : inp.mosaic15;
  const before = mosaic?.missing ?? 0;
  let w = header(1, inp.bakeId);
  w.i32(minX); w.i32(minZ); w.u16(nx); w.u16(nz); w.u16(FAR_CELL_M);
  const heights = new Int16Array(nx * nz);
  const mask = new Uint8Array(Math.ceil((nx * nz) / 8));
  const a = inp.area;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * FAR_CELL_M, z = minZ + j * FAR_CELL_M;
      let h: number, land: boolean;
      if (x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ) {
        const ah = inp.areaHeight(x, z);
        land = ah !== null && inp.isLand(x, z);
        h = ah ?? -10;
      } else {
        h = mosaic ? mosaic.atEnu(x, z) : 0;
        land = h > 0.5;
        if (!land) h = Math.max(-60, Math.min(h, -2.5));
      }
      heights[j * nx + i] = Math.max(-32767, Math.min(32767, Math.round(h * 10)));
      if (land) mask[(j * nx + i) >> 3] = (mask[(j * nx + i) >> 3] as number) | (1 << ((j * nx + i) & 7));
    }
  }
  for (let i = 0; i < heights.length; i++) w.i16(heights[i] as number);
  w.raw(mask);
  const dem = w.bytes();
  const demMissing = (mosaic?.missing ?? 0) - before;

  // massing
  const ox = Math.floor(f.minX / MASS_CELL_M) * MASS_CELL_M, oz = Math.floor(f.minZ / MASS_CELL_M) * MASS_CELL_M;
  const cells = new Map<string, { cx: number; cz: number; boxes: { dx: number; dz: number; w: number; d: number; h: number; yaw: number }[] }>();
  let boxes = 0;
  for (const [, list] of [...inp.buildings.byChunk.entries()].sort(([p], [q]) => (p < q ? -1 : 1))) {
    for (const b of list) {
      if (b.heightDm < MASS_MIN_HEIGHT_DM) continue;
      const r = b.prism;
      // orientation of the longest edge, then the box in that frame
      let best = 0, theta = 0;
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length;
        const dx = (r[j] as number) - (r[i] as number), dz = (r[j + 1] as number) - (r[i + 1] as number);
        const l = Math.hypot(dx, dz);
        if (l > best) { best = l; theta = Math.atan2(dz, dx); }
      }
      theta = ((theta % Math.PI) + Math.PI) % Math.PI;
      const c = Math.cos(theta), s = Math.sin(theta);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let i = 0; i < r.length; i += 2) {
        const u = (r[i] as number) * c + (r[i + 1] as number) * s, v = -(r[i] as number) * s + (r[i + 1] as number) * c;
        if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      const cxm = um * c - vm * s, czm = um * s + vm * c;
      const cx = Math.floor((cxm - ox) / MASS_CELL_M), cz = Math.floor((czm - oz) / MASS_CELL_M);
      const key = `${cx},${cz}`;
      const cell = cells.get(key) ?? { cx, cz, boxes: [] };
      cell.boxes.push({
        dx: Math.round((cxm - (ox + cx * MASS_CELL_M)) * 10), dz: Math.round((czm - (oz + cz * MASS_CELL_M)) * 10),
        w: Math.min(255, Math.max(1, Math.round(u1 - u0))), d: Math.min(255, Math.max(1, Math.round(v1 - v0))), h: b.heightDm, yaw: Math.round((theta / (2 * Math.PI)) * 256) & 255,
      });
      cells.set(key, cell);
      boxes++;
    }
  }
  const arterials = inp.segs.filter((s) => s.cls <= 2);
  w = header(2, inp.bakeId);
  w.i32(ox); w.i32(oz); w.u16(MASS_CELL_M); w.u32(boxes); w.u32(arterials.length);
  for (const cell of [...cells.values()].sort((p, q) => p.cz - q.cz || p.cx - q.cx)) {
    w.u16(cell.cx); w.u16(cell.cz); w.u16(cell.boxes.length);
    for (const b of cell.boxes.sort((p, q) => p.dz - q.dz || p.dx - q.dx || p.h - q.h)) { w.i16(b.dx); w.i16(b.dz); w.u8(b.w); w.u8(b.d); w.u16(b.h); w.u8(b.yaw); }
  }
  for (const s of arterials) {
    w.u8(s.cls); w.u16(s.pts.length / 2);
    for (let i = 0; i < s.pts.length; i += 2) { w.i32(Math.round(((s.pts[i] as number) - ox) * 10)); w.i32(Math.round(((s.pts[i + 1] as number) - oz) * 10)); }
  }
  const massing = w.bytes();

  const grid: DemGrid = { minX, minZ, nx, nz, cellM: FAR_CELL_M, heights: new Float32Array(nx * nz), land: new Uint8Array(nx * nz) };
  for (let p = 0; p < nx * nz; p++) {
    grid.heights[p] = (heights[p] as number) / 10;
    grid.land[p] = ((mask[p >> 3] as number) >> (p & 7)) & 1;
  }
  const cards = cardsRaster(grid);
  if (cards.cards > CARD_COUNT) throw new Error(`S11: ${cards.cards} cards, at most ${CARD_COUNT}`);
  return { dem, massing, cards: cards.atlas, report: { demPosts: nx * nz, demMissing, boxes, lines: arterials.length, cards: cards.cards, cardsFromDem: cards.demClusters } };
}

// ---- skyline cards (M10d2) -------------------------------------------------------------------------------------------------

/** `config/world/backdrop.json`: the atlas layout and the clusters the cards show. */
export const BACKDROP_PATH = path.join(toolsRoot, 'config', 'world', 'backdrop.json');
export function loadBackdrop(): { atlas: CardAtlasLayout; clusters: CardCluster[] } {
  return JSON.parse(readFileSync(BACKDROP_PATH, 'utf8')) as { atlas: CardAtlasLayout; clusters: CardCluster[] };
}

/**
 * Land posts of the DEM higher than `DEM_RELIEF_M` within a cluster's half width of its centre; the rasterizer uses the DEM when there
 * are at least 4 (a bake whose far terrain is flat or missing there, like `synth`, gets the seeded ridge instead).
 */
export const DEM_RELIEF_M = 30;
export function demLandPosts(g: DemGrid, c: CardCluster): number {
  let n = 0;
  const r = c.widthM / 2;
  for (let j = 0; j < g.nz; j++) {
    const z = g.minZ + j * g.cellM;
    if (Math.abs(z - c.enu[1]) > r) continue;
    for (let i = 0; i < g.nx; i++) {
      const x = g.minX + i * g.cellM;
      if (Math.abs(x - c.enu[0]) <= r && g.land[j * g.nx + i] && (g.heights[j * g.nx + i] as number) > DEM_RELIEF_M) n++;
    }
  }
  return n;
}

/** The card atlas of a DEM grid: one card per cluster and azimuth, RGBA (bake S11). */
export function cardsRaster(g: DemGrid): { atlas: Rgba; cards: number; demClusters: number } {
  const cfg = loadBackdrop();
  const sampler = demSampler(g);
  let demClusters = 0;
  const { atlas, cards } = rasterAtlas(cfg.clusters, cfg.atlas, sampler, (c) => {
    const land = demLandPosts(g, c) >= 4;
    if (land) demClusters++;
    return land;
  });
  return { atlas, cards, demClusters };
}

/** KTX2 of the atlas: Basis ETC1S, sRGB, full mip chain (the M10d0 encoder, BD-M10d0-01). */
export async function encodeCards(atlas: Rgba): Promise<Uint8Array> {
  const enc = await basisEncoder();
  return enc.encode({ width: atlas.width, height: atlas.height, data: atlas.data }, 'albedo');
}

/** A PNG of the atlas for people and for tests that read pixels (`far-bay-cards.preview.png` beside the packs, never a pack). */
export function cardsPreviewPng(atlas: Rgba): Uint8Array {
  const img = new PNG({ width: atlas.width, height: atlas.height });
  img.data.set(atlas.data);
  return PNG.sync.write(img, { colorType: 6, deflateLevel: 9 });
}

