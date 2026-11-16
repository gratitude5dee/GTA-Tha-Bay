/**
 * Ground cover (M02h3, C08 1.1): the cover class of every 4 m cell of a z9 chunk, carried in the l0 section 21 LANDUSE as
 * run-merged rectangles. Pure and synchronous (C02 lint applies).
 *
 * Section 21 record (C08 section 4): `u8 class, u8 n, n x (i16 dx, i16 dz)`, decimetres from the chunk's NW corner. A cover rectangle
 * is the polygon of its four corners (n = 4, clockwise from the NW corner in ENU x/z) with class 16 + `CoverClass` (17..23). Other
 * classes of the section (C08 1.0: park, grass, sand, plaza, rock, water edges) are skipped here, and a 1.0 index skips every class above
 * 16 (C08 section 8), so its packs decode to all `None`.
 *
 * Rectangles: the cells of each row are cut into runs of one class, and a run continues the rectangle above it when that rectangle
 * ends on the previous row with the same columns and class. Output order is by first row, then first column: identical covers give
 * identical bytes.
 */
import { C08_VERSION, type ChunkKey } from './c08.ts';
import { packSections } from './pack-codec.ts';

export const enum CoverClass { None = 0, Yard = 1, Dirt = 2, Mixed = 3, Driveway = 4, Vacant = 5, Scrub = 6, Park = 7 }
/** `CoverClass` names in id order 0..7. */
export const COVER_NAMES = ['none', 'yard', 'dirt', 'mixed', 'driveway', 'vacant', 'scrub', 'park'] as const;
export type CoverName = (typeof COVER_NAMES)[number];
/** Section 21 class code of cover class c is `COVER_CODE_BASE + c` (17..23). */
export const COVER_CODE_BASE = 16;
export const COVER_CLASS_MAX = 7;
/** Cells per side and per chunk; a cell is 4 m = 40 dm. */
export const COVER_SIDE = 64;
export const COVER_CELLS = COVER_SIDE * COVER_SIDE;
const CELL_DM = 40;
/** Section 21 id (C08 section 4). */
export const SEC_LANDUSE = 21;

export interface CoverRect {
  cls: number;
  /** First column and row, inclusive. */
  i0: number;
  j0: number;
  /** One past the last column and row. */
  i1: number;
  j1: number;
}

/** The cover of one chunk as run-merged rectangles (cells of class `None` are not covered). */
export function coverRects(cover: ArrayLike<number>): CoverRect[] {
  if (cover.length !== COVER_CELLS) throw new RangeError(`cover: ${cover.length} cells, expected ${COVER_CELLS}`);
  const done: CoverRect[] = [];
  // open rectangles that end on the previous row, keyed by i0
  let open = new Map<number, CoverRect>();
  for (let j = 0; j < COVER_SIDE; j++) {
    const next = new Map<number, CoverRect>();
    let i = 0;
    while (i < COVER_SIDE) {
      const c = cover[j * COVER_SIDE + i] as number;
      let e = i + 1;
      while (e < COVER_SIDE && (cover[j * COVER_SIDE + e] as number) === c) e++;
      if (c !== 0) {
        if (c < 0 || c > COVER_CLASS_MAX || !Number.isInteger(c)) throw new RangeError(`cover: class ${c} at cell ${i},${j}`);
        const above = open.get(i);
        if (above && above.i1 === e && above.cls === c) {
          above.j1 = j + 1;
          open.delete(i);
          next.set(i, above);
        } else next.set(i, { cls: c, i0: i, j0: j, i1: e, j1: j + 1 });
      }
      i = e;
    }
    for (const r of open.values()) done.push(r);
    open = next;
  }
  for (const r of open.values()) done.push(r);
  return done.sort((a, b) => a.j0 - b.j0 || a.i0 - b.i0);
}

/** Bytes of one record: class, n, four corners. */
export const COVER_RECORD_BYTES = 2 + 4 * 4;

