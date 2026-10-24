/**
 * S9 spawn tables (02-world-bake.md section 4 S9; contract rule 14). Per chunk:
 *   trafficSlots = min(255, round(sum lengthKm * lanes * perLaneKm[cls]))   over the edges the chunk owns
 *   pedSlots     = min(255, round(sidewalkKm * perKm[profile] + plazaM2 / 400))
 * and parked slots from segments with parking at a 7 m pitch, 15 % empty by hash, at most 256 per chunk, ordered by hash
 * so that a prefix is a thinning. `densityProfile` is the position of the chunk's profile in config/world/density.json.
 */
import { SLOT, RoadClass, chunkKeyAt, fnv32, type ChunkKey, type ParkedSlot, type RoadEdge, type SpawnTable } from '../../../../packages/shared/src/index.ts';
import { pointAt3, polyLength } from '../geom/poly.ts';
import type { DensityConfig } from '../config.ts';
import type { NodeB, SegB } from './s5-roads.ts';

export const PARKED_PITCH_M = 7;
export const PARKED_EMPTY_PCT = 15;
export const PARKED_MAX = 256;
export const PLAZA_CELL_M2 = 144;

export interface SpawnInputs {
  segs: readonly SegB[];
  edges: readonly RoadEdge[];
  nodes: readonly NodeB[];
  chunks: Iterable<ChunkKey>;
  sidewalkM: ReadonlyMap<ChunkKey, number>;
  latticeNodes: ReadonlyMap<ChunkKey, number>;
  density: DensityConfig;
  /** Profile name at a point (the district of the point, `outer` where no neighbourhood covers it). */
  profileAt(x: number, z: number): string;
}

export interface SpawnReport { chunks: number; traffic: number; ped: number; parked: number; maxParked: number; freewayChunks: number }

export function runSpawn(inp: SpawnInputs): { spawn: Map<ChunkKey, SpawnTable>; report: SpawnReport } {
  const names = inp.density.profiles.map((p) => p.name);
  const idxOf = (n: string): number => {
    const i = names.indexOf(n);
    if (i < 0) throw new Error(`S9: density profile "${n}" is not in config/world/density.json profiles`);
    return i;
  };
  const trafficKm = new Map<ChunkKey, number>();
  const roadM = new Map<ChunkKey, { all: number; freeway: number }>();
  for (const e of inp.edges) {
    const s = inp.segs[e.seg] as SegB;
    if (s.island === true) continue;   // islands get no traffic or parked slots (DL-706)
    const from = inp.nodes[e.from] as NodeB;
    const key = chunkKeyAt(9, from.x, from.z);
    const perLane = inp.density.perLaneKm[String(e.cls)] ?? 0;
    trafficKm.set(key, (trafficKm.get(key) ?? 0) + (s.lengthM / 1000) * e.lanes * perLane);
    const r = roadM.get(key) ?? { all: 0, freeway: 0 };
    r.all += s.lengthM;
    if (e.cls === RoadClass.Freeway || e.cls === RoadClass.Ramp) r.freeway += s.lengthM;
    roadM.set(key, r);
  }
  // parked candidates by chunk
  interface Cand { h: number; slot: Omit<ParkedSlot, 'slot'> }
  const parked = new Map<ChunkKey, Cand[]>();
  for (const s of inp.segs) {
    if (s.parking === 0 || s.bridge || s.tunnel || s.island === true) continue;
    const L = polyLength(s.pts);
    const sides: (-1 | 1)[] = s.parking === 2 ? [-1, 1] : [1];
    let i = 0;
    for (let d = 6; d <= L - 6; d += PARKED_PITCH_M, i++) {
      for (const side of sides) {
        const key = `${s.id}:${i}:${side}`;
        if (fnv32(key) % 100 < PARKED_EMPTY_PCT) continue;
        const p = pointAt3(s.pts, s.ys, d);
        const ck = chunkKeyAt(9, p.x, p.z);
        const h = fnv32(`o:${key}`);
        const l = parked.get(ck) ?? [];
        l.push({ h, slot: { seg: s.id, s: Math.round(d * 10) / 10, side, yawJitterDm: ((fnv32(`y:${key}`) >>> 8) % 11) - 5 } });
        parked.set(ck, l);
      }
    }
  }
  const spawn = new Map<ChunkKey, SpawnTable>();
  const rep: SpawnReport = { chunks: 0, traffic: 0, ped: 0, parked: 0, maxParked: 0, freewayChunks: 0 };
  for (const key of [...inp.chunks].sort()) {
    const [, cx, cz] = key.split('/').map(Number) as [number, number, number];
    const mx = -65664 + cx * 256 + 128, mz = -65664 + cz * 256 + 128;
    let profile = inp.profileAt(mx, mz);
    const r = roadM.get(key);
    if (r && r.all > 200 && r.freeway / r.all >= 0.6) { profile = 'freeway'; rep.freewayChunks++; }
    const pi = idxOf(profile);
    const perKm = (inp.density.profiles[pi] as { perKm: number }).perKm;
    const trafficSlots = Math.min(255, Math.round(trafficKm.get(key) ?? 0));
    const sidewalkKm = (inp.sidewalkM.get(key) ?? 0) / 1000;
    const plazaM2 = (inp.latticeNodes.get(key) ?? 0) * PLAZA_CELL_M2;
    const pedSlots = Math.min(255, Math.round(sidewalkKm * perKm + plazaM2 / 400));
    const cands = (parked.get(key) ?? []).sort((a, b) => a.h - b.h || a.slot.seg - b.slot.seg || a.slot.s - b.slot.s || a.slot.side - b.slot.side).slice(0, PARKED_MAX);
    const list: ParkedSlot[] = cands.map((c, i) => ({ slot: SLOT.parked[0] + i, ...c.slot }));
    spawn.set(key, { cellKey: key, densityProfile: pi, trafficSlots, pedSlots, parked: list });
    rep.chunks++;
    rep.traffic += trafficSlots;
    rep.ped += pedSlots;
    rep.parked += list.length;
    rep.maxParked = Math.max(rep.maxParked, list.length);
  }
  return { spawn, report: rep };
}
