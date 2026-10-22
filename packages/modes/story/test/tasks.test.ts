import { Seat, Transform } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import {
  animTask, at, circle, defineMission, despawn, driveTo, enterVehicleTask, fleeTask, followTask, idleTask, leaveVehicleTask, lookTask, npc, spawn, stage, task, vehicle, waitFor, walkTo,
} from '../src/authoring/index.ts';
import { planRoute, pursuit, stepToward, type VehicleDriver } from '../src/vm/tasks.ts';
import { ll, makeHarness, type Harness } from './harness.ts';

const ID = 'm.t.task';

const mission = (ops: Parameters<typeof stage>[2] extends infer O ? NonNullable<O> extends { onEnter?: infer E } ? E : never : never) =>
  defineMission({
    id: ID,
    version: 1,
    district: 'd1',
    cast: {
      pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)) }),
      car: vehicle({ prefab: 'vehicle.compact', spawn: at(...ll(30, 0)) }),
      boss: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(0, 40)), spawnAt: 'manual' }),
    },
    zones: { z: circle(...ll(200, 0), 6), far: circle(...ll(30, 0), 4) },
    stages: [stage('a', [waitFor(600, { id: 'long' })], { onEnter: ops })],
  });

const pos = (h: Harness, key: string): [number, number] => {
  const id = h.ecs.resolve(h.at(`mis:${ID}:${key}`)) as number;
  const tr = h.ecs.store(Transform);
  return [tr.px[id] as number, tr.pz[id] as number];
};

describe('task math', () => {
  it('stepToward moves by at most the step and arrives exactly', () => {
    const a = stepToward([0, 0, 0], [3, 0, 4], 2);
    expect(a.arrived).toBe(false);
    expect(Math.hypot(a.pos[0], a.pos[2])).toBeCloseTo(2, 6);
    const b = stepToward([0, 0, 0], [3, 0, 4], 10);
    expect(b.arrived).toBe(true);
    expect(b.pos).toEqual([3, 0, 4]);
  });

  it('pursuit steers toward the target and eases off when the target is behind', () => {
    // forward is -Z at yaw 0, so a target ahead and to the right (+X) wants a positive steer
    const right = pursuit([0, 0, 0], 0, 5, [10, 0, -30], 12);
    expect(right.steer).toBeGreaterThan(0);
    expect(right.throttle).toBeGreaterThan(0);
    const left = pursuit([0, 0, 0], 0, 5, [-10, 0, -30], 12);
    expect(left.steer).toBeLessThan(0);
    const behind = pursuit([0, 0, 0], 0, 14, [0, 0, 30], 12);
    expect(behind.throttle).toBe(0);
    expect(behind.brake).toBeGreaterThan(0);
  });
});

