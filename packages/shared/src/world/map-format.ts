/**
 * `map_data/sf-map.v1`, `map_data/sf-map-bldg.v1` and `map_data/sf-geocode.v1` (M02c2; 02-world-maps.md section 1): the pure reader and
 * writer the bake (stage S12) and the client views share. Little-endian, integers only, no padding; every writer is deterministic
 * (same input, same bytes) and every reader rejects a damaged buffer with a `MapFormatError`. C02 lint applies.
 *
 * Common coding: unsigned varints (LEB128), zigzag for signed values, strings as varint length + UTF-8, coordinates in half metres
 * (0.5 m units, the quantisation of 02-world-maps.md section 1). Points of a chunk record are relative to the chunk's NW corner of
 * its level (z9: 256 m, z7: 1024 m, z5: 4096 m), the first point absolute and the rest deltas.
 *
 * `sf-map.v1` ("DVMP", version 1)
 *   header 44 B  magic u32, version u8, flags u8, reserved u16, bakeId[32] raw SHA-256, sectionCount u32
 *   directory    sectionCount x { id u32, offset u32, length u32 }
 *   sections     1 strings, 2 neighbourhoods (41 polygons + label point + tier), 3 polygons (land, water, piers, landuse; DP 5 m),
 *                4 labels (landmarks and points of interest), 5 hillshade (32 m cells, u8, RLE), 6/7/8 street records at z9, z7, z5
 *   street level index: count, then { cx, cy, byteLength } per chunk (row-major, cy outer); payloads follow in the same order. A payload
 *   is { lineCount, lines: { cnn, classcode u8, flags u8, nameId, pointCount, points } }. Every street segment carries its `cnn`.
 *
 * `sf-map-bldg.v1` ("DVMB", version 1): header 44 B (as above, sectionCount unused), then one z9 chunk index and payloads of
 * { height class u8, ring points } footprints.
 *
 * `sf-geocode.v1` ("DVGC", version 1): header 44 B, a street table sorted by (name, type), a chunk table, the base addresses sorted by
 * (street, number, suffix) with { streetId u16, number u16, suffix u8, x i16, z i16, chunk u16 } and a parallel `cnn` array, and the name
 * index of landmarks, points of interest and neighbourhoods sorted by lower-case label.
 */
import { CHUNK_EDGE_M, GRID_MIN_M } from './c08.ts';

export class MapFormatError extends Error {
  constructor(what: string, detail: string) {
    super(`${what} decode failed: ${detail}`);
    this.name = 'MapFormatError';
  }
}

export const MAP_MAGIC = 0x504d5644; // 'D' 'V' 'M' 'P'
export const BLDG_MAGIC = 0x424d5644; // 'D' 'V' 'M' 'B'
export const GEOCODE_MAGIC = 0x43475644; // 'D' 'V' 'G' 'C'
export const MAP_VERSION = 1;
export const MAP_HEADER_BYTES = 44;
/** Map units per metre: 0.5 m quantisation. */
export const MAP_UNITS_PER_M = 2;

export type MapLevel = 9 | 7 | 5;
export const MAP_LEVELS: readonly MapLevel[] = [9, 7, 5];
export const levelEdgeM = (l: MapLevel): number => CHUNK_EDGE_M[l];

/** Polygon kinds of section 3. */
export const enum MapPolyKind {
  Land = 1,
  Water = 2,
  Pier = 3,
  /** `LANDUSE_ORDER` of the bake plus this base: residential 8, commercial 9, industrial 10, grass 11, park 12, sand 13, plaza 14, rock 15. */
  LanduseBase = 8,
}
export const MAP_LANDUSE_KINDS = ['residential', 'commercial', 'industrial', 'grass', 'park', 'sand', 'plaza', 'rock'] as const;

/** Bits of `MapPoly.levels`: the levels a polygon is drawn at. */
export const LEVEL_BIT: Record<MapLevel, number> = { 9: 1, 7: 2, 5: 4 };

/** Bits of `MapStreetLine.flags`. */
export const STREET_ONEWAY_MASK = 3; // 0 both ways, 1 'F' (along the line), 2 'T' (against it)
export const STREET_BRIDGE = 4;
export const STREET_TUNNEL = 8;

export const enum LabelKind {
  Landmark = 4,
  Poi = 5,
  Transit = 6,
}

// ---- byte coding ------------------------------------------------------------------------------------------------------

