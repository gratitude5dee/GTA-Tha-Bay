import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NodeControl, YAW_UNIT, decodeL0, decodeP0, readHeader, toStaticShapeSet, chunkBounds,
  type SimChunk,
} from '../../../packages/shared/src/index.ts';
import type { StaticShapeSet } from '../../../packages/engine/src/sim/physics/backend.ts';
import { encodeL0, encodeP0, type PackHeaderInput } from '../src/pack/encode.ts';

const dir = fileURLToPath(new URL('../../../tests/fixtures/world/civic-graybox/', import.meta.url));
const read = (n: string): Uint8Array => new Uint8Array(readFileSync(dir + n));
const p0Bytes = read('p0-64-64.pack');
const l0Bytes = read('l0-64-64.pack');
const headerOf = (b: Uint8Array): PackHeaderInput => {
  const h = readHeader(b);
  return { tileX: h.tileX, tileY: h.tileY, hostZ: h.hostZ, bakeId: h.bakeId };
};
const p0 = decodeP0(p0Bytes);

describe('encode is the exact inverse of decode', () => {
  it('re-encodes the committed p0 byte for byte', () => {
    const again = encodeP0(decodeP0(p0Bytes), headerOf(p0Bytes));
    expect(Buffer.from(again).equals(Buffer.from(p0Bytes))).toBe(true);
  });

  it('re-encodes the committed l0 byte for byte', () => {
    const again = encodeL0(decodeL0(l0Bytes, p0), headerOf(l0Bytes));
    expect(Buffer.from(again).equals(Buffer.from(l0Bytes))).toBe(true);
  });

  it('writes a clean layout: directory at 64, reserved bytes zero, absolute offsets', () => {
    const dv = new DataView(p0Bytes.buffer, p0Bytes.byteOffset, p0Bytes.byteLength);
    expect(dv.getUint32(44, true)).toBe(64);
    expect(p0Bytes.subarray(48, 64).every((v) => v === 0)).toBe(true);
    const first = dv.getUint32(64 + 4, true);
    expect(first).toBe(64 + 4 * 8); // the first section table follows the directory
    let prevEnd = first + 13 * 12;
    for (let i = 0; i < 13; i++) {
      const o = first + i * 12;
      expect(p0Bytes[o]).toBe(i + 1); // ascending ids 1..13
      expect(dv.getUint32(o + 4, true)).toBe(prevEnd); // payloads follow with no padding
      prevEnd += dv.getUint32(o + 8, true);
    }
    expect(dv.getUint32(64 + 8 + 4, true)).toBe(prevEnd); // the next chunk starts right after
  });

  it('shares its StaticShapeSet shape with the engine physics backend', () => {
    const s: StaticShapeSet = toStaticShapeSet(p0[0]!);
    expect(s.prisms.length).toBeGreaterThan(0);
  });

  it('round-trips every section type, including tags, slabs, hoods and a program-less junction', () => {
    const base = p0[0]!;
    const b = chunkBounds(base.key);
    const x = (dm: number) => b.minX + dm / 10;
    const z = (dm: number) => b.minZ + dm / 10;
    const yaw = (u: number) => u * YAW_UNIT;
    const chunk: SimChunk = {
      ...base,
      slabs: Float32Array.of(4, 5, 1, x(100), z(100), x(100), z(140), x(140), z(140), x(140), z(100)),
      hoods: Float32Array.of(3, -3.5, 4.5, x(0), z(0), x(40), z(0), x(0), z(40)),
      segments: [{ id: 99, pts: Float32Array.of(x(10), 1.5, z(20), x(30), 2, z(40)), lengthM: 0, widthM: 9.5, osmWay: 12345678901, cnn: 77 }],
      junctions: [{
        id: 3, nodes: [0, 12345], x: 100, z: 100, control: NodeControl.Yield, program: null, stopApproaches: [5, 6],
        movements: [{ id: 0, inEdge: 5, outEdge: 6, turn: 'uturn', lengthM: 12.3, conflicts: [] }],
      }],
      tags: {
        hidingSpots: [{ id: 'hs.é€😀', x: x(10), y: 1, z: z(10), radiusM: 7.5, kind: 'alley' }],
        pursuitBreakers: [{ id: 'pb.a', x: x(20), y: 2, z: z(20), triggerRadiusM: 12, kind: 'billboard', prefab: 'pfb:test', mission: true }],
        chokePoints: [{ id: 'cp.a', x: x(30), y: 3, z: z(30), edge: 4000000000, widthM: 9, kind: 'ramp' }],
        jumpZones: [{ id: 'jz.a', x: x(40), y: 4, z: z(40), yaw: yaw(64), lengthM: 20, kind: 'hill-crest' }],
        portals: [
          { id: 'po.a', x: x(50), y: 5, z: z(50), yaw: yaw(128), widthM: 30, kind: 'ferry', state: 'sealed', toArea: 'ea-oakland', edges: [1, 2, 3] },
          { id: 'po.b', x: x(60), y: 6, z: z(60), yaw: 0, widthM: 30, kind: 'tunnel', state: 'open', toArea: null, edges: [] },
        ],
        shoreNodes: [{ id: 'sh.a', x: x(70), y: 0, z: z(70), nx: 127 / 127, nz: -64 / 127 }],
        teleportNodes: [{ id: 'tp.a', x: x(80), y: 8, z: z(80), yaw: yaw(255), kind: 'transit' }],
      },
    };
    chunk.junctions[0]!.program = null;
    const header = headerOf(p0Bytes);
    const decoded = decodeP0(encodeP0([chunk], header))[0]!;
    // Junction x/z are derived from member nodes (clarification 5): only node 0 is in this chunk.
    const junction = { ...chunk.junctions[0]!, x: base.nodes[0]!.x, z: base.nodes[0]!.z };
    expect(decoded.junctions).toEqual([junction]);
    expect(decoded.tags).toEqual(chunk.tags);
    expect(decoded.hoods).toEqual(chunk.hoods);
    expect(decoded.slabs).toEqual(chunk.slabs);
    expect(decoded.segments[0]!.lengthM).toBeCloseTo(Math.hypot(2, 0.5, 2), 4);
    expect(decoded.segments[0]!.osmWay).toBe(12345678901);
    expect(decoded.segments[0]!.cnn).toBe(77);
    const again = encodeP0([decoded], header);
    expect(Buffer.from(again).equals(Buffer.from(encodeP0([chunk], header)))).toBe(true);
  });

  it('derives segment length from 3D point distances', () => {
    const base = p0[0]!;
    const b = chunkBounds(base.key);
    const pts = Float32Array.of(b.minX + 1, 0, b.minZ + 1, b.minX + 4, 4, b.minZ + 5);
    const c: SimChunk = { ...base, segments: [{ id: 1, pts, lengthM: 0, widthM: 6, osmWay: 0, cnn: 0 }] };
    const d = decodeP0(encodeP0([c], headerOf(p0Bytes)))[0]!;
    expect(d.segments[0]!.lengthM).toBeCloseTo(Math.hypot(3, 4, 4), 6);
  });
});