describe('npc tasks', () => {
  it('goto walks, idle and anim finish at once, look turns toward the target, follow keeps up, flee runs away', () => {
    const h = makeHarness();
    h.start(mission([task('pal', walkTo('z', 'run'))]));
    h.step(60);
    const [x1] = pos(h, 'pal');
    expect(x1).toBeGreaterThan(10);
    expect(h.rt.tasks.kindOf('pal')).toBe('goto');
    h.rt.tasks.assign('pal', idleTask(), 0);
    h.step(2);
    expect(h.rt.tasks.kindOf('pal')).toBe('');
    h.rt.tasks.assign('pal', animTask('wave', true), 0);
    h.step(2);
    expect(h.rt.tasks.kindOf('pal')).toBe('');

    h.put(h.player, 30, 30);
    h.put(h.at(`mis:${ID}:pal`), 0, 0);
    h.rt.tasks.assign('pal', followTask('player', 5), 0);
    h.step(1200);
    const [fx, fz] = pos(h, 'pal');
    expect(Math.hypot(fx - 30, fz - 30)).toBeLessThan(5.2);

    h.rt.tasks.assign('pal', fleeTask('player'), 0);
    const d0 = Math.hypot(fx - 30, fz - 30);
    h.step(120);
    const [gx, gz] = pos(h, 'pal');
    expect(Math.hypot(gx - 30, gz - 30)).toBeGreaterThan(d0 + 8);

    h.rt.tasks.assign('pal', lookTask('player'), 0);
    h.step(2);
    expect(h.rt.tasks.kindOf('pal')).toBe('look');
  });

  it('enterVehicle walks to the car and seats the actor; leaveVehicle puts it beside the car', () => {
    const h = makeHarness();
    h.start(mission([task('pal', enterVehicleTask('car', 1))]));
    h.step(900);
    const pal = h.ecs.resolve(h.at(`mis:${ID}:pal`)) as number;
    const car = h.ecs.resolve(h.at(`mis:${ID}:car`)) as number;
    expect(h.ecs.store(Seat).vehicle[pal]).toBe(car);
    expect(h.ecs.store(Seat).seat[pal]).toBe(1);
    expect(h.rt.actors.inVehicle('pal', 'car')).toBe(true);
    expect(h.rt.actors.inVehicle('pal', 'any')).toBe(true);
    h.rt.tasks.assign('pal', leaveVehicleTask(), 0);
    h.step(3);
    expect(h.ecs.store(Seat).vehicle[pal]).toBe(0);
    expect(h.rt.actors.inVehicle('pal')).toBe(false);
  });

  it('a task for a despawned cast entry is dropped', () => {
    const h = makeHarness();
    h.start(mission([task('pal', walkTo('z')), despawn('pal'), spawn('boss')]));
    h.step(5);
    expect(h.rt.tasks.names()).not.toContain('pal');
  });
});

describe('driveTo over a synthetic C08 graph', () => {
  function graph(h: Harness): void {
    const world = h.ctx.world as unknown as { graph: Record<string, unknown> };
    world.graph = {
      route: () => ({ edges: [1, 2], lengthM: 170, etaS: 20, complete: true }),
      laneCentre: (e: { edge: number; s: number }, out: Float64Array) => {
        // edge 1 runs east from x=40, edge 2 from x=120; s metres along each
        out[0] = (e.edge === 1 ? 40 : 120) + e.s;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
      },
    };
  }

  it('planRoute turns edges into a polyline that ends at the goal', () => {
    const h = makeHarness();
    graph(h);
    const path = planRoute(h.ctx, [30, 0, 0], [200, 0, 0]);
    expect(path?.length).toBe(7);
    expect(path?.[0]).toEqual([40, 0, 0]);
    expect(path?.at(-1)).toEqual([200, 0, 0]);
    expect(planRoute({ world: { graph: { route: () => null } } } as never, [0, 0, 0], [1, 0, 0])).toBeNull();
  });

  it('feeds the engine\'s vehicle driver throttle toward the goal and stops at it', () => {
    const h = makeHarness();
    graph(h);
    const inputs: { throttle: number; brake: number; steer: number; handbrake: boolean }[] = [];
    const driver: VehicleDriver = { drive: (_h, i) => (inputs.push(i), true) };
    h.rt.setDriver(() => driver);
    h.start(mission([task('car', driveTo('z', 'fast'))]));
    h.step(30);
    expect(inputs.length).toBeGreaterThan(10);
    expect(inputs[5]?.throttle).toBeGreaterThan(0);
    expect(inputs[5]?.handbrake).toBe(false);
    // put the car inside the goal zone: the task ends with the brake on
    h.put(h.at(`mis:${ID}:car`), 200, 0);
    h.step(3);
    const last = inputs.at(-1);
    expect(last).toMatchObject({ throttle: 0, brake: 1, handbrake: true });
    expect(h.rt.tasks.kindOf('car')).toBe('');
  });

  it('without a driver the car moves along the straight line like a walker', () => {
    const h = makeHarness();
    h.start(mission([task('car', driveTo('z'))]));
    h.step(60);
    expect(pos(h, 'car')[0]).toBeGreaterThan(31);
  });
});
