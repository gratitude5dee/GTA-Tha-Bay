/**
 * DVWP v1 pack codec (C08 section 4): pure, synchronous decoders for p0 and l0, plus toStaticShapeSet.
 * The encoder is tools/map/src/pack/encode.ts and reuses the constants and tables exported here.
 * C02 lint applies: no Math.random, Date, transcendental Math.*, `**` or DOM.
 *
 * Layout choices that C08 section 4 leaves open (M01f; proposed to the Architect as C08 clarifications):
 *  1. The directory follows the 64 B header (dirOffset = 64). Chunks are ordered by cy, then cx. Each chunk's
 *     section table sits at the chunk offset (12 B entries, ascending section id) and its payloads follow in the
 *     same order. No padding; every offset is absolute; reserved bytes are 0. p0 always carries sections 1-13
 *     (empty ones have count 0); l0 carries 20, 22, 23, 24, 25.
 *     Section `count`: records for list sections (PRISM, SLAB, HOOD, SEGMENT, NODE, EDGE, JUNCTION, BUILDING,
 *     TREE, LAMP, FURNITURE, LMREF), n for STRINGS, number of type groups for TAGS, 1 for the single-block
 *     sections (HEIGHT, PED, SPAWN, GROUND).
 *  2. EDGE flags bit 15 set means dir = -1; RoadEdge.flags carries only bits 0-14.
 *  3. TAGS record: u16 idStr, i16 dx, i16 dz, i16 yDm, then the type's remaining fields in interface order:
 *     metres -> u16 dm; angles -> u8 (1/256 turn); string unions -> u8 index in declaration order; strings ->
 *     u16 string index (0xFFFF = null); booleans -> u8; `edge` -> u32; `edges` -> u8 n + u32[n]; nx, nz -> i8 / 127.
 *     Tag type codes follow ChunkTags order (hidingSpots 0 ... teleportNodes 6). A TAGS section is a list of
 *     groups: u8 type, u8 count, records.
 *  4. l0 holds no HEIGHT and no GROUND. decodeL0 takes both from the matching p0 chunk.
 *  5. JUNCTION carries no SignalProgram.id, pedWalkTicks or Junction.x/z. Decode sets program.id = junction id,
 *     x/z = the mean of the member nodes found in the same chunk (0 when none), pedWalkTicks = 0.
 *  Builder additions to the five above (also proposals):
 *  6. A junction without a signal program is written with cycleTicks 0, offsetTicks 0, nPhases 0; decode gives null.
 *  7. SLAB's i8 layer is written as 0 and not decoded: PrismPack has no slot for it.
 *  8. PED edge u16 a, b are indices into the chunk's own node list; decode maps them to PedNode.id. The ped graph
 *     of a chunk is self-contained: edges that cross a chunk edge are split with duplicate nodes at the same position.
 *  9. Quantisation: laneW 0.05 m, speed 0.25 m/s, all other metres 0.1 m; tree scale u8 / 32; yaw radians =
 *     u8 * 2*pi/256. Decoded metres are `units / 10` (nearest double), except heights in toStaticShapeSet (`* 0.1`).
 */
import { TWO_PI, dhypot } from '../detmath.ts';
import {
  CHUNK_EDGE_M,
  TERRAIN_POSTS,
  chunkBounds,
  type BuildingRecord,
  type ChunkKey,
  type ChunkTags,
  type HeightGrid,
  type Junction,
  type Movement,
  type PedEdge,
  type PedNode,
  type PrismPack,
  type RenderChunk,
  type RoadEdge,
  type RoadNode,
  type RoadSegment,
  type SignalPhase,
  type SignalProgram,
  type SimChunk,
  type SpawnTable,
  type Turn,
} from './c08.ts';

