import { describe, expect, it } from 'vitest';
import { SLOT, fnv32, type ChunkKey } from '../../../packages/shared/src/index.ts';
import { loadDensity } from '../src/config.ts';
import { PARKED_EMPTY_PCT, PARKED_MAX, PARKED_PITCH_M, PLAZA_CELL_M2, runSpawn } from '../src/stages/s9-spawn.ts';
import { net, resetIds, way } from './net-fixtures.ts';

const density = loadDensity();
const CHUNK = '9/256/256' as ChunkKey;   // the chunk around City Hall: x and z from -128 to 128

function spawnFor(osm: ReturnType<typeof way>[], opts: { profile?: string; sidewalkM?: number; lattice?: number } = {}) {
  const { roads, junctions } = net(osm);
  const sidewalkM = new Map<ChunkKey, number>([[CHUNK, opts.sidewalkM ?? 0]]);
  const latticeNodes = new Map<ChunkKey, number>([[CHUNK, opts.lattice ?? 0]]);
  const r = runSpawn({
    segs: roads.segs, edges: roads.edges, nodes: junctions.nodes, chunks: [CHUNK], sidewalkM, latticeNodes, density,
    profileAt: () => opts.profile ?? 'residential',
  });
  return { ...r, roads };
}

describe('S9 spawn tables', () => {
  it('computes trafficSlots from lane kilometres and the per-class rates', () => {
    resetIds();
    // 200 m of two-way local street inside the chunk: edges of both directions, one lane each
    const { spawn, roads } = spawnFor([way([-100, 0, 100, 0], { highway: 'residential' })]);
    const km = roads.edges.reduce((s, e) => s + (roads.segs[e.seg]!.lengthM / 1000) * e.lanes * (density.perLaneKm[String(e.cls)] ?? 0), 0);
    expect(spawn.get(CHUNK)!.trafficSlots).toBe(Math.min(255, Math.round(km)));
    expect(spawn.get(CHUNK)!.trafficSlots).toBeGreaterThan(0);
  });

  it('computes pedSlots from sidewalk kilometres times the profile rate plus plaza area over 400', () => {
    resetIds();
    const perKm = density.profiles.find((p) => p.name === 'cbd')!.perKm;
    const { spawn } = spawnFor([way([-100, 0, 100, 0], { highway: 'residential' })], { profile: 'cbd', sidewalkM: 800, lattice: 50 });
    expect(spawn.get(CHUNK)!.pedSlots).toBe(Math.round(0.8 * perKm + (50 * PLAZA_CELL_M2) / 400));
    // clamped at 255
    const big = spawnFor([way([-100, 0, 100, 0], { highway: 'residential' })], { profile: 'tourist-dense', sidewalkM: 90_000 });
    expect(big.spawn.get(CHUNK)!.pedSlots).toBe(255);
  });

  it('stores the position of the profile in config/world/density.json as densityProfile', () => {
    resetIds();
    const names = density.profiles.map((p) => p.name);
    for (const name of ['cbd', 'residential', 'sparse']) {
      const { spawn } = spawnFor([way([-100, 0, 100, 0], { highway: 'residential' })], { profile: name });
      expect(spawn.get(CHUNK)!.densityProfile).toBe(names.indexOf(name));
    }
    expect(names.slice(0, 3)).toEqual(['cbd', 'cbd-tech', 'nightlife']);
    expect(() => spawnFor([way([-100, 0, 100, 0], { highway: 'residential' })], { profile: 'no-such-profile' })).toThrow(/density profile/);
  });

  it('switches a chunk of mostly freeway to the freeway profile', () => {
    resetIds();
    const { spawn, report } = spawnFor([way([-120, 0, 120, 0], { highway: 'motorway', oneway: 'yes' })], { profile: 'cbd' });
    expect(density.profiles[spawn.get(CHUNK)!.densityProfile]!.name).toBe('freeway');
    expect(report.freewayChunks).toBe(1);
  });

  it('places parked slots at a 7 m pitch on both sides, 15 % empty by hash, ordered by hash, so a prefix is a thinning', () => {
    resetIds();
    const { spawn, roads } = spawnFor([way([-120, 0, 120, 0], { highway: 'residential' })]);
    const t = spawn.get(CHUNK)!;
    expect(roads.segs[0]!.parking).toBe(2);
    expect(t.parked.length).toBeGreaterThan(40);
    expect(t.parked.length).toBeLessThanOrEqual(PARKED_MAX);
    // slot numbers start at SLOT.parked[0] and run without gaps
    t.parked.forEach((p, i) => expect(p.slot).toBe(SLOT.parked[0] + i));
    // both sides, spacing multiples of the pitch
    expect(new Set(t.parked.map((p) => p.side))).toEqual(new Set([-1, 1]));
    for (const p of t.parked) expect(((p.s - 6) / PARKED_PITCH_M) % 1).toBeCloseTo(0, 0);
    // occupancy: about 85 % of the 2 x 34 candidates
    const candidates = 2 * Math.floor((roads.segs[0]!.lengthM - 12) / PARKED_PITCH_M + 1);
    expect(t.parked.length / candidates).toBeGreaterThan(1 - PARKED_EMPTY_PCT / 100 - 0.15);
    expect(t.parked.length / candidates).toBeLessThan(1);
    // the order is by hash of the slot key: re-deriving it gives the same sequence
    const hashes = t.parked.map((p) => fnv32(`o:${p.seg}:${Math.round((p.s - 6) / PARKED_PITCH_M)}:${p.side}`));
    expect([...hashes].sort((a, b) => a - b)).toEqual(hashes);
    for (const p of t.parked) expect(Math.abs(p.yawJitterDm)).toBeLessThanOrEqual(5);
  });

  it('keeps no parked slots on bridges and tunnels, and is deterministic', () => {
    resetIds();
    const a = spawnFor([way([-120, 0, 120, 0], { highway: 'residential', bridge: 'yes', layer: '1' })]);
    expect(a.spawn.get(CHUNK)!.parked).toHaveLength(0);
    resetIds();
    const x = spawnFor([way([-120, 0, 120, 0], { highway: 'residential' })]);
    resetIds();
    const y = spawnFor([way([-120, 0, 120, 0], { highway: 'residential' })]);
    expect(JSON.stringify([...x.spawn])).toBe(JSON.stringify([...y.spawn]));
  });
});
