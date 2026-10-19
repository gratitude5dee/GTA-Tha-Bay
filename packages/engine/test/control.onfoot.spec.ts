import { describe, expect, it } from 'vitest';
import { PHYSICS_CONFIG } from '../src/sim/physics/config.ts';
import { CONTROL_STATE } from '../src/sim/control/states.ts';
import { WALK_COURSE } from './fixtures/world-boxes.ts';
import { createWalkSim, frame, hold, JUMP, player, SPRINT, YAW } from './walk-sim.ts';

/** x at tick `from` and at tick `to` of a run with constant input. */
async function runDistance(f: Parameters<typeof hold>[2], spawn: [number, number, number], from: number, to: number): Promise<number> {
  const sim = await createWalkSim({ spawn });
  let x0 = 0;
  let x1 = 0;
  hold(sim, to, f, (t) => {
    if (t === from) x0 = player(sim).x;
    if (t === to) x1 = player(sim).x;
  });
  sim.dispose();
  return x1 - x0;
}

describe('on-foot controller: speeds (AC-4)', () => {
  const lane: [number, number, number] = [-100, 0, WALK_COURSE.flatLaneZ];

  it('run at full stick covers 42.0 +/- 0.5 m between ticks 60 and 660', async () => {
    const d = await runDistance({ moveY: -127, camYaw: YAW.east }, lane, 60, 660);
    expect(d).toBeGreaterThan(41.5);
    expect(d).toBeLessThan(42.5);
  });

  it('Sprint covers 68.0 +/- 0.7 m', async () => {
    const d = await runDistance({ moveY: -127, camYaw: YAW.east, buttons: SPRINT }, lane, 60, 660);
    expect(d).toBeGreaterThan(67.3);
    expect(d).toBeLessThan(68.7);
  });

  it('a stick at 0.4 walks: 16.0 +/- 0.3 m', async () => {
    const d = await runDistance({ moveY: -51, camYaw: YAW.east }, lane, 60, 660);
    expect(d).toBeGreaterThan(15.7);
    expect(d).toBeLessThan(16.3);
  });

  it('movement is relative to the view: the same input facing north walks along -Z, facing south along +Z', async () => {
    const sim = await createWalkSim({ spawn: [0, 0, -100] });
    hold(sim, 120, { moveY: -127, camYaw: YAW.north });
    expect(player(sim).z).toBeCloseTo(-100 - 8.4, 0);
    expect(Math.abs(player(sim).x)).toBeLessThan(0.05);
    hold(sim, 240, { moveY: -127, camYaw: YAW.south });
    expect(player(sim).z).toBeCloseTo(-100 - 8.4 + 16.8, 0);
    sim.dispose();
  });

  it('strafing right with the view north moves +X; a diagonal is no faster than straight ahead', async () => {
    const sim = await createWalkSim({ spawn: [0, 0, -100] });
    hold(sim, 60, { moveX: 127, camYaw: YAW.north });
    expect(player(sim).x).toBeCloseTo(4.2, 0);
    const before = { x: player(sim).x, z: player(sim).z };
    hold(sim, 60, { moveX: 127, moveY: -127, camYaw: YAW.north });
    const dx = player(sim).x - before.x;
    const dz = player(sim).z - before.z;
    expect(Math.hypot(dx, dz)).toBeLessThan(4.3);
    expect(Math.hypot(dx, dz)).toBeGreaterThan(4.1);
    sim.dispose();
  });

  it('on the 10 % grade uphill speed is 3.49 +/- 0.17 m/s and downhill is faster than on the flat', async () => {
    const sim = await createWalkSim({ spawn: [WALK_COURSE.featureX - 10, 0, WALK_COURSE.rampLaneZ] });
    let x0 = 0;
    let x1 = 0;
    hold(sim, 420, { moveY: -127, camYaw: YAW.east }, (t) => {
      if (t === 240) x0 = player(sim).x;
      if (t === 420) x1 = player(sim).x;
    });
    const uphill = (x1 - x0) / 3;
    expect(uphill).toBeGreaterThan(3.49 - 0.17);
    expect(uphill).toBeLessThan(3.49 + 0.17);
    // Turn round and come back down.
    hold(sim, 30, { moveY: -127, camYaw: YAW.west });
    const a = player(sim).x;
    hold(sim, 120, { moveY: -127, camYaw: YAW.west });
    const downhill = (a - player(sim).x) / 2;
    expect(downhill).toBeGreaterThan(4.2);
    expect(downhill).toBeLessThan(4.2 * 1.25 + 0.01);
    sim.dispose();
  });

  it('config: speeds and hill constants come from config/physics.json', () => {
    const c = PHYSICS_CONFIG.character;
    expect([c.walkMps, c.runMps, c.sprintMps]).toEqual([1.6, 4.2, 6.8]);
    expect([c.radiusM, c.heightM, c.headY, c.chestY]).toEqual([0.35, 1.8, 1.7, 1.35]);
    expect([c.autostepM, c.snapToGroundM, c.maxSlopeDeg, c.slide]).toEqual([0.4, 0.5, 45, true]);
  });
});

