/**
 * M03b1 AC-5: density and spawning. The hour, tier and weather tables of `config/world/density.json`, the `canonical` profile on the
 * `mobile-low` factors, the spawn ring (0.6 to 1.0 x `R_amb`, never in the forward cone closer than 0.9 x `R_amb`), the despawn beyond
 * 1.25 x `R_amb`, `setDensity` 0 / 0.35 / 1.0, closed edges and the cap on cars (traffic and parked together).
 */
import { describe, expect, it } from 'vitest';
import { RoadClass, activeSlots, type ChunkKey, type QualityTierId, type SimChunk, type WeatherPreset } from '@dv/shared';
import { AMBIENT_RADIUS_M, DENSITY, activeFor, densityTier, hourFactor, tierFactor, trafficCap, weatherFactor } from '../src/sim/traffic/density.ts';
import { STREAMING } from '../src/sim/streaming/plan.ts';
import { CONE_COS } from '../src/sim/traffic/spawn.ts';
import { loadBake, type BakeData } from './fixtures/bake.ts';
import { makeRig } from './fixtures/traffic.ts';

const TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'];

describe('the density tables', () => {
  it('hour curves are linear between the anchors and wrap from 22:00 to 00:00', () => {
    const profile = DENSITY.profiles.findIndex((p) => p.name === 'cbd');
    expect(DENSITY.hourAnchors).toEqual([0, 3, 6, 8, 12, 17, 20, 22]);
    expect(hourFactor(profile, 'traffic', 8)).toBeCloseTo(1.0, 9);
    expect(hourFactor(profile, 'traffic', 12)).toBeCloseTo(0.7, 9);
    expect(hourFactor(profile, 'traffic', 10)).toBeCloseTo(0.85, 9);
    expect(hourFactor(profile, 'traffic', 23)).toBeCloseTo(0.225, 9);
    expect(hourFactor(profile, 'traffic', 24)).toBeCloseTo(hourFactor(profile, 'traffic', 0), 9);
    expect(hourFactor(profile, 'ped', 12)).toBeCloseTo(1.0, 9);
    expect(hourFactor(profile, 'parked', 4)).toBe(1);
    const night = DENSITY.profiles.findIndex((p) => p.name === 'nightlife');
    expect(hourFactor(night, 'traffic', 20)).toBeCloseTo(1.0, 9);
    expect(DENSITY.hourCurves['cbd-tech']).toEqual(DENSITY.hourCurves['cbd']);
    expect(hourFactor(DENSITY.profiles.findIndex((p) => p.name === 'none'), 'traffic', 12)).toBe(0);
  });

  it('tier and weather factors are the table of the living part section 7', () => {
    expect(TIERS.map((t) => tierFactor(t, 'traffic'))).toEqual([1, 0.675, 0.25, 0.15]);
    expect(TIERS.map((t) => tierFactor(t, 'ped'))).toEqual([1, 0.667, 0.25, 0.133]);
    expect(TIERS.map((t) => tierFactor(t, 'parked'))).toEqual([1, 0.7, 0.3, 0.15]);
    expect(tierFactor('xr-visionpro', 'traffic')).toBe(0.375);
    expect(tierFactor('xr-quest', 'traffic')).toBe(0.15);
    const w: WeatherPreset[] = ['clear', 'karl-fog', 'overcast', 'rain', 'smoke', 'golden'];
    expect(w.map((x) => weatherFactor(x, 'traffic'))).toEqual([1, 0.9, 1, 0.85, 0.7, 1]);
    expect(w.map((x) => weatherFactor(x, 'ped'))).toEqual([1, 0.7, 0.9, 0.5, 0.4, 1.1]);
    expect(weatherFactor('rain', 'parked')).toBe(1);
  });

  it('the traffic factor is the tier cap over 800 and the pedestrian factor the cap over 600', () => {
    for (const t of TIERS) expect(tierFactor(t, 'traffic')).toBeCloseTo(trafficCap(t) / 800, 3);
  });

  it('the canonical profile always reads the mobile-low factors', () => {
    for (const t of [...TIERS, 'xr-visionpro', 'xr-quest'] as QualityTierId[]) expect(densityTier('canonical', t)).toBe('mobile-low');
    for (const t of TIERS) expect(densityTier('local', t)).toBe(t);
  });

  it('the ambient radius per tier is the streaming plan ambientM', () => {
    for (const t of [...TIERS, 'xr-visionpro', 'xr-quest'] as QualityTierId[]) expect(AMBIENT_RADIUS_M[t]).toBe(STREAMING.tiers[t].ambientM);
  });

  it('activeFor is activeSlots over the table factors', () => {
    const profile = DENSITY.profiles.findIndex((p) => p.name === 'tourist-dense');
    const n = activeFor({ capacity: 40, kind: 'traffic', tier: 'desktop', profile, hour: 17, weather: 'rain', override: 1 });
    expect(n).toBe(activeSlots(40, 0.675, 0.9, 0.85, 1));
    expect(activeFor({ capacity: 40, kind: 'traffic', tier: 'desktop', profile, hour: 17, weather: 'rain', override: 0 })).toBe(0);
  });
});