class Writer {
  buf = new Uint8Array(1 << 16);
  len = 0;
  private need(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  u8(v: number): void {
    this.need(1);
    this.buf[this.len++] = v & 255;
  }
  u16(v: number): void {
    this.need(2);
    this.buf[this.len++] = v & 255;
    this.buf[this.len++] = (v >>> 8) & 255;
  }
  u32(v: number): void {
    this.need(4);
    this.buf[this.len++] = v & 255;
    this.buf[this.len++] = (v >>> 8) & 255;
    this.buf[this.len++] = (v >>> 16) & 255;
    this.buf[this.len++] = (v >>> 24) & 255;
  }
  i16(v: number): void {
    this.u16(v < 0 ? v + 65536 : v);
  }
  /** Unsigned varint of an integer 0 to 2^53 - 1 (no bit operators beyond 32 bits). */
  vu(v: number): void {
    if (!(v >= 0) || v !== Math.floor(v)) throw new RangeError(`varint needs a non-negative integer, got ${v}`);
    this.need(10);
    let x = v;
    while (x >= 128) {
      this.buf[this.len++] = (x % 128) + 128;
      x = Math.floor(x / 128);
    }
    this.buf[this.len++] = x;
  }
  vs(v: number): void {
    this.vu(v < 0 ? -2 * v - 1 : 2 * v);
  }
  bytes(b: Uint8Array): void {
    this.need(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  str(s: string): void {
    const b = utf8(s);
    this.vu(b.length);
    this.bytes(b);
  }
  out(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function fromUtf8(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++] as number;
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | ((b[i++] as number) & 63));
    else if (c < 0xf0) {
      s += String.fromCharCode(((c & 15) << 12) | (((b[i] as number) & 63) << 6) | ((b[i + 1] as number) & 63));
      i += 2;
    } else {
      const cp = ((c & 7) << 18) | (((b[i] as number) & 63) << 12) | (((b[i + 1] as number) & 63) << 6) | ((b[i + 2] as number) & 63);
      i += 3;
      const v = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 1023));
    }
  }
  return s;
}

class Reader {
  pos: number;
  constructor(readonly b: Uint8Array, start: number, readonly end: number, private readonly what: string) {
    this.pos = start;
  }
  fail(detail: string): never {
    throw new MapFormatError(this.what, detail);
  }
  private chk(n: number): void {
    if (this.pos + n > this.end) this.fail('runs past the end');
  }
  u8(): number {
    this.chk(1);
    return this.b[this.pos++] as number;
  }
  u16(): number {
    this.chk(2);
    const v = (this.b[this.pos] as number) | ((this.b[this.pos + 1] as number) << 8);
    this.pos += 2;
    return v;
  }
  i16(): number {
    const v = this.u16();
    return v >= 32768 ? v - 65536 : v;
  }
  u32(): number {
    this.chk(4);
    const p = this.pos;
    const v = ((this.b[p] as number) | ((this.b[p + 1] as number) << 8) | ((this.b[p + 2] as number) << 16) | ((this.b[p + 3] as number) << 24)) >>> 0;
    this.pos += 4;
    return v;
  }
  vu(): number {
    let v = 0;
    let mul = 1;
    for (let i = 0; i < 9; i++) {
      this.chk(1);
      const c = this.b[this.pos++] as number;
      v += (c & 127) * mul;
      if (c < 128) return v;
      mul *= 128;
    }
    return this.fail('varint too long');
  }
  vs(): number {
    const z = this.vu();
    return z % 2 === 1 ? -(z + 1) / 2 : z / 2;
  }
  take(n: number): Uint8Array {
    this.chk(n);
    const s = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
  str(): string {
    return fromUtf8(this.take(this.vu()));
  }
}

const HEX = '0123456789abcdef';
function hexBytes(hex: string, what: string): Uint8Array {
  if (hex.length !== 64) throw new RangeError(`${what}: bakeId must be 64 lowercase hex characters`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const hi = HEX.indexOf(hex.charAt(i * 2)), lo = HEX.indexOf(hex.charAt(i * 2 + 1));
    if (hi < 0 || lo < 0) throw new RangeError(`${what}: bakeId must be 64 lowercase hex characters`);
    out[i] = hi * 16 + lo;
  }
  return out;
}
function bytesHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX.charAt((b[i] as number) >> 4) + HEX.charAt((b[i] as number) & 15);
  return s;
}

const cmpNum = (a: number, b: number): number => a - b;
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Writes the 44 B header plus the directory and returns the file. `sections` are in id order. */
function assemble(magic: number, bakeId: string, sections: readonly { id: number; bytes: Uint8Array }[], what: string): Uint8Array {
  const w = new Writer();
  w.u32(magic);
  w.u8(MAP_VERSION);
  w.u8(0);
  w.u16(0);
  w.bytes(hexBytes(bakeId, what));
  w.u32(sections.length);
  let off = MAP_HEADER_BYTES + sections.length * 12;
  for (const s of sections) {
    w.u32(s.id);
    w.u32(off);
    w.u32(s.bytes.length);
    off += s.bytes.length;
  }
  for (const s of sections) w.bytes(s.bytes);
  return w.out();
}

interface Opened {
  bakeId: string;
  sections: Map<number, { start: number; end: number }>;
}

function open(buf: ArrayBuffer | ArrayBufferView, magic: number, what: string): { u8: Uint8Array; o: Opened } {
  const u8 = ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
  if (u8.length < MAP_HEADER_BYTES) throw new MapFormatError(what, `${u8.length} B is shorter than the header`);
  const r = new Reader(u8, 0, u8.length, what);
  if (r.u32() !== magic) r.fail('bad magic');
  const v = r.u8();
  if (v !== MAP_VERSION) r.fail(`version ${v}`);
  r.u8();
  r.u16();
  const bakeId = bytesHex(r.take(32));
  const n = r.u32();
  const sections = new Map<number, { start: number; end: number }>();
  for (let i = 0; i < n; i++) {
    const id = r.u32(), off = r.u32(), len = r.u32();
    if (off + len > u8.length) r.fail(`section ${id} runs past the end`);
    sections.set(id, { start: off, end: off + len });
  }
  return { u8, o: { bakeId, sections } };
}

