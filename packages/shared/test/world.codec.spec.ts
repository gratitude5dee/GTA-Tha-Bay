import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NodeControl, PackDecodeError, canonicalize, decodeL0, decodeP0, postIndex, readHeader, sampleHeight, sha256Hex,
  signalAspect, toStaticShapeSet,
  type PackDecodeReason,
} from '../src/index.ts';

const dir = fileURLToPath(new URL('../../../tests/fixtures/world/civic-graybox/', import.meta.url));
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(dir + name));
const p0Bytes = read('p0-64-64.pack');
const l0Bytes = read('l0-64-64.pack');
const BAKE_ID = sha256Hex(canonicalize({ sourceHashes: {}, toolVersion: 'graybox@1', configHashes: {} }));
const p0 = decodeP0(p0Bytes);
const chunk = (key: string) => p0.find((c) => c.key === key)!;

function expectReason(bytes: Uint8Array, reason: PackDecodeReason, decode: (b: Uint8Array) => unknown = decodeP0): void {
  let err: unknown;
  let result: unknown;
  try {
    result = decode(bytes);
  } catch (e) {
    err = e;
  }
  expect(err, `expected a throw for ${reason}`).toBeInstanceOf(PackDecodeError);
  expect((err as PackDecodeError).reason).toBe(reason);
  expect(result).toBeUndefined();
}

describe('DVWP header', () => {
  it('reads the fixture header', () => {
    expect(readHeader(p0Bytes)).toEqual({
      version: 1, family: 0, tileX: 64, tileY: 64, hostZ: 7, chunkCount: 4, bakeId: BAKE_ID, dirOffset: 64,
    });
    expect(readHeader(l0Bytes).family).toBe(1);
    // magic is the bytes 'D' 'V' 'W' 'P'
    expect(String.fromCharCode(...p0Bytes.subarray(0, 4))).toBe('DVWP');
  });
});

