/**
 * The engine side of the sandbox's car spawner on a real vehicle world (M04e3, AC-7): an empty car leaves at once, a car the player
 * sits in leaves once the player is out, and building the port or preparing a road car changes nothing else.
 */
import { describe, expect, it, vi } from 'vitest';
import type { EntityHandle } from '@dv/shared';
import { Control, LocalPlayer } from '../src/sim/ecs/components.ts';
import { CONTROL_OWNER, CONTROL_PHASE, phaseOf } from '../src/sim/control/states.ts';
import { createSandboxVehiclePort, RETIRE_WAIT_TICKS, type SandboxVehiclePortImpl } from '../src/sim/modes/sandbox-vehicle-port.ts';
import { createVehicleWorld, drive, type VehicleWorld } from './vehicle-sim.ts';

function portOf(w: VehicleWorld): SandboxVehiclePortImpl {
  return createSandboxVehiclePort({
    ecs: w.sim.ecs,
    backend: w.sim.backend,
    services: w.sim.services,
    store: w.mod.store,
    prefabs: w.prefabs,
    physics: { groundY: () => 0, castRay: () => null },
    tick: () => w.sim.tick,
    graph: () => null,
    player: () => ({ x: 0, y: 0, z: -3, camYaw: 0 }),
  });
}

const resolves = (w: VehicleWorld, h: EntityHandle): boolean => w.sim.ecs.resolve(h) !== null;
const playerOwner = (w: VehicleWorld): { owner: number; phase: number } => {
  const id = w.sim.ecs.query([LocalPlayer])[0] as number;
  const co = w.sim.ecs.store(Control);
  return { owner: co.owner[id] as number, phase: phaseOf(co.pending[id] as number) };
};

describe('sandbox vehicle port on a real world (M04e3 AC-7)', () => {
  it('an empty car stops resolving on the tick it is retired', async () => {
    const w = await createVehicleWorld({ prefab: null, seated: false });
    const port = portOf(w);
    const h = port.spawn('vehicle.sedan', { x: 6, y: 0, z: 6, yaw: 0 }, 'veh:sbx0');
    drive(w, 1);
    expect(resolves(w, h)).toBe(true);
    expect(port.alive(h)).toBe(true);
    expect(port.inUse(h)).toBe(false);
    port.retire(h);
    drive(w, 1);
    expect(resolves(w, h)).toBe(false);
    expect(port.alive(h)).toBe(false);
    expect(w.sim.ecs.resolve(w.sim.ecs.byKey('veh:sbx0'))).toBeNull();
    w.sim.dispose();
  });

  it('a car the player sits in is released first: the player ends on foot within 600 ticks, then the key stops resolving', async () => {
    const w = await createVehicleWorld({ prefab: null, seated: false, pos: [0, 0, 0] });
    const port = portOf(w);
    const h = port.spawn('vehicle.sedan', { x: 0, y: 0, z: 0, yaw: -Math.PI / 2 }, 'veh:sbx0');
    drive(w, 30);
    expect(port.playerDriving()).toBe(false);
    expect(port.seat(h)).toBe(true);
    drive(w, 40);
    expect(port.playerDriving()).toBe(true);
    expect(port.inUse(h)).toBe(true);
    port.retire(h);
    expect(resolves(w, h)).toBe(true);
    expect(port.queued()).toBe(1);
    let gone = -1;
    for (let i = 0; i < RETIRE_WAIT_TICKS; i++) {
      port.update(w.sim.tick);
      drive(w, 1);
      if (!resolves(w, h)) {
        gone = i;
        break;
      }
    }
    expect(gone).toBeGreaterThan(0);
    expect(port.queued()).toBe(0);
    expect(playerOwner(w)).toEqual({ owner: CONTROL_OWNER.OnFoot, phase: CONTROL_PHASE.Ready });
    expect(w.sim.ecs.resolve(w.sim.ecs.byKey('veh:sbx0'))).toBeNull();
    w.sim.dispose();
  });

  it('a car whose driver does not get out is removed after 600 ticks and the player is handed back to the ground', async () => {
    const w = await createVehicleWorld({ prefab: null, seated: false, pos: [0, 0, 0] });
    const port = portOf(w);
    const h = port.spawn('vehicle.sedan', { x: 0, y: 0, z: 0, yaw: -Math.PI / 2 }, 'veh:sbx0');
    drive(w, 30);
    expect(port.seat(h)).toBe(true);
    drive(w, 40);
    port.retire(h);
    // the exit is never granted: the request is cleared every tick, as a blocked exit would do
    for (let i = 0; i <= RETIRE_WAIT_TICKS + 2; i++) {
      port.update(w.sim.tick);
      drive(w, 1);
      const id = w.sim.ecs.query([LocalPlayer])[0] as number;
      if (resolves(w, h)) w.sim.ecs.store(Control).pending[id] = (CONTROL_PHASE.Active as number) | 0;
    }
    expect(resolves(w, h)).toBe(false);
    expect(playerOwner(w).owner).toBe(CONTROL_OWNER.OnFoot);
    w.sim.dispose();
  });

  it('building the port without calling prepare keeps the state hash at tick 600', async () => {
    const a = await createVehicleWorld({ prefab: 'vehicle.sedan', seated: false });
    const b = await createVehicleWorld({ prefab: 'vehicle.sedan', seated: false });
    const port = portOf(b);
    expect(port.queued()).toBe(0);
    drive(a, 600);
    for (let i = 0; i < 600; i++) {
      port.update(b.sim.tick);
      drive(b, 1);
    }
    expect(b.sim.tick).toBe(a.sim.tick);
    expect(b.sim.hash()).toBe(a.sim.hash());
    a.sim.dispose();
    b.sim.dispose();
  });

  it('prepare of a race car loads the race prefabs exactly once, and a road car loads nothing', async () => {
    const w = await createVehicleWorld({ prefab: null, seated: false });
    const port = portOf(w);
    const load = vi.spyOn(w.prefabs, 'load');
    port.prepare('vehicle.sedan');
    expect(load).not.toHaveBeenCalled();
    port.prepare('vehicle.halcyon-cormorant');
    port.prepare('vehicle.halcyon-cormorant');
    port.prepare('vehicle.kestrel-quill');
    expect(load).toHaveBeenCalledTimes(1);
    expect(w.prefabs.has('vehicle.halcyon-cormorant')).toBe(true);
    w.sim.dispose();
  });
});
