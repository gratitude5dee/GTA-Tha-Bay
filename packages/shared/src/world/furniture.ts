// packages/shared/src/world/furniture.ts — street furniture placement (M02h6; 02-world.md section 5.4, C08 1.1 rule 12, DL-740).
// Pure: no IO, no other package (C02 lint applies). The records are `RenderChunk.furniture`'s `x, z, yaw, type` (world x and z, yaw in
// radians, `type` the u8 of `config/world/furniture.json` `types`); they are rounded to the pack's precision (0.1 m, `YAW_UNIT`), so a
// record that went through an l0 pack (the bake fill) reads back as the same float32 the mesher places at mesh time (AC-2).
//
// Rules (design values in `place`): a stop sign on the right curb `stopBeforeLineM` before the stop line of each approach of an
// AllWayStop and each `stopApproaches` edge of a MinorStop; hydrants on each sidewalk side every `hydrantPitchM` from a seeded phase,
// clear of the junction boxes; meters on the parking sides of Arterial and Collector streets every `meterPitchM`; a shelter and a bench
// at each `Transit` ped node; benches at `Plaza` nodes `benchPitchM` apart; utility poles on one seeded side of Local streets every
// `polePitchM`; a one-way sign where a one-way street leaves a junction. Every item stands on the sidewalk top, at least
// `widthM / 2 + centreClearM` from every centreline it could stand on, and `clearM` from the other items, the lamps and the trees; an item
// that does not fit is moved along its street by `shiftsM` (first that fits) or left out.
import { datan2, dsqrt, TWO_PI } from '../detmath.ts';
import { ctrU32 } from '../rng.ts';
import { chunkBounds, type ChunkKey, type Junction, type RoadEdge, type RoadSegment, type SimChunk } from './c08.ts';
import { YAW_UNIT } from './pack-codec.ts';

/** The record types of `config/world/furniture.json` `types`, in u8 order. */
export const FURNITURE_TYPES = ['stop', 'hydrant', 'meter', 'shelter', 'bench', 'pole', 'oneway'] as const;
export type FurnitureType = (typeof FURNITURE_TYPES)[number];
export const FurnitureType = { stop: 0, hydrant: 1, meter: 2, shelter: 3, bench: 4, pole: 5, oneway: 6 } as const;
/** Floats per `RenderChunk.furniture` record. */
export const FURNITURE_RECORD = 4;

export interface FurniturePlaceRules {
  /** Metres from the carriageway edge onto the sidewalk, per type. */
  inset: Record<FurnitureType, number>;
  /** An item stands at least `widthM / 2 + centreClearM` from every street centreline near it. */
  centreClearM: number;
  /** The stop line lies this far past the widest crossing street's half width, measured from the junction centre. */
  stopLineM: number;
  stopBeforeLineM: number;
  hydrantPitchM: number;
  /** The half size of a junction box, metres from the junction centre along a street. */
  junctionBoxM: number;
  /** Hydrants stand at least this far outside a junction box. */
  hydrantJunctionM: number;
  meterPitchM: number;
  meterEndM: number;
  polePitchM: number;
  poleEndM: number;
  benchPitchM: number;
  benchOffsetM: number;
  shelterBenchM: number;
  /** A one-way sign this far down the street from the junction centre. */
  onewayM: number;
  clearM: number;
  /** Moves along the street tried in order when an item does not fit where its rule puts it. */
  shiftsM: readonly number[];
}

/** `config/world/furniture.json` (`config/schemas/world-furniture.schema.json`). */
export interface FurnitureFile {
  schema: 'world-furniture/1';
  types: readonly FurnitureType[];
  /** The S13 bake fill (`s13-pack.ts`); false keeps the FURNITURE section empty and the mesher places at mesh time (DL-740). */
  bakeFill: boolean;
  place: FurniturePlaceRules;
  signal: { inset: number; armM: number; poleM: number };
  wires: { heightM: number; gapM: number; lane: { bus: 'outer' | 'inner'; tram: 'outer' | 'inner' } };
  pools: Record<'full' | 'lite' | 'min', Record<string, number>>;
  headsM: number;
  headsHz: number;
  parked: {
    families: Record<'full' | 'lite' | 'min', readonly string[]>;
    caps: Record<'full' | 'lite' | 'min', number>;
    ghostM: Record<'full' | 'lite' | 'min', number>;
    dressFarM: Record<'full' | 'lite' | 'min', number>;
    fadeM: number;
    dressShare: Record<'full' | 'lite' | 'min', number>;
    skipCarLengths: number;
    carLengthM: number;
    /** A live car counts for `skipCarLengths` only within this distance across the slot's centre line (its parking lane). */
    skipLateralM: number;
    rebandM: number;
    everyFrames: number;
  };
}