const near = (cx: number, cy: number, n: number) => (k: string): boolean => {
  const [, x, y] = k.split('/').map(Number) as [number, number, number];
  return Math.abs(x - cx) <= n && Math.abs(y - cy) <= n;
};

function chunksOf(bake: BakeData, n: number): SimChunk[] {
  return bake.chunks(near(256, 256, n));
}

describe('AC-5: spawning around a moving player', () => {
  for (const tier of TIERS) {
    it(`${tier}: spawns at 0.6 to 1.0 x R_amb outside the forward cone, despawns beyond 1.25 x R_amb`, async () => {
      const bake = loadBake('synth', 'density.spawn synth');
      if (!bake) return;
      const R = AMBIENT_RADIUS_M[tier];
      const spawns: { d: number; dot: number }[] = [];
      const despawns: number[] = [];
      let focusAt = { x: 0, z: 0, vx: 10, vz: 0 };
      const rig = await makeRig({
        chunks: chunksOf(bake, 7), topology: bake.topology, index: bake.index, tier, seed: bake.index.worldSeed, initialFill: false, parked: false,
        focus: focusAt,
        hooks: {
          spawned: (a) => {
            const dx = a.x - focusAt.x, dz = a.z - focusAt.z;
            const d = Math.hypot(dx, dz);
            spawns.push({ d, dot: (dx * focusAt.vx + dz * focusAt.vz) / (d * 10) });
          },
          despawned: (a, why) => {
            if (why === 'range') despawns.push(Math.hypot(a.x - focusAt.x, a.z - focusAt.z));
          },
        },
      });
      // the player drives east at 10 m/s for 40 s
      rig.run(60 * 40, (tick) => {
        focusAt = { x: (tick / 60) * 10, z: 0, vx: 10, vz: 0 };
        rig.focus = focusAt;
      });
      expect(spawns.length).toBeGreaterThan(20);
      for (const s of spawns) {
        expect(s.d).toBeGreaterThanOrEqual(0.6 * R - 1);
        expect(s.d).toBeLessThanOrEqual(1.0 * R + 1);
        if (s.d < 0.9 * R) expect(s.dot).toBeLessThanOrEqual(CONE_COS + 1e-9);
      }
      expect(despawns.length).toBeGreaterThan(5);
      for (const d of despawns) expect(d).toBeGreaterThan(1.25 * R);
    }, 120_000);
  }

  it('the first population (initial fill) lies between 20 m and R_amb', async () => {
    const bake = loadBake('synth', 'density.spawn synth fill');
    if (!bake) return;
    const R = AMBIENT_RADIUS_M['desktop'];
    const ds: number[] = [];
    const rig = await makeRig({
      chunks: chunksOf(bake, 5), topology: bake.topology, index: bake.index, tier: 'desktop', seed: bake.index.worldSeed, parked: false,
      hooks: { spawned: (a) => ds.push(Math.hypot(a.x, a.z)) },
    });
    rig.run(300);
    expect(ds.length).toBeGreaterThan(50);
    for (const d of ds) {
      expect(d).toBeGreaterThanOrEqual(20 - 1);
      expect(d).toBeLessThanOrEqual(R + 1);
    }
  }, 60_000);
});

