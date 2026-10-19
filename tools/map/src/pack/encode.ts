/**
 * DVWP v1 encoder: the exact inverse of decodeP0 / decodeL0 in packages/shared/src/world/pack-codec.ts. Layout
 * choices are documented at the top of that file. Inputs must already be quantised: out-of-range values throw
 * instead of being clamped.
 */
import {
  DIR_ENTRY_BYTES, FAMILY_CODE, HEADER_BYTES, HEIGHT_POSTS, GROUND_CELLS, NO_STRING, PACK_MAGIC, PACK_VERSION,
  SECTION_ENTRY_BYTES, SEC, TAG_LAYOUT, TAG_TYPES, TREE_SCALE_UNIT, TURNS, YAW_UNIT,
  chunkBounds, parseChunkKey,
  type BuildingRecord, type ChunkKey, type RenderChunk, type SimChunk, type TagType,
} from '../../../../packages/shared/src/index.ts';

export interface PackHeaderInput { tileX: number; tileY: number; hostZ: number; bakeId: string }

export class Bytes {
  private buf = new Uint8Array(256);
  private dv = new DataView(this.buf.buffer);
  length = 0;
  private grow(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.length + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.dv = new DataView(next.buffer);
  }
  u8(v: number): void { this.range(v, 0, 255, 'u8'); this.grow(1); this.dv.setUint8(this.length, v); this.length += 1; }
  i8(v: number): void { this.range(v, -128, 127, 'i8'); this.grow(1); this.dv.setInt8(this.length, v); this.length += 1; }
  u16(v: number): void { this.range(v, 0, 65535, 'u16'); this.grow(2); this.dv.setUint16(this.length, v, true); this.length += 2; }
  i16(v: number): void { this.range(v, -32768, 32767, 'i16'); this.grow(2); this.dv.setInt16(this.length, v, true); this.length += 2; }
  u32(v: number): void { this.range(v, 0, 4294967295, 'u32'); this.grow(4); this.dv.setUint32(this.length, v, true); this.length += 4; }
  i32(v: number): void { this.range(v, -2147483648, 2147483647, 'i32'); this.grow(4); this.dv.setInt32(this.length, v, true); this.length += 4; }
  raw(b: Uint8Array): void { this.grow(b.length); this.buf.set(b, this.length); this.length += b.length; }
  private range(v: number, lo: number, hi: number, what: string): void {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new RangeError(`encode: ${v} does not fit ${what}`);
  }
  bytes(): Uint8Array { return this.buf.slice(0, this.length); }
}

/** Rounds `v * scale` to an integer; throws when the input is not already on the grid (within 0.2 unit). */
function quant(v: number, scale: number, what: string): number {
  const q = Math.round(v * scale);
  if (!Number.isFinite(v) || Math.abs(q - v * scale) > 0.2) throw new RangeError(`encode: ${what} ${v} is not on the ${1 / scale} grid`);
  return q;
}
export const dmOf = (v: number, what: string): number => quant(v, 10, what);

export interface SectionOut { id: number; count: number; data: Uint8Array }
export interface ChunkOut { cx: number; cy: number; sections: SectionOut[] }

export function hexBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new RangeError('encode: bakeId must be 64 lowercase hex characters');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function assemble(family: number, h: PackHeaderInput, chunks: ChunkOut[]): Uint8Array {
  const sorted = [...chunks].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as ChunkOut;
    const b = sorted[i] as ChunkOut;
    if (a.cx === b.cx && a.cy === b.cy) throw new RangeError('encode: duplicate chunk');
  }
  const dirOffset = HEADER_BYTES;
  let cursor = dirOffset + sorted.length * DIR_ENTRY_BYTES;
  const out = new Bytes();
  out.u32(PACK_MAGIC); out.u8(PACK_VERSION); out.u8(family);
  out.u16(h.tileX); out.u16(h.tileY); out.u8(h.hostZ); out.u8(sorted.length);
  out.raw(hexBytes(h.bakeId)); out.u32(dirOffset);
  out.raw(new Uint8Array(16));
  const tableOffsets: number[] = [];
  for (const c of sorted) {
    tableOffsets.push(cursor);
    cursor += c.sections.length * SECTION_ENTRY_BYTES + c.sections.reduce((n, s) => n + s.data.length, 0);
  }
  sorted.forEach((c, i) => { out.u8(c.cx); out.u8(c.cy); out.u16(c.sections.length); out.u32(tableOffsets[i] as number); });
  sorted.forEach((c, i) => {
    let data = (tableOffsets[i] as number) + c.sections.length * SECTION_ENTRY_BYTES;
    for (const s of c.sections) {
      out.u8(s.id); out.u8(0); out.u16(s.count); out.u32(data); out.u32(s.data.length);
      data += s.data.length;
    }
    for (const s of c.sections) out.raw(s.data);
  });
  return out.bytes();
}