// ---- geometry helpers ---------------------------------------------------------------------------------------------------

/** Clips one polyline (x, z pairs) to the half-open rectangle; the pieces keep the direction of the line. */
export function clipPolylineToRect(pts: ArrayLike<number>, minX: number, minZ: number, maxX: number, maxZ: number): number[][] {
  const out: number[][] = [];
  let cur: number[] | null = null;
  const n = Math.floor(pts.length / 2);
  for (let i = 0; i + 1 < n; i++) {
    const x0 = pts[i * 2] as number, z0 = pts[i * 2 + 1] as number, x1 = pts[i * 2 + 2] as number, z1 = pts[i * 2 + 3] as number;
    // Liang-Barsky
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dz = z1 - z0;
    const p = [-dx, dx, -dz, dz];
    const q = [x0 - minX, maxX - x0, z0 - minZ, maxZ - z0];
    let inside = true;
    for (let k = 0; k < 4; k++) {
      const pk = p[k] as number, qk = q[k] as number;
      if (pk === 0) {
        if (qk < 0) { inside = false; break; }
      } else {
        const t = qk / pk;
        if (pk < 0) { if (t > t1) { inside = false; break; } if (t > t0) t0 = t; }
        else { if (t < t0) { inside = false; break; } if (t < t1) t1 = t; }
      }
    }
    if (!inside || t0 > t1) {
      cur = null;
      continue;
    }
    const ax = x0 + dx * t0, az = z0 + dz * t0, bx = x0 + dx * t1, bz = z0 + dz * t1;
    if (cur === null || t0 > 0) {
      cur = [ax, az];
      out.push(cur);
    }
    cur.push(bx, bz);
    if (t1 < 1) cur = null;
  }
  return out;
}

const qUnits = (m: number): number => Math.round(m * MAP_UNITS_PER_M);

function putPoints(w: Writer, units: ArrayLike<number>): void {
  const n = Math.floor(units.length / 2);
  w.vu(n);
  let px = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    const x = units[i * 2] as number, z = units[i * 2 + 1] as number;
    w.vs(x - px);
    w.vs(z - pz);
    px = x;
    pz = z;
  }
}

function getPoints(r: Reader, into: 'i16' | 'i32'): Int16Array | Int32Array {
  const n = r.vu();
  if (n * 2 > r.end - r.pos + 2) r.fail('point count runs past the end');
  const out = into === 'i16' ? new Int16Array(n * 2) : new Int32Array(n * 2);
  let px = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    px += r.vs();
    pz += r.vs();
    out[i * 2] = px;
    out[i * 2 + 1] = pz;
  }
  return out;
}

// ---- sf-map.v1 --------------------------------------------------------------------------------------------------------------

export interface MapSourcePoly {
  kind: number;
  /** OR of `LEVEL_BIT`. */
  levels: number;
  /** ENU metres, flat x, z pairs; ring 0 is the outer boundary, the rest are holes. */
  rings: ArrayLike<number>[];
}
export interface MapSourceHood {
  name: string;
  slug: string;
  /** 1 largest to 3 smallest: the label tier. */
  tier: 1 | 2 | 3;
  labelX: number;
  labelZ: number;
  polys: { rings: ArrayLike<number>[] }[];
}
export interface MapSourceLabel { kind: number; text: string; x: number; z: number }
export interface MapSourceStreet {
  cnn: number;
  /** DataSF `classcode`, 0 to 6. */
  classcode: number;
  /** 0 both ways, 1 `F`, 2 `T`. */
  oneway: 0 | 1 | 2;
  bridge: boolean;
  tunnel: boolean;
  name: string;
  /** ENU metres at full resolution (z9 records). */
  pts: ArrayLike<number>;
  /** The line for the z7 and z5 records (already simplified); null when the class is not drawn at that level. */
  pts7: ArrayLike<number> | null;
  pts5: ArrayLike<number> | null;
}
export interface MapSourceHill { cellM: number; minX: number; minZ: number; cols: number; rows: number; cells: Uint8Array }
export interface MapSource {
  bakeId: string;
  hoods: MapSourceHood[];
  polys: MapSourcePoly[];
  labels: MapSourceLabel[];
  hill: MapSourceHill | null;
  streets: MapSourceStreet[];
}

const SEC_STRINGS = 1, SEC_HOODS = 2, SEC_POLYS = 3, SEC_LABELS = 4, SEC_HILL = 5;
const SEC_STREETS: Record<MapLevel, number> = { 9: 6, 7: 7, 5: 8 };

function putRingsAbs(w: Writer, rings: readonly ArrayLike<number>[]): void {
  w.vu(rings.length);
  for (const r of rings) {
    const u: number[] = new Array(r.length);
    for (let i = 0; i < r.length; i++) u[i] = qUnits(r[i] as number);
    putPoints(w, u);
  }
}
function getRingsAbs(r: Reader): Int32Array[] {
  const n = r.vu();
  if (n > 100000) r.fail('ring count');
  const out: Int32Array[] = [];
  for (let i = 0; i < n; i++) out.push(getPoints(r, 'i32') as Int32Array);
  return out;
}

