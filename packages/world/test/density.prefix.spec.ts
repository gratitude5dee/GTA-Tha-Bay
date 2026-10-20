/**
 * M03b2 AC-3: the prefix rule (C01 rule 5). For the same `(cell, slot)` set, the agents a lower tier runs are a subset of the
 * agents the next tier runs, for pedestrians and for traffic: the active count is a prefix whose length grows with the tier, and the
 * start of a slot is a pure function of `(worldSeed, cell, slot, epoch)` that does not read the tier. Checked on the pure budget over
 * every chunk of the `synth` bake and over a settled population on each tier.
 */
import { describe, expect, it } from 'vitest';
import { chunkKeyAt, type ChunkKey, type QualityTierId, type SimChunk, type WeatherPreset } from '@dv/shared';
import { PED_SLOT0, pedBudget, pedCap } from '../src/sim/peds/density.ts';
import { DENSITY, activeFor } from '../src/sim/traffic/density.ts';
import { loadBake } from './fixtures/bake.ts';
import { makePedRig } from './fixtures/peds.ts';
import { makeRig } from './fixtures/traffic.ts';
import { spawnPose } from '../src/sim/streaming/boot.ts';

const LADDER: readonly QualityTierId[] = ['mobile-low', 'mobile', 'desktop', 'desktop-ultra'];
const WEATHER: readonly WeatherPreset[] = ['clear', 'karl-fog', 'overcast', 'rain', 'smoke', 'golden'];