function cellOf(key: ChunkKey, h: PackHeaderInput): { cx: number; cy: number } {
  const p = parseChunkKey(key);
  if (!p || p.z !== 9) throw new RangeError(`encode: ${key} is not a z=9 chunk key`);
  const cx = p.x - h.tileX * 4;
  const cy = p.y - h.tileY * 4;
  if (cx < 0 || cx > 3 || cy < 0 || cy > 3) throw new RangeError(`encode: ${key} is outside host tile ${h.tileX}-${h.tileY}`);
  return { cx, cy };
}

class StringTable {
  readonly list: string[] = [];
  private readonly index = new Map<string, number>();
  add(s: string): number {
    const have = this.index.get(s);
    if (have !== undefined) return have;
    const i = this.list.length;
    if (i >= NO_STRING) throw new RangeError('encode: string table overflow');
    this.list.push(s);
    this.index.set(s, i);
    return i;
  }
}

function prismSection(pack: Float32Array, id: number, ox: number, oz: number, withLayer: boolean): SectionOut {
  const w = new Bytes();
  let count = 0;
  for (let i = 0; i < pack.length;) {
    const n = pack[i] as number;
    w.u8(n);
    w.i16(dmOf(pack[i + 1] as number, 'prism base'));
    w.u16(dmOf(pack[i + 2] as number, 'prism height'));
    for (let v = 0; v < n; v++) {
      w.i16(dmOf((pack[i + 3 + v * 2] as number) - ox, 'prism x'));
      w.i16(dmOf((pack[i + 4 + v * 2] as number) - oz, 'prism z'));
    }
    if (withLayer) w.i8(0);
    i += 3 + n * 2;
    count++;
  }
  return { id, count, data: w.bytes() };
}

