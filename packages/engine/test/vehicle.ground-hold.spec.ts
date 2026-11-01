/**
 * The ground hold (bug #105, BD-FIX-PARKED-FALL-01): a vehicle with nobody aboard whose ground collider is not resident (its chunk's
 * statics left the collider working set, 01-engine.md 2.4) stays at its last pose instead of free-falling, and rests on the ground again
 * once the collider is back. The QA parked cars at City Hall fell to y -1294 and -1602 m when the story moved the stream to the Yard.
 *
 * The car stands on its own chunk (`pad`), the player on another (`far`) 400 m east that never unloads, so only the car's ground goes.
 * A car with the player at the wheel, a car in the air over resident ground and a car under the ground are not held: they fall as before
 * (the first is the below-the-world net's, 02-world-maps.md 4.1 d; the last is under a resident surface, so its ground is resident).
 * A held car stays held inside a failed chunk's wall box, survives a snapshot restore, and its hold (a body id) is not inherited by the
 * next car that takes over its dense id.
 */
import { describe, expect, it } from 'vitest';
import type { EntityHandle, StableKey } from '@dv/shared';
import { BodyRef, Transform } from '../src/sim/ecs/components.ts';
import type { StaticShapeSet } from '../src/sim/physics/backend.ts';
import { groundHeld } from '../src/sim/vehicle/components.ts';
import { createVehicleWorld, drive, launch, view, type VehicleWorld } from './vehicle-sim.ts';

/** A flat 200 m square at y 0 around (cx, cz): one chunk's ground. */
function square(cx: number, cz: number): StaticShapeSet {
  return { heightfield: { nx: 2, nz: 2, cell: 200, heights: new Float32Array(4), at: [cx - 100, 0, cz - 100] }, prisms: new Float32Array(0) };
}

const PAD = 'chunk.pad';
const FAR = 'chunk.far';

/** Ticks a spawned sedan takes to come to rest on its suspension. */
const SETTLE = 300;

/** A parked sedan on `PAD` at the origin and the player on foot on `FAR` at x 400, settled. */
async function parked(): Promise<VehicleWorld> {
  const w = await createVehicleWorld({
    noTrack: true, seated: false, pos: [0, 0, 0], playerAt: [400, 0, 0],
    setup: ({ sim }) => {
      sim.backend.addChunkStatics(PAD, square(0, 0));
      sim.backend.addChunkStatics(FAR, square(400, 0));
    },
  });
  drive(w, SETTLE);
  return w;
}

const bodyOf = (w: VehicleWorld, h: EntityHandle = w.vehicle): number => w.sim.ecs.store(BodyRef).body[w.sim.ecs.resolve(h) as number] as number;
const held = (w: VehicleWorld, h: EntityHandle = w.vehicle): boolean => {
  const rt = w.mod.store.rt.get(w.sim.ecs.resolve(h) as number);
  return rt !== undefined && groundHeld(rt, bodyOf(w, h));
};