export const PACK_MAGIC = 0x50575644; // bytes 'D' 'V' 'W' 'P' little-endian
export const PACK_VERSION = 1;
export const HEADER_BYTES = 64;
export const DIR_ENTRY_BYTES = 8;
export const SECTION_ENTRY_BYTES = 12;
export const FAMILY_CODE = { p0: 0, l0: 1, l1: 2, l2: 3 } as const;
export const NO_STRING = 0xffff;
export const HEIGHT_POSTS = TERRAIN_POSTS * TERRAIN_POSTS;
export const GROUND_CELLS = 64 * 64;
/** Radians per u8 angle unit (1/256 turn). */
export const YAW_UNIT = TWO_PI / 256;
/** Tree scale is stored as u8 / TREE_SCALE_UNIT. */
export const TREE_SCALE_UNIT = 32;

export const SEC = {
  HEIGHT: 1, PRISM: 2, SLAB: 3, HOOD: 4, SEGMENT: 5, NODE: 6, EDGE: 7, JUNCTION: 8, PED: 9, TAGS: 10, SPAWN: 11,
  GROUND: 12, STRINGS: 13, BUILDING: 20, LANDUSE: 21, TREE: 22, LAMP: 23, FURNITURE: 24, LMREF: 25,
} as const;
export const P0_SECTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
export const L0_SECTIONS = [20, 22, 23, 24, 25] as const;
export const TURNS: readonly Turn[] = ['straight', 'left', 'right', 'uturn'];

export type PackDecodeReason = 'magic' | 'version' | 'family' | 'bounds' | 'section';
export class PackDecodeError extends Error {
  readonly reason: PackDecodeReason;
  constructor(reason: PackDecodeReason, detail: string) {
    super(`pack decode failed (${reason}): ${detail}`);
    this.name = 'PackDecodeError';
    this.reason = reason;
  }
}

// ---- tag layout tables (shared with the encoder) ---------------------------------------------------------------
export const TAG_TYPES = [
  'hidingSpots', 'pursuitBreakers', 'chokePoints', 'jumpZones', 'portals', 'shoreNodes', 'teleportNodes',
] as const;
export type TagType = (typeof TAG_TYPES)[number];
export type TagFieldType = 'dm16' | 'yaw8' | 'enum8' | 'str16' | 'bool8' | 'edge32' | 'edges8' | 'i8n127';
export interface TagField {
  readonly key: string;
  readonly t: TagFieldType;
  readonly values?: readonly string[];
  readonly nullable?: boolean;
}
export const TAG_LAYOUT: Readonly<Record<TagType, readonly TagField[]>> = {
  hidingSpots: [
    { key: 'radiusM', t: 'dm16' },
    { key: 'kind', t: 'enum8', values: ['viaduct', 'garage', 'alley', 'carwash', 'tunnel-portal'] },
  ],
  pursuitBreakers: [
    { key: 'triggerRadiusM', t: 'dm16' },
    { key: 'kind', t: 'enum8', values: ['scaffold', 'produce-stand', 'crane-load', 'cable-car', 'billboard'] },
    { key: 'prefab', t: 'str16' },
    { key: 'mission', t: 'bool8' },
  ],
  chokePoints: [
    { key: 'edge', t: 'edge32' },
    { key: 'widthM', t: 'dm16' },
    { key: 'kind', t: 'enum8', values: ['bridge', 'tunnel', 'ramp', 'narrow'] },
  ],
  jumpZones: [
    { key: 'yaw', t: 'yaw8' },
    { key: 'lengthM', t: 'dm16' },
    { key: 'kind', t: 'enum8', values: ['hill-crest', 'ramp'] },
  ],
  portals: [
    { key: 'yaw', t: 'yaw8' },
    { key: 'widthM', t: 'dm16' },
    { key: 'kind', t: 'enum8', values: ['bridge', 'county-line', 'ferry', 'tunnel'] },
    { key: 'state', t: 'enum8', values: ['closed', 'open', 'sealed'] },
    { key: 'toArea', t: 'str16', nullable: true },
    { key: 'edges', t: 'edges8' },
  ],
  shoreNodes: [
    { key: 'nx', t: 'i8n127' },
    { key: 'nz', t: 'i8n127' },
  ],
  teleportNodes: [
    { key: 'yaw', t: 'yaw8' },
    { key: 'kind', t: 'enum8', values: ['xr', 'landmark', 'transit', 'safehouse', 'spawn'] },
  ],
};