function encodeChunkP0(c: SimChunk): SectionOut[] {
  const b = chunkBounds(c.key);
  const ox = b.minX;
  const oz = b.minZ;
  const out: SectionOut[] = [];

  if (c.height.dm.length !== HEIGHT_POSTS) throw new RangeError('encode: height grid must be 65 x 65');
  let w = new Bytes();
  for (let i = 0; i < HEIGHT_POSTS; i++) w.i16(c.height.dm[i] as number);
  out.push({ id: SEC.HEIGHT, count: 1, data: w.bytes() });
  out.push(prismSection(c.prisms, SEC.PRISM, ox, oz, false));
  out.push(prismSection(c.slabs, SEC.SLAB, ox, oz, true));
  out.push(prismSection(c.hoods, SEC.HOOD, ox, oz, false));

  w = new Bytes();
  for (const s of c.segments) {
    const nPts = s.pts.length / 3;
    w.u32(s.id); w.u16(nPts); w.u16(dmOf(s.widthM, 'segment width'));
    w.u32(s.osmWay % 4294967296); w.u32(Math.floor(s.osmWay / 4294967296)); w.u32(s.cnn);
    for (let i = 0; i < nPts; i++) {
      w.i16(dmOf((s.pts[i * 3] as number) - ox, 'segment x'));
      w.i16(dmOf((s.pts[i * 3 + 2] as number) - oz, 'segment z'));
      w.i16(dmOf(s.pts[i * 3 + 1] as number, 'segment y'));
    }
  }
  out.push({ id: SEC.SEGMENT, count: c.segments.length, data: w.bytes() });

  w = new Bytes();
  for (const n of c.nodes) {
    w.u32(n.id); w.i16(dmOf(n.x - ox, 'node x')); w.i16(dmOf(n.z - oz, 'node z')); w.i16(dmOf(n.y, 'node y'));
    w.i8(n.layer); w.u8(n.control); w.i16(n.junction);
  }
  out.push({ id: SEC.NODE, count: c.nodes.length, data: w.bytes() });

  w = new Bytes();
  for (const e of c.edges) {
    if (e.flags < 0 || e.flags > 0x7fff) throw new RangeError('encode: edge flags must fit 15 bits');
    w.u32(e.id); w.u32(e.seg); w.u32(e.from); w.u32(e.to); w.i32(e.twin);
    w.u8(e.cls); w.u8(e.lanes); w.u8(quant(e.laneWidthM, 20, 'lane width')); w.u8(quant(e.speedMps, 4, 'speed'));
    w.u16(e.flags | (e.dir === -1 ? 0x8000 : 0));
    w.i8(e.layer); w.u8(dmOf(e.medianM, 'median')); w.u8(e.parkingSides); w.i8(e.maxGradePct); w.u8(e.nhood);
  }
  out.push({ id: SEC.EDGE, count: c.edges.length, data: w.bytes() });

  w = new Bytes();
  for (const j of c.junctions) {
    w.u16(j.id); w.u8(j.control); w.u8(j.nodes.length);
    for (const n of j.nodes) w.u32(n);
    w.u8(j.movements.length);
    for (const m of j.movements) {
      const turn = TURNS.indexOf(m.turn);
      w.u16(m.id); w.u32(m.inEdge); w.u32(m.outEdge); w.u8(turn); w.u16(dmOf(m.lengthM, 'movement length'));
      w.u8(m.conflicts.length);
      for (const k of m.conflicts) w.u16(k);
    }
    const p = j.program;
    w.u16(p ? p.cycleTicks : 0); w.u16(p ? p.offsetTicks : 0); w.u8(p ? p.phases.length : 0);
    for (const ph of p ? p.phases : []) {
      w.u16(ph.startTick); w.u16(ph.greenTicks); w.u16(ph.amberTicks); w.u16(ph.clearTicks); w.u8(ph.movements.length);
      for (const m of ph.movements) w.u16(m);
    }
    w.u8(j.stopApproaches.length);
    for (const s of j.stopApproaches) w.u32(s);
  }
  out.push({ id: SEC.JUNCTION, count: c.junctions.length, data: w.bytes() });

  w = new Bytes();
  const pedIndex = new Map<number, number>();
  w.u16(c.pedNodes.length);
  c.pedNodes.forEach((n, i) => {
    pedIndex.set(n.id, i);
    w.u32(n.id); w.i16(dmOf(n.x - ox, 'ped x')); w.i16(dmOf(n.z - oz, 'ped z')); w.i16(dmOf(n.y, 'ped y')); w.u8(n.flags);
  });
  w.u16(c.pedEdges.length);
  for (const e of c.pedEdges) {
    const a = pedIndex.get(e.a);
    const bb = pedIndex.get(e.b);
    if (a === undefined || bb === undefined) throw new RangeError('encode: ped edge references a node outside the chunk');
    w.u16(a); w.u16(bb); w.u8(e.kind); w.u8(dmOf(e.widthM, 'ped width')); w.i16(e.junction); w.i16(e.movement);
  }
  out.push({ id: SEC.PED, count: 1, data: w.bytes() });

  const strings = new StringTable();
  w = new Bytes();
  let groups = 0;
  TAG_TYPES.forEach((type: TagType, code) => {
    const list = (c.tags as unknown as Record<string, Record<string, unknown>[] | undefined>)[type];
    if (!list || list.length === 0) return;
    groups++;
    w.u8(code); w.u8(list.length);
    for (const rec of list) {
      w.u16(strings.add(rec['id'] as string));
      w.i16(dmOf((rec['x'] as number) - ox, `${type} x`)); w.i16(dmOf((rec['z'] as number) - oz, `${type} z`));
      w.i16(dmOf(rec['y'] as number, `${type} y`));
      for (const f of TAG_LAYOUT[type]) {
        const v = rec[f.key];
        switch (f.t) {
          case 'dm16': w.u16(dmOf(v as number, f.key)); break;
          case 'yaw8': w.u8(Math.round((v as number) / YAW_UNIT) & 255); break;
          case 'enum8': {
            const i = f.values?.indexOf(v as string) ?? -1;
            if (i < 0) throw new RangeError(`encode: ${f.key} ${String(v)} is not a known value`);
            w.u8(i);
            break;
          }
          case 'str16': w.u16(v === null ? NO_STRING : strings.add(v as string)); break;
          case 'bool8': w.u8(v ? 1 : 0); break;
          case 'edge32': w.u32(v as number); break;
          case 'edges8': { const l = v as number[]; w.u8(l.length); for (const e of l) w.u32(e); break; }
          case 'i8n127': w.i8(Math.round((v as number) * 127)); break;
        }
      }
    }
  });
  out.push({ id: SEC.TAGS, count: groups, data: w.bytes() });

  w = new Bytes();
  w.u8(c.spawn.densityProfile); w.u16(c.spawn.trafficSlots); w.u16(c.spawn.pedSlots); w.u16(c.spawn.parked.length);
  for (const p of c.spawn.parked) {
    w.u16(p.slot); w.u32(p.seg); w.u16(dmOf(p.s, 'parked s')); w.i8(p.side); w.i8(p.yawJitterDm);
  }
  out.push({ id: SEC.SPAWN, count: 1, data: w.bytes() });

  if (c.ground.length !== GROUND_CELLS) throw new RangeError('encode: ground grid must be 64 x 64');
  out.push({ id: SEC.GROUND, count: 1, data: Uint8Array.from(c.ground) });

  w = new Bytes();
  w.u16(strings.list.length);
  const te = new TextEncoder();
  for (const s of strings.list) {
    const u = te.encode(s);
    w.u8(u.length); w.raw(u);
  }
  out.push({ id: SEC.STRINGS, count: strings.list.length, data: w.bytes() });
  return out;
}