export function encodeMap(src: MapSource): Uint8Array {
  const strings: string[] = [];
  const stringId = new Map<string, number>();
  const intern = (s: string): number => {
    let id = stringId.get(s);
    if (id === undefined) {
      id = strings.length;
      strings.push(s);
      stringId.set(s, id);
    }
    return id;
  };

  const hoods = new Writer();
  hoods.vu(src.hoods.length);
  for (const h of src.hoods) {
    hoods.vu(intern(h.name));
    hoods.vu(intern(h.slug));
    hoods.u8(h.tier);
    hoods.vs(qUnits(h.labelX));
    hoods.vs(qUnits(h.labelZ));
    hoods.vu(h.polys.length);
    for (const p of h.polys) putRingsAbs(hoods, p.rings);
  }

  const polys = new Writer();
  polys.vu(src.polys.length);
  for (const p of src.polys) {
    polys.u8(p.kind);
    polys.u8(p.levels);
    putRingsAbs(polys, p.rings);
  }

  const labels = new Writer();
  labels.vu(src.labels.length);
  for (const l of src.labels) {
    labels.u8(l.kind);
    labels.vu(intern(l.text));
    labels.vs(qUnits(l.x));
    labels.vs(qUnits(l.z));
  }

  const hill = new Writer();
  if (src.hill) {
    const h = src.hill;
    if (h.cells.length !== h.cols * h.rows) throw new RangeError('encodeMap: hillshade cells must hold cols x rows bytes');
    hill.u8(1);
    hill.u16(h.cellM);
    hill.u32(h.minX >>> 0);
    hill.u32(h.minZ >>> 0);
    hill.u16(h.cols);
    hill.u16(h.rows);
    let i = 0;
    while (i < h.cells.length) {
      const v = h.cells[i] as number;
      let j = i + 1;
      while (j < h.cells.length && h.cells[j] === v) j++;
      hill.u8(v);
      hill.vu(j - i);
      i = j;
    }
  } else hill.u8(0);

  // street records per level
  const streetSecs: { id: number; bytes: Uint8Array }[] = [];
  for (const level of MAP_LEVELS) {
    const edge = CHUNK_EDGE_M[level];
    const byChunk = new Map<number, { cx: number; cy: number; lines: { s: MapSourceStreet; pts: number[] }[] }>();
    const stride = Math.floor(131072 / edge) + 2;
    for (const s of src.streets) {
      const line = level === 9 ? s.pts : level === 7 ? s.pts7 : s.pts5;
      if (!line || line.length < 4) continue;
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i + 1 < line.length; i += 2) {
        const x = line[i] as number, z = line[i + 1] as number;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const cx0 = Math.floor((minX - GRID_MIN_M) / edge), cx1 = Math.floor((maxX - GRID_MIN_M) / edge);
      const cy0 = Math.floor((minZ - GRID_MIN_M) / edge), cy1 = Math.floor((maxZ - GRID_MIN_M) / edge);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const ox = GRID_MIN_M + cx * edge, oz = GRID_MIN_M + cy * edge;
          const pieces = cx0 === cx1 && cy0 === cy1 ? [Array.from(line as ArrayLike<number>)] : clipPolylineToRect(line, ox, oz, ox + edge, oz + edge);
          for (const pc of pieces) {
            if (pc.length < 4) continue;
            const key = cy * stride + cx;
            let c = byChunk.get(key);
            if (!c) {
              c = { cx, cy, lines: [] };
              byChunk.set(key, c);
            }
            c.lines.push({ s, pts: pc });
          }
        }
      }
    }
    const chunks = [...byChunk.values()].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    const idx = new Writer();
    const payloads: Uint8Array[] = [];
    idx.vu(chunks.length);
    for (const c of chunks) {
      const ox = GRID_MIN_M + c.cx * edge, oz = GRID_MIN_M + c.cy * edge;
      const w = new Writer();
      w.vu(c.lines.length);
      for (const l of c.lines) {
        w.vu(l.s.cnn);
        w.u8(l.s.classcode);
        w.u8((l.s.oneway & STREET_ONEWAY_MASK) | (l.s.bridge ? STREET_BRIDGE : 0) | (l.s.tunnel ? STREET_TUNNEL : 0));
        w.vu(intern(l.s.name));
        const u: number[] = new Array(l.pts.length);
        for (let i = 0; i < l.pts.length; i += 2) {
          u[i] = qUnits((l.pts[i] as number) - ox);
          u[i + 1] = qUnits((l.pts[i + 1] as number) - oz);
        }
        putPoints(w, u);
      }
      const bytes = w.out();
      idx.vu(c.cx);
      idx.vu(c.cy);
      idx.vu(bytes.length);
      payloads.push(bytes);
    }
    for (const p of payloads) idx.bytes(p);
    streetSecs.push({ id: SEC_STREETS[level], bytes: idx.out() });
  }

  const sw = new Writer();
  sw.vu(strings.length);
  for (const s of strings) sw.str(s);

  return assemble(
    MAP_MAGIC,
    src.bakeId,
    [
      { id: SEC_STRINGS, bytes: sw.out() },
      { id: SEC_HOODS, bytes: hoods.out() },
      { id: SEC_POLYS, bytes: polys.out() },
      { id: SEC_LABELS, bytes: labels.out() },
      { id: SEC_HILL, bytes: hill.out() },
      ...streetSecs,
    ],
    'encodeMap',
  );
}