describe('encoder rejects what it cannot represent', () => {
  const header = headerOf(p0Bytes);
  const base = p0[0]!;
  const b = chunkBounds(base.key);

  it('throws on an i16 overflow instead of clamping', () => {
    const c: SimChunk = { ...base, nodes: [{ ...base.nodes[0]!, x: b.minX + 4000 }] }; // 40,000 dm
    expect(() => encodeP0([c], header)).toThrow(RangeError);
  });

  it('throws on more than 255 vertices', () => {
    const verts = 256;
    const pack = new Float32Array(3 + verts * 2);
    pack[0] = verts;
    const c: SimChunk = { ...base, prisms: pack };
    expect(() => encodeP0([c], header)).toThrow(RangeError);
  });

  it('throws on values that are not on the 0.1 m grid', () => {
    const c: SimChunk = { ...base, nodes: [{ ...base.nodes[0]!, x: base.nodes[0]!.x + 0.04 }] };
    expect(() => encodeP0([c], header)).toThrow(RangeError);
  });

  it('throws on a chunk outside the host tile, a bake mismatch and an unknown tag kind', () => {
    expect(() => encodeP0([{ ...base, key: '9/300/300' }], header)).toThrow(RangeError);
    expect(() => encodeP0([{ ...base, bakeId: 'f'.repeat(64) }], header)).toThrow(RangeError);
    const bad = { ...base, tags: { ...base.tags, hidingSpots: [{ id: 'x', x: b.minX, y: 0, z: b.minZ, radiusM: 1, kind: 'moat' as 'alley' }] } };
    expect(() => encodeP0([bad], header)).toThrow(RangeError);
  });
});