describe('the ground hold of a vehicle whose ground collider is not resident (BD-FIX-PARKED-FALL-01)', () => {
  it('a parked car stays at its pose while its ground is unloaded and rests on the ground again when it reloads', async () => {
    const w = await parked();
    const rest = view(w);
    expect(rest.contacts).toBe(4);
    // at rest the body's velocity read after the step is about -0.061 m/s: gravity's share of the step, which the next substep's
    // suspension impulse takes back (the height stays at 0.540 m)
    expect(Math.abs(rest.vy)).toBeLessThan(0.1);
    expect(rest.y).toBeGreaterThan(0.3);
    expect(held(w)).toBe(false);

    // the stream moved away: the chunk's colliders leave the backend, 10 s go by
    w.sim.backend.removeChunkStatics(PAD);
    let lowest = rest.y;
    let highest = rest.y;
    drive(w, 600, {}, () => {
      const y = view(w).y;
      if (y < lowest) lowest = y;
      if (y > highest) highest = y;
    });
    expect(rest.y - lowest, 'fell while its ground was unloaded').toBeLessThan(1e-3);
    expect(highest - rest.y).toBeLessThan(1e-3);
    const away = view(w);
    expect(Math.abs(away.x - rest.x)).toBeLessThan(1e-3);
    expect(Math.abs(away.z - rest.z)).toBeLessThan(1e-3);
    expect(away.horiz).toBe(0);
    expect(away.vy).toBe(0);
    expect(held(w)).toBe(true);
    expect(w.sim.backend.bodyKind(bodyOf(w))).toBe('kinematic');

    // the stream came back: the same ground again, and the car stands on it, dynamic and at rest
    w.sim.backend.addChunkStatics(PAD, square(0, 0));
    drive(w, 120);
    const back = view(w);
    expect(held(w)).toBe(false);
    expect(w.sim.backend.bodyKind(bodyOf(w))).toBe('dynamic');
    expect(back.contacts).toBe(4);
    expect(Math.abs(back.y - rest.y)).toBeLessThan(0.02);
    expect(Math.abs(back.x - rest.x)).toBeLessThan(0.02);
    expect(Math.abs(back.z - rest.z)).toBeLessThan(0.02);
    expect(back.horiz).toBeLessThan(0.05);
    expect(Math.abs(back.vy)).toBeLessThan(0.1);
    // no impact was reported for the stop or the release
    expect(back.bodyHealth).toBe(rest.bodyHealth);
    w.sim.dispose();
  }, 60_000);

  it('a held car is held the same after a snapshot restore, and the run hashes the same', async () => {
    const w = await parked();
    w.sim.backend.removeChunkStatics(PAD);
    drive(w, 30);
    expect(held(w)).toBe(true);
    const snap = w.sim.snapshot();
    drive(w, 60);
    const straight = w.sim.hash();
    w.sim.restore(snap);
    drive(w, 60);
    expect(w.sim.hash()).toBe(straight);
    expect(held(w)).toBe(true);
    w.sim.backend.addChunkStatics(PAD, square(0, 0));
    drive(w, 120);
    expect(held(w)).toBe(false);
    expect(view(w).contacts).toBe(4);
    w.sim.dispose();
  }, 60_000);

  it('a held car stays held inside the wall box of a chunk that failed to load, and rests on the ground once it loads', async () => {
    const w = await parked();
    const rest = view(w);
    w.sim.backend.removeChunkStatics(PAD);
    drive(w, 30);
    expect(held(w)).toBe(true);
    // the chunk comes back as a failed load: the streaming's wall box over it (base -100 m, 600 m high; `wallPrism` in @dv/world)
    w.sim.backend.addChunkStatics(PAD, { prisms: Float32Array.from([4, -100, 600, -100, -100, 100, -100, 100, 100, -100, 100]) });
    drive(w, 120);
    expect(held(w), 'let go inside the wall').toBe(true);
    expect(Math.abs(view(w).y - rest.y)).toBeLessThan(1e-3);
    expect(Math.abs(view(w).x - rest.x)).toBeLessThan(1e-3);
    // then the chunk loads: its ground replaces the wall
    w.sim.backend.addChunkStatics(PAD, square(0, 0));
    drive(w, 120);
    expect(held(w)).toBe(false);
    expect(view(w).contacts).toBe(4);
    expect(Math.abs(view(w).y - rest.y)).toBeLessThan(0.02);
    w.sim.dispose();
  }, 60_000);

  it('a car that takes over the dense id of a held car is held for its own body only', async () => {
    const w = await parked();
    w.sim.backend.removeChunkStatics(PAD);
    drive(w, 30);
    expect(held(w)).toBe(true);
    const id = w.sim.ecs.resolve(w.vehicle) as number;
    const oldBody = bodyOf(w);
    // the held car goes; a new one (the same handling, so the runtime keyed by the dense id is reused) appears over the empty chunk,
    // 2 m above where the pad was
    w.prefabs.despawn(w.vehicle);
    drive(w, 1);
    const next = w.prefabs.spawn('vehicle.sedan', { pos: [20, 2, 0], yaw: 0 }, 'veh:test1' as StableKey);
    drive(w, 1);
    expect(w.sim.ecs.resolve(next), 'the dense id is reused').toBe(id);
    expect(bodyOf(w, next)).not.toBe(oldBody);
    // it is held at its own spawn pose (its body is kinematic), not left dynamic and unsimulated by the old car's hold
    expect(held(w, next)).toBe(true);
    expect(w.sim.backend.bodyKind(bodyOf(w, next))).toBe('kinematic');
    const at = w.sim.ecs.store(Transform).py[id] as number;
    drive(w, 120);
    expect(w.sim.ecs.store(Transform).py[id]).toBe(at);
    // its ground arrives: it drops the 2 m and stands on its wheels
    w.sim.backend.addChunkStatics(PAD, square(0, 0));
    drive(w, 240);
    expect(held(w, next)).toBe(false);
    expect(w.mod.store.rt.get(id)?.contacts).toBe(4);
    expect(Math.abs((w.sim.ecs.store(Transform).py[id] as number) - 0.54)).toBeLessThan(0.02);
    w.sim.dispose();
  }, 60_000);

  it('a car with the player at the wheel is not held: it falls, for the below-the-world net', async () => {
    // the player drives the car here; the player's own chunk is the car's
    const w = await createVehicleWorld({ noTrack: true, pos: [0, 0, 0], setup: ({ sim }) => sim.backend.addChunkStatics(PAD, square(0, 0)) });
    drive(w, 120);
    const rest = view(w);
    w.sim.backend.removeChunkStatics(PAD);
    drive(w, 60);
    expect(held(w)).toBe(false);
    expect(view(w).y).toBeLessThan(rest.y - 3);
    w.sim.dispose();
  }, 60_000);

  it('a car with nobody aboard in the air over resident ground is never held: it flies and lands', async () => {
    const w = await parked();
    launch(w, 8, 6);
    let wasHeld = false;
    let top = view(w).y;
    drive(w, 180, {}, () => {
      wasHeld ||= held(w);
      top = Math.max(top, view(w).y);
    });
    expect(wasHeld).toBe(false);
    expect(top).toBeGreaterThan(1.5);
    expect(view(w).x).toBeGreaterThan(5);
    expect(view(w).contacts).toBeGreaterThan(0);
    w.sim.dispose();
  }, 60_000);

  it('a car under a resident ground is not held: it falls on to the below-the-world rules', async () => {
    const w = await parked();
    const b = w.sim.backend;
    // 30 m under the pad, at rest (as a spawn under the terrain would put it)
    b.setBodyPose(bodyOf(w), [0, -30, 0], [0, 0, 0, 1]);
    b.setBodyVelocity(bodyOf(w), [0, 0, 0], [0, 0, 0]);
    drive(w, 60);
    expect(held(w)).toBe(false);
    expect(view(w).y).toBeLessThan(-33);
    w.sim.dispose();
  }, 60_000);
});