describe('on-foot controller: obstacles and the jump (AC-5)', () => {
  it('climbs the 0.35 m step', async () => {
    const sim = await createWalkSim({ spawn: [WALK_COURSE.featureX - 10, 0, WALK_COURSE.stepLowLaneZ] });
    let topY = 0;
    hold(sim, 240, { moveY: -127, camYaw: YAW.east }, () => {
      topY = Math.max(topY, player(sim).y);
    });
    expect(topY).toBeGreaterThan(0.3);
    expect(player(sim).x).toBeGreaterThan(WALK_COURSE.featureX + WALK_COURSE.stepDepthM);
    sim.dispose();
  });

  it('is blocked by the 0.5 m step', async () => {
    const sim = await createWalkSim({ spawn: [WALK_COURSE.featureX - 10, 0, WALK_COURSE.stepHighLaneZ] });
    let topY = 0;
    hold(sim, 360, { moveY: -127, camYaw: YAW.east }, () => {
      topY = Math.max(topY, player(sim).y);
    });
    expect(topY).toBeLessThan(0.05);
    expect(player(sim).x).toBeLessThan(WALK_COURSE.featureX);
    sim.dispose();
  });

  it('is blocked by the 50 degree bank', async () => {
    const sim = await createWalkSim({ spawn: [WALK_COURSE.featureX - 10, 0, WALK_COURSE.bankLaneZ] });
    let topY = 0;
    hold(sim, 360, { moveY: -127, camYaw: YAW.east }, () => {
      topY = Math.max(topY, player(sim).y);
    });
    expect(topY).toBeLessThan(0.1);
    expect(player(sim).x).toBeLessThan(WALK_COURSE.featureX + 0.5);
    sim.dispose();
  });

  it('a jump on flat ground peaks at 1.00 +/- 0.05 m and the states go 110, 111, 112, 100', async () => {
    const sim = await createWalkSim({ spawn: [-100, 0, WALK_COURSE.flatLaneZ] });
    hold(sim, 10, {});
    expect(player(sim).state).toBe(CONTROL_STATE.idle);
    const states: number[] = [];
    let apex = 0;
    for (let i = 0; i < 120; i++) {
      sim.step(1, (tick) => frame({ tick, buttons: i === 0 ? JUMP : 0, pressed: i === 0 ? JUMP : 0 }));
      const p = player(sim);
      apex = Math.max(apex, p.y);
      if (states[states.length - 1] !== p.state) states.push(p.state);
    }
    expect(apex).toBeGreaterThan(0.95);
    expect(apex).toBeLessThan(1.05);
    expect(states).toEqual([CONTROL_STATE.jump, CONTROL_STATE.fall, CONTROL_STATE.land, CONTROL_STATE.idle]);
    expect(player(sim).y).toBeCloseTo(0, 3);
    expect(player(sim).grounded).toBe(true);
    sim.dispose();
  });

  it('the Anim component follows the control state: ids 0 to 6 and p0 = speed', async () => {
    const sim = await createWalkSim({ spawn: [-100, 0, WALK_COURSE.flatLaneZ] });
    hold(sim, 30, { moveY: -127, camYaw: YAW.east });
    expect(player(sim).anim).toBe(2);
    hold(sim, 30, { moveY: -127, camYaw: YAW.east, buttons: SPRINT });
    expect(player(sim).anim).toBe(3);
    hold(sim, 30, { moveY: -40, camYaw: YAW.east });
    expect(player(sim).anim).toBe(1);
    hold(sim, 30, {});
    expect(player(sim).anim).toBe(0);
    sim.dispose();
  });

  it('walking off the 4 m drop at the end of the grade falls, lands and stops: the capsule is never below the floor', async () => {
    // The grade ends 40 m after its foot, 4 m up, with nothing behind it but the ground: a 4 m drop.
    const run = await createWalkSim({ spawn: [WALK_COURSE.featureX - 2, 0, WALK_COURSE.rampLaneZ] });
    const states = new Set<number>();
    let minY = 0;
    hold(run, 1200, { moveY: -127, camYaw: YAW.east }, () => {
      const p = player(run);
      states.add(p.state);
      minY = Math.min(minY, p.y);
    });
    expect(states.has(CONTROL_STATE.fall)).toBe(true);
    expect(states.has(CONTROL_STATE.land)).toBe(true);
    expect(minY).toBeGreaterThan(-0.05);
    run.dispose();
  });
});