export interface MapPoly {
  kind: number;
  levels: number;
  /** Half-metre units, absolute ENU. */
  rings: Int32Array[];
  /** Position in the file: the paint order. */
  order: number;
  /** Half-metre bounding box. */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
export interface MapHood { name: string; slug: string; tier: number; labelX: number; labelZ: number; polys: Int32Array[][] }
export interface MapLabel { kind: number; text: string; x: number; z: number }
export interface MapHill { cellM: number; minX: number; minZ: number; cols: number; rows: number; cells: Uint8Array }
export interface MapStreetLine {
  cnn: number;
  classcode: number;
  /** 0 both ways, 1 `F`, 2 `T`. */
  oneway: number;
  bridge: boolean;
  tunnel: boolean;
  nameId: number;
  /** Half-metre units relative to the NW corner of the chunk. */
  pts: Int16Array;
}

interface LevelIndex {
  cx: number;
  cy: number;
  start: number;
  end: number;
}

/** A decoded `sf-map.v1`. Street records decode on demand, one chunk at a time. */
export class MapData {
  readonly strings: string[];
  readonly hoods: MapHood[];
  readonly polys: MapPoly[];
  readonly labels: MapLabel[];
  readonly hill: MapHill | null;
  private readonly index: Record<MapLevel, Map<number, LevelIndex>>;
  private bucket: Map<number, MapPoly[]> | null = null;

  private constructor(readonly bakeId: string, private readonly u8: Uint8Array, parts: { strings: string[]; hoods: MapHood[]; polys: MapPoly[]; labels: MapLabel[]; hill: MapHill | null; index: Record<MapLevel, Map<number, LevelIndex>> }) {
    this.strings = parts.strings;
    this.hoods = parts.hoods;
    this.polys = parts.polys;
    this.labels = parts.labels;
    this.hill = parts.hill;
    this.index = parts.index;
  }

