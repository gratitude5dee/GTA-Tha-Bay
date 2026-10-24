/**
 * Ragdoll-lite (M03a1, AC-7): a vehicle meets a ped capsule.
 */
import { describe, expect, it } from 'vitest';
import type { EntityHandle } from '@dv/shared';
import { BodyRef, Control, Transform } from '../src/sim/ecs/components.ts';
import type { EntityPrefabDef } from '../src/sim/index.ts';
import { CONTROL_OWNER, CONTROL_STATE } from '../src/sim/control/states.ts';
import { closingSpeedFor, HIT_RESTITUTION, PED_MASS_KG, ragdollCap, RAGDOLL_MIN_DV } from '../src/sim/ragdoll/ragdoll-lite.ts';
import { bodyOf, createVehicleWorld, drive, launch, type VehicleWorld } from './vehicle-sim.ts';

const PED: EntityPrefabDef = {
  id: 'ped.test', kind: 'ped', version: 1, render: { asset: 'prop/graybox.capsule' },
  physics: { body: 'kinematic', shape: 'capsule', dims: [0.55, 0.35], groups: ['character'] },
  components: {
    Transform: { qw: 1 }, Velocity: {}, BodyRef: {}, Ped: {}, Anim: { state: 0 },
    CharacterBody: { radius: 0.35, height: 1.8, grounded: 1, groundNormalY: 1 }, Control: { owner: 1, state: 100 },
  },
};

async function world(tier?: 'mobile'): Promise<VehicleWorld> {
  const w = await createVehicleWorld({ pos: [0, 0, 0], playerAt: [0, 0, -40], ...(tier ? { config: { tier } } : {}) });
  w.mod.prefabs.load([PED]);
  drive(w, 30);
  return w;
}

function pedBody(w: VehicleWorld, ped: EntityHandle): number {
  return w.sim.ecs.store(BodyRef).body[w.sim.ecs.resolve(ped) as number] as number;
}

function carVelocity(w: VehicleWorld): [number, number, number] {
  const buf = new Float64Array(13);
  w.sim.backend.readBody(bodyOf(w), buf);
  return [buf[7] as number, buf[8] as number, buf[9] as number];
}