// ---- header -------------------------------------------------------------------------------------------------------
export interface PackHeader {
  version: number;
  family: 0 | 1 | 2 | 3;
  tileX: number;
  tileY: number;
  hostZ: number;
  chunkCount: number;
  /** 64 lowercase hex characters (the raw 32 bytes). */
  bakeId: string;
  dirOffset: number;
}

type Bytes = ArrayBuffer | ArrayBufferView;
function viewOf(buf: Bytes): DataView {
  return ArrayBuffer.isView(buf)
    ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    : new DataView(buf);
}

class Reader {
  pos: number;
  readonly end: number;
  private readonly dv: DataView;
  private readonly reason: PackDecodeReason;
  constructor(dv: DataView, start: number, end: number, reason: PackDecodeReason) {
    this.dv = dv;
    this.pos = start;
    this.end = end;
    this.reason = reason;
  }
  private need(n: number): number {
    const p = this.pos;
    if (p < 0 || p + n > this.end) throw new PackDecodeError(this.reason, `read of ${n} B at ${p} passes ${this.end}`);
    this.pos = p + n;
    return p;
  }
  u8(): number { return this.dv.getUint8(this.need(1)); }
  i8(): number { return this.dv.getInt8(this.need(1)); }
  u16(): number { return this.dv.getUint16(this.need(2), true); }
  i16(): number { return this.dv.getInt16(this.need(2), true); }
  u32(): number { return this.dv.getUint32(this.need(4), true); }
  i32(): number { return this.dv.getInt32(this.need(4), true); }
  bytes(n: number): Uint8Array {
    const p = this.need(n);
    return new Uint8Array(this.dv.buffer, this.dv.byteOffset + p, n);
  }
  done(what: string): void {
    if (this.pos !== this.end) throw new PackDecodeError('section', `${what}: ${this.end - this.pos} unread bytes`);
  }
}

const hexOf = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i] as number).toString(16).padStart(2, '0');
  return s;
};

/** Reads and validates the 64 B header. Throws PackDecodeError (bounds, magic, version, family). */
export function readHeader(buf: Bytes): PackHeader {
  const dv = viewOf(buf);
  if (dv.byteLength < HEADER_BYTES) throw new PackDecodeError('bounds', `${dv.byteLength} B is shorter than the header`);
  const r = new Reader(dv, 0, HEADER_BYTES, 'bounds');
  if (r.u32() !== PACK_MAGIC) throw new PackDecodeError('magic', 'bad magic');
  const version = r.u8();
  if (version !== PACK_VERSION) throw new PackDecodeError('version', `version ${version}`);
  const family = r.u8();
  if (family > 3) throw new PackDecodeError('family', `family ${family}`);
  const tileX = r.u16();
  const tileY = r.u16();
  const hostZ = r.u8();
  const chunkCount = r.u8();
  const bakeId = hexOf(r.bytes(32));
  const dirOffset = r.u32();
  return { version, family: family as 0 | 1 | 2 | 3, tileX, tileY, hostZ, chunkCount, bakeId, dirOffset };
}

interface Section { id: number; count: number; offset: number; bytes: number }
interface ChunkEntry { key: ChunkKey; sections: Map<number, Section> }