export interface FurniturePlacement {
  rules: FurniturePlaceRules;
  /** `WorldIndex.worldSeed` (`worldSeedOf(bakeId)`). */
  worldSeed: number;
  /** The other sim chunks of the z7 tile (the chunk among them or not): streets and junctions a chunk's records reach into. */
  tile?: readonly SimChunk[];
  /** x, z pairs (world metres) the items keep `clearM` from: the lamps and the trees of the render chunk. */
  avoid?: ArrayLike<number>;
  /** Tests: one entry per record, in record order, saying which rule placed it. */
  trace?: FurnitureTrace[];
}

/** Which rule placed a record (tests): the segment and side (+1 right of its polyline), the distance along it, or the junction or ped node. */
export interface FurnitureTrace {
  seg: number;
  side: 0 | 1 | -1;
  d: number;
  junction: number;
  node: number;
  edge: number;
}

/** `WorldIndex.worldSeed` as S13 derives it from the bake id (`tools/map/src/stages/s13-pack.ts`). */
export const worldSeedOf = (bakeId: string): number => Number.parseInt(bakeId.slice(0, 8), 16) >>> 0;

/** The four floats of a record rounded to the l0 pack's precision (0.1 m from the chunk's north-west corner, yaw in `YAW_UNIT`). */
export function quantizeRecord(key: ChunkKey, x: number, z: number, yaw: number): [number, number, number] {
  const b = chunkBounds(key);
  let y = yaw % TWO_PI;
  if (y < 0) y += TWO_PI;
  return [b.minX + Math.round((x - b.minX) * 10) / 10, b.minZ + Math.round((z - b.minZ) * 10) / 10, (Math.round(y / YAW_UNIT) & 255) * YAW_UNIT];
}

// ---- polylines ------------------------------------------------------------------------------------------------------------

interface Along { x: number; y: number; z: number; tx: number; tz: number }

/** Length of an x, y, z polyline in the x-z plane. */
export function polyLength(pts: Float32Array): number {
  let n = 0;
  for (let i = 3; i < pts.length; i += 3) {
    const dx = (pts[i] as number) - (pts[i - 3] as number), dz = (pts[i + 2] as number) - (pts[i - 1] as number);
    n += dsqrt(dx * dx + dz * dz);
  }
  return n;
}

/** The point `d` metres along the polyline (clamped) and the unit tangent there. */
export function alongPoly(pts: Float32Array, d: number): Along {
  const n = pts.length / 3;
  let left = d < 0 ? 0 : d;
  for (let i = 1; i < n; i++) {
    const ax = pts[(i - 1) * 3] as number, ay = pts[(i - 1) * 3 + 1] as number, az = pts[(i - 1) * 3 + 2] as number;
    const bx = pts[i * 3] as number, by = pts[i * 3 + 1] as number, bz = pts[i * 3 + 2] as number;
    const dx = bx - ax, dz = bz - az;
    const len = dsqrt(dx * dx + dz * dz);
    if (len <= 1e-9) continue;
    if (left <= len || i === n - 1) {
      const t = Math.min(1, left / len);
      return { x: ax + dx * t, y: ay + (by - ay) * t, z: az + dz * t, tx: dx / len, tz: dz / len };
    }
    left -= len;
  }
  return { x: pts[0] as number, y: pts[1] as number, z: pts[2] as number, tx: 1, tz: 0 };
}

/** Distance in the x-z plane from (x, z) to the polyline. */
export function distToPoly(pts: Float32Array, x: number, z: number): number {
  return nearestOnPoly(pts, x, z).d;
}

// ---- the street index of a tile ---------------------------------------------------------------------------------------------

export interface StreetIndex {
  segs: Map<number, RoadSegment>;
  edges: Map<number, RoadEdge>;
  /** The directed edges of each segment (one for a one-way street, two otherwise). */
  bySeg: Map<number, RoadEdge[]>;
  junctions: Junction[];
}