describe('ragdoll-lite', () => {
  it('a ped velocity change of 7 m/s ragdolls it for at most 180 ticks, then it gets up; the car gets the opposite impulse', async () => {
    const w = await world();
    const mass = 1450;
    const ped = w.mod.prefabs.spawn('ped.test', { pos: [30, 0, 30], yaw: 0 }, 'npc:test-ped-1');
    drive(w, 2);
    const speed = closingSpeedFor(7, mass);
    expect(speed).toBeGreaterThan(6);
    launch(w, speed);
    const before = carVelocity(w);
    const tick = w.sim.tick;
    const out = w.mod.ragdoll.hit(ped, tick, bodyOf(w), mass, [speed, 0, 0]);
    expect(out.kind).toBe('ragdoll');
    expect(out.pedDeltaV).toBeCloseTo(7, 5);
    // the opposite impulse: J = (1 + e) v / (1/M + 1/m), the car loses J / M along the normal (+X)
    const j = ((1 + HIT_RESTITUTION) * speed) / (1 / mass + 1 / PED_MASS_KG);
    const after = carVelocity(w);
    expect(before[0] - after[0]).toBeCloseTo(j / mass, 4);
    expect(after[1]).toBeCloseTo(before[1], 6);

    const body = pedBody(w, ped);
    expect(w.sim.backend.bodyKind(body)).toBe('dynamic');
    const co = w.sim.ecs.store(Control);
    const pid = w.sim.ecs.resolve(ped) as number;
    expect(co.owner[pid]).toBe(CONTROL_OWNER.Ragdoll);
    expect(co.state[pid]).toBe(CONTROL_STATE.ragdoll);

    let dynamicTicks = 0;
    let gettingUp = false;
    for (let i = 0; i < 400; i++) {
      drive(w, 1);
      if (w.sim.backend.bodyKind(body) === 'dynamic') dynamicTicks++;
      if (co.state[pid] === CONTROL_STATE.gettingUp) gettingUp = true;
    }
    expect(dynamicTicks).toBeGreaterThan(0);
    expect(dynamicTicks).toBeLessThanOrEqual(180);
    expect(gettingUp).toBe(true);
    expect(w.sim.backend.bodyKind(body)).toBe('kinematic');
    expect(co.owner[pid]).toBe(CONTROL_OWNER.OnFoot);
    expect(co.state[pid]).toBe(CONTROL_STATE.idle);
    // upright again
    const tr = w.sim.ecs.store(Transform);
    expect(tr.qw[pid]).toBe(1);
    expect(tr.qx[pid]).toBe(0);
    expect(w.mod.ragdoll.isDown(ped)).toBe(false);
    w.sim.dispose();
  }, 60_000);

  it('at 5 m/s no ragdoll starts and the car is not touched', async () => {
    const w = await world();
    const mass = 1450;
    const ped = w.mod.prefabs.spawn('ped.test', { pos: [30, 0, 30], yaw: 0 }, 'npc:test-ped-1');
    drive(w, 2);
    const speed = closingSpeedFor(5, mass);
    launch(w, speed);
    const before = carVelocity(w);
    const out = w.mod.ragdoll.hit(ped, w.sim.tick, bodyOf(w), mass, [speed, 0, 0]);
    expect(out.kind).toBe('none');
    expect(out.pedDeltaV).toBeCloseTo(5, 5);
    expect(RAGDOLL_MIN_DV).toBe(6);
    expect(carVelocity(w)).toEqual(before);
    expect(w.sim.backend.bodyKind(pedBody(w, ped))).toBe('kinematic');
    expect(w.mod.ragdoll.isDown(ped)).toBe(false);
    w.sim.dispose();
  });

  it('with the mobile cap of 4, the fifth hit plays the canned fall and creates no body', async () => {
    const w = await world('mobile');
    expect(ragdollCap('mobile')).toBe(4);
    expect(ragdollCap('desktop')).toBe(8);
    expect(ragdollCap('mobile-low')).toBe(2);
    const mass = 1450;
    const speed = closingSpeedFor(8, mass);
    const peds: EntityHandle[] = [];
    for (let i = 0; i < 5; i++) peds.push(w.mod.prefabs.spawn('ped.test', { pos: [30 + i * 3, 0, 30], yaw: 0 }, `npc:test-ped-${i}`));
    drive(w, 2);
    const kinds: string[] = [];
    for (const p of peds) kinds.push(w.mod.ragdoll.hit(p, w.sim.tick, bodyOf(w), mass, [speed, 0, 0]).kind);
    expect(kinds).toEqual(['ragdoll', 'ragdoll', 'ragdoll', 'ragdoll', 'canned']);
    const bodies = peds.map((p) => w.sim.backend.bodyKind(pedBody(w, p)));
    expect(bodies).toEqual(['dynamic', 'dynamic', 'dynamic', 'dynamic', 'kinematic']);
    expect(w.mod.ragdoll.activeBodies).toBe(4);
    // the canned ped still goes down (control state 300) and gets up
    const co = w.sim.ecs.store(Control);
    const last = w.sim.ecs.resolve(peds[4] as EntityHandle) as number;
    expect(co.state[last]).toBe(CONTROL_STATE.ragdoll);
    drive(w, 400);
    expect(co.state[last]).toBe(CONTROL_STATE.idle);
    w.sim.dispose();
  }, 60_000);

  it('a car that drives into a ped hits it through the contact system', async () => {
    const w = await world();
    const ped = w.mod.prefabs.spawn('ped.test', { pos: [40, 0, 0], yaw: 0 }, 'npc:test-ped-1');
    drive(w, 2);
    launch(w, 15);
    const events: string[] = [];
    for (let i = 0; i < 300 && !w.mod.ragdoll.isDown(ped); i++) {
      drive(w, 1, { throttle: 60 });
      for (const e of w.sim.services.events.drain()) events.push(e.t);
    }
    expect(w.mod.ragdoll.isDown(ped)).toBe(true);
    expect(events).toContain('ragdoll.start');
    w.sim.dispose();
  }, 60_000);
});