/** Splits the directory and section tables, checking every range against the buffer. */
function readDirectory(dv: DataView, h: PackHeader): ChunkEntry[] {
  const total = dv.byteLength;
  const dirEnd = h.dirOffset + h.chunkCount * DIR_ENTRY_BYTES;
  if (h.dirOffset < HEADER_BYTES || dirEnd > total) throw new PackDecodeError('bounds', 'directory passes the end of the buffer');
  const dir = new Reader(dv, h.dirOffset, dirEnd, 'bounds');
  const out: ChunkEntry[] = [];
  for (let i = 0; i < h.chunkCount; i++) {
    const cx = dir.u8();
    const cy = dir.u8();
    const sectionCount = dir.u16();
    const offset = dir.u32();
    if (cx > 3 || cy > 3) throw new PackDecodeError('bounds', `chunk cell ${cx},${cy} is outside the host cell`);
    if (offset + sectionCount * SECTION_ENTRY_BYTES > total) throw new PackDecodeError('bounds', 'section table passes the end of the buffer');
    const t = new Reader(dv, offset, offset + sectionCount * SECTION_ENTRY_BYTES, 'bounds');
    const sections = new Map<number, Section>();
    for (let s = 0; s < sectionCount; s++) {
      const id = t.u8();
      const enc = t.u8();
      const count = t.u16();
      const so = t.u32();
      const bytes = t.u32();
      if (enc !== 0) throw new PackDecodeError('section', `section ${id} has encoding ${enc}`);
      if (so + bytes > total) throw new PackDecodeError('section', `section ${id} passes the end of the buffer`);
      if (sections.has(id)) throw new PackDecodeError('section', `section ${id} appears twice`);
      sections.set(id, { id, count, offset: so, bytes });
    }
    const key = `9/${h.tileX * 4 + cx}/${h.tileY * 4 + cy}` as ChunkKey;
    out.push({ key, sections });
  }
  return out;
}

const sectionReader = (dv: DataView, e: ChunkEntry, id: number): { r: Reader; count: number } | null => {
  const s = e.sections.get(id);
  if (!s) return null;
  return { r: new Reader(dv, s.offset, s.offset + s.bytes, 'section'), count: s.count };
};

function listSection<T>(dv: DataView, e: ChunkEntry, id: number, name: string, one: (r: Reader) => T): T[] {
  const sec = sectionReader(dv, e, id);
  const out: T[] = [];
  if (!sec) return out;
  for (let i = 0; i < sec.count; i++) out.push(one(sec.r));
  sec.r.done(name);
  return out;
}

/** Strict UTF-8 decode (no TextDecoder: the sim tsconfig has no DOM lib). Rejects overlong forms, surrogates and truncation. */
function utf8Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i++] as number;
    let cp = c;
    let extra = 0;
    let min = 0;
    if (c >= 0xf0 && c <= 0xf4) { extra = 3; cp = c & 0x07; min = 0x10000; }
    else if (c >= 0xe0) { extra = 2; cp = c & 0x0f; min = 0x800; }
    else if (c >= 0xc2 && c < 0xe0) { extra = 1; cp = c & 0x1f; min = 0x80; }
    else if (c >= 0x80) throw new PackDecodeError('section', 'STRINGS holds invalid UTF-8');
    if (c >= 0xf5 || i + extra > b.length) throw new PackDecodeError('section', 'STRINGS holds invalid UTF-8');
    for (let k = 0; k < extra; k++) {
      const d = b[i++] as number;
      if ((d & 0xc0) !== 0x80) throw new PackDecodeError('section', 'STRINGS holds invalid UTF-8');
      cp = (cp << 6) | (d & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new PackDecodeError('section', 'STRINGS holds invalid UTF-8');
    s += String.fromCodePoint(cp);
  }
  return s;
}

function readStrings(dv: DataView, e: ChunkEntry): string[] {
  const sec = sectionReader(dv, e, SEC.STRINGS);
  if (!sec) return [];
  const n = sec.r.u16();
  if (n !== sec.count) throw new PackDecodeError('section', 'STRINGS count mismatch');
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = sec.r.u8();
    out.push(utf8Decode(sec.r.bytes(len)));
  }
  sec.r.done('STRINGS');
  return out;
}

