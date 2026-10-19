/**
 * S11 far backdrop (02-world-maps.md section 4.3; DL-546): `world_pack/far-bay-dem`, `world_pack/far-bay-massing` and the
 * placeholder atlas `texture/far-bay-cards`.
 *
 * far-bay-dem     Terrarium z12 resampled to 256 m posts over `far` (z15 where only the area was fetched; a post with no tile
 *                 reads 0 m and is counted) plus a land mask. Inside the area box the baked terrain and land mask are used.
 * far-bay-massing buildings of 15 m and more as oriented boxes in 1 km cells, plus arterial road lines.
 * far-bay-cards   a PNG atlas of 24 flat silhouette cards (8 clusters x 3 azimuths); the rasterised cards are M10d2's art pass.
 *
 * Layout (BD-M02a2-09, a proposal): 64 B header { magic u32 'DVFA', version u8 1, kind u8 (1 dem, 2 massing), u16 0, bakeId[32],
 * then kind fields, zero padded }; dem fields i32 minX, i32 minZ, u16 nx, u16 nz, u16 cellM, then i16[nx * nz] in 0.1 m (z outer)
 * and ceil(nx * nz / 8) mask bytes (bit set = land); massing fields i32 originX, i32 originZ, u16 cellM, u32 boxes, u32 lines,
 * then per non-empty cell { u16 cx, u16 cz, u16 count, count * { i16 dx, i16 dz (0.1 m from the cell NW corner), u8 w, u8 d
 * (m), u16 hDm, u8 yaw (1/256 turn) } }, then lines { u8 cls, u16 n, n * { i32 x, i32 z } } in 0.1 m from the origin.
 */
import { PNG } from 'pngjs';
import { Rng, fnv32, type WorldBounds } from '../../../../packages/shared/src/index.ts';
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
  cards: Uint8Array;
  report: { demPosts: number; demMissing: number; boxes: number; lines: number; cards: number };
}

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

  return { dem, massing, cards: cardsAtlas(), report: { demPosts: nx * nz, demMissing, boxes, lines: arterials.length, cards: CARD_COUNT } };
}

/** 2048 x 1024 atlas, 8 x 3 cards of 256 x 341 px: flat dark skyline silhouettes on transparent ground (placeholder art). */
export function cardsAtlas(): Uint8Array {
  const W = 2048, H = 1024, cw = 256, ch = 341;
  const img = new PNG({ width: W, height: H });
  for (let c = 0; c < CARD_COUNT; c++) {
    const rng = new Rng(fnv32(`far-bay-card:${c}`));
    const ox = (c % 8) * cw, oy = Math.floor(c / 8) * ch;
    let x = 0;
    while (x < cw) {
      const bw = 14 + (rng.nextU32() % 30);
      const bh = 40 + (rng.nextU32() % 200);
      const shade = 40 + (rng.nextU32() % 30);
      for (let xx = x; xx < Math.min(cw, x + bw); xx++) {
        for (let yy = ch - bh; yy < ch; yy++) {
          const i = ((oy + yy) * W + ox + xx) * 4;
          img.data[i] = shade; img.data[i + 1] = shade + 8; img.data[i + 2] = shade + 22; img.data[i + 3] = 255;
        }
      }
      x += bw;
    }
  }
  return PNG.sync.write(img, { colorType: 6, deflateLevel: 9 });
}