export function streetIndex(sim: SimChunk, tile?: readonly SimChunk[]): StreetIndex {
  const chunks = tile && tile.length > 0 ? (tile.includes(sim) ? tile : [sim, ...tile]) : [sim];
  const segs = new Map<number, RoadSegment>();
  const edges = new Map<number, RoadEdge>();
  const bySeg = new Map<number, RoadEdge[]>();
  const junctions: Junction[] = [];
  for (const c of chunks) {
    for (const s of c.segments) segs.set(s.id, s);
    for (const e of c.edges) edges.set(e.id, e);
    for (const j of c.junctions) junctions.push(j);
  }
  for (const e of [...edges.values()].sort((a, b) => a.id - b.id)) {
    const l = bySeg.get(e.seg);
    if (l) l.push(e);
    else bySeg.set(e.seg, [e]);
  }
  return { segs, edges, bySeg, junctions };
}

/** The approaches of a junction: its `stopApproaches`, else the distinct `inEdge`s of its movements (the bake leaves Signal junctions' list empty). */
export function approachesOf(j: Junction): number[] {
  if (j.stopApproaches.length > 0) return [...j.stopApproaches];
  const out: number[] = [];
  for (const m of j.movements) if (!out.includes(m.inEdge)) out.push(m.inEdge);
  return out.sort((a, b) => a - b);
}

/** The largest half width of the streets meeting at a junction (its approaches and their twins). */
function junctionHalfWidth(j: Junction, ix: StreetIndex): number {
  let w = 0;
  for (const m of j.movements) {
    for (const id of [m.inEdge, m.outEdge]) {
      const e = ix.edges.get(id);
      const s = e ? ix.segs.get(e.seg) : undefined;
      if (s && s.widthM / 2 > w) w = s.widthM / 2;
    }
  }
  return w;
}

/**
 * Where an approach edge reaches the junction: the point `back` metres before the end of its travel, the travel tangent there, and its
 * segment. Null when the segment is not in the tile.
 */
export function approachPoint(e: RoadEdge, ix: StreetIndex, back: number): (Along & { seg: RoadSegment }) | null {
  const s = ix.segs.get(e.seg);
  if (!s) return null;
  const len = polyLength(s.pts);
  const d = e.dir === 1 ? len - back : back;
  const a = alongPoly(s.pts, d);
  return e.dir === 1 ? { ...a, seg: s } : { ...a, tx: -a.tx, tz: -a.tz, seg: s };
}

/** Yaw (radians, 0 north, 90 degrees west: the look shots' convention, a three.js rotation about +Y) of an item whose face looks along (fx, fz). */
export function yawFacing(fx: number, fz: number): number {
  let y = datan2(-fx, -fz);
  if (y < 0) y += TWO_PI;
  return y;
}

interface Box { minX: number; minZ: number; maxX: number; maxZ: number }
function boxOf(pts: Float32Array, pad: number): Box {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i] as number, z = pts[i + 2] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
}

// ---- placement --------------------------------------------------------------------------------------------------------------

interface Placed { x: number; z: number; yaw: number; type: number }

/**
 * The furniture records of one chunk (the streets, junctions and ped nodes it owns), `x, z, yaw, type` per record in placement order.
 * Deterministic: the same chunk, tile, seed, rules and avoid list give the same floats.
 */