function readPrisms(dv: DataView, e: ChunkEntry, id: number, name: string, ox: number, oz: number, withLayer: boolean): PrismPack {
  const sec = sectionReader(dv, e, id);
  if (!sec) return new Float32Array(0);
  const flat: number[] = [];
  for (let i = 0; i < sec.count; i++) {
    const n = sec.r.u8();
    const baseDm = sec.r.i16();
    const hDm = sec.r.u16();
    flat.push(n, baseDm / 10, hDm / 10);
    for (let v = 0; v < n; v++) {
      const dx = sec.r.i16();
      const dz = sec.r.i16();
      flat.push(ox + dx / 10, oz + dz / 10);
    }
    if (withLayer) sec.r.i8();
  }
  sec.r.done(name);
  return Float32Array.from(flat);
}

function decodeChunkP0(dv: DataView, e: ChunkEntry, bakeId: string): SimChunk {
  const b = chunkBounds(e.key);
  const ox = b.minX;
  const oz = b.minZ;
  const strings = readStrings(dv, e);
  const str = (i: number): string => {
    const s = strings[i];
    if (s === undefined) throw new PackDecodeError('section', `string index ${i} is out of range`);
    return s;
  };

  // HEIGHT
  const hs = sectionReader(dv, e, SEC.HEIGHT);
  if (!hs || e.sections.get(SEC.HEIGHT)?.bytes !== HEIGHT_POSTS * 2) throw new PackDecodeError('section', 'HEIGHT missing or not 65 x 65 posts');
  const dm = new Int16Array(HEIGHT_POSTS);
  for (let i = 0; i < HEIGHT_POSTS; i++) dm[i] = hs.r.i16();
  hs.r.done('HEIGHT');
  const height: HeightGrid = { originX: ox, originZ: oz, cellM: CHUNK_EDGE_M[9] / (TERRAIN_POSTS - 1), dm };

  // GROUND
  const gs = sectionReader(dv, e, SEC.GROUND);
  if (!gs || e.sections.get(SEC.GROUND)?.bytes !== GROUND_CELLS) throw new PackDecodeError('section', 'GROUND missing or not 64 x 64 cells');
  const ground = Uint8Array.from(gs.r.bytes(GROUND_CELLS));
  gs.r.done('GROUND');

  const prisms = readPrisms(dv, e, SEC.PRISM, 'PRISM', ox, oz, false);
  const slabs = readPrisms(dv, e, SEC.SLAB, 'SLAB', ox, oz, true);
  const hoods = readPrisms(dv, e, SEC.HOOD, 'HOOD', ox, oz, false);

  const segments = listSection<RoadSegment>(dv, e, SEC.SEGMENT, 'SEGMENT', (r) => {
    const id = r.u32();
    const nPts = r.u16();
    const widthDm = r.u16();
    const osmLo = r.u32();
    const osmHi = r.u32();
    const cnn = r.u32();
    const pts = new Float32Array(nPts * 3);
    for (let i = 0; i < nPts; i++) {
      pts[i * 3] = ox + r.i16() / 10;
      pts[i * 3 + 2] = oz + r.i16() / 10;
      pts[i * 3 + 1] = r.i16() / 10;
    }
    let lengthM = 0;
    for (let i = 1; i < nPts; i++) {
      const dx = (pts[i * 3] as number) - (pts[i * 3 - 3] as number);
      const dy = (pts[i * 3 + 1] as number) - (pts[i * 3 - 2] as number);
      const dz = (pts[i * 3 + 2] as number) - (pts[i * 3 - 1] as number);
      lengthM += dhypot(dhypot(dx, dy), dz);
    }
    return { id, pts, lengthM, widthM: widthDm / 10, osmWay: osmHi * 4294967296 + osmLo, cnn };
  });

  const nodes = listSection<RoadNode>(dv, e, SEC.NODE, 'NODE', (r) => {
    const id = r.u32();
    const x = ox + r.i16() / 10;
    const z = oz + r.i16() / 10;
    const y = r.i16() / 10;
    return { id, x, y, z, layer: r.i8(), control: r.u8(), junction: r.i16() };
  });

  const edges = listSection<RoadEdge>(dv, e, SEC.EDGE, 'EDGE', (r) => {
    const id = r.u32();
    const seg = r.u32();
    const from = r.u32();
    const to = r.u32();
    const twin = r.i32();
    const cls = r.u8();
    const lanes = r.u8();
    const laneW = r.u8();
    const speed = r.u8();
    const rawFlags = r.u16();
    const layer = r.i8();
    const medianDm = r.u8();
    const parking = r.u8();
    const gradePct = r.i8();
    const nhood = r.u8();
    if (parking > 2) throw new PackDecodeError('section', `parkingSides ${parking}`);
    return {
      id, seg, dir: rawFlags & 0x8000 ? -1 : 1, from, to, twin, cls, lanes, laneWidthM: laneW / 20, speedMps: speed / 4,
      flags: rawFlags & 0x7fff, layer, medianM: medianDm / 10, parkingSides: parking as 0 | 1 | 2, maxGradePct: gradePct, nhood,
    };
  });

  const junctions = listSection<Junction>(dv, e, SEC.JUNCTION, 'JUNCTION', (r) => {
    const id = r.u16();
    const control = r.u8();
    const nNodes = r.u8();
    const nodeIds: number[] = [];
    for (let i = 0; i < nNodes; i++) nodeIds.push(r.u32());
    const nMov = r.u8();
    const movements: Movement[] = [];
    for (let i = 0; i < nMov; i++) {
      const mid = r.u16();
      const inEdge = r.u32();
      const outEdge = r.u32();
      const turn = TURNS[r.u8()];
      if (turn === undefined) throw new PackDecodeError('section', 'unknown turn code');
      const lengthM = r.u16() / 10;
      const nConf = r.u8();
      const conflicts: number[] = [];
      for (let c = 0; c < nConf; c++) conflicts.push(r.u16());
      movements.push({ id: mid, inEdge, outEdge, turn, lengthM, conflicts });
    }
    const cycleTicks = r.u16();
    const offsetTicks = r.u16();
    const nPhases = r.u8();
    const phases: SignalPhase[] = [];
    for (let p = 0; p < nPhases; p++) {
      const startTick = r.u16();
      const greenTicks = r.u16();
      const amberTicks = r.u16();
      const clearTicks = r.u16();
      const nm = r.u8();
      const ms: number[] = [];
      for (let m = 0; m < nm; m++) ms.push(r.u16());
      phases.push({ startTick, greenTicks, amberTicks, clearTicks, movements: ms });
    }
    const nStop = r.u8();
    const stopApproaches: number[] = [];
    for (let i = 0; i < nStop; i++) stopApproaches.push(r.u32());
    let sx = 0;
    let sz = 0;
    let found = 0;
    for (const nid of nodeIds) {
      const n = nodes.find((q) => q.id === nid);
      if (n) { sx += n.x; sz += n.z; found++; }
    }
    const program: SignalProgram | null = cycleTicks === 0 ? null : { id, cycleTicks, offsetTicks, phases, pedWalkTicks: 0 };
    return { id, nodes: nodeIds, x: found ? sx / found : 0, z: found ? sz / found : 0, control, movements, program, stopApproaches };
  });

  let pedNodes: PedNode[] = [];
  let pedEdges: PedEdge[] = [];
  const ps = sectionReader(dv, e, SEC.PED);
  if (ps) {
    const nn = ps.r.u16();
    pedNodes = [];
    for (let i = 0; i < nn; i++) {
      const id = ps.r.u32();
      const x = ox + ps.r.i16() / 10;
      const z = oz + ps.r.i16() / 10;
      const y = ps.r.i16() / 10;
      pedNodes.push({ id, x, y, z, flags: ps.r.u8() });
    }
    const ne = ps.r.u16();
    pedEdges = [];
    for (let i = 0; i < ne; i++) {
      const a = pedNodes[ps.r.u16()];
      const b = pedNodes[ps.r.u16()];
      if (!a || !b) throw new PackDecodeError('section', 'ped edge references a missing node');
      const kind = ps.r.u8();
      const widthM = ps.r.u8() / 10;
      pedEdges.push({ a: a.id, b: b.id, kind, widthM, junction: ps.r.i16(), movement: ps.r.i16() });
    }
    ps.r.done('PED');
  }

  const tags = emptyTags();
  const ts = sectionReader(dv, e, SEC.TAGS);
  if (ts) {
    for (let g = 0; g < ts.count; g++) {
      const type = TAG_TYPES[ts.r.u8()];
      if (type === undefined) throw new PackDecodeError('section', 'unknown tag type');
      const n = ts.r.u8();
      const list: Record<string, unknown>[] = [];
      for (let i = 0; i < n; i++) list.push(readTag(ts.r, type, str, ox, oz));
      (tags as unknown as Record<string, unknown>)[type] = list;
    }
    ts.r.done('TAGS');
  }

  const sp = sectionReader(dv, e, SEC.SPAWN);
  let spawn: SpawnTable = { cellKey: e.key, densityProfile: 0, trafficSlots: 0, pedSlots: 0, parked: [] };
  if (sp) {
    const profile = sp.r.u8();
    const trafficSlots = sp.r.u16();
    const pedSlots = sp.r.u16();
    const nParked = sp.r.u16();
    const parked: SpawnTable['parked'] = [];
    for (let i = 0; i < nParked; i++) {
      const slot = sp.r.u16();
      const seg = sp.r.u32();
      const s = sp.r.u16() / 10;
      const side = sp.r.i8();
      if (side !== -1 && side !== 1) throw new PackDecodeError('section', `parked side ${side}`);
      parked.push({ slot, seg, s, side, yawJitterDm: sp.r.i8() });
    }
    sp.r.done('SPAWN');
    spawn = { cellKey: e.key, densityProfile: profile, trafficSlots, pedSlots, parked };
  }

  return { key: e.key, bakeId, height, prisms, slabs, hoods, segments, edges, nodes, junctions, pedNodes, pedEdges, tags, spawn, ground };
}