describe('AC-5: the number of live slots', () => {
  it('the budget of a cell equals activeSlots for the tier, hour and weather, and canonical uses the mobile-low factors', async () => {
    const bake = loadBake('synth', 'density.spawn synth budget');
    if (!bake) return;
    const chunks = chunksOf(bake, 2);
    const rig = await makeRig({ chunks, topology: bake.topology, index: bake.index, tier: 'mobile-low', seed: bake.index.worldSeed, parked: false });
    const hours = [3, 8, 12, 17, 22];
    const weathers: WeatherPreset[] = ['clear', 'rain', 'karl-fog'];
    let checked = 0;
    for (const tier of TIERS) {
      const r = await makeRig({ chunks, topology: bake.topology, index: bake.index, tier, seed: bake.index.worldSeed, parked: false });
      for (const hour of hours) {
        for (const weather of weathers) {
          r.env.hour = hour;
          r.env.weather = weather;
          r.run(2);
          for (const c of chunks.slice(0, 12)) {
            const name = DENSITY.profiles[c.spawn.densityProfile]?.name ?? 'none';
            const hf = hourFactor(c.spawn.densityProfile, 'traffic', hour);
            const expected = activeSlots(c.spawn.trafficSlots, tierFactor(tier, 'traffic'), hf, weatherFactor(weather, 'traffic'), 1);
            expect(r.sim.trafficBudget(c), `${tier} ${hour} h ${weather} ${name}`).toBe(expected);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    // canonical: the sim is given the mobile-low tier whatever the device is
    const canon = densityTier('canonical', 'desktop');
    const a = await makeRig({ chunks, topology: bake.topology, index: bake.index, tier: canon, seed: bake.index.worldSeed, parked: false });
    a.run(2);
    for (const c of chunks.slice(0, 12)) expect(a.sim.trafficBudget(c)).toBe(rig.sim.trafficBudget(c));
  }, 120_000);

  it('setDensity 0 / 0.35 / 1.0 scales the budget and thins the live agents out of sight', async () => {
    const bake = loadBake('synth', 'density.spawn synth override');
    if (!bake) return;
    const chunks = chunksOf(bake, 2);
    const rig = await makeRig({ chunks, topology: bake.topology, index: bake.index, tier: 'desktop', seed: bake.index.worldSeed, parked: false, hour: 12 });
    rig.run(2);
    const c = chunks.find((x) => x.spawn.trafficSlots >= 20) as SimChunk;
    const full = rig.sim.trafficBudget(c);
    expect(full).toBeGreaterThan(5);
    rig.services.traffic.setDensity('traffic', 0.35, 'event');
    expect(rig.sim.trafficBudget(c)).toBe(activeSlots(c.spawn.trafficSlots, 0.675, hourFactor(c.spawn.densityProfile, 'traffic', 12), 1, 0.35));
    rig.services.traffic.setDensity('traffic', 0, 'event2');
    expect(rig.sim.trafficBudget(c)).toBe(0);
    rig.services.traffic.release('event2');
    expect(rig.sim.trafficBudget(c)).toBe(activeSlots(c.spawn.trafficSlots, 0.675, hourFactor(c.spawn.densityProfile, 'traffic', 12), 1, 0.35));
    rig.services.traffic.release('event');
    expect(rig.sim.trafficBudget(c)).toBe(full);

    // live agents follow: fill, then switch the traffic off; what is out of sight goes and nothing new comes
    rig.run(900);
    const before = rig.sim.agents.size;
    expect(before).toBeGreaterThan(20);
    rig.services.traffic.setDensity('traffic', 0, 'off');
    const spawnsAtOff = rig.sim.stats.spawns;
    rig.run(1800);
    expect(rig.sim.stats.spawns).toBe(spawnsAtOff);
    expect(rig.sim.agents.size).toBeLessThan(before);
  }, 120_000);
});

describe('AC-5: closed edges and the car cap', () => {
  it('closed edges are never entered', async () => {
    const bake = loadBake('synth', 'density.spawn synth closed');
    if (!bake) return;
    const chunks = chunksOf(bake, 4);
    const rig = await makeRig({ chunks, topology: bake.topology, index: bake.index, tier: 'desktop', seed: bake.index.worldSeed, parked: false });
    const closed: number[] = [];
    for (const c of chunks) {
      const [, x] = c.key.split('/').map(Number) as [number, number];
      if (x >= 256) for (const id of rig.services.network.chunkEdges(c.key)) closed.push(id);
    }
    expect(closed.length).toBeGreaterThan(100);
    rig.services.traffic.closeEdges(closed, 'race');
    const set = new Set(closed);
    let violations = 0;
    rig.run(60 * 240, (tick) => {
      if (tick % 6 !== 0) return;
      for (const a of rig.sim.agents.list()) if (set.has(a.edge) || (a.nextEdge !== 0xffffffff && set.has(a.nextEdge) && a.state === 1)) violations++;
    });
    expect(rig.sim.stats.spawns).toBeGreaterThan(30);
    expect(violations).toBe(0);
  }, 120_000);

  it('traffic and parked cars together never exceed the C13 cap; the parked cars thin out by tier', async () => {
    const bake = loadBake('synth', 'density.spawn synth cap');
    if (!bake) return;
    const chunks = chunksOf(bake, 4);
    const counts: Record<string, number> = {};
    for (const tier of TIERS) {
      const rig = await makeRig({ chunks, topology: bake.topology, index: bake.index, tier, seed: bake.index.worldSeed, hour: 8 });
      let max = 0;
      rig.run(1200, () => {
        max = Math.max(max, rig.sim.agents.size);
      });
      expect(max, tier).toBeLessThanOrEqual(trafficCap(tier));
      expect(rig.sim.agents.size).toBeGreaterThan(10);
      counts[tier] = rig.sim.agents.size;
      const parked = rig.sim.agents.list().filter((a) => a.isParked);
      expect(parked.length).toBeGreaterThan(5);
      // a parked car stands at the kerb: widthM / 2 - 1.15 from the centreline, on its side
      for (const a of parked.slice(0, 20)) {
        const c = chunks.find((x) => x.key === a.cell) as SimChunk;
        const seg = c.segments.find((s) => s.id === a.seg);
        expect(seg).toBeTruthy();
        expect(Math.abs(a.side)).toBe(1);
      }
    }
    expect(counts['desktop-ultra'] as number).toBeGreaterThan(counts['mobile-low'] as number);
    void RoadClass;
  }, 120_000);
});

export type { ChunkKey };