export function encodeP0(chunks: readonly SimChunk[], header: PackHeaderInput): Uint8Array {
  const outs = chunks.map((c) => {
    if (c.bakeId !== header.bakeId) throw new RangeError(`encode: ${c.key} has a different bakeId`);
    return { ...cellOf(c.key, header), sections: encodeChunkP0(c) };
  });
  return assemble(FAMILY_CODE.p0, header, outs);
}

function encodeBuilding(w: Bytes, b: BuildingRecord): void {
  if (b.palette < 0 || b.palette > 63) throw new RangeError('encode: palette must fit 6 bits');
  w.i16(b.baseDm); w.u16(b.heightDm); w.u8(b.kind); w.u8((b.roof << 6) | b.palette); w.u16(b.seed); w.u8(b.proxyOf);
  w.u8(b.ring.length / 2);
  for (const v of b.ring) w.i16(v);
}

function encodeChunkL0(c: RenderChunk): SectionOut[] {
  const b = chunkBounds(c.key);
  const ox = b.minX;
  const oz = b.minZ;
  const out: SectionOut[] = [];
  let w = new Bytes();
  for (const bd of c.buildings) encodeBuilding(w, bd);
  out.push({ id: SEC.BUILDING, count: c.buildings.length, data: w.bytes() });

  w = new Bytes();
  for (let i = 0; i < c.trees.length; i += 4) {
    w.i16(dmOf((c.trees[i] as number) - ox, 'tree x')); w.i16(dmOf((c.trees[i + 1] as number) - oz, 'tree z'));
    w.u8(quant(c.trees[i + 2] as number, TREE_SCALE_UNIT, 'tree scale')); w.u8(c.trees[i + 3] as number);
  }
  out.push({ id: SEC.TREE, count: c.trees.length / 4, data: w.bytes() });

  w = new Bytes();
  for (let i = 0; i < c.lamps.length; i += 3) {
    w.i16(dmOf((c.lamps[i] as number) - ox, 'lamp x')); w.i16(dmOf((c.lamps[i + 1] as number) - oz, 'lamp z'));
    w.u8(Math.round((c.lamps[i + 2] as number) / YAW_UNIT) & 255);
  }
  out.push({ id: SEC.LAMP, count: c.lamps.length / 3, data: w.bytes() });

  w = new Bytes();
  for (let i = 0; i < c.furniture.length; i += 4) {
    w.i16(dmOf((c.furniture[i] as number) - ox, 'furniture x')); w.i16(dmOf((c.furniture[i + 1] as number) - oz, 'furniture z'));
    w.u8(Math.round((c.furniture[i + 2] as number) / YAW_UNIT) & 255); w.u8(c.furniture[i + 3] as number);
  }
  out.push({ id: SEC.FURNITURE, count: c.furniture.length / 4, data: w.bytes() });

  w = new Bytes();
  for (const l of c.landmarks) w.u8(l);
  out.push({ id: SEC.LMREF, count: c.landmarks.length, data: w.bytes() });
  return out;
}

export function encodeL0(chunks: readonly RenderChunk[], header: PackHeaderInput): Uint8Array {
  const outs = chunks.map((c) => {
    if (c.bakeId !== header.bakeId) throw new RangeError(`encode: ${c.key} has a different bakeId`);
    return { ...cellOf(c.key, header), sections: encodeChunkL0(c) };
  });
  return assemble(FAMILY_CODE.l0, header, outs);
}