export function placeFurniture(sim: SimChunk, cfg: FurniturePlacement): Float32Array {
  const r = cfg.rules;
  const ix = streetIndex(sim, cfg.tile);
  const placed: Placed[] = [];
  const avoid = cfg.avoid ?? [];
  // the centrelines an item may not stand on: every street of the tile within reach
  const streets = [...ix.segs.values()].sort((a, b) => a.id - b.id);
  const boxes = streets.map((s) => boxOf(s.pts, s.widthM / 2 + r.centreClearM));
  const clear2 = r.clearM * r.clearM;
  const fits = (x: number, z: number): boolean => {
    for (let i = 0; i < streets.length; i++) {
      const b = boxes[i] as Box;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const s = streets[i] as RoadSegment;
      if (distToPoly(s.pts, x, z) < s.widthM / 2 + r.centreClearM - 1e-6) return false;
    }
    for (const p of placed) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < clear2) return false;
    }
    for (let i = 0; i + 1 < avoid.length; i += 2) {
      const dx = (avoid[i] as number) - x, dz = (avoid[i + 1] as number) - z;
      if (dx * dx + dz * dz < clear2) return false;
    }
    return true;
  };
  let why: FurnitureTrace = { seg: -1, side: 0, d: 0, junction: -1, node: -1, edge: -1 };
  const put = (x: number, z: number, yaw: number, type: number): boolean => {
    const [qx, qz, qy] = quantizeRecord(sim.key, x, z, yaw);
    if (!fits(qx, qz)) return false;
    placed.push({ x: qx, z: qz, yaw: qy, type });
    cfg.trace?.push(why);
    return true;
  };
  /** An item on the side `side` (+1 right of the polyline's direction) of a segment at `d` metres, nudged along by `shiftsM` if needed. */
  const onSide = (s: RoadSegment, len: number, d: number, side: 1 | -1, inset: number, type: number, face: 'street' | 'along' | 'against', lo = 0, hi = len): boolean => {
    for (const shift of [0, ...r.shiftsM]) {
      const at = d + shift;
      if (at < lo || at > hi) continue;
      const a = alongPoly(s.pts, at);
      why = { seg: s.id, side, d: at, junction: -1, node: -1, edge: -1 };
      const off = (s.widthM / 2 + inset) * side;
      const x = a.x - a.tz * off, z = a.z + a.tx * off;
      // `street`: the face looks across to the carriageway; `along` / `against`: along the polyline or against it
      const yaw = face === 'street' ? yawFacing(a.tz * side, -a.tx * side) : face === 'along' ? yawFacing(a.tx, a.tz) : yawFacing(-a.tx, -a.tz);
      if (put(x, z, yaw, type)) return true;
    }
    return false;
  };
  const seedU = (stream: string, n: number): number => ctrU32(cfg.worldSeed, stream, n) / 4294967296;

  // 1. junction items: stop signs and one-way signs (the junctions this chunk owns)
  for (const j of [...sim.junctions].sort((a, b) => a.id - b.id)) {
    const half = junctionHalfWidth(j, ix);
    const stopEdges = j.control === 2 ? approachesOf(j) : j.control === 3 ? [...j.stopApproaches].sort((a, b) => a - b) : [];
    for (const id of stopEdges) {
      const e = ix.edges.get(id);
      if (!e) continue;
      const back = half + r.stopLineM + r.stopBeforeLineM;
      const a = approachPoint(e, ix, back);
      if (!a) continue;
      const len = polyLength(a.seg.pts);
      if (back > len) continue;
      const off = a.seg.widthM / 2 + r.inset.stop;
      why = { seg: a.seg.id, side: 0, d: back, junction: j.id, node: -1, edge: id };
      // right of travel is (-tz, tx); the face looks back at the approaching traffic
      const yaw = yawFacing(-a.tx, -a.tz);
      for (const shift of [0, 0.5, 1, 1.5]) {
        if (put(a.x - a.tz * off - a.tx * shift, a.z + a.tx * off - a.tz * shift, yaw, FurnitureType.stop)) break;
      }
    }
    // one-way signs: a one-way street leaving the junction, on its right curb, facing the junction
    const outs: number[] = [];
    for (const m of j.movements) if (!outs.includes(m.outEdge)) outs.push(m.outEdge);
    for (const id of outs.sort((a, b) => a - b)) {
      const e = ix.edges.get(id);
      if (!e || (e.flags & 1) === 0) continue;
      const s = ix.segs.get(e.seg);
      if (!s) continue;
      const len = polyLength(s.pts);
      const d0 = half + r.onewayM;
      if (d0 > len / 2) continue;
      const d = e.dir === 1 ? d0 : len - d0;
      const side: 1 | -1 = e.dir === 1 ? 1 : -1;
      if (onSide(s, len, d, side, r.inset.oneway, FurnitureType.oneway, 'street')) {
        const t = cfg.trace?.[cfg.trace.length - 1];
        if (t) { t.junction = j.id; t.edge = id; }
      }
    }
  }

  // 2. shelters and benches at the transit and plaza ped nodes
  const benches: { x: number; z: number }[] = [];
  for (const n of [...sim.pedNodes].sort((a, b) => a.id - b.id)) {
    const transit = (n.flags & 16) !== 0;
    const plaza = (n.flags & 2) !== 0;
    if (!transit && !plaza) continue;
    // the nearest street: the shelter faces it, a plaza bench takes the street's direction
    let best: { s: RoadSegment; d: number } | null = null;
    for (const s of streets) {
      const d = distToPoly(s.pts, n.x, n.z);
      if (!best || d < best.d) best = { s, d };
    }
    let fx = 0, fz = -1;
    if (best) {
      // the face looks from the node to its nearest point on the street
      const p = nearestOnPoly(best.s.pts, n.x, n.z);
      const dx = p.x - n.x, dz = p.z - n.z, l = dsqrt(dx * dx + dz * dz);
      if (l > 1e-6) { fx = dx / l; fz = dz / l; }
    }
    why = { seg: best ? best.s.id : -1, side: 0, d: 0, junction: -1, node: n.id, edge: -1 };
    if (transit) {
      put(n.x, n.z, yawFacing(fx, fz), FurnitureType.shelter);
      // the bench beside the shelter, along the kerb (the street's right, seen from the node)
      put(n.x - fz * r.shelterBenchM, n.z + fx * r.shelterBenchM, yawFacing(fx, fz), FurnitureType.bench);
    }
    if (plaza) {
      if (benches.some((b) => (b.x - n.x) * (b.x - n.x) + (b.z - n.z) * (b.z - n.z) < r.benchPitchM * r.benchPitchM)) continue;
      const turn = Math.floor(seedU('fur:bench', n.id) * 4);
      const bx = n.x + (turn % 2 === 0 ? r.benchOffsetM : -r.benchOffsetM), bz = n.z;
      const yaw = (turn * TWO_PI) / 4;
      if (put(bx, bz, yaw, FurnitureType.bench)) benches.push({ x: bx, z: bz });
    }
  }

  // 3. along the streets this chunk owns: meters, hydrants and utility poles
  for (const s of [...sim.segments].sort((a, b) => a.id - b.id)) {
    const edges = ix.bySeg.get(s.id) ?? [];
    const first = edges[0];
    if (!first) continue;
    let flags = 0, parking = 0;
    for (const e of edges) {
      flags |= e.flags;
      if (e.parkingSides > parking) parking = e.parkingSides;
    }
    const cls = first.cls;
    // no furniture on freeways, ramps, service lanes, bridges and tunnels
    if (cls < 2 || cls > 4 || (flags & (2 | 4)) !== 0) continue;
    const len = polyLength(s.pts);
    const sides: (1 | -1)[] = [1, -1];
    // meters: the parking sides of Arterial and Collector streets (parking 2 both sides, 1 the right of the polyline, like S9's slots)
    if ((cls === 2 || cls === 3) && parking > 0 && (flags & 16) === 0) {
      const pSides: (1 | -1)[] = parking === 2 ? [-1, 1] : [1];
      for (const side of pSides) {
        for (let d = r.meterEndM + r.junctionBoxM; d <= len - r.meterEndM - r.junctionBoxM; d += r.meterPitchM) {
          onSide(s, len, d, side, r.inset.meter, FurnitureType.meter, 'street');
        }
      }
    }
    // hydrants: every sidewalk side, from a seeded phase, outside the junction boxes
    const lo = r.junctionBoxM + r.hydrantJunctionM;
    for (const side of sides) {
      const phase = seedU('fur:hydrant', s.id * 2 + (side > 0 ? 1 : 0)) * r.hydrantPitchM;
      for (let d = lo + phase; d <= len - lo; d += r.hydrantPitchM) {
        onSide(s, len, d, side, r.inset.hydrant, FurnitureType.hydrant, 'street', lo, Math.max(lo, len - lo));
      }
    }
    // utility poles: one seeded side of Local streets
    if (cls === 4) {
      const side: 1 | -1 = seedU('fur:pole', s.id) < 0.5 ? 1 : -1;
      const phase = seedU('fur:pole-phase', s.id) * r.polePitchM;
      for (let d = r.poleEndM + r.junctionBoxM + phase; d <= len - r.poleEndM - r.junctionBoxM; d += r.polePitchM) {
        onSide(s, len, d, side, r.inset.pole, FurnitureType.pole, 'street');
      }
    }
  }

  const out = new Float32Array(placed.length * FURNITURE_RECORD);
  placed.forEach((p, i) => {
    out[i * 4] = p.x;
    out[i * 4 + 1] = p.z;
    out[i * 4 + 2] = p.yaw;
    out[i * 4 + 3] = p.type;
  });
  return out;
}