function emptyTags(): ChunkTags {
  return { hidingSpots: [], pursuitBreakers: [], chokePoints: [], jumpZones: [], portals: [], shoreNodes: [] };
}

function readTag(r: Reader, type: TagType, str: (i: number) => string, ox: number, oz: number): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  rec['id'] = str(r.u16());
  rec['x'] = ox + r.i16() / 10;
  rec['z'] = oz + r.i16() / 10;
  rec['y'] = r.i16() / 10;
  for (const f of TAG_LAYOUT[type]) {
    switch (f.t) {
      case 'dm16': rec[f.key] = r.u16() / 10; break;
      case 'yaw8': rec[f.key] = r.u8() * YAW_UNIT; break;
      case 'enum8': {
        const v = f.values?.[r.u8()];
        if (v === undefined) throw new PackDecodeError('section', `unknown ${f.key} code`);
        rec[f.key] = v;
        break;
      }
      case 'str16': {
        const i = r.u16();
        rec[f.key] = i === NO_STRING ? (f.nullable ? null : '') : str(i);
        break;
      }
      case 'bool8': rec[f.key] = r.u8() !== 0; break;
      case 'edge32': rec[f.key] = r.u32(); break;
      case 'edges8': {
        const n = r.u8();
        const list: number[] = [];
        for (let i = 0; i < n; i++) list.push(r.u32());
        rec[f.key] = list;
        break;
      }
      case 'i8n127': rec[f.key] = r.i8() / 127; break;
    }
  }
  // Key order follows the interface: id, x, y, z, fields.
  const { id, x, y, z, ...rest } = rec;
  return { id, x, y, z, ...rest };
}