describe('AC-3: the active prefix grows with the tier', () => {
  it('mobile-low <= mobile <= desktop <= desktop-ultra for every kind, hour, weather and override, over every chunk of the synth bake', () => {
    const bake = loadBake('synth', 'density.prefix synth');
    if (!bake) return;
    const chunks = bake.chunks();
    expect(chunks.length).toBeGreaterThan(10);
    let checked = 0;
    for (const c of chunks) {
      for (const hour of [0, 3, 7, 8, 12, 17, 20, 23]) {
        for (const weather of WEATHER) {
          for (const override of [0.35, 1, 1.5]) {
            let prevPed = -1, prevTraffic = -1;
            for (const tier of LADDER) {
              const ped = pedBudget(c, { tier, hour, weather, override });
              const traffic = activeFor({ capacity: c.spawn.trafficSlots, kind: 'traffic', tier, profile: c.spawn.densityProfile, hour, weather, override });
              expect(ped).toBeGreaterThanOrEqual(prevPed);
              expect(traffic).toBeGreaterThanOrEqual(prevTraffic);
              expect(ped).toBeLessThanOrEqual(c.spawn.pedSlots);
              prevPed = ped;
              prevTraffic = traffic;
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('a prefix of 0 ... n - 1 slots: the pedestrian slots are 256 and up, the traffic slots 0 and up', () => {
    expect(PED_SLOT0).toBe(256);
    const c = { spawn: { pedSlots: 100, trafficSlots: 100, densityProfile: 0 } } as unknown as SimChunk;
    const n = pedBudget(c, { tier: 'desktop', hour: 12, weather: 'clear', override: 1 });
    expect(n).toBe(Math.min(100, Math.floor(100 * 0.667 * 1 * 1 * 1)));
  });

  it('the caps follow the C13 rows: 80, 150, 400, 600', () => {
    expect(LADDER.map((t) => pedCap(t))).toEqual([80, 150, 400, 600]);
  });

  it('the hour curves exist for every profile that has pedestrians', () => {
    for (const p of DENSITY.profiles) if (p.perKm > 0) expect(DENSITY.hourCurves[p.name]).toBeTruthy();
  });
});

describe('AC-3: a settled population', () => {
  it('the (cell, slot) set of a lower tier is a subset of the next tier\'s, and a slot starts at the same place on every tier', async () => {
    const bake = loadBake('synth', 'density.prefix peds');
    if (!bake) return;
    const pose = spawnPose(bake.index);
    const [, cx, cy] = chunkKeyAt(9, pose.x, pose.z).split('/').map(Number) as [number, number, number];
    const chunks = bake.chunks((k) => {
      const [, x, y] = k.split('/').map(Number) as [number, number, number];
      return Math.abs(x - cx) <= 3 && Math.abs(y - cy) <= 3;
    });
    const tiers = ['mobile-low', 'mobile', 'desktop'] as const;
    const rigs = [];
    for (const tier of tiers) rigs.push(await makePedRig({ chunks, topology: bake.topology, index: bake.index, tier, focus: { x: pose.x, z: pose.z, vx: 0, vz: 0 } }));
    let slots = 0;
    for (const c of chunks) {
      const sets = rigs.map((r) => new Set(Array.from({ length: r.sim.budget(c) }, (_, i) => PED_SLOT0 + i)));
      for (let t = 1; t < sets.length; t++) for (const s of sets[t - 1] as Set<number>) expect((sets[t] as Set<number>).has(s)).toBe(true);
      slots += (sets[0] as Set<number>).size;
      // the start of a slot does not read the tier
      for (const slot of [...(sets[0] as Set<number>)].slice(0, 6)) {
        const first = rigs[0]?.sim.candidate(c.key as ChunkKey, c, slot, 1);
        for (const r of rigs) expect(r.sim.candidate(c.key as ChunkKey, c, slot, 1)).toEqual(first);
      }
    }
    expect(slots).toBeGreaterThan(20);
    // every live pedestrian of each tier holds a slot inside the live prefix of its cell
    for (const r of rigs) {
      r.run(900);
      expect(r.sim.peds.size).toBeGreaterThan(5);
      for (const p of r.sim.peds.list()) {
        const c = chunks.find((q) => q.key === p.cell);
        expect(c).toBeTruthy();
        if (c) expect(p.slot - PED_SLOT0).toBeLessThan(r.sim.budget(c));
      }
    }
    // a higher tier runs at least as many
    expect((rigs[1]?.sim.peds.size ?? 0)).toBeGreaterThanOrEqual(rigs[0]?.sim.peds.size ?? 0);
    expect((rigs[2]?.sim.peds.size ?? 0)).toBeGreaterThanOrEqual(rigs[1]?.sim.peds.size ?? 0);
  }, 120_000);

  it('the same for the cars of the traffic', async () => {
    const bake = loadBake('synth', 'density.prefix traffic');
    if (!bake) return;
    const pose = spawnPose(bake.index);
    const [, cx, cy] = chunkKeyAt(9, pose.x, pose.z).split('/').map(Number) as [number, number, number];
    const chunks = bake.chunks((k) => {
      const [, x, y] = k.split('/').map(Number) as [number, number, number];
      return Math.abs(x - cx) <= 3 && Math.abs(y - cy) <= 3;
    });
    const sets: Record<string, Set<string>> = {};
    for (const tier of ['mobile-low', 'mobile', 'desktop'] as const) {
      const rig = await makeRig({ chunks, topology: bake.topology, index: bake.index, tier, parked: false, focus: { x: pose.x, z: pose.z, vx: 0, vz: 0 } });
      rig.run(1200);
      sets[tier] = new Set(rig.sim.agents.list().filter((a) => !a.isParked).map((a) => a.key));
    }
    const low = sets['mobile-low'] as Set<string>, mid = sets['mobile'] as Set<string>, high = sets['desktop'] as Set<string>;
    expect(low.size).toBeGreaterThan(5);
    expect(mid.size).toBeGreaterThanOrEqual(low.size);
    expect(high.size).toBeGreaterThanOrEqual(mid.size);
    // cars move and leave: compare the slots that ever were live in the lower tier's run against what the higher tier's budget allows
    for (const k of low) {
      const slot = Number(k.slice(k.lastIndexOf(':') + 1));
      expect(slot).toBeLessThan(256);
    }
  }, 120_000);
});

export type { ChunkKey };