/** The nearest point of a polyline to (x, z) in the x-z plane. */
export function nearestOnPoly(pts: Float32Array, x: number, z: number): { x: number; z: number; d: number } {
  let best = { x: pts[0] as number, z: pts[2] as number, d: Infinity };
  const n = pts.length / 3;
  for (let i = 1; i < n; i++) {
    const ax = pts[(i - 1) * 3] as number, az = pts[(i - 1) * 3 + 2] as number;
    const bx = pts[i * 3] as number, bz = pts[i * 3 + 2] as number;
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t;
    const d = dsqrt((px - x) * (px - x) + (pz - z) * (pz - z));
    if (d < best.d) best = { x: px, z: pz, d };
  }
  return best;
}

// ---- graph-bound items (mesh time) ------------------------------------------------------------------------------------------

export interface SignalHead {
  /** The junction and the approach edge, the movement the head shows (the approach's straight movement, else its first). */
  junction: number;
  approach: number;
  movement: number;
  /** The pole's foot (world x, z), the yaw the head faces (towards the approaching traffic) and the road height there. */
  x: number;
  z: number;
  y: number;
  yaw: number;
}

/** One signal assembly per approach of each Signal junction the chunk owns (02-world.md 5.4; the approaches as `approachesOf` says). */
export function signalHeads(sim: SimChunk, cfg: FurniturePlacement, inset: number): SignalHead[] {
  const r = cfg.rules;
  const ix = streetIndex(sim, cfg.tile);
  const out: SignalHead[] = [];
  for (const j of [...sim.junctions].sort((a, b) => a.id - b.id)) {
    if (j.control !== 1 || !j.program) continue;
    const half = junctionHalfWidth(j, ix);
    for (const id of approachesOf(j)) {
      const e = ix.edges.get(id);
      if (!e) continue;
      const back = half + r.stopLineM;
      const a = approachPoint(e, ix, back);
      if (!a || back > polyLength(a.seg.pts)) continue;
      const moves = j.movements.filter((m) => m.inEdge === id);
      const pick = moves.find((m) => m.turn === 'straight') ?? moves[0];
      if (!pick) continue;
      const off = a.seg.widthM / 2 + inset;
      const [x, z, yaw] = quantizeRecord(sim.key, a.x - a.tz * off, a.z + a.tx * off, yawFacing(-a.tx, -a.tz));
      out.push({ junction: j.id, approach: id, movement: pick.id, x, z, y: a.y, yaw });
    }
  }
  return out;
}

