/**
 * Decoders for the coarse render packs (`l1`, `l2`) and the far-bay backdrop packs (`far-bay-dem`, `far-bay-massing`) that bake
 * stage S11 writes (tools/map/src/stages/s11-lod.ts, s11-far.ts; Builder decisions BD-M02a2-08 and BD-M02a2-09, proposed to the
 * Architect as C08 layout clarifications). Pure and synchronous like `decodeP0`; the encoders are in tools/map.
 *
 *   l1 / l2   the DVWP v1 container (header, directory, section tables). The units of an l1 pack are z=7 tiles of the z=5 host
 *             block, the units of an l2 pack z=5 blocks of the z=3 host region, addressed by the (cx, cy) cell in the host. Sections:
 *             HEIGHT (1, 65 x 65 i16 in 0.1 m, posts 16 m / 64 m), MASSING (30, the BUILDING record with proxyOf 0), ROADLINE (31,
 *             u8 class, u8 n, n x (i16, i16)), LANDUSE (32, u8 class, u8 n, n x (i16, i16)). Every coordinate is an i16 in 0.1 m
 *             relative to the unit CENTRE; LANDUSE class codes are the C08 landuse order plus 8 for land outlines.
 *   far-bay   a 64 B header { magic u32 'DVFA', version u8, kind u8 (1 dem, 2 massing), u16, bakeId[32], zero padding } followed by
 *             the kind's fields (see `decodeFarDem`, `decodeFarMassing`).
 *
 * C02 lint applies: no Math.random, Date, transcendental Math.*, `**` or DOM.
 */
import { TWO_PI } from '../detmath.ts';
import { CHUNK_EDGE_M, GRID_MIN_M, TERRAIN_POSTS, type ChunkKey } from './c08.ts';
import {
  DIR_ENTRY_BYTES, FAMILY_CODE, HEADER_BYTES, PackDecodeError, SECTION_ENTRY_BYTES, readHeader, type PackHeader,
} from './pack-codec.ts';

type Bytes = ArrayBuffer | ArrayBufferView;

export const SEC_LOD = { HEIGHT: 1, MASSING: 30, ROADLINE: 31, LANDUSE: 32 } as const;
/** `LodLanduse.cls` value of a land outline polygon (everything else inside it is land; outside is water). */
export const LOD_LAND_CLASS = 8;
export const FAR_MAGIC = 0x41465644;

function viewOf(buf: Bytes): DataView {
  return ArrayBuffer.isView(buf) ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength) : new DataView(buf);
}

/** A bounds-checked little-endian cursor. */
class Cursor {
  constructor(private readonly dv: DataView, public pos: number, private readonly end: number) {}
  private need(n: number): number {
    const p = this.pos;
    if (p < 0 || p + n > this.end) throw new PackDecodeError('section', `read of ${n} B at ${p} passes ${this.end}`);
    this.pos = p + n;
    return p;
  }
  u8(): number { return this.dv.getUint8(this.need(1)); }
  u16(): number { return this.dv.getUint16(this.need(2), true); }
  i16(): number { return this.dv.getInt16(this.need(2), true); }
  u32(): number { return this.dv.getUint32(this.need(4), true); }
  i32(): number { return this.dv.getInt32(this.need(4), true); }
  bytes(n: number): Uint8Array {
    const p = this.need(n);
    return new Uint8Array(this.dv.buffer, this.dv.byteOffset + p, n);
  }
  get remaining(): number { return this.end - this.pos; }
}

export interface LodMass {
  baseDm: number;
  heightDm: number;
  kind: number;
  roof: number;
  palette: number;
  seed: number;
  /** x, z pairs, ENU metres (absolute). */
  ring: Float32Array;
}
export interface LodRoad {
  cls: number;
  /** x, z pairs, ENU metres (absolute). */
  pts: Float32Array;
}
export interface LodLanduse {
  cls: number;
  ring: Float32Array;
}
export interface LodUnit {
  level: 'l1' | 'l2';
  /** `7/x/y` for an l1 unit, `5/x/y` for an l2 unit. */
  key: ChunkKey;
  /** North-west corner and centre of the unit, ENU metres. */
  originX: number;
  originZ: number;
  centreX: number;
  centreZ: number;
  edgeM: number;
  postM: number;
  /** 65 x 65 posts, row-major with z outer, 0.1 m. */
  heights: Int16Array;
  massing: LodMass[];
  roads: LodRoad[];
  landuse: LodLanduse[];
}

interface UnitEntry { cx: number; cy: number; sections: Map<number, { count: number; offset: number; bytes: number }> }