describe('decodeP0 on the committed gray-box fixture', () => {
  it('returns the four chunks with the bake id', () => {
    expect(p0.map((c) => c.key)).toEqual(['9/256/256', '9/257/256', '9/256/257', '9/257/257']);
    for (const c of p0) expect(c.bakeId).toBe(BAKE_ID);
  });

  it('shares edge posts between neighbours', () => {
    const a = chunk('9/256/256').height, b = chunk('9/257/256').height, c = chunk('9/256/257').height;
    for (let r = 0; r < 65; r++) expect(a.dm[postIndex(64, r)]).toBe(b.dm[postIndex(0, r)]);
    for (let col = 0; col < 65; col++) expect(a.dm[postIndex(col, 64)]).toBe(c.dm[postIndex(col, 0)]);
  });

  it('samples 17.6 m at City Hall and 15.6 m 100 m south', () => {
    const h = chunk('9/256/256').height;
    expect(sampleHeight(h, 0, 0)).toBeCloseTo(17.6, 1);
    expect(Math.abs(sampleHeight(h, 0, 0) - 17.6)).toBeLessThan(0.05);
    expect(Math.abs(sampleHeight(h, 0, 100) - 15.6)).toBeLessThan(0.05);
  });

  it('holds 12 prisms, 3 per chunk, wound counter-clockwise on the map', () => {
    let total = 0;
    for (const c of p0) {
      let n = 0;
      for (let i = 0; i < c.prisms.length; ) {
        const verts = c.prisms[i] as number;
        expect(verts).toBe(4);
        // NW -> SW -> SE -> NE: x0 == x1, z grows, then x grows.
        const [x0, z0, x1, z1, x2, z2, x3, z3] = Array.from(c.prisms.subarray(i + 3, i + 11));
        expect([x0, z0, x1, z1, x2, z2, x3, z3].every((v) => Number.isFinite(v))).toBe(true);
        expect(x1).toBe(x0); expect(z1! > z0!).toBe(true); expect(x2! > x1!).toBe(true); expect(z2).toBe(z1);
        expect(x3).toBe(x2); expect(z3).toBe(z0);
        i += 3 + verts * 2;
        n++;
      }
      expect(n).toBe(3);
      total += n;
      expect(c.slabs.length).toBe(0);
      expect(c.hoods.length).toBe(0);
    }
    expect(total).toBe(12);
  });

  it('holds 8 directed edges, 5 nodes, 4 segments and one signalised junction', () => {
    expect(p0.reduce((n, c) => n + c.edges.length, 0)).toBe(8);
    expect(p0.reduce((n, c) => n + c.nodes.length, 0)).toBe(5);
    expect(p0.reduce((n, c) => n + c.segments.length, 0)).toBe(4);
    const js = p0.flatMap((c) => c.junctions);
    expect(js).toHaveLength(1);
    const j = js[0]!;
    expect(j.movements).toHaveLength(12);
    expect(j.program?.phases).toHaveLength(2);
    expect(j.control).toBe(NodeControl.Signal);
    expect(j.x).toBe(100);
    expect(j.z).toBe(100);
    expect(j.program?.id).toBe(j.id);
    expect(j.program?.pedWalkTicks).toBe(0);
  });

  it('has twins, owners and lengths that agree', () => {
    const edges = p0.flatMap((c) => c.edges);
    const byId = new Map(edges.map((e) => [e.id, e]));
    expect([...byId.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const e of edges) {
      const t = byId.get(e.twin)!;
      expect(t.twin).toBe(e.id);
      expect(t.from).toBe(e.to);
      expect(t.seg).toBe(e.seg);
      expect(t.dir).toBe(-e.dir);
      expect(e.cls).toBe(2);
      expect(e.lanes).toBe(2);
      expect(e.laneWidthM).toBe(3.5);
      expect(e.speedMps).toBe(13.5);
      expect(e.parkingSides).toBe(2);
      expect(e.nhood).toBe(255);
    }
    // ownership: an edge sits in the chunk that contains its `from` node
    for (const c of p0) {
      const nodeIds = new Set(c.nodes.map((n) => n.id));
      for (const e of c.edges) expect(nodeIds.has(e.from)).toBe(true);
    }
    const seg = chunk('9/256/256').segments.find((s) => s.id === 2)!; // east arm: J (100,100) -> (376,100)
    expect(seg.widthM).toBe(18.6);
    expect(seg.lengthM).toBeCloseTo(276, 6);
    for (let i = 3; i < seg.pts.length; i += 3) {
      const d = Math.hypot(seg.pts[i]! - seg.pts[i - 3]!, seg.pts[i + 2]! - seg.pts[i - 1]!);
      expect(d).toBeLessThanOrEqual(20 + 1e-4);
    }
  });

  it('keeps movements consistent: no u-turns, symmetric conflicts, out edges leave J', () => {
    const j = p0.flatMap((c) => c.junctions)[0]!;
    const edges = new Map(p0.flatMap((c) => c.edges).map((e) => [e.id, e]));
    for (const m of j.movements) {
      expect(m.turn).not.toBe('uturn');
      expect(edges.get(m.inEdge)!.to).toBe(0);
      expect(edges.get(m.outEdge)!.from).toBe(0);
      expect(m.conflicts).not.toContain(m.id);
      for (const k of m.conflicts) expect(j.movements[k]!.conflicts).toContain(m.id);
      expect(m.conflicts).toEqual([...m.conflicts].sort((a, b) => a - b));
    }
    const straight = j.movements.filter((m) => m.turn === 'straight');
    expect(straight).toHaveLength(4);
    // opposing straights do not conflict, crossing ones do
    const n = j.movements[0]!, s = j.movements[6]!, e = j.movements[3]!;
    expect(n.turn).toBe('straight'); expect(s.turn).toBe('straight'); expect(e.turn).toBe('straight');
    expect(n.conflicts).not.toContain(s.id);
    expect(n.conflicts).toContain(e.id);
    // two movements into the same out edge conflict
    const intoSouth = j.movements.filter((m) => m.outEdge === n.outEdge).map((m) => m.id);
    expect(intoSouth).toHaveLength(3);
    expect(j.movements[intoSouth[0]!]!.conflicts.filter((c) => intoSouth.includes(c)).length).toBeGreaterThanOrEqual(1);
  });

  it('runs the signal: N-S green first, E-W green at 1800', () => {
    const j = p0.flatMap((c) => c.junctions)[0]!;
    const prog = j.program!;
    expect(prog.cycleTicks).toBe(3600);
    expect(prog.phases.map((p) => [p.startTick, p.greenTicks, p.amberTicks, p.clearTicks])).toEqual([[0, 1500, 240, 60], [1800, 1500, 240, 60]]);
    expect(signalAspect(prog, 0, 0, false)).toBe('green');
    expect(signalAspect(prog, 0, 3, false)).toBe('red');
    expect(signalAspect(prog, 1500, 0, false)).toBe('amber');
    expect(signalAspect(prog, 1800, 3, false)).toBe('green');
    expect(signalAspect(prog, 1800, 0, false)).toBe('red');
    expect(signalAspect(prog, 10, 0, true)).toBe('dark');
    // every movement is in exactly one phase
    for (const m of j.movements) expect(prog.phases.filter((p) => p.movements.includes(m.id))).toHaveLength(1);
  });

  it('splits sidewalks at chunk edges with duplicate boundary nodes', () => {
    const c0 = chunk('9/256/256'), c1 = chunk('9/257/256'), c2 = chunk('9/256/257');
    expect(c0.pedNodes).toHaveLength(12);
    expect(c1.pedNodes).toHaveLength(4);
    expect(c2.pedNodes).toHaveLength(4);
    expect(chunk('9/257/257').pedNodes).toHaveLength(0);
    const ids = p0.flatMap((c) => c.pedNodes.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
    const at = (c: typeof c0, x: number, z: number) => c.pedNodes.filter((n) => n.x === x && Math.abs(n.z - z) < 1e-4);
    expect(at(c0, 128, 89.2)).toHaveLength(1);
    expect(at(c1, 128, 89.2)).toHaveLength(1);
    expect(c0.pedEdges.filter((e) => e.kind === 1)).toHaveLength(4);
    for (const c of p0) {
      const have = new Set(c.pedNodes.map((n) => n.id));
      for (const e of c.pedEdges) { expect(have.has(e.a)).toBe(true); expect(have.has(e.b)).toBe(true); }
    }
    for (const e of c0.pedEdges.filter((q) => q.kind === 1)) {
      expect(e.widthM).toBe(4);
      expect(e.junction).toBe(0);
      expect(chunk('9/256/256').junctions[0]!.movements[e.movement]!.turn).toBe('straight');
    }
  });

  it('classifies ground under roads, sidewalks and grass', () => {
    const g = chunk('9/256/256').ground;
    const cell = (x: number, z: number) => g[Math.floor((z + 128) / 4) * 64 + Math.floor((x + 128) / 4)];
    expect(cell(0, 100)).toBe(6); // E-W carriageway
    expect(cell(100, 0)).toBe(6); // N-S carriageway
    expect(cell(0, 89.2)).toBe(7); // sidewalk
    expect(cell(-60, -60)).toBe(0); // grass
  });

  it('carries the spawn table and the teleport tag', () => {
    const c0 = chunk('9/256/256'), c1 = chunk('9/257/256');
    for (const c of p0) { expect(c.spawn.trafficSlots).toBe(8); expect(c.spawn.pedSlots).toBe(16); expect(c.spawn.cellKey).toBe(c.key); }
    expect(c0.spawn.parked.map((p) => p.slot)).toEqual([512, 513, 514, 515]);
    expect(c0.spawn.parked.map((p) => p.s)).toEqual([30, 50, 70, 90]);
    expect(c0.spawn.parked.map((p) => p.side)).toEqual([1, -1, 1, -1]);
    expect(c1.spawn.parked).toHaveLength(4);
    expect(chunk('9/256/257').spawn.parked).toHaveLength(0);
    expect(chunk('9/257/257').spawn.parked).toHaveLength(0);
    expect(c0.tags.teleportNodes).toEqual([{ id: 'tp.graybox.spawn', x: 89, y: 16.4, z: 60, yaw: 0, kind: 'spawn' }]);
    expect(c1.tags.teleportNodes).toBeUndefined();
  });
});

describe('toStaticShapeSet', () => {
  it('builds the C01 shape set: 65 x 65 heightfield and the concatenated prisms', () => {
    for (const c of p0) {
      const s = toStaticShapeSet(c);
      const hf = s.heightfield;
      expect(hf.nx).toBe(65);
      expect(hf.nz).toBe(65);
      expect(hf.cell).toBe(4);
      expect(hf.heights).toBeInstanceOf(Float32Array);
      expect(hf.heights.length).toBe(4225);
      for (let i = 0; i < 4225; i++) expect(hf.heights[i]).toBe(Math.fround(c.height.dm[i]! * 0.1));
      expect(hf.at).toEqual([c.height.originX, 0, c.height.originZ]);
      expect(Array.from(s.prisms)).toEqual([...c.prisms, ...c.slabs, ...c.hoods]);
    }
  });

  it('concatenates prisms, slabs and hoods in that order', () => {
    const c = { ...chunk('9/256/256'), slabs: Float32Array.of(3, 1, 1, 0, 0, 1, 0, 0, 1), hoods: Float32Array.of(3, 2, 2, 5, 5, 6, 5, 5, 6) };
    const s = toStaticShapeSet(c);
    expect(s.prisms.length).toBe(chunk('9/256/256').prisms.length + 18);
    expect(Array.from(s.prisms.subarray(s.prisms.length - 18))).toEqual([...c.slabs, ...c.hoods]);
  });
});

describe('decodeL0', () => {
  const l0 = decodeL0(l0Bytes, p0);
  it('returns one render chunk per sim chunk with the shared height grid', () => {
    expect(l0.map((c) => c.key)).toEqual(p0.map((c) => c.key));
    l0.forEach((c, i) => {
      expect(c.z).toBe(9);
      expect(c.bakeId).toBe(BAKE_ID);
      expect(c.height).toBe(p0[i]!.height);
      expect(c.ground).toBe(p0[i]!.ground);
      expect(c.buildings).toHaveLength(3);
      expect(c.furniture).toHaveLength(0);
      expect(c.landmarks).toEqual([]);
    });
  });
  it('numbers buildings 0-11 with cycling kinds', () => {
    const all = l0.flatMap((c) => c.buildings);
    expect(all.map((b) => b.palette)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(all.map((b) => b.seed)).toEqual(all.map((b) => b.palette));
    expect(all.map((b) => b.kind)).toEqual([2, 1, 5, 2, 1, 5, 2, 1, 5, 2, 1, 5]);
    for (const b of all) { expect(b.roof).toBe(0); expect(b.proxyOf).toBe(0); expect(b.ring).toHaveLength(8); }
    expect(all[0]!.heightDm).toBe(120);
    expect(all[7]!.heightDm).toBe(45);
  });
  it('has 8 trees and 8 lamps', () => {
    expect(l0.reduce((n, c) => n + c.trees.length / 4, 0)).toBe(8);
    expect(l0.reduce((n, c) => n + c.lamps.length / 3, 0)).toBe(8);
  });
  it('rejects an l0 pack with no matching p0 chunk or with a different bake', () => {
    expectReason(l0Bytes, 'section', (b) => decodeL0(b, p0.slice(0, 2)));
    expectReason(l0Bytes, 'section', (b) => decodeL0(b, p0.map((c) => ({ ...c, bakeId: '0'.repeat(64) }))));
    expectReason(p0Bytes, 'family', (b) => decodeL0(b, p0));
  });
});

describe('corrupt packs', () => {
  const copy = () => Uint8Array.from(p0Bytes);
  const dv = (b: Uint8Array) => new DataView(b.buffer);

  it('wrong magic', () => { const b = copy(); b[0] = 0x58; expectReason(b, 'magic'); });
  it('version 2', () => { const b = copy(); b[4] = 2; expectReason(b, 'version'); });
  it('family 7', () => { const b = copy(); b[5] = 7; expectReason(b, 'family'); });
  it('an l0 pack given to decodeP0', () => { expectReason(l0Bytes, 'family'); });
  it('a buffer shorter than the header', () => { expectReason(p0Bytes.subarray(0, 40), 'bounds'); });
  it('a truncated directory', () => { expectReason(p0Bytes.subarray(0, 64 + 12), 'bounds'); });
  it('a directory entry outside the host cell', () => { const b = copy(); b[64] = 4; expectReason(b, 'bounds'); });
  it('a chunk table past the end', () => { const b = copy(); dv(b).setUint32(64 + 4, b.length - 6, true); expectReason(b, 'bounds'); });
  it('a section offset past the end', () => {
    const b = copy();
    const table = dv(b).getUint32(64 + 4, true);
    dv(b).setUint32(table + 4, b.length + 10, true); // first entry: offset
    expectReason(b, 'section');
  });
  it('a section that runs past the end', () => {
    const b = copy();
    const table = dv(b).getUint32(64 + 4, true);
    dv(b).setUint32(table + 8, b.length, true); // first entry: bytes
    expectReason(b, 'section');
  });
  it('a section with leftover bytes', () => {
    const b = copy();
    const table = dv(b).getUint32(64 + 4, true);
    const entries = dv(b).getUint16(64 + 2, true);
    for (let i = 0; i < entries; i++) {
      const o = table + i * 12;
      if (b[o] === 12) dv(b).setUint32(o + 8, 4097, true); // GROUND with one extra byte
    }
    expectReason(b, 'section');
  });
  it('invalid UTF-8 in the string table', () => {
    const b = copy();
    const needle = Buffer.from('tp.graybox.spawn');
    const at = Buffer.from(b).indexOf(needle);
    expect(at).toBeGreaterThan(0);
    b[at + 3] = 0xff;
    expectReason(b, 'section');
  });
  it('a truncated buffer never yields a partial result', () => {
    for (const n of [70, 200, 1000, 20000, p0Bytes.length - 1]) {
      let threw = false;
      try {
        decodeP0(p0Bytes.subarray(0, n));
      } catch (e) {
        threw = e instanceof PackDecodeError;
      }
      expect(threw, `${n} bytes`).toBe(true);
    }
  });
});
