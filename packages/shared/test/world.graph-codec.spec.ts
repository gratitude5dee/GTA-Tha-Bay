import { describe, expect, it } from 'vitest';
import {
  GRAPH_EDGE_BYTES, GRAPH_HEADER_BYTES, GRAPH_MAGIC, GRAPH_NODE_BYTES, GraphDecodeError, decodeGraph, encodeGraph, sha256Hex,
  type GraphTopology,
} from '../src/index.ts';

const BAKE_ID = sha256Hex(new TextEncoder().encode('graph-codec-test'));

function sample(): GraphTopology {
  return {
    bakeId: BAKE_ID,
    nodes: [
      { x: 0, z: 0, y: 12.3, layer: 0, control: 1 },
      { x: -1234.5, z: 987.6, y: -4.2, layer: -1, control: 0 },
      { x: 32767.9, z: -32767.9, y: 67, layer: 1, control: 4 },
    ],
    edges: [
      { from: 0, to: 1, lengthM: 1590.8, cls: 2, lanes: 2, flags: 0x1234, dir: 1, layer: 0, speedMps: 13.5 },
      { from: 1, to: 0, lengthM: 1590.8, cls: 2, lanes: 2, flags: 0x7fff, dir: -1, layer: -1, speedMps: 13.5 },
      { from: 1, to: 2, lengthM: 0.1, cls: 5, lanes: 1, flags: 0, dir: 1, layer: 1, speedMps: 0 },
    ],
  };
}

describe('sf-graph codec', () => {
  it('has the documented size: 48 B header, 12 B per node, 18 B per edge', () => {
    const bytes = encodeGraph(sample());
    expect(bytes.byteLength).toBe(GRAPH_HEADER_BYTES + 3 * GRAPH_NODE_BYTES + 3 * GRAPH_EDGE_BYTES);
    expect(GRAPH_HEADER_BYTES).toBe(48);
    expect(GRAPH_NODE_BYTES).toBe(12);
    expect(GRAPH_EDGE_BYTES).toBe(18);
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint32(0, true)).toBe(GRAPH_MAGIC);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('DVGR');
    expect(dv.getUint32(40, true)).toBe(3);
    expect(dv.getUint32(44, true)).toBe(3);
  });

  it('decodes what it encoded, at 0.1 m and 0.25 m/s resolution', () => {
    const g = decodeGraph(encodeGraph(sample()));
    expect(g.bakeId).toBe(BAKE_ID);
    expect(g.nodes[0]).toEqual({ x: 0, z: 0, y: 12.3, layer: 0, control: 1 });
    expect(g.nodes[1]).toEqual({ x: -1234.5, z: 987.6, y: -4.2, layer: -1, control: 0 });
    expect(g.edges[0]).toEqual({ from: 0, to: 1, lengthM: 1590.8, cls: 2, lanes: 2, flags: 0x1234, dir: 1, layer: 0, speedMps: 13.5 });
    expect(g.edges[1]!.dir).toBe(-1);
    expect(g.edges[1]!.flags).toBe(0x7fff);
    expect(g.edges[2]!.lengthM).toBe(0.1);
  });

  it('is the identity under decode then encode, and deterministic', () => {
    const bytes = encodeGraph(sample());
    expect(Array.from(encodeGraph(decodeGraph(bytes)))).toEqual(Array.from(bytes));
    expect(Array.from(encodeGraph(sample()))).toEqual(Array.from(bytes));
    expect(sha256Hex(bytes)).toBe(sha256Hex(encodeGraph(sample())));
  });

  it('round-trips an empty graph', () => {
    const g = decodeGraph(encodeGraph({ bakeId: BAKE_ID, nodes: [], edges: [] }));
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it('accepts an ArrayBuffer and a view at an offset', () => {
    const bytes = encodeGraph(sample());
    const padded = new Uint8Array(bytes.length + 7);
    padded.set(bytes, 7);
    expect(decodeGraph(padded.subarray(7)).edges).toHaveLength(3);
    expect(decodeGraph(bytes.slice().buffer).nodes).toHaveLength(3);
  });

  it('rejects a bad magic, version, length, edge endpoint and short buffer', () => {
    const good = encodeGraph(sample());
    const bad = (mut: (b: Uint8Array, dv: DataView) => void): Uint8Array => { const b = good.slice(); mut(b, new DataView(b.buffer)); return b; };
    expect(() => decodeGraph(bad((_b, dv) => dv.setUint32(0, 1, true)))).toThrow(GraphDecodeError);
    expect(() => decodeGraph(bad((_b, dv) => dv.setUint8(4, 2)))).toThrow(/version 2/);
    expect(() => decodeGraph(good.subarray(0, good.length - 1))).toThrow(/length does not match/);
    expect(() => decodeGraph(bad((_b, dv) => dv.setUint32(GRAPH_HEADER_BYTES + 3 * GRAPH_NODE_BYTES + 4, 9, true)))).toThrow(/outside the node table|outside the table/);
    expect(() => decodeGraph(good.subarray(0, 20))).toThrow(/shorter than the header/);
  });

  it('refuses a malformed bakeId, a non-finite value and flags over 15 bits at encode', () => {
    expect(() => encodeGraph({ ...sample(), bakeId: 'abc' })).toThrow(RangeError);
    expect(() => encodeGraph({ ...sample(), bakeId: 'G'.repeat(64) })).toThrow(RangeError);
    const nan = sample();
    nan.nodes[0]!.x = Number.NaN;
    expect(() => encodeGraph(nan)).toThrow(RangeError);
    const flags = sample();
    flags.edges[0]!.flags = 0x8000;
    expect(() => encodeGraph(flags)).toThrow(RangeError);
  });
});