  static decode(buf: ArrayBuffer | ArrayBufferView): MapData {
    const what = 'sf-map.v1';
    const { u8, o } = open(buf, MAP_MAGIC, what);
    const sec = (id: number): Reader => {
      const s = o.sections.get(id);
      if (!s) throw new MapFormatError(what, `section ${id} is missing`);
      return new Reader(u8, s.start, s.end, what);
    };
    const sr = sec(SEC_STRINGS);
    const strings: string[] = [];
    for (let n = sr.vu(); n > 0; n--) strings.push(sr.str());
    const str = (r: Reader): string => {
      const id = r.vu();
      const s = strings[id];
      if (s === undefined) r.fail(`string ${id} does not exist`);
      return s;
    };

    const hr = sec(SEC_HOODS);
    const hoods: MapHood[] = [];
    for (let n = hr.vu(); n > 0; n--) {
      const name = str(hr), slug = str(hr), tier = hr.u8();
      const labelX = hr.vs(), labelZ = hr.vs();
      const polys: Int32Array[][] = [];
      for (let k = hr.vu(); k > 0; k--) polys.push(getRingsAbs(hr));
      hoods.push({ name, slug, tier, labelX: labelX / MAP_UNITS_PER_M, labelZ: labelZ / MAP_UNITS_PER_M, polys });
    }

    const pr = sec(SEC_POLYS);
    const polys: MapPoly[] = [];
    for (let n = pr.vu(); n > 0; n--) {
      const kind = pr.u8(), levels = pr.u8();
      const rings = getRingsAbs(pr);
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      const outer = rings[0];
      if (outer) {
        for (let i = 0; i + 1 < outer.length; i += 2) {
          const x = outer[i] as number, z = outer[i + 1] as number;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
      polys.push({ kind, levels, rings, order: polys.length, minX, minZ, maxX, maxZ });
    }

    const lr = sec(SEC_LABELS);
    const labels: MapLabel[] = [];
    for (let n = lr.vu(); n > 0; n--) {
      const kind = lr.u8();
      const text = str(lr);
      labels.push({ kind, text, x: lr.vs() / MAP_UNITS_PER_M, z: lr.vs() / MAP_UNITS_PER_M });
    }

    const hl = sec(SEC_HILL);
    let hill: MapHill | null = null;
    if (hl.u8() === 1) {
      const cellM = hl.u16();
      const minX = hl.u32() | 0, minZ = hl.u32() | 0;
      const cols = hl.u16(), rows = hl.u16();
      const cells = new Uint8Array(cols * rows);
      let i = 0;
      while (i < cells.length) {
        const v = hl.u8();
        const run = hl.vu();
        if (run < 1 || i + run > cells.length) hl.fail('hillshade run');
        cells.fill(v, i, i + run);
        i += run;
      }
      hill = { cellM, minX, minZ, cols, rows, cells };
    }

    const index = { 9: new Map(), 7: new Map(), 5: new Map() } as Record<MapLevel, Map<number, LevelIndex>>;
    for (const level of MAP_LEVELS) {
      const r = sec(SEC_STREETS[level]);
      const stride = Math.floor(131072 / CHUNK_EDGE_M[level]) + 2;
      const n = r.vu();
      const heads: { cx: number; cy: number; len: number }[] = [];
      for (let i = 0; i < n; i++) heads.push({ cx: r.vu(), cy: r.vu(), len: r.vu() });
      let at = r.pos;
      for (const h of heads) {
        if (at + h.len > r.end) r.fail('street payload runs past the end');
        index[level].set(h.cy * stride + h.cx, { cx: h.cx, cy: h.cy, start: at, end: at + h.len });
        at += h.len;
      }
    }
    return new MapData(o.bakeId, u8, { strings, hoods, polys, labels, hill, index });
  }

  /** The chunks that have records at `level`, row-major. */
  chunks(level: MapLevel): { cx: number; cy: number }[] {
    return [...this.index[level].values()].map((e) => ({ cx: e.cx, cy: e.cy }));
  }

  hasChunk(level: MapLevel, cx: number, cy: number): boolean {
    return this.index[level].has(cy * (Math.floor(131072 / CHUNK_EDGE_M[level]) + 2) + cx);
  }

  /** The street lines of one chunk at `level` (empty when none). */
  streets(level: MapLevel, cx: number, cy: number): MapStreetLine[] {
    const e = this.index[level].get(cy * (Math.floor(131072 / CHUNK_EDGE_M[level]) + 2) + cx);
    if (!e) return [];
    const r = new Reader(this.u8, e.start, e.end, 'sf-map.v1');
    const out: MapStreetLine[] = [];
    for (let n = r.vu(); n > 0; n--) {
      const cnn = r.vu(), classcode = r.u8(), flags = r.u8(), nameId = r.vu();
      out.push({ cnn, classcode, oneway: flags & STREET_ONEWAY_MASK, bridge: (flags & STREET_BRIDGE) !== 0, tunnel: (flags & STREET_TUNNEL) !== 0, nameId, pts: getPoints(r, 'i16') as Int16Array });
    }
    return out;
  }

  /** The origin (ENU metres) of a chunk at `level`. */
  static origin(level: MapLevel, cx: number, cy: number): { x: number; z: number } {
    const e = CHUNK_EDGE_M[level];
    return { x: GRID_MIN_M + cx * e, z: GRID_MIN_M + cy * e };
  }

  /** Every street line of `level`, in chunk order (the bake gates and the tests use it). */
  allStreets(level: MapLevel): { cx: number; cy: number; line: MapStreetLine }[] {
    const out: { cx: number; cy: number; line: MapStreetLine }[] = [];
    for (const c of this.chunks(level)) for (const line of this.streets(level, c.cx, c.cy)) out.push({ cx: c.cx, cy: c.cy, line });
    return out;
  }

  /** The distinct `cnn` values at z9 with their classcode and one-way flag. */
  cnnTable(): Map<number, { classcode: number; oneway: number }> {
    const out = new Map<number, { classcode: number; oneway: number }>();
    for (const { line } of this.allStreets(9)) if (!out.has(line.cnn)) out.set(line.cnn, { classcode: line.classcode, oneway: line.oneway });
    return out;
  }

  /** Polygons whose box meets the rectangle (ENU metres) and that are drawn at `level`. */
  polysIn(level: MapLevel, minX: number, minZ: number, maxX: number, maxZ: number): MapPoly[] {
    const CELL = 2048 * MAP_UNITS_PER_M;
    if (!this.bucket) {
      this.bucket = new Map();
      this.polys.forEach((p) => {
        if (!(p.minX <= p.maxX)) return;
        for (let cy = Math.floor(p.minZ / CELL); cy <= Math.floor(p.maxZ / CELL); cy++) {
          for (let cx = Math.floor(p.minX / CELL); cx <= Math.floor(p.maxX / CELL); cx++) {
            const k = cy * 100000 + cx;
            const l = this.bucket!.get(k);
            if (l) l.push(p);
            else this.bucket!.set(k, [p]);
          }
        }
      });
    }
    const bit = LEVEL_BIT[level];
    const seen = new Set<MapPoly>();
    const out: MapPoly[] = [];
    const x0 = minX * MAP_UNITS_PER_M, x1 = maxX * MAP_UNITS_PER_M, z0 = minZ * MAP_UNITS_PER_M, z1 = maxZ * MAP_UNITS_PER_M;
    for (let cy = Math.floor(z0 / CELL); cy <= Math.floor(z1 / CELL); cy++) {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (const p of this.bucket.get(cy * 100000 + cx) ?? []) {
          if (seen.has(p) || (p.levels & bit) === 0) continue;
          seen.add(p);
          if (p.maxX < x0 || p.minX > x1 || p.maxZ < z0 || p.minZ > z1) continue;
          out.push(p);
        }
      }
    }
    // paint order: the order in the file
    return out.sort((a, b) => a.order - b.order);
  }

  /** The hillshade byte at an ENU point; 128 is flat, 0 when the point is outside the grid or there is none. */
  shadeAt(x: number, z: number): number {
    const h = this.hill;
    if (!h) return 128;
    const i = Math.floor((x - h.minX) / h.cellM), j = Math.floor((z - h.minZ) / h.cellM);
    if (i < 0 || j < 0 || i >= h.cols || j >= h.rows) return 128;
    return h.cells[j * h.cols + i] as number;
  }
}

// ---- sf-map-bldg.v1 -----------------------------------------------------------------------------------------------------------

export interface BldgSourceItem { heightClass: number; ring: ArrayLike<number> }
export interface BldgSource {
  bakeId: string;
  /** Footprints already simplified; ENU metres, flat rings. */
  buildings: BldgSourceItem[];
}
export interface BldgFootprint { heightClass: number; pts: Int16Array }

/** Height classes of the footprint file: 0 under 12 m, 1 12 to 30 m, 2 30 to 80 m, 3 tall (80 m and over). */
export const bldgHeightClass = (heightM: number): number => (heightM < 12 ? 0 : heightM < 30 ? 1 : heightM < 80 ? 2 : 3);

export function encodeMapBuildings(src: BldgSource): Uint8Array {
  const edge = CHUNK_EDGE_M[9];
  const byChunk = new Map<number, { cx: number; cy: number; items: { hc: number; pts: number[] }[] }>();
  for (const b of src.buildings) {
    if (b.ring.length < 6) continue;
    let sx = 0, sz = 0;
    const n = b.ring.length / 2;
    for (let i = 0; i < b.ring.length; i += 2) {
      sx += b.ring[i] as number;
      sz += b.ring[i + 1] as number;
    }
    const cx = Math.floor((sx / n - GRID_MIN_M) / edge), cy = Math.floor((sz / n - GRID_MIN_M) / edge);
    const key = cy * 1000 + cx;
    let c = byChunk.get(key);
    if (!c) {
      c = { cx, cy, items: [] };
      byChunk.set(key, c);
    }
    const ox = GRID_MIN_M + cx * edge, oz = GRID_MIN_M + cy * edge;
    const u: number[] = [];
    for (let i = 0; i < b.ring.length; i += 2) u.push(qUnits((b.ring[i] as number) - ox), qUnits((b.ring[i + 1] as number) - oz));
    c.items.push({ hc: b.heightClass, pts: u });
  }
  const chunks = [...byChunk.values()].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const idx = new Writer();
  const payloads: Uint8Array[] = [];
  idx.vu(chunks.length);
  for (const c of chunks) {
    const w = new Writer();
    w.vu(c.items.length);
    for (const it of c.items) {
      w.u8(it.hc);
      putPoints(w, it.pts);
    }
    const bytes = w.out();
    idx.vu(c.cx);
    idx.vu(c.cy);
    idx.vu(bytes.length);
    payloads.push(bytes);
  }
  for (const p of payloads) idx.bytes(p);
  return assemble(BLDG_MAGIC, src.bakeId, [{ id: 1, bytes: idx.out() }], 'encodeMapBuildings');
}

/** A decoded `sf-map-bldg.v1`: footprints per z9 chunk, decoded on demand. */
export class MapBuildings {
  private constructor(readonly bakeId: string, private readonly u8: Uint8Array, private readonly index: Map<number, LevelIndex>) {}

