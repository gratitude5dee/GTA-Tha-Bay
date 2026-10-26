import { describe, expect, it } from 'vitest';
import type { EntityHandle } from '@dv/shared';
import { Health, LocalPlayer, Transform, Vehicle, VehicleDamage } from '../src/sim/ecs/components.ts';
import { createSandboxBodyPort, UPRIGHT_LIFT_M } from '../src/sim/modes/sandbox-body-port.ts';
import { noFlags } from '../src/sim/sandbox-flags.ts';
import { bodyOf, createVehicleWorld, drive, launch, view, type VehicleWorld } from './vehicle-sim.ts';

function portOf(w: VehicleWorld, groundY: () => number | null = () => 0) {
  const added: string[] = [];
  const removed: string[] = [];
  const port = createSandboxBodyPort({
    ecs: w.sim.ecs,
    services: w.sim.services,
    backend: w.sim.backend,
    store: w.mod.store,
    physics: { groundY },
    resources: { add: (r) => void added.push(r.name), remove: (n) => void removed.push(n) },
  });
  return { port, added, removed };
}

function pose(w: VehicleWorld): { x: number; y: number; z: number; q: [number, number, number, number] } {
  const id = w.sim.ecs.resolve(w.vehicle) as number;
  const t = w.sim.ecs.store(Transform);
  return { x: t.px[id] as number, y: t.py[id] as number, z: t.pz[id] as number, q: [t.qx[id] as number, t.qy[id] as number, t.qz[id] as number, t.qw[id] as number] };
}

/** The heading (radians about +Y, forward is -Z) of a pose, from the quaternion. */
function headingOf(q: [number, number, number, number]): number {
  const [qx, qy, , qw] = q;
  const fx = -2 * (qx * q[2] + qw * qy);
  const fz = -(1 - 2 * (qx * qx + qy * qy));
  return Math.atan2(-fx, -fz);
}

