/**
 * BD-FIX-SPAWN-12 (DL-736 follow-up): the vehicle seat port of a resumed checkpoint.
 *  - `reseatDriver`: a mission resumed while the player drives another car seats the player in the cast car only after taking it out of
 *    the car it drives (`unseatDriver`), so the other car is left with nobody booked at its wheel;
 *  - `setDownBeside`: a seat that cannot be taken sets the player down on foot where the normal exit would, never inside the car's collider.
 */
import { describe, expect, it } from 'vitest';
import type { EntityHandle } from '@dv/shared';
import { BodyRef, CharacterBody, Control, LocalPlayer, RenderKey, Transform } from '../src/sim/ecs/components.ts';
import { CONTROL_OWNER, CONTROL_PHASE, CONTROL_STATE, phaseOf } from '../src/sim/control/states.ts';
import { PHYSICS_CONFIG } from '../src/sim/physics/config.ts';
import { reseatDriver, seatDriver, setDownBeside } from '../src/sim/vehicle/enter-exit.ts';
import { createVehicleWorld, drive, playerControl, type VehicleWorld } from './vehicle-sim.ts';

/** A world with the player at the wheel of `w.vehicle` (at the origin) and a second, empty sedan `other` 12 m north of it. */
async function twoCars(): Promise<{ w: VehicleWorld; other: EntityHandle }> {
  let other = 0 as EntityHandle;
  const w = await createVehicleWorld({
    pos: [0, 0, 0],
    setup: ({ prefabs }) => {
      other = prefabs.spawn('vehicle.sedan', { pos: [0, 0, -12], yaw: -Math.PI / 2 }, 'veh:test1');
    },
  });
  drive(w, 30);   // the cars settle on the track
  return { w, other };
}

const idOf = (w: VehicleWorld, h: EntityHandle): number => w.sim.ecs.resolve(h) as number;
const driverOf = (w: VehicleWorld, h: EntityHandle): number => w.mod.store.rt.get(idOf(w, h))?.driver ?? -1;
const playerId = (w: VehicleWorld): number => w.sim.ecs.query([LocalPlayer])[0] as number;
const posOf = (w: VehicleWorld, id: number): [number, number, number] => {
  const tr = w.sim.ecs.store(Transform);
  return [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number];
};

/** The player's feet in the car's frame (x right, z back), and the car's collider half extents. */
function inCarFrame(w: VehicleWorld, car: EntityHandle): { x: number; z: number; hx: number; hz: number } {
  const cid = idOf(w, car);
  const tr = w.sim.ecs.store(Transform);
  const yaw = 2 * Math.atan2(tr.qy[cid] as number, tr.qw[cid] as number);
  const [px, , pz] = posOf(w, playerId(w));
  const dx = px - (tr.px[cid] as number);
  const dz = pz - (tr.pz[cid] as number);
  // right (cos yaw, -sin yaw), back (sin yaw, cos yaw)
  const shape = w.sim.backend.bodyShape(w.sim.ecs.store(BodyRef).body[cid] as number);
  const dims = shape?.dims ?? [0, 0, 0];
  return { x: dx * Math.cos(yaw) - dz * Math.sin(yaw), z: dx * Math.sin(yaw) + dz * Math.cos(yaw), hx: dims[0] as number, hz: dims[2] as number };
}

/** True when the player's capsule (radius r) lies clear of the car's box collider on the ground plane. */
function clearOf(w: VehicleWorld, car: EntityHandle): boolean {
  const r = PHYSICS_CONFIG.character.radiusM;
  const f = inCarFrame(w, car);
  return Math.abs(f.x) > f.hx + r || Math.abs(f.z) > f.hz + r;
}