function readUnits(dv: DataView, h: PackHeader): UnitEntry[] {
  const total = dv.byteLength;
  const dirEnd = h.dirOffset + h.chunkCount * DIR_ENTRY_BYTES;
  if (h.dirOffset < HEADER_BYTES || dirEnd > total) throw new PackDecodeError('bounds', 'directory passes the end of the buffer');
  const dir = new Cursor(dv, h.dirOffset, dirEnd);
  const out: UnitEntry[] = [];
  for (let i = 0; i < h.chunkCount; i++) {
    const cx = dir.u8();
    const cy = dir.u8();
    const sectionCount = dir.u16();
    const offset = dir.u32();
    if (cx > 3 || cy > 3) throw new PackDecodeError('bounds', `unit cell ${cx},${cy} is outside the host`);
    if (offset + sectionCount * SECTION_ENTRY_BYTES > total) throw new PackDecodeError('bounds', 'section table passes the end of the buffer');
    const t = new Cursor(dv, offset, offset + sectionCount * SECTION_ENTRY_BYTES);
    const sections = new Map<number, { count: number; offset: number; bytes: number }>();
    for (let s = 0; s < sectionCount; s++) {
      const id = t.u8();
      const enc = t.u8();
      const count = t.u16();
      const so = t.u32();
      const bytes = t.u32();
      if (enc !== 0) throw new PackDecodeError('section', `section ${id} has encoding ${enc}`);
      if (so + bytes > total) throw new PackDecodeError('section', `section ${id} passes the end of the buffer`);
      if (sections.has(id)) throw new PackDecodeError('section', `section ${id} appears twice`);
      sections.set(id, { count, offset: so, bytes });
    }
    out.push({ cx, cy, sections });
  }
  return out;
}

function readRing(c: Cursor, n: number, cx: number, cz: number): Float32Array {
  const ring = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    ring[i * 2] = cx + c.i16() / 10;
    ring[i * 2 + 1] = cz + c.i16() / 10;
  }
  return ring;
}

/** Decodes an `l1` or `l2` pack to its units. Throws `PackDecodeError`; never returns a partial result. */
export function decodeLod(buf: Bytes): LodUnit[] {
  const dv = viewOf(buf);
  const h = readHeader(dv);
  const level = h.family === FAMILY_CODE.l1 ? 'l1' : h.family === FAMILY_CODE.l2 ? 'l2' : null;
  if (!level) throw new PackDecodeError('family', `family ${h.family} is not l1 or l2`);
  const unitZ = level === 'l1' ? 7 : 5;
  const edgeM = CHUNK_EDGE_M[unitZ];
  const postM = edgeM / (TERRAIN_POSTS - 1);
  return readUnits(dv, h).map((e) => {
    const ux = h.tileX * 4 + e.cx;
    const uy = h.tileY * 4 + e.cy;
    const originX = GRID_MIN_M + ux * edgeM;
    const originZ = GRID_MIN_M + uy * edgeM;
    const centreX = originX + edgeM / 2;
    const centreZ = originZ + edgeM / 2;
    const sec = (id: number): { c: Cursor; count: number } | null => {
      const s = e.sections.get(id);
      return s ? { c: new Cursor(dv, s.offset, s.offset + s.bytes), count: s.count } : null;
    };

    const hs = sec(SEC_LOD.HEIGHT);
    const heights = new Int16Array(TERRAIN_POSTS * TERRAIN_POSTS);
    if (hs) {
      for (let i = 0; i < heights.length; i++) heights[i] = hs.c.i16();
      if (hs.c.remaining !== 0) throw new PackDecodeError('section', 'HEIGHT has unread bytes');
    }

    const massing: LodMass[] = [];
    const ms = sec(SEC_LOD.MASSING);
    if (ms) {
      for (let i = 0; i < ms.count; i++) {
        const baseDm = ms.c.i16();
        const heightDm = ms.c.u16();
        const kind = ms.c.u8();
        const rp = ms.c.u8();
        const seed = ms.c.u16();
        ms.c.u8(); // proxyOf, always 0 in l1 and l2
        const n = ms.c.u8();
        massing.push({ baseDm, heightDm, kind, roof: rp >> 6, palette: rp & 63, seed, ring: readRing(ms.c, n, centreX, centreZ) });
      }
      if (ms.c.remaining !== 0) throw new PackDecodeError('section', 'MASSING has unread bytes');
    }

    const roads: LodRoad[] = [];
    const rs = sec(SEC_LOD.ROADLINE);
    if (rs) {
      for (let i = 0; i < rs.count; i++) {
        const cls = rs.c.u8();
        const n = rs.c.u8();
        roads.push({ cls, pts: readRing(rs.c, n, centreX, centreZ) });
      }
      if (rs.c.remaining !== 0) throw new PackDecodeError('section', 'ROADLINE has unread bytes');
    }

    const landuse: LodLanduse[] = [];
    const ls = sec(SEC_LOD.LANDUSE);
    if (ls) {
      for (let i = 0; i < ls.count; i++) {
        const cls = ls.c.u8();
        const n = ls.c.u8();
        landuse.push({ cls, ring: readRing(ls.c, n, centreX, centreZ) });
      }
      if (ls.c.remaining !== 0) throw new PackDecodeError('section', 'LANDUSE has unread bytes');
    }

    return { level, key: `${unitZ}/${ux}/${uy}` as ChunkKey, originX, originZ, centreX, centreZ, edgeM, postM, heights, massing, roads, landuse };
  });
}