describe('sandbox body port on a real vehicle world (AC-4)', () => {
  it('repair restores body, engine and all four tires and clears the water stall', async () => {
    const w = await createVehicleWorld({ pos: [0, 6, 0], seated: false });
    drive(w, 240);
    const id = w.sim.ecs.resolve(w.vehicle) as number;
    const dm = w.sim.ecs.store(VehicleDamage);
    expect(dm.body[id] as number).toBeLessThan(1);
    dm.engine[id] = 0.4;
    (dm.tires[2] as Float32Array)[id] = 0.1;
    const rt = w.mod.store.rt.get(id);
    if (rt) rt.wet = { wetTicks: 90, stalled: true };
    portOf(w).port.repair(w.vehicle);
    expect(dm.body[id]).toBe(1);
    expect(dm.engine[id]).toBe(1);
    for (let k = 0; k < 4; k++) expect((dm.tires[k] as Float32Array)[id]).toBe(1);
    expect(w.mod.store.rt.get(id)?.wet).toEqual({ wetTicks: 0, stalled: false });
    w.sim.dispose();
  });

  it('upright stands an upside-down car on its wheels, keeping its heading', async () => {
    const yaw = -Math.PI / 2;
    const w = await createVehicleWorld({ pos: [0, 3, 0], seated: false, yaw });
    // roll the car onto its roof about its own long axis: q = qyaw * qroll(pi) = (sin(yaw/2), 0, cos(yaw/2), 0)
    const half = yaw / 2;
    w.sim.backend.setBodyPose(bodyOf(w), [0, 3, 0], [Math.sin(half), 0, Math.cos(half), 0]);
    // the suspension rolls a dropped car back within a second; the port is asked while it is still on its roof
    drive(w, 3);
    expect(view(w).upY).toBeLessThan(-0.9);
    expect(view(w).horiz).toBeLessThan(1);
    const before = headingOf(pose(w).q);
    const { port } = portOf(w);
    expect(port.upright(w.vehicle)).toBe('ok');
    drive(w, 120);
    const v = view(w);
    expect(v.upY).toBeGreaterThan(0.95);
    expect(Math.abs(v.speed)).toBeLessThan(0.5);
    let d = Math.abs(headingOf(pose(w).q) - before);
    if (d > Math.PI) d = 2 * Math.PI - d;
    expect((d * 180) / Math.PI).toBeLessThan(5);
    expect(pose(w).y).toBeGreaterThan(0);
    expect(pose(w).y).toBeLessThan(UPRIGHT_LIFT_M + 1);
    w.sim.dispose();
  });

  it('upright refuses a moving car and a spot with no ground, changing nothing', async () => {
    const w = await createVehicleWorld({ pos: [0, 1, 0], seated: false });
    drive(w, 120);
    launch(w, 10);
    drive(w, 2);
    expect(view(w).horiz).toBeGreaterThan(5);
    const moving = pose(w);
    expect(portOf(w).port.upright(w.vehicle)).toBe('moving');
    expect(pose(w)).toEqual(moving);
    const w2 = await createVehicleWorld({ pos: [0, 1, 0], seated: false });
    drive(w2, 120);
    const still = pose(w2);
    expect(portOf(w2, () => null).port.upright(w2.vehicle)).toBe('noGround');
    expect(pose(w2)).toEqual(still);
    w.sim.dispose();
    w2.sim.dispose();
  });

  it('restorePlayer fills health and clears a knockout', async () => {
    const w = await createVehicleWorld({ seated: false });
    const pid = w.sim.ecs.query([LocalPlayer])[0] as number;
    const hp = w.sim.ecs.store(Health);
    expect(w.sim.ecs.hasId(pid, Health)).toBe(true);
    hp.hp[pid] = 10;
    hp.ko[pid] = 1;
    hp.koUntilTick[pid] = 999;
    portOf(w).port.restorePlayer();
    expect(hp.hp[pid]).toBe(hp.max[pid]);
    expect(hp.ko[pid]).toBe(0);
    expect(hp.koUntilTick[pid]).toBe(0);
    w.sim.dispose();
  });

  it('target returns the driven owned car first, then the nearest within 6 m, and never a car outside owned', async () => {
    let second = 0 as EntityHandle;
    let third = 0 as EntityHandle;
    const w = await createVehicleWorld({
      pos: [0, 1, 0],
      seated: true,
      setup: ({ prefabs }) => {
        second = prefabs.spawn('vehicle.sedan', { pos: [4, 1, 12], yaw: 0 }, 'veh:sbx1');
        third = prefabs.spawn('vehicle.sedan', { pos: [40, 1, 40], yaw: 0 }, 'veh:sbx2');
      },
    });
    drive(w, 5);
    const { port } = portOf(w);
    expect(port.target([second, w.vehicle])).toBe(w.vehicle);
    expect(port.driving(w.vehicle)).toBe(true);
    // a driven car that is not owned is never returned; the nearest owned car is out of reach
    expect(port.target([third])).toBeNull();
    expect(w.sim.ecs.hasId(w.sim.ecs.resolve(w.vehicle) as number, Vehicle)).toBe(true);
    w.sim.dispose();

    // on foot: the nearest owned car within 6 m, and null for a car at 1 m that is not owned
    const f = await createVehicleWorld({
      pos: [0, 1, 0],
      seated: false,
      playerAt: [0, 0.2, -3],
      setup: ({ prefabs }) => {
        second = prefabs.spawn('vehicle.sedan', { pos: [0, 1, -8], yaw: 0 }, 'veh:sbx1');
      },
    });
    drive(f, 5);
    const fp = portOf(f).port;
    // the player is 3 m from the first car and 5 m from the second
    expect(fp.target([second, f.vehicle])).toBe(f.vehicle);
    expect(fp.driving(f.vehicle)).toBe(false);
    expect(fp.target([second])).toBe(second);
    expect(fp.target([])).toBeNull();
    // a car at 1 m that is not owned is not returned
    expect(fp.target([f.vehicle].filter((h) => h === second))).toBeNull();
    f.sim.dispose();
  });

  it('target ignores an owned car beyond 6 m', async () => {
    const w = await createVehicleWorld({ pos: [0, 1, 0], seated: false, playerAt: [0, 0.2, -9] });
    drive(w, 5);
    expect(portOf(w).port.target([w.vehicle])).toBeNull();
    w.sim.dispose();
  });

  it('setFlags registers the resource on the first flag and drops it when all are off', async () => {
    const w = await createVehicleWorld({ seated: false });
    const { port, added, removed } = portOf(w);
    expect(added).toEqual([]);
    port.setFlags({ ...noFlags(), godMode: true });
    port.setFlags({ ...noFlags(), godMode: true, superJump: true });
    expect(added).toEqual(['sandbox-flags']);
    expect(port.flags()).toEqual({ godMode: true, superJump: true, carNoDamage: false });
    port.setFlags(noFlags());
    expect(removed).toEqual(['sandbox-flags']);
    expect(w.sim.services.sandboxFlags).toEqual(noFlags());
    w.sim.dispose();
  });
});
