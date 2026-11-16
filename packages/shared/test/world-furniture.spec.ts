/**
 * M02h6 AC-2 (placement half): `placeFurniture` on the `synth` and `civic-excerpt` bakes and on a hand-built chunk. Two runs give the same
 * floats; stop signs stand at the AllWayStop and MinorStop approaches; meters only on the parking sides of Arterial and Collector streets;
 * hydrant gaps along one sidewalk side are 90 m within 10 %; every record keeps the distance rules (centrelines, other items, lamps and
 * trees); every record is already at the l0 pack's precision; shelters and benches stand at Transit and Plaza ped nodes (the hand-built
 * chunk: neither bake has a `Transit` node, BD-M02h6-03). The mesher half of AC-2 is `packages/world/test/furniture.mesher.spec.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  FurnitureType, approachPoint, chunkBounds, chunkKeyAt, decodeL0, decodeP0, distToPoly, placeFurniture, polyLength, quantizeRecord, signalHeads,
  streetIndex, wireSpans, worldSeedOf, type FurnitureFile, type FurnitureTrace, type Junction, type RenderChunk, type RoadEdge, type RoadSegment, type SimChunk,
} from '../src/index.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

const FILE = JSON.parse(readFileSync('config/world/furniture.json', 'utf8')) as FurnitureFile;
const R = FILE.place;

interface Tile { sims: SimChunk[]; renders: RenderChunk[] }
function tilesOf(area: string, max = 6): Tile[] {
  const bake = requireBake(area, `world-furniture ${area}`);
  if (!bake) return [];
  const names = readdirSync(`${bake.dir}/packs`).filter((f) => f.startsWith('p0-')).map((f) => f.slice(3, -5)).sort();
  const out: Tile[] = [];
  for (const n of names) {
    const sims = decodeP0(new Uint8Array(readFileSync(`${bake.dir}/packs/p0-${n}.pack`)));
    let renders: RenderChunk[] = [];
    try {
      renders = decodeL0(new Uint8Array(readFileSync(`${bake.dir}/packs/l0-${n}.pack`)), sims);
    } catch {
      // no render pack
    }
    out.push({ sims, renders });
  }
  // the busiest tiles: most junctions and parking first
  const score = (t: Tile): number => t.sims.reduce((k, s) => k + s.junctions.length * 4 + s.segments.length, 0);
  return out.sort((a, b) => score(b) - score(a)).slice(0, max);
}

const avoidOf = (r: RenderChunk | undefined): number[] => {
  const out: number[] = [];
  if (!r) return out;
  for (let i = 0; i + 2 < r.lamps.length; i += 3) out.push(r.lamps[i] as number, r.lamps[i + 1] as number);
  for (let i = 0; i + 3 < r.trees.length; i += 4) out.push(r.trees[i] as number, r.trees[i + 1] as number);
  return out;
};

function checkRecords(sim: SimChunk, tile: readonly SimChunk[], recs: Float32Array, avoid: readonly number[]): void {
  const ix = streetIndex(sim, tile);
  for (let i = 0; i < recs.length; i += 4) {
    const x = recs[i] as number, z = recs[i + 1] as number, yaw = recs[i + 2] as number;
    // the pack's precision: quantizing again changes nothing
    const [qx, qz, qy] = quantizeRecord(sim.key, x, z, yaw);
    expect(Math.fround(qx), `${sim.key} #${i / 4} x`).toBe(x);
    expect(Math.fround(qz)).toBe(z);
    expect(Math.fround(qy)).toBe(yaw);
    expect(recs[i + 3] as number).toBeLessThan(FILE.types.length);
    let worst = Infinity, near = Infinity, byAvoid = Infinity;
    for (const s of ix.segs.values()) worst = Math.min(worst, distToPoly(s.pts, x, z) - (s.widthM / 2 + R.centreClearM));
    for (let k = i + 4; k < recs.length; k += 4) near = Math.min(near, Math.hypot((recs[k] as number) - x, (recs[k + 1] as number) - z));
    for (let k = 0; k + 1 < avoid.length; k += 2) byAvoid = Math.min(byAvoid, Math.hypot((avoid[k] as number) - x, (avoid[k + 1] as number) - z));
    if (worst < -0.06 || near < R.clearM - 0.15 || byAvoid < R.clearM - 0.15) {
      expect({ key: sim.key, record: i / 4, worst, near, byAvoid }, 'a record off the distance rules').toBeNull();
    }
  }
}

describe('config/world/furniture.json', () => {
  it('validates against config/schemas/world-furniture.schema.json', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('config/schemas/world-furniture.schema.json', 'utf8')) as object);
    expect(validate(FILE), JSON.stringify(validate.errors)).toBe(true);
  });
  it('keeps the bake fill off (DL-740) and the type table in u8 order', () => {
    expect(FILE.bakeFill).toBe(false);
    expect(FILE.types).toEqual(['stop', 'hydrant', 'meter', 'shelter', 'bench', 'pole', 'oneway']);
  });
});

describe.each(['synth', 'civic-excerpt'])('placeFurniture on %s (AC-2)', (area) => {
  const tiles = tilesOf(area);
  it('places deterministically, at pack precision, within the distance rules', () => {
    if (tiles.length === 0) return;
    let total = 0;
    for (const t of tiles) {
      for (const sim of t.sims) {
        const avoid = avoidOf(t.renders.find((r) => r.key === sim.key));
        const cfg = { rules: R, worldSeed: worldSeedOf(sim.bakeId), tile: t.sims, avoid };
        const a = placeFurniture(sim, cfg);
        const b = placeFurniture(sim, { ...cfg, tile: [...t.sims] });
        expect(Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)), `${sim.key} twice`).toBe(0);
        checkRecords(sim, t.sims, a, avoid);
        total += a.length / 4;
      }
    }
    expect(total).toBeGreaterThan(50);
  });

  it('stop signs at the AllWayStop and MinorStop approaches, meters on parking sides, hydrants 90 m apart within 10 %', () => {
    if (tiles.length === 0) return;
    let stops = 0, stopWant = 0, gaps = 0, meters = 0;
    for (const t of tiles) {
      for (const sim of t.sims) {
        const trace: FurnitureTrace[] = [];
        const recs = placeFurniture(sim, { rules: R, worldSeed: worldSeedOf(sim.bakeId), tile: t.sims, avoid: avoidOf(t.renders.find((r) => r.key === sim.key)), trace });
        expect(trace.length).toBe(recs.length / 4);
        const ix = streetIndex(sim, t.sims);
        // stop signs: one per stop approach whose street is in the tile and long enough, at the junction it belongs to
        for (const j of sim.junctions) {
          const want = j.control === 2 ? new Set(j.movements.map((m) => m.inEdge).concat(j.stopApproaches)) : j.control === 3 ? new Set(j.stopApproaches) : new Set<number>();
          for (const id of want) {
            const e = ix.edges.get(id);
            if (!e || !ix.segs.get(e.seg)) continue;
            const got = trace.findIndex((tr, k) => tr.junction === j.id && tr.edge === id && recs[k * 4 + 3] === FurnitureType.stop);
            const seg = ix.segs.get(e.seg) as RoadSegment;
            if (polyLength(seg.pts) < 40) continue;
            stopWant++;
            if (got >= 0) {
              stops++;
              const a = approachPoint(e, ix, (trace[got] as FurnitureTrace).d);
              expect(a).not.toBeNull();
              // on the right curb of the approach: the record lies to the right of the travel direction
              const rx = (recs[got * 4] as number) - (a as { x: number }).x, rz = (recs[got * 4 + 1] as number) - (a as { z: number }).z;
              expect(rx * -(a as { tz: number }).tz + rz * (a as { tx: number }).tx, `${sim.key} stop sign ${got} on the right`).toBeGreaterThan(0);
            }
          }
          if (j.control !== 2 && j.control !== 3) expect(trace.some((tr, k) => tr.junction === j.id && recs[k * 4 + 3] === FurnitureType.stop)).toBe(false);
        }
        // meters: parking sides of Arterial and Collector streets only
        for (let k = 0; k < trace.length; k++) {
          if (recs[k * 4 + 3] !== FurnitureType.meter) continue;
          meters++;
          const tr = trace[k] as FurnitureTrace;
          const es = ix.bySeg.get(tr.seg) ?? [];
          const parking = Math.max(...es.map((e) => e.parkingSides));
          expect(es.some((e) => e.cls === 2 || e.cls === 3), `meter ${k} on an Arterial or Collector`).toBe(true);
          expect(parking).toBeGreaterThan(0);
          if (parking === 1) expect(tr.side).toBe(1);
        }
        // hydrants along each segment side: consecutive gaps 90 m +- 10 %, and outside the junction boxes
        const bySide = new Map<string, number[]>();
        for (let k = 0; k < trace.length; k++) {
          if (recs[k * 4 + 3] !== FurnitureType.hydrant) continue;
          const tr = trace[k] as FurnitureTrace;
          const l = bySide.get(`${tr.seg}:${tr.side}`) ?? [];
          l.push(tr.d);
          bySide.set(`${tr.seg}:${tr.side}`, l);
          for (const j of ix.junctions) {
            expect(Math.hypot(j.x - (recs[k * 4] as number), j.z - (recs[k * 4 + 1] as number)), `hydrant ${k} by junction ${j.id}`).toBeGreaterThanOrEqual(R.junctionBoxM + R.hydrantJunctionM - 0.5);
          }
        }
        for (const ds of bySide.values()) {
          ds.sort((a, b) => a - b);
          for (let k = 1; k < ds.length; k++) {
            const gap = (ds[k] as number) - (ds[k - 1] as number);
            // a hydrant that did not fit leaves a double gap; any gap that is not a multiple is out of the rule
            const n = Math.max(1, Math.round(gap / R.hydrantPitchM));
            expect(Math.abs(gap / n - R.hydrantPitchM), `hydrant gap ${gap}`).toBeLessThanOrEqual(R.hydrantPitchM * 0.1);
            if (n === 1) gaps++;
          }
        }
      }
    }
    if (area === 'synth') {
      expect(stopWant).toBeGreaterThan(0);
      expect(stops / stopWant, `${stops} of ${stopWant} stop approaches signed`).toBeGreaterThan(0.9);
      expect(gaps).toBeGreaterThan(10);
      expect(meters).toBeGreaterThan(10);
    }
  });

  it('one signal head per approach of each Signal junction, on the straight movement when there is one', () => {
    if (tiles.length === 0) return;
    let heads = 0;
    for (const t of tiles) {
      for (const sim of t.sims) {
        const hs = signalHeads(sim, { rules: R, worldSeed: worldSeedOf(sim.bakeId), tile: t.sims }, FILE.signal.inset);
        heads += hs.length;
        for (const h of hs) {
          const j = sim.junctions.find((x) => x.id === h.junction) as Junction;
          expect(j.control).toBe(1);
          const m = j.movements.find((x) => x.id === h.movement);
          expect(m?.inEdge).toBe(h.approach);
          if (j.movements.some((x) => x.inEdge === h.approach && x.turn === 'straight')) expect(m?.turn).toBe('straight');
        }
        // one per approach at most
        expect(new Set(hs.map((h) => `${h.junction}:${h.approach}`)).size).toBe(hs.length);
      }
    }
    expect(heads).toBeGreaterThan(0);
  });
});

// ---- a hand-built chunk: a Transit node, a Plaza, a bus lane --------------------------------------------------------------------

function handChunk(): SimChunk {
  const key = chunkKeyAt(9, 30, 30);
  const b = chunkBounds(key);
  const z0 = b.minZ + 128;
  const pts = new Float32Array([b.minX + 8, 10, z0, b.minX + 128, 10, z0, b.minX + 248, 10, z0]);
  const seg: RoadSegment = { id: 1, pts, lengthM: 240, widthM: 14, osmWay: 0, cnn: 0 };
  const edge = (id: number, dir: 1 | -1, flags: number): RoadEdge => ({
    id, seg: 1, dir, from: dir === 1 ? 1 : 2, to: dir === 1 ? 2 : 1, twin: id === 1 ? 2 : 1, cls: 2, lanes: 2, laneWidthM: 3.5, speedMps: 13, flags, layer: 0, medianM: 0,
    parkingSides: 2, maxGradePct: 0, nhood: 255,
  });
  return {
    key, bakeId: 'ab'.repeat(32), height: { originX: b.minX, originZ: b.minZ, cellM: 4, dm: new Int16Array(65 * 65).fill(100) }, prisms: new Float32Array(0), slabs: new Float32Array(0),
    hoods: new Float32Array(0), segments: [seg], edges: [edge(1, 1, 128), edge(2, -1, 0)], nodes: [], junctions: [],
    pedNodes: [
      { id: 1, x: b.minX + 100, y: 10, z: z0 - 9, flags: 16 },
      { id: 2, x: b.minX + 160, y: 10, z: z0 + 30, flags: 2 },
      { id: 3, x: b.minX + 170, y: 10, z: z0 + 34, flags: 2 },
      { id: 4, x: b.minX + 230, y: 10, z: z0 + 30, flags: 2 },
    ],
    pedEdges: [], tags: { hidingSpots: [], pursuitBreakers: [], chokePoints: [], jumpZones: [], portals: [], shoreNodes: [] },
    spawn: { cellKey: key, densityProfile: 0, trafficSlots: 0, pedSlots: 0, parked: [] }, ground: new Uint8Array(64 * 64),
  };
}

describe('placeFurniture on a hand-built chunk', () => {
  it('a shelter and a bench at the Transit node, plaza benches 40 m apart, wires over the bus lane', () => {
    const sim = handChunk();
    const trace: FurnitureTrace[] = [];
    const recs = placeFurniture(sim, { rules: R, worldSeed: 7, trace });
    const kinds = (t: number): number[] => trace.flatMap((_, k) => (recs[k * 4 + 3] === t ? [k] : []));
    expect(kinds(FurnitureType.shelter).length).toBe(1);
    expect(trace[kinds(FurnitureType.shelter)[0] as number]?.node).toBe(1);
    const benches = kinds(FurnitureType.bench);
    expect(benches.map((k) => trace[k]?.node).sort()).toEqual([1, 2, 4]);
    expect(kinds(FurnitureType.meter).length).toBeGreaterThan(20);
    checkRecords(sim, [sim], recs, []);
    const spans = wireSpans(sim, { rules: R, worldSeed: 7 }, FILE.wires);
    expect(spans.length).toBe(2);
    // the bus lane is lane 0 of the eastbound edge: south of the centreline (right of travel east is +Z... south)
    for (const s of spans) expect(s.z).toBeGreaterThan(sim.segments[0]!.pts[2] as number);
  });
});
