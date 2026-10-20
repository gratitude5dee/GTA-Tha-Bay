/**
 * M03b1 AC-4: autoYield and the pedestrian rule of a robotaxi. A stationary dummy stands in the lane of a robotaxi that comes at 14 m/s:
 * it stops without contact. The reactions every ambient car has to an intruder (the player's car, a prop) and the honk are checked too.
 */
import { describe, expect, it } from 'vitest';
import { autoYieldBrakeDemand, type ChunkKey } from '@dv/shared';
import { ARCH, ARCHETYPES } from '../src/sim/traffic/components.ts';
import type { Obstacle } from '../src/sim/traffic/reactions.ts';
import { autoYieldAccel } from '../src/sim/traffic/robotaxi.ts';
import { crossRoads } from './fixtures/roads.ts';
import { makeRig, routeThrough } from './fixtures/traffic.ts';

const CELL = '9/256/256' as ChunkKey;

/** The robotaxi comes down arm 0 (100 m of road, limit 14.7 so that 0.95 x is about 14 m/s); a dummy stands at s = 75 in its lane. */
async function approach(kind: Obstacle['kind'], arch: number) {
  const cross = crossRoads({ speedMps: 14.7, armM: 100 });
  const honks: string[] = [];
  const rig = await makeRig({ chunks: [cross.chunk], parked: false, initialFill: false, hooks: { honk: (a) => honks.push(a.key) } });
  const car = rig.sim.place({ key: 'amb:9/256/256:40', cell: CELL, slot: 40, epoch: 1, arch, edge: cross.inEdge[0] as number, s: 8, lane: 0, speed: 13.9 });
  if (!car) throw new Error('not placed');
  routeThrough(car, cross, 0, 2);
  const out = new Float64Array(6);
  rig.sim.paths.pose(cross.inEdge[0] as number, 75, rig.sim.paths.laneOffset(cross.inEdge[0] as number, 0), out);
  const radius = kind === 'ped' ? 0.3 : 0.45;
  const dummy: Obstacle = { id: 'dummy', kind, x: out[0] as number, z: out[2] as number, vx: 0, vz: 0, halfW: radius, halfL: radius };
  rig.input.obstacles = [dummy];
  let minGap = Infinity;
  let overlap = false;
  rig.run(900, () => {
    const hl = (ARCHETYPES[arch] as (typeof ARCHETYPES)[number]).halfLength;
    // distance from the front bumper to the dummy along the heading
    const ahead = (dummy.x - car.x) * car.fx + (dummy.z - car.z) * car.fz - hl - dummy.halfL;
    if (car.edge === cross.inEdge[0] && ahead > -5) minGap = Math.min(minGap, ahead);
    if (ahead < 0 && ahead > -2 * hl) overlap = true;
  });
  return { car, minGap, overlap, honks, rig, cross };
}

describe('AC-4: a robotaxi and a stationary pedestrian dummy in its lane', () => {
  it('stops without contact when it comes at 14 m/s', async () => {
    const r = await approach('ped', ARCH.robotaxi);
    expect(r.overlap).toBe(false);
    expect(r.minGap).toBeGreaterThan(0.5);
    expect(r.car.speed).toBeLessThan(0.3);
    expect(r.car.edge).toBe(r.cross.inEdge[0]);
  });

  it('an object of another kind in the lane (a prop) is stopped for too', async () => {
    const r = await approach('prop', ARCH.robotaxi);
    expect(r.overlap).toBe(false);
    expect(r.minGap).toBeGreaterThan(0.3);
    expect(r.car.speed).toBeLessThan(0.3);
  });

  it('an ordinary car stops for the intruder in its lane as well, and honks when it brakes hard', async () => {
    const r = await approach('vehicle', ARCH.sedan);
    expect(r.overlap).toBe(false);
    expect(r.car.speed).toBeLessThan(0.3);
    expect(r.minGap).toBeGreaterThan(0.3);
  });

  it('the autoYield demand follows the quirk: zero outside 14 m or at 4 m/s closing, up to 0.7 g', () => {
    expect(autoYieldBrakeDemand(14, 20, 14)).toBe(0);
    expect(autoYieldBrakeDemand(14, 10, 3.9)).toBe(0);
    expect(autoYieldBrakeDemand(14, 3, 14)).toBe(1);
    expect(autoYieldAccel({ gap: 3, vLead: 0, closing: 14, obstacle: { id: '', kind: 'ped', x: 0, z: 0, vx: 0, vz: 0, halfW: 0, halfL: 0 } })).toBeCloseTo(-0.7 * 9.81, 3);
    expect(autoYieldAccel({ gap: 30, vLead: 0, closing: 14, obstacle: { id: '', kind: 'ped', x: 0, z: 0, vx: 0, vz: 0, halfW: 0, halfL: 0 } })).toBe(0);
  });
});