export interface WireSpan {
  /** Start of the span (world x, y, z with y the road height), its yaw along the lane and its length. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  lengthM: number;
}

/** Trolley wire spans over the BusLane and TramEmbedded lanes of the streets the chunk owns: one span per polyline piece per lane. */
export function wireSpans(sim: SimChunk, cfg: FurniturePlacement, wires: FurnitureFile['wires']): WireSpan[] {
  const ix = streetIndex(sim, cfg.tile);
  const out: WireSpan[] = [];
  for (const s of [...sim.segments].sort((a, b) => a.id - b.id)) {
    for (const e of ix.bySeg.get(s.id) ?? []) {
      const bus = (e.flags & 128) !== 0, tram = (e.flags & 64) !== 0;
      if (!bus && !tram) continue;
      const lanes = Math.max(1, e.lanes);
      const which = bus ? wires.lane.bus : wires.lane.tram;
      const lane = which === 'outer' ? 0 : lanes - 1;
      const oneWay = (e.flags & 1) !== 0;
      // C08 rule 10: the lateral offset of a lane, positive to the right of travel
      const lat = oneWay ? (lane + 0.5 - lanes / 2) * e.laneWidthM : e.medianM / 2 + (lane + 0.5) * e.laneWidthM;
      const n = s.pts.length / 3;
      for (let i = 1; i < n; i++) {
        const k0 = e.dir === 1 ? i - 1 : n - i, k1 = e.dir === 1 ? i : n - i - 1;
        const ax = s.pts[k0 * 3] as number, ay = s.pts[k0 * 3 + 1] as number, az = s.pts[k0 * 3 + 2] as number;
        const bx = s.pts[k1 * 3] as number, bz = s.pts[k1 * 3 + 2] as number;
        const dx = bx - ax, dz = bz - az, l = dsqrt(dx * dx + dz * dz);
        if (l < 0.5) continue;
        const tx = dx / l, tz = dz / l;
        out.push({ x: ax - tz * lat, y: ay, z: az + tx * lat, yaw: yawFacing(tx, tz), lengthM: l });
      }
    }
  }
  return out;
}
