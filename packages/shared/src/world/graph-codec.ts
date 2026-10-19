/**
 * `map_data/sf-graph.v1` codec (M02a2; 02-world-contracts.md rule 9): the always-resident road topology, nodes and edges with
 * lengths, classes and flags and no geometry, so long routes can be planned before the chunks of the route are resident.
 * Pure and deterministic (C02 lint applies): the same topology encodes to the same bytes, and decode then encode is the
 * identity.
 *
 * Layout (a C08 clarification proposal, listed in the M02a2 report; little-endian, no padding):
 *   header 48 B   magic u32 0x52475644 ('D' 'V' 'G' 'R'), version u8 = 1, 3 B reserved (0), bakeId[32] raw SHA-256,
 *                 nodeCount u32, edgeCount u32
 *   node   12 B   x i32 and z i32 in 0.1 m (absolute ENU), y i16 in 0.1 m, layer i8, control u8
 *   edge   18 B   from u32, to u32, lengthDm u32 (the segment length in 0.1 m), cls u8, lanes u8,
 *                 flags u16 (bit 15 = direction -1, bits 0 to 14 = RoadEdge.flags), layer i8, speed u8 (0.25 m/s)
 * Node and edge ids are their indices (C08 rule 8 assigns them densely), so the arrays carry no id column.
 */

export const GRAPH_MAGIC = 0x52475644;
export const GRAPH_VERSION = 1;
export const GRAPH_HEADER_BYTES = 48;
export const GRAPH_NODE_BYTES = 12;
export const GRAPH_EDGE_BYTES = 18;

export interface GraphNode { x: number; z: number; y: number; layer: number; control: number }
export interface GraphEdge { from: number; to: number; lengthM: number; cls: number; lanes: number; flags: number; dir: 1 | -1; layer: number; speedMps: number }
export interface GraphTopology { bakeId: string; nodes: GraphNode[]; edges: GraphEdge[] }

export class GraphDecodeError extends Error {
  constructor(detail: string) {
    super(`sf-graph decode failed: ${detail}`);
    this.name = 'GraphDecodeError';
  }
}

const HEX = '0123456789abcdef';

function bakeIdBytes(hex: string): Uint8Array {
  if (hex.length !== 64) throw new RangeError('encodeGraph: bakeId must be 64 lowercase hex characters');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const hi = HEX.indexOf(hex.charAt(i * 2)), lo = HEX.indexOf(hex.charAt(i * 2 + 1));
    if (hi < 0 || lo < 0) throw new RangeError('encodeGraph: bakeId must be 64 lowercase hex characters');
    out[i] = hi * 16 + lo;
  }
  return out;
}

function bakeIdHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX.charAt((b[i] as number) >> 4) + HEX.charAt((b[i] as number) & 15);
  return s;
}

function dm(v: number, what: string): number {
  const q = Math.round(v * 10);
  if (!Number.isInteger(q)) throw new RangeError(`encodeGraph: ${what} ${v} is not finite`);
  return q;
}

export function encodeGraph(g: GraphTopology): Uint8Array {
  const out = new Uint8Array(GRAPH_HEADER_BYTES + g.nodes.length * GRAPH_NODE_BYTES + g.edges.length * GRAPH_EDGE_BYTES);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GRAPH_MAGIC, true);
  dv.setUint8(4, GRAPH_VERSION);
  out.set(bakeIdBytes(g.bakeId), 8);
  dv.setUint32(40, g.nodes.length, true);
  dv.setUint32(44, g.edges.length, true);
  let o = GRAPH_HEADER_BYTES;
  for (const n of g.nodes) {
    dv.setInt32(o, dm(n.x, 'node x'), true);
    dv.setInt32(o + 4, dm(n.z, 'node z'), true);
    dv.setInt16(o + 8, dm(n.y, 'node y'), true);
    dv.setInt8(o + 10, n.layer);
    dv.setUint8(o + 11, n.control);
    o += GRAPH_NODE_BYTES;
  }
  for (const e of g.edges) {
    if (e.flags < 0 || e.flags > 0x7fff) throw new RangeError('encodeGraph: edge flags must fit 15 bits');
    dv.setUint32(o, e.from, true);
    dv.setUint32(o + 4, e.to, true);
    dv.setUint32(o + 8, dm(e.lengthM, 'edge length'), true);
    dv.setUint8(o + 12, e.cls);
    dv.setUint8(o + 13, e.lanes);
    dv.setUint16(o + 14, e.flags | (e.dir === -1 ? 0x8000 : 0), true);
    dv.setInt8(o + 16, e.layer);
    dv.setUint8(o + 17, Math.round(e.speedMps * 4));
    o += GRAPH_EDGE_BYTES;
  }
  return out;
}

export function decodeGraph(buf: ArrayBuffer | ArrayBufferView): GraphTopology {
  const u8 = ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
  if (u8.length < GRAPH_HEADER_BYTES) throw new GraphDecodeError(`${u8.length} B is shorter than the header`);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== GRAPH_MAGIC) throw new GraphDecodeError('bad magic');
  if (dv.getUint8(4) !== GRAPH_VERSION) throw new GraphDecodeError(`version ${dv.getUint8(4)}`);
  const nn = dv.getUint32(40, true), ne = dv.getUint32(44, true);
  if (u8.length !== GRAPH_HEADER_BYTES + nn * GRAPH_NODE_BYTES + ne * GRAPH_EDGE_BYTES) throw new GraphDecodeError('length does not match the counts');
  const nodes: GraphNode[] = [];
  let o = GRAPH_HEADER_BYTES;
  for (let i = 0; i < nn; i++) {
    nodes.push({ x: dv.getInt32(o, true) / 10, z: dv.getInt32(o + 4, true) / 10, y: dv.getInt16(o + 8, true) / 10, layer: dv.getInt8(o + 10), control: dv.getUint8(o + 11) });
    o += GRAPH_NODE_BYTES;
  }
  const edges: GraphEdge[] = [];
  for (let i = 0; i < ne; i++) {
    const flags = dv.getUint16(o + 14, true);
    const from = dv.getUint32(o, true), to = dv.getUint32(o + 4, true);
    if (from >= nn || to >= nn) throw new GraphDecodeError(`edge ${i} names a node outside the table`);
    edges.push({
      from, to, lengthM: dv.getUint32(o + 8, true) / 10, cls: dv.getUint8(o + 12), lanes: dv.getUint8(o + 13), flags: flags & 0x7fff,
      dir: flags & 0x8000 ? -1 : 1, layer: dv.getInt8(o + 16), speedMps: dv.getUint8(o + 17) / 4,
    });
    o += GRAPH_EDGE_BYTES;
  }
  return { bakeId: bakeIdHex(u8.subarray(8, 40)), nodes, edges };
}