describe('the seat port of a resumed checkpoint (BD-FIX-SPAWN-12)', () => {
  it('seatDriver alone leaves the car the player drives booked to it: the defect reseatDriver closes', async () => {
    const { w, other } = await twoCars();
    expect(driverOf(w, w.vehicle)).toBe(playerId(w));
    expect(seatDriver(w.sim.ecs, w.sim.backend, w.mod.store, w.sim.services, w.player, other, w.sim.tick)).toBe(true);
    // both cars name the player as their driver
    expect(driverOf(w, other)).toBe(playerId(w));
    expect(driverOf(w, w.vehicle)).toBe(playerId(w));
    w.sim.dispose();
  });

  it('reseatDriver takes the player out of the car it drives first, then seats it in the other one', async () => {
    const { w, other } = await twoCars();
    w.sim.services.events.drain();
    expect(reseatDriver(w.sim.ecs, w.sim.backend, w.mod.store, w.sim.services, w.player, other, w.sim.tick)).toBe(true);
    const events = w.sim.services.events.drain();
    // the first car has nobody at its wheel; the second has the player, driving, Active
    expect(driverOf(w, w.vehicle)).toBe(0);
    expect(driverOf(w, other)).toBe(playerId(w));
    const c = playerControl(w);
    expect(c.owner).toBe(CONTROL_OWNER.Vehicle);
    expect(c.state).toBe(CONTROL_STATE.driving);
    expect(phaseOf(c.pending)).toBe(CONTROL_PHASE.Active);
    expect(w.sim.ecs.store(Control).target[playerId(w)]).toBe(idOf(w, other));
    expect(w.sim.services.camera.target).toBe(other);
    // the unseat went through the ownership machine's event log
    expect(events.some((e) => e.t === 'control.transition' && String(e.s).endsWith('unseat'))).toBe(true);
    // the player rides with the second car from the next physics step, and the first stays where it stood
    const first = posOf(w, idOf(w, w.vehicle));
    drive(w, 20);
    const p = posOf(w, playerId(w));
    const o = posOf(w, idOf(w, other));
    expect(Math.hypot(p[0] - o[0], p[2] - o[2])).toBeLessThan(1);
    const after = posOf(w, idOf(w, w.vehicle));
    expect(Math.hypot(after[0] - first[0], after[2] - first[2])).toBeLessThan(0.05);
    expect(driverOf(w, w.vehicle)).toBe(0);
    w.sim.dispose();
  });

  it('reseatDriver into the car the player already drives changes nothing', async () => {
    const { w } = await twoCars();
    w.sim.services.events.drain();
    expect(reseatDriver(w.sim.ecs, w.sim.backend, w.mod.store, w.sim.services, w.player, w.vehicle, w.sim.tick)).toBe(true);
    expect(driverOf(w, w.vehicle)).toBe(playerId(w));
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.Vehicle);
    expect(w.sim.services.events.drain().some((e) => e.t === 'control.transition')).toBe(false);
    w.sim.dispose();
  });

  it('reseatDriver into a car whose seat is taken answers false and leaves the player out of every car', async () => {
    const { w, other } = await twoCars();
    const rt = w.mod.store.rt.get(idOf(w, other)) ?? w.mod.store.ensure(idOf(w, other), 'hp.sedan');
    rt.driver = 999_999;
    expect(reseatDriver(w.sim.ecs, w.sim.backend, w.mod.store, w.sim.services, w.player, other, w.sim.tick)).toBe(false);
    expect(driverOf(w, w.vehicle)).toBe(0);
    expect(driverOf(w, other)).toBe(999_999);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.OnFoot);
    w.sim.dispose();
  });

  it('setDownBeside puts the player on foot at the driver-side exit point, clear of the collider, and it stays clear and grounded', async () => {
    const { w, other } = await twoCars();
    expect(setDownBeside(w.sim.ecs, w.sim.backend, w.mod.store, w.sim.services, w.player, other, w.sim.tick)).toBe(true);
    const pid = playerId(w);
    // out of the car it drove, which keeps nobody at its wheel; on foot, shown, colliding
    expect(driverOf(w, w.vehicle)).toBe(0);
    expect(driverOf(w, other)).toBe(0);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.OnFoot);
    expect(w.sim.ecs.store(RenderKey).visible[pid]).toBe(1);
    // the normal exit's first candidate: the driver side (left, x < 0), trackM / 2 + 0.9 m from the centre line
    const track = w.mod.store.rt.get(idOf(w, other))?.profile.trackM ?? 0;
    const f = inCarFrame(w, other);
    expect(f.x).toBeCloseTo(-(track / 2 + 0.9), 3);
    expect(Math.abs(f.z)).toBeLessThan(0.01);
    expect(clearOf(w, other)).toBe(true);
    const car0 = posOf(w, idOf(w, other));
    for (let i = 0; i < 60; i++) {
      drive(w, 1);
      expect(clearOf(w, other), `clear of the car at step ${i}`).toBe(true);
    }
    expect(w.sim.ecs.store(CharacterBody).grounded[pid]).toBe(1);
    // the car was not shoved by a capsule inside it
    const car1 = posOf(w, idOf(w, other));
    expect(Math.hypot(car1[0] - car0[0], car1[2] - car0[2])).toBeLessThan(0.05);
    w.sim.dispose();
  });

  it('setDownBeside answers false for a vehicle that is gone', async () => {
    const { w, other } = await twoCars();
    w.prefabs.despawn(other);
    drive(w, 1);
    expect(setDownBeside(w.sim.ecs, w.sim.backend, w.mod.store, w.sim.services, w.player, other, w.sim.tick)).toBe(false);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.Vehicle);
    w.sim.dispose();
  });
});