/** Decodes a p0 pack to its SimChunks. Pure and synchronous; throws PackDecodeError and never returns a partial result. */
export function decodeP0(buf: Bytes): SimChunk[] {
  const dv = viewOf(buf);
  const h = readHeader(dv);
  if (h.family !== FAMILY_CODE.p0) throw new PackDecodeError('family', `family ${h.family} is not p0`);
  return readDirectory(dv, h).map((e) => decodeChunkP0(dv, e, h.bakeId));
}

/** Decodes an l0 pack. Height and ground come from the matching p0 chunk (clarification 4). */
export function decodeL0(buf: Bytes, p0: readonly SimChunk[]): RenderChunk[] {
  const dv = viewOf(buf);
  const h = readHeader(dv);
  if (h.family !== FAMILY_CODE.l0) throw new PackDecodeError('family', `family ${h.family} is not l0`);
  return readDirectory(dv, h).map((e) => {
    const sim = p0.find((c) => c.key === e.key);
    if (!sim) throw new PackDecodeError('section', `no p0 chunk for ${e.key}`);
    if (sim.bakeId !== h.bakeId) throw new PackDecodeError('section', `p0 and l0 bake ids differ for ${e.key}`);
    const b = chunkBounds(e.key);
    const ox = b.minX;
    const oz = b.minZ;
    const buildings = listSection<BuildingRecord>(dv, e, SEC.BUILDING, 'BUILDING', (r) => {
      const baseDm = r.i16();
      const heightDm = r.u16();
      const kind = r.u8();
      const rp = r.u8();
      const seed = r.u16();
      const proxyOf = r.u8();
      const n = r.u8();
      const ring = new Int16Array(n * 2);
      for (let i = 0; i < n * 2; i++) ring[i] = r.i16();
      return { baseDm, heightDm, kind, roof: (rp >> 6) as 0 | 1 | 2 | 3, palette: rp & 63, seed, proxyOf, ring };
    });
    const flatten = (id: number, name: string, per: (r: Reader, out: number[]) => void): Float32Array => {
      const out: number[] = [];
      const sec = sectionReader(dv, e, id);
      if (!sec) return new Float32Array(0);
      for (let i = 0; i < sec.count; i++) per(sec.r, out);
      sec.r.done(name);
      return Float32Array.from(out);
    };
    const trees = flatten(SEC.TREE, 'TREE', (r, o) => {
      o.push(ox + r.i16() / 10, oz + r.i16() / 10, r.u8() / TREE_SCALE_UNIT, r.u8());
    });
    const lamps = flatten(SEC.LAMP, 'LAMP', (r, o) => {
      o.push(ox + r.i16() / 10, oz + r.i16() / 10, r.u8() * YAW_UNIT);
    });
    const furniture = flatten(SEC.FURNITURE, 'FURNITURE', (r, o) => {
      o.push(ox + r.i16() / 10, oz + r.i16() / 10, r.u8() * YAW_UNIT, r.u8());
    });
    const landmarks = listSection<number>(dv, e, SEC.LMREF, 'LMREF', (r) => r.u8());
    return { key: e.key, z: 9, bakeId: h.bakeId, height: sim.height, ground: sim.ground, buildings, trees, lamps, furniture, landmarks };
  });
}

/** The C01 StaticShapeSet that PhysicsBackend.addChunkStatics takes (structurally identical; DL-078). */
export interface StaticShapeSet {
  heightfield?: { nx: number; nz: number; cell: number; heights: Float32Array; at: [number, number, number] };
  prisms: Float32Array;
}

export function toStaticShapeSet(c: SimChunk): StaticShapeSet & { heightfield: NonNullable<StaticShapeSet['heightfield']> } {
  const heights = new Float32Array(c.height.dm.length);
  for (let i = 0; i < heights.length; i++) heights[i] = (c.height.dm[i] as number) * 0.1;
  const prisms = new Float32Array(c.prisms.length + c.slabs.length + c.hoods.length);
  prisms.set(c.prisms, 0);
  prisms.set(c.slabs, c.prisms.length);
  prisms.set(c.hoods, c.prisms.length + c.slabs.length);
  return {
    heightfield: { nx: TERRAIN_POSTS, nz: TERRAIN_POSTS, cell: c.height.cellM, heights, at: [c.height.originX, 0, c.height.originZ] },
    prisms,
  };
}