/** The section 21 payload of one chunk's cover: `count` records, `data` bytes. */
export function encodeCoverRects(cover: ArrayLike<number>): { count: number; data: Uint8Array } {
  const rects = coverRects(cover);
  const data = new Uint8Array(rects.length * COVER_RECORD_BYTES);
  const dv = new DataView(data.buffer);
  let o = 0;
  for (const r of rects) {
    dv.setUint8(o, COVER_CODE_BASE + r.cls);
    dv.setUint8(o + 1, 4);
    const x0 = r.i0 * CELL_DM, z0 = r.j0 * CELL_DM, x1 = r.i1 * CELL_DM, z1 = r.j1 * CELL_DM;
    const pts = [x0, z0, x1, z0, x1, z1, x0, z1];
    for (let k = 0; k < 8; k++) dv.setInt16(o + 2 + k * 2, pts[k] as number, true);
    o += COVER_RECORD_BYTES;
  }
  return { count: rects.length, data };
}

/** True when the index's C08 version reads the cover codes (1.1 and later); a 1.0 reader skips classes above 16. */
export function readsCover(c08: string): boolean {
  const m = /^(\d+)\.(\d+)\./.exec(c08);
  if (!m) return false;
  const major = Number(m[1]), minor = Number(m[2]);
  return major > 1 || (major === 1 && minor >= 1);
}

/**
 * Decodes one section 21 payload to the 4,096 cover cells of its chunk. Records of other classes are read past; a record that runs past
 * the payload throws a RangeError. `c08` is the world index's version: a 1.0 index gives all `None`.
 */
export function decodeCoverSection(bytes: Uint8Array | null, count: number, c08: string = C08_VERSION): Uint8Array {
  const out = new Uint8Array(COVER_CELLS);
  if (!bytes || count === 0) return out;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cover = readsCover(c08);
  let o = 0;
  for (let k = 0; k < count; k++) {
    if (o + 2 > bytes.byteLength) throw new RangeError('cover: LANDUSE record passes the end of the section');
    const cls = dv.getUint8(o);
    const n = dv.getUint8(o + 1);
    if (o + 2 + n * 4 > bytes.byteLength) throw new RangeError('cover: LANDUSE record passes the end of the section');
    const c = cls - COVER_CODE_BASE;
    if (cover && c >= 1 && c <= COVER_CLASS_MAX && n > 0) {
      let minX = 32767, minZ = 32767, maxX = -32768, maxZ = -32768;
      for (let p = 0; p < n; p++) {
        const x = dv.getInt16(o + 2 + p * 4, true), z = dv.getInt16(o + 4 + p * 4, true);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const i0 = Math.max(0, Math.round(minX / CELL_DM)), i1 = Math.min(COVER_SIDE, Math.round(maxX / CELL_DM));
      const j0 = Math.max(0, Math.round(minZ / CELL_DM)), j1 = Math.min(COVER_SIDE, Math.round(maxZ / CELL_DM));
      for (let j = j0; j < j1; j++) out.fill(c, j * COVER_SIDE + i0, j * COVER_SIDE + Math.max(i0, i1));
    }
    o += 2 + n * 4;
  }
  if (o !== bytes.byteLength) throw new RangeError(`cover: ${bytes.byteLength - o} unread bytes in LANDUSE`);
  return out;
}

type Bytes = ArrayBuffer | ArrayBufferView;

/** The cover of chunk `key` of an l0 pack: 4,096 cells, all `None` when the chunk or its section 21 is absent. */
export function decodeCover(l0: Bytes, key: ChunkKey, c08: string = C08_VERSION): Uint8Array {
  const s = packSections(l0, SEC_LANDUSE).find((e) => e.key === key);
  return decodeCoverSection(s?.bytes ?? null, s?.count ?? 0, c08);
}

/** The covers of every chunk of an l0 pack (the tile decode reads them once). */
export function decodeCoverTile(l0: Bytes, c08: string = C08_VERSION): Map<ChunkKey, Uint8Array> {
  const out = new Map<ChunkKey, Uint8Array>();
  for (const s of packSections(l0, SEC_LANDUSE)) out.set(s.key, decodeCoverSection(s.bytes, s.count, c08));
  return out;
}

/** Cells per class (index = `CoverClass`). */
export function coverCounts(cover: ArrayLike<number>): number[] {
  const n = new Array<number>(COVER_CLASS_MAX + 1).fill(0);
  for (let i = 0; i < cover.length; i++) {
    const c = cover[i] as number;
    if (c >= 0 && c <= COVER_CLASS_MAX) n[c] = (n[c] as number) + 1;
  }
  return n;
}
