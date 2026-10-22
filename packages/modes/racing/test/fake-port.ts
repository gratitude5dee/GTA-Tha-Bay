/**
 * A world-free `RaceWorldPort` for the unit tests: the car is a point that moves along the route at the speed the test asks for,
 * so the session, the director and the HUD can be driven for thousands of ticks without Rapier.
 */
import { routePoint, type DamageState, type RaceDef } from '@dv/shared';
import type { CarCommand, CarImpact, CarReadout, RaceWorldPort } from '../src/sim/port.ts';

export interface FakeCar extends RaceWorldPort {
  /** Metres per second the car holds (the test sets it; `drive` brakes it when `brake` is held). */
  speed: number;
  /** Route metres of the car. */
  s: number;
  placed: { pos: [number, number, number]; yaw: number }[];
  spawned: { prefab: string; pos: [number, number, number] }[];
  damage: DamageState | null;
  nitro: { on: boolean; charge: number };
  command: CarCommand;
  impacts: CarImpact[];
  upY: number;
  released: boolean;
}

export function fakePort(def: RaceDef, o: { ready?: () => boolean } = {}): FakeCar {
  const car: FakeCar = {
    speed: 0, s: 0, placed: [], spawned: [], damage: null, nitro: { on: false, charge: 0 }, command: { throttle: 0, brake: 0, steer: 0, handbrake: true },
    impacts: [], upY: 1, released: false,
    collidersReady: () => (o.ready ? o.ready() : true),
    groundY: () => 0,
    spawnCar(prefab, pos) {
      if (car.spawned.length === 0) car.spawned.push({ prefab, pos });
      return true;
    },
    read(): CarReadout | null {
      if (car.spawned.length === 0) return null;
      const p = routePoint(def, car.s);
      return {
        pos: [p.x, p.y + 0.5, p.z], front: [p.x + p.tx * 1.3, p.y, p.z + p.tz * 1.3], yaw: 0, speedMps: car.speed, vel: [p.tx * car.speed, 0, p.tz * car.speed],
        upY: car.upY, airTicks: 0, gear: car.speed > 1 ? 2 : 0, rpm: 3000 + car.speed * 60, slipDeg: 0,
      };
    },
    place(pos) {
      car.placed.push({ pos, yaw: 0 });
      // back to the nearest route position of the placement (z runs along the fixture route)
      car.s = Math.max(0, -pos[2]);
      car.speed = 0;
    },
    drive(c) {
      car.command = c;
    },
    setNitro(on, charge) {
      car.nitro = { on, charge };
    },
    setDamage(d) {
      car.damage = d;
    },
    takeImpacts() {
      const out = car.impacts;
      car.impacts = [];
      return out;
    },
    release() {
      car.released = true;
    },
  };
  return car;
}