  static decode(buf: ArrayBuffer | ArrayBufferView): MapBuildings {
    const what = 'sf-map-bldg.v1';
    const { u8, o } = open(buf, BLDG_MAGIC, what);
    const s = o.sections.get(1);
    if (!s) throw new MapFormatError(what, 'section 1 is missing');
    const r = new Reader(u8, s.start, s.end, what);
    const n = r.vu();
    const heads: { cx: number; cy: number; len: number }[] = [];
    for (let i = 0; i < n; i++) heads.push({ cx: r.vu(), cy: r.vu(), len: r.vu() });
    const index = new Map<number, LevelIndex>();
    let at = r.pos;
    for (const h of heads) {
      if (at + h.len > r.end) r.fail('payload runs past the end');
      index.set(h.cy * 1000 + h.cx, { cx: h.cx, cy: h.cy, start: at, end: at + h.len });
      at += h.len;
    }
    return new MapBuildings(o.bakeId, u8, index);
  }

  chunks(): { cx: number; cy: number }[] {
    return [...this.index.values()].map((e) => ({ cx: e.cx, cy: e.cy }));
  }

  footprints(cx: number, cy: number): BldgFootprint[] {
    const e = this.index.get(cy * 1000 + cx);
    if (!e) return [];
    const r = new Reader(this.u8, e.start, e.end, 'sf-map-bldg.v1');
    const out: BldgFootprint[] = [];
    for (let n = r.vu(); n > 0; n--) {
      const heightClass = r.u8();
      out.push({ heightClass, pts: getPoints(r, 'i16') as Int16Array });
    }
    return out;
  }
}

// ---- sf-geocode.v1 --------------------------------------------------------------------------------------------------------------

export interface GeocodeStreet { name: string; type: string }
export interface GeocodeAddress {
  streetId: number;
  number: number;
  /** 0 none, 1 to 26 for A to Z. */
  suffix: number;
  x: number;
  z: number;
  cnn: number;
}
export interface GeocodeName { kind: number; label: string; x: number; z: number }
export interface GeocodeSource {
  bakeId: string;
  /** Sorted by (name, type); `addresses[].streetId` indexes this list. */
  streets: GeocodeStreet[];
  addresses: GeocodeAddress[];
  names: GeocodeName[];
}

/** Name kinds of the geocoder's name index. */
export const enum NameKind {
  Landmark = 1,
  Poi = 2,
  Hood = 3,
}

export function encodeGeocode(src: GeocodeSource): Uint8Array {
  const edge = CHUNK_EDGE_M[9];
  const addrs = [...src.addresses].sort((a, b) => a.streetId - b.streetId || a.number - b.number || a.suffix - b.suffix || a.cnn - b.cnn);
  const chunkIds = new Map<number, number>();
  const chunkList: { cx: number; cy: number }[] = [];
  const keyOf = (cx: number, cy: number): number => cy * 1000 + cx;
  const cells = addrs.map((a) => {
    const cx = Math.floor((a.x - GRID_MIN_M) / edge), cy = Math.floor((a.z - GRID_MIN_M) / edge);
    return { cx, cy };
  });
  [...new Set(cells.map((c) => keyOf(c.cx, c.cy)))].sort(cmpNum).forEach((k) => {
    chunkIds.set(k, chunkList.length);
    chunkList.push({ cx: k % 1000, cy: Math.floor(k / 1000) });
  });
  if (chunkList.length > 65535) throw new RangeError('encodeGeocode: more than 65535 occupied chunks');

  const st = new Writer();
  st.vu(src.streets.length);
  for (const s of src.streets) {
    st.str(s.name);
    st.str(s.type);
  }
  const ch = new Writer();
  ch.vu(chunkList.length);
  for (const c of chunkList) {
    ch.vu(c.cx);
    ch.vu(c.cy);
  }
  const ad = new Writer();
  ad.vu(addrs.length);
  addrs.forEach((a, i) => {
    const c = cells[i] as { cx: number; cy: number };
    ad.u16(a.streetId);
    ad.u16(a.number);
    ad.u8(a.suffix);
    ad.i16(qUnits(a.x - (GRID_MIN_M + c.cx * edge)));
    ad.i16(qUnits(a.z - (GRID_MIN_M + c.cy * edge)));
    ad.u16(chunkIds.get(keyOf(c.cx, c.cy)) as number);
  });
  const cn = new Writer();
  for (const a of addrs) cn.vu(a.cnn);
  const names = [...src.names].sort((a, b) => cmpStr(a.label.toLowerCase(), b.label.toLowerCase()) || a.kind - b.kind || cmpStr(a.label, b.label) || a.x - b.x || a.z - b.z);
  const nm = new Writer();
  nm.vu(names.length);
  for (const n of names) {
    nm.u8(n.kind);
    nm.str(n.label);
    nm.vs(qUnits(n.x));
    nm.vs(qUnits(n.z));
  }
  return assemble(
    GEOCODE_MAGIC,
    src.bakeId,
    [
      { id: 1, bytes: st.out() },
      { id: 2, bytes: ch.out() },
      { id: 3, bytes: ad.out() },
      { id: 4, bytes: cn.out() },
      { id: 5, bytes: nm.out() },
    ],
    'encodeGeocode',
  );
}

export interface GeocodeData {
  bakeId: string;
  streets: GeocodeStreet[];
  /** Sorted by (streetId, number, suffix). */
  addresses: GeocodeAddress[];
  /** First index of each street in `addresses` (length streets + 1). */
  streetStart: Uint32Array;
  /** Sorted by lower-case label. */
  names: GeocodeName[];
}

export function decodeGeocode(buf: ArrayBuffer | ArrayBufferView): GeocodeData {
  const what = 'sf-geocode.v1';
  const { u8, o } = open(buf, GEOCODE_MAGIC, what);
  const sec = (id: number): Reader => {
    const s = o.sections.get(id);
    if (!s) throw new MapFormatError(what, `section ${id} is missing`);
    return new Reader(u8, s.start, s.end, what);
  };
  const sr = sec(1);
  const streets: GeocodeStreet[] = [];
  for (let n = sr.vu(); n > 0; n--) streets.push({ name: sr.str(), type: sr.str() });
  const cr = sec(2);
  const chunks: { cx: number; cy: number }[] = [];
  for (let n = cr.vu(); n > 0; n--) chunks.push({ cx: cr.vu(), cy: cr.vu() });
  const ar = sec(3);
  const count = ar.vu();
  if (count * 11 > ar.end - ar.pos) ar.fail('address count runs past the end');
  const addresses: GeocodeAddress[] = [];
  const edge = CHUNK_EDGE_M[9];
  const streetStart = new Uint32Array(streets.length + 1);
  for (let i = 0; i < count; i++) {
    const streetId = ar.u16(), number = ar.u16(), suffix = ar.u8();
    const x = ar.i16(), z = ar.i16(), chunk = ar.u16();
    const c = chunks[chunk];
    if (!c) ar.fail(`chunk ${chunk} does not exist`);
    if (streetId >= streets.length) ar.fail(`street ${streetId} does not exist`);
    addresses.push({ streetId, number, suffix, x: GRID_MIN_M + c.cx * edge + x / MAP_UNITS_PER_M, z: GRID_MIN_M + c.cy * edge + z / MAP_UNITS_PER_M, cnn: 0 });
    streetStart[streetId + 1] = (streetStart[streetId + 1] as number) + 1;
  }
  for (let s = 0; s < streets.length; s++) streetStart[s + 1] = (streetStart[s + 1] as number) + (streetStart[s] as number);
  const nr = sec(4);
  for (const a of addresses) a.cnn = nr.vu();
  const mr = sec(5);
  const names: GeocodeName[] = [];
  for (let n = mr.vu(); n > 0; n--) {
    const kind = mr.u8(), label = mr.str();
    names.push({ kind, label, x: mr.vs() / MAP_UNITS_PER_M, z: mr.vs() / MAP_UNITS_PER_M });
  }
  return { bakeId: o.bakeId, streets, addresses, streetStart, names };
}
