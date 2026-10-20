/**
 * M03b2: the robotaxi now sees the pedestrians (M03b1 read an empty set). The pedestrians of the sim are `ped` obstacles for the
 * traffic: a robotaxi (and any other car) stops for one in its lane, the robotaxi stops at a crosswalk that is occupied and keeps 3 m
 * from a pedestrian beside its lane, and a pedestrian farther off its lane does not stop it.
 */
import { describe, expect, it } from 'vitest';
import { PedEdgeKind, type ChunkKey } from '@dv/shared';
import { PedState } from '../src/sim/peds/components.ts';
import { CROSSWALK_PATCH_HALF_M, PED_HALF_M, pedObstacle } from '../src/sim/peds/sim.ts';
import { ARCH, ARCHETYPES } from '../src/sim/traffic/components.ts';
import type { Obstacle } from '../src/sim/traffic/reactions.ts';
import { makePedRig, pedCrossing } from './fixtures/peds.ts';
import { makeRig, routeThrough } from './fixtures/traffic.ts';

const CELL = '9/256/256' as ChunkKey;

async function scene(arch: number, pedSide: 'lane' | 'far') {
  const f = pedCrossing();
  const peds = await makePedRig({ chunks: [f.chunk], focus: { x: -25, z: 0, vx: 0, vz: 0 }, initialFill: false });
  const cars = await makeRig({ chunks: [f.chunk], parked: false, initialFill: false });
  // the car comes east down the west arm (inbound edge 3) toward the crosswalk at x = -10
  const car = cars.sim.place({ key: 'amb:9/256/256:41', cell: CELL, slot: 41, epoch: 1, arch, edge: f.cross.inEdge[3] as number, s: 36, lane: 0, speed: 10 });
  if (!car) throw new Error('not placed');
  routeThrough(car, f.cross, 3, 1);
  // a pedestrian crosses the road on the crosswalk (z from -6 to 6); a second walks the far sidewalk, 6 m off the lane
  const walker = peds.sim.place({ key: 'amb:9/256/256:310', cell: CELL, slot: 310, a: pedSide === 'lane' ? 1 : 0, b: pedSide === 'lane' ? 2 : 1, s: pedSide === 'lane' ? 0 : 5, pace: 1.4, lane: 0 });
  if (!walker) throw new Error('not placed');
  if (pedSide === 'lane') peds.vehicles = [];
  return { f, peds, cars, car, walker };
}

describe('the pedestrian obstacle', () => {
  it('is a 0.6 m box on the pavement, the 2.4 m crosswalk patch on a crosswalk, and moves with the pedestrian', async () => {
    const { peds, walker } = await scene(ARCH.robotaxi, 'lane');
    peds.run(2);
    const o = pedObstacle(walker);
    expect(o).toMatchObject({ id: walker.key, kind: 'ped', halfW: CROSSWALK_PATCH_HALF_M, halfL: CROSSWALK_PATCH_HALF_M });
    expect(o.x).toBeCloseTo(walker.x, 9);
    expect(Math.hypot(o.vx, o.vz)).toBeCloseTo(walker.speed, 9);
    const { peds: p2, walker: w2 } = await scene(ARCH.robotaxi, 'far');
    p2.run(2);
    expect(pedObstacle(w2)).toMatchObject({ halfW: PED_HALF_M, halfL: PED_HALF_M });
    // a pedestrian waiting at the kerb is not on the crosswalk
    w2.state = PedState.Wait;
    expect(pedObstacle(w2).halfW).toBe(PED_HALF_M);
  });
});

describe('cars read the pedestrians', () => {
  for (const [name, arch] of [['robotaxi', ARCH.robotaxi], ['ordinary car', ARCH.sedan]] as const) {
    it(`a ${name} brakes for a pedestrian on the crosswalk in its lane and never overlaps it`, async () => {
      const { peds, cars, car, walker } = await scene(arch, 'lane');
      let overlap = false;
      let slowest = Infinity;
      const hl = (ARCHETYPES[arch] as (typeof ARCHETYPES)[number]).halfLength;
      for (let tick = 0; tick < 1500; tick++) {
        if (tick % 2 === 0) {
          peds.run(2);
          cars.input.obstacles = peds.sim.peds.list().map((p) => pedObstacle(p));
        }
        cars.run(1);
        const onCross = walker.kind === PedEdgeKind.Crosswalk && walker.s > 0.5 && walker.s < walker.len - 0.5 && walker.state !== PedState.Wait;
        // gap from the front bumper to the pedestrian along the lane (the road runs along x)
        const gap = walker.x - (car.x + hl);
        if (onCross && Math.abs(walker.z - 1.5) < 1.2 && gap < 0 && gap > -2 * hl) overlap = true;
        if (onCross && gap > 0 && gap < 30) slowest = Math.min(slowest, car.speed);
      }
      expect(overlap).toBe(false);
      expect(slowest).toBeLessThan(3);
    });
  }

  it('a pedestrian well off the lane does not stop the robotaxi', async () => {
    const { f, peds, cars, car } = await scene(ARCH.robotaxi, 'far');
    let minSpeed = Infinity;
    for (let tick = 0; tick < 240; tick++) {
      if (tick % 2 === 0) {
        peds.run(2);
        cars.input.obstacles = peds.sim.peds.list().map((p): Obstacle => pedObstacle(p));
      }
      cars.run(1);
      if (car.edge === f.cross.inEdge[3] && car.s > 15 && car.s < 60) minSpeed = Math.min(minSpeed, car.speed);
    }
    expect(minSpeed).toBeGreaterThan(5);
  });
});
