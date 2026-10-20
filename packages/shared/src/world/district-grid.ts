/**
 * `data/district-grid.v1` codec (M02c1; 02-world-contracts.md `WorldQuery.nhoodAt`): a coarse raster of Analysis Neighborhood
 * indices over the play box, one `u8` per 64 m cell (255 = none), so `nhoodAt` and `districtAt` answer without a polygon test.
 * Pure and deterministic (C02 lint applies): the same grid encodes to the same bytes and decode then encode is the identity.
 *
 * Layout (a C08 clarification proposal, listed in the M02c1 report; little-endian, no padding):
 *   header 52 B   magic u32 0x47445644 ('D' 'V' 'D' 'G'), version u8 = 1, reserved u8 = 0, cellM u16,
 *                 minX i32 and minZ i32 (ENU metres of the grid's NW corner), cols u16, rows u16, bakeId[32] raw SHA-256
 *   table         count u8, then count x (len u8, ASCII slug): the neighbourhood slug of index 0 ... count - 1, in index order
 *   cells         cols x rows u8, row-major with z outer, 255 = none
 */

export const DISTRICT_GRID_MAGIC = 0x47445644;
export const DISTRICT_GRID_VERSION = 1;
export const DISTRICT_GRID_HEADER_BYTES = 52;
export const NHOOD_NONE = 255;

export interface DistrictGrid {
  bakeId: string;
  cellM: number;
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  /** Neighbourhood slugs, index order (the index stored in the cells and in `RoadEdge.nhood`). */
  nhoods: string[];
  cells: Uint8Array;
}

export class DistrictGridDecodeError extends Error {
  constructor(detail: string) {
    super(`district-grid decode failed: ${detail}`);
    this.name = 'DistrictGridDecodeError';
  }
}

const HEX = '0123456789abcdef';

function bakeIdBytes(hex: string): Uint8Array {
  if (hex.length !== 64) throw new RangeError('encodeDistrictGrid: bakeId must be 64 lowercase hex characters');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const hi = HEX.indexOf(hex.charAt(i * 2)), lo = HEX.indexOf(hex.charAt(i * 2 + 1));
    if (hi < 0 || lo < 0) throw new RangeError('encodeDistrictGrid: bakeId must be 64 lowercase hex characters');
    out[i] = hi * 16 + lo;
  }
  return out;
}

function bakeIdHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX.charAt((b[i] as number) >> 4) + HEX.charAt((b[i] as number) & 15);
  return s;
}

export function encodeDistrictGrid(g: DistrictGrid): Uint8Array {
  if (g.cells.length !== g.cols * g.rows) throw new RangeError('encodeDistrictGrid: cells must hold cols x rows bytes');
  if (g.nhoods.length > 255) throw new RangeError('encodeDistrictGrid: at most 255 neighbourhood slugs');
  let table = 1;
  for (const s of g.nhoods) {
    if (s.length > 255) throw new RangeError('encodeDistrictGrid: slug longer than 255 characters');
    table += 1 + s.length;
  }
  const out = new Uint8Array(DISTRICT_GRID_HEADER_BYTES + table + g.cells.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, DISTRICT_GRID_MAGIC, true);
  dv.setUint8(4, DISTRICT_GRID_VERSION);
  dv.setUint16(6, g.cellM, true);
  dv.setInt32(8, g.minX, true);
  dv.setInt32(12, g.minZ, true);
  dv.setUint16(16, g.cols, true);
  dv.setUint16(18, g.rows, true);
  out.set(bakeIdBytes(g.bakeId), 20);
  let o = DISTRICT_GRID_HEADER_BYTES;
  out[o++] = g.nhoods.length;
  for (const s of g.nhoods) {
    out[o++] = s.length;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 127) throw new RangeError(`encodeDistrictGrid: slug "${s}" is not ASCII`);
      out[o++] = c;
    }
  }
  out.set(g.cells, o);
  return out;
}

export function decodeDistrictGrid(buf: ArrayBuffer | ArrayBufferView): DistrictGrid {
  const u8 = ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
  if (u8.length < DISTRICT_GRID_HEADER_BYTES + 1) throw new DistrictGridDecodeError(`${u8.length} B is shorter than the header`);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== DISTRICT_GRID_MAGIC) throw new DistrictGridDecodeError('bad magic');
  if (dv.getUint8(4) !== DISTRICT_GRID_VERSION) throw new DistrictGridDecodeError(`version ${dv.getUint8(4)}`);
  const cellM = dv.getUint16(6, true);
  const minX = dv.getInt32(8, true), minZ = dv.getInt32(12, true);
  const cols = dv.getUint16(16, true), rows = dv.getUint16(18, true);
  let o = DISTRICT_GRID_HEADER_BYTES;
  const count = u8[o++] as number;
  const nhoods: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = u8[o++] as number;
    if (o + len > u8.length) throw new DistrictGridDecodeError('slug table runs past the end');
    let s = '';
    for (let k = 0; k < len; k++) s += String.fromCharCode(u8[o + k] as number);
    o += len;
    nhoods.push(s);
  }
  if (u8.length !== o + cols * rows) throw new DistrictGridDecodeError('length does not match the dimensions');
  return { bakeId: bakeIdHex(u8.subarray(20, 52)), cellM, minX, minZ, cols, rows, nhoods, cells: u8.slice(o, o + cols * rows) };
}

/** Neighbourhood index at an ENU point: 0 to 40, or 255 when none or outside the grid. */
export function nhoodIndexAt(g: DistrictGrid, x: number, z: number): number {
  const i = Math.floor((x - g.minX) / g.cellM);
  const j = Math.floor((z - g.minZ) / g.cellM);
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return NHOOD_NONE;
  return g.cells[j * g.cols + i] as number;
}