// ---- far-bay ------------------------------------------------------------------------------------------------------------

function farCursor(buf: Bytes, kind: 1 | 2): { c: Cursor; bakeId: string } {
  const dv = viewOf(buf);
  if (dv.byteLength < HEADER_BYTES) throw new PackDecodeError('bounds', `${dv.byteLength} B is shorter than the far header`);
  const c = new Cursor(dv, 0, dv.byteLength);
  if (c.u32() !== FAR_MAGIC) throw new PackDecodeError('magic', 'bad far-bay magic');
  const version = c.u8();
  if (version !== 1) throw new PackDecodeError('version', `far-bay version ${version}`);
  const k = c.u8();
  if (k !== kind) throw new PackDecodeError('family', `far-bay kind ${k}, expected ${kind}`);
  c.u16();
  let bakeId = '';
  for (const b of c.bytes(32)) bakeId += b.toString(16).padStart(2, '0');
  c.pos = HEADER_BYTES;
  return { c, bakeId };
}

export interface FarDem {
  bakeId: string;
  minX: number;
  minZ: number;
  nx: number;
  nz: number;
  cellM: number;
  /** nx x nz posts, row-major with z outer, 0.1 m. */
  heights: Int16Array;
  /** Land bit per post (1 = land), same order. */
  land: Uint8Array;
}

/** `world_pack/far-bay-dem`: Terrarium z12 resampled to 256 m posts plus a land mask. */
export function decodeFarDem(buf: Bytes): FarDem {
  const { c, bakeId } = farCursor(buf, 1);
  const minX = c.i32();
  const minZ = c.i32();
  const nx = c.u16();
  const nz = c.u16();
  const cellM = c.u16();
  const n = nx * nz;
  const heights = new Int16Array(n);
  for (let i = 0; i < n; i++) heights[i] = c.i16();
  const mask = c.bytes(Math.ceil(n / 8));
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = ((mask[i >> 3] as number) >> (i & 7)) & 1;
  if (c.remaining !== 0) throw new PackDecodeError('section', 'far-bay-dem has unread bytes');
  return { bakeId, minX, minZ, nx, nz, cellM, heights, land };
}

export interface FarMassing {
  bakeId: string;
  originX: number;
  originZ: number;
  cellM: number;
  /** Per box: x, z (centre, ENU m), width, depth, height (m), yaw (radians). Six floats per box. */
  boxes: Float32Array;
  /** Arterial lines: class and x, z pairs (ENU m). */
  lines: LodRoad[];
}

/** `world_pack/far-bay-massing`: buildings of 15 m and more as oriented boxes in 1 km cells, plus arterial lines. */
export function decodeFarMassing(buf: Bytes): FarMassing {
  const { c, bakeId } = farCursor(buf, 2);
  const originX = c.i32();
  const originZ = c.i32();
  const cellM = c.u16();
  const boxCount = c.u32();
  const lineCount = c.u32();
  const boxes = new Float32Array(boxCount * 6);
  let b = 0;
  while (b < boxCount) {
    const cx = c.u16();
    const cz = c.u16();
    const n = c.u16();
    for (let i = 0; i < n && b < boxCount; i++, b++) {
      const dx = c.i16();
      const dz = c.i16();
      const w = c.u8();
      const d = c.u8();
      const hDm = c.u16();
      const yaw = c.u8();
      boxes[b * 6] = originX + cx * cellM + dx / 10;
      boxes[b * 6 + 1] = originZ + cz * cellM + dz / 10;
      boxes[b * 6 + 2] = w;
      boxes[b * 6 + 3] = d;
      boxes[b * 6 + 4] = hDm / 10;
      boxes[b * 6 + 5] = (yaw * TWO_PI) / 256;
    }
  }
  const lines: LodRoad[] = [];
  for (let i = 0; i < lineCount; i++) {
    const cls = c.u8();
    const n = c.u16();
    const pts = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      pts[k * 2] = originX + c.i32() / 10;
      pts[k * 2 + 1] = originZ + c.i32() / 10;
    }
    lines.push({ cls, pts });
  }
  if (c.remaining !== 0) throw new PackDecodeError('section', 'far-bay-massing has unread bytes');
  return { bakeId, originX, originZ, cellM, boxes, lines };
}
