/**
 * Entering and leaving a vehicle through the ownership machine (M03a1, AC-5).
 *
 * The sedan stands at the origin facing +X. Its driver door is on the left (-Z), 1.45 m from the centre line; the player
 * stands 2 m from that door, looking at it.
 */
import { describe, expect, it } from 'vitest';
import { SimButton, type InputFrame } from '@dv/shared';
import { Control, LocalPlayer, RenderKey, Transform } from '../src/sim/ecs/components.ts';
import { boxPrisms } from '../src/sim/fixtures/world-boxes.ts';
import { CONTROL_OWNER, CONTROL_PHASE, CONTROL_REASON, CONTROL_STATE, inputContextFor, phaseOf } from '../src/sim/control/states.ts';
import { requestEnterVehicle } from '../src/sim/vehicle/enter-exit.ts';
import { BodyRef } from '../src/sim/ecs/components.ts';
import { createVehicleWorld, drive, NEUTRAL, playerControl, view, type VehicleWorld } from './vehicle-sim.ts';

const ENTER = 1 << SimButton.Enter;
const DOOR_OFFSET = 2;
/** The player faces +Z (toward the driver door from the north side). */
const FACE_SOUTH = Math.PI;

function tap(w: VehicleWorld, buttons = ENTER): void {
  w.sim.step(1, (tick) => ({ ...NEUTRAL, tick, buttons, pressed: buttons } as InputFrame));
}

async function standing(extra: Parameters<typeof createVehicleWorld>[0] = {}): Promise<VehicleWorld> {
  const w = await createVehicleWorld({
    seated: false, pos: [0, 0, 0], playerAt: [0, 0, -(1.45 + DOOR_OFFSET)], playerYaw: FACE_SOUTH, ...extra,
  });
  drive(w, 30);   // the player lands, the car settles
  return w;
}

function playerPos(w: VehicleWorld): [number, number, number] {
  const id = w.sim.ecs.query([LocalPlayer])[0] as number;
  const tr = w.sim.ecs.store(Transform);
  return [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number];
}

describe('enter and exit', () => {
  it('passes through states 200 and 201 within 15 settle ticks, with the vehicle input context', async () => {
    const w = await standing();
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.OnFoot);
    expect(w.mod.interaction.current()?.kind).toBe(1);
    const states: number[] = [playerControl(w).state];
    tap(w);
    let at200 = -1;
    let at201 = -1;
    for (let i = 0; i < 40; i++) {
      drive(w, 1);
      const c = playerControl(w);
      if (states[states.length - 1] !== c.state) states.push(c.state);
      if (c.state === CONTROL_STATE.vehicleEntering && at200 < 0) at200 = i;
      if (c.state === CONTROL_STATE.driving && at201 < 0) at201 = i;
    }
    expect(states).toEqual([CONTROL_STATE.idle, CONTROL_STATE.vehicleEntering, CONTROL_STATE.driving]);
    expect(at201 - at200).toBeLessThanOrEqual(15);
    const c = playerControl(w);
    expect(c.owner).toBe(CONTROL_OWNER.Vehicle);
    expect(phaseOf(c.pending)).toBe(CONTROL_PHASE.Active);
    expect(inputContextFor(c.owner)).toBe('vehicle');
    expect(inputContextFor(CONTROL_OWNER.OnFoot)).toBe('onFoot');
    // the capsule is hidden and sits in the seat
    const id = w.sim.ecs.query([LocalPlayer])[0] as number;
    expect(w.sim.ecs.store(RenderKey).visible[id]).toBe(0);
    const v = view(w);
    const p = playerPos(w);
    expect(Math.hypot(p[0] - v.x, p[2] - v.z)).toBeLessThan(1);
    // the camera follows the vehicle
    expect(w.sim.services.camera.reason).toBe('vehicle');
    w.sim.dispose();
  });

  it('exit puts the player on the driver side, within 3 m', async () => {
    const w = await standing();
    tap(w);
    drive(w, 40);
    expect(playerControl(w).state).toBe(CONTROL_STATE.driving);
    tap(w);
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      drive(w, 1);
      const s = playerControl(w).state;
      if (seen[seen.length - 1] !== s) seen.push(s);
    }
    expect(seen).toContain(CONTROL_STATE.vehicleExiting);
    expect(seen[seen.length - 1]).toBe(CONTROL_STATE.idle);
    const c = playerControl(w);
    expect(c.owner).toBe(CONTROL_OWNER.OnFoot);
    const v = view(w);
    const p = playerPos(w);
    expect(p[2]).toBeLessThan(v.z - 1);              // the left (driver) side
    expect(Math.hypot(p[0] - v.x, p[2] - v.z)).toBeLessThanOrEqual(3);
    const id = w.sim.ecs.query([LocalPlayer])[0] as number;
    expect(w.sim.ecs.store(RenderKey).visible[id]).toBe(1);
    expect(w.sim.services.camera.reason).toBe('player');
    // the driver link is released: the car can be entered again
    tap(w);
    drive(w, 1);
    w.sim.dispose();
  });

  it('exit lands on the passenger side when the driver side is blocked, and refuses when nothing is free', async () => {
    const blockLeft = boxPrisms([{ cx: 0, cz: -1.4, hx: 6, hz: 0.1, baseY: 0, heightM: 3 }]);
    const w = await standing({
      setup: ({ sim }) => { sim.backend.addChunkStatics('wall.left', { prisms: blockLeft }); },
      // the player starts on the right side so that the wall does not stand between it and the car
      playerAt: [0, 0, 1.45 + DOOR_OFFSET], playerYaw: 0,
    });
    tap(w);
    drive(w, 40);
    expect(playerControl(w).state).toBe(CONTROL_STATE.driving);
    tap(w);
    drive(w, 12);
    expect(playerControl(w).state).toBe(CONTROL_STATE.idle);
    const v = view(w);
    const p = playerPos(w);
    expect(p[2]).toBeGreaterThan(v.z + 1);            // the passenger side
    expect(Math.hypot(p[0] - v.x, p[2] - v.z)).toBeLessThanOrEqual(3);
    w.sim.dispose();

    // boxed in on every side: the exit is refused with its reason and the player keeps driving
    const ring = boxPrisms([
      { cx: 0, cz: -1.4, hx: 8, hz: 0.1, baseY: 0, heightM: 3 }, { cx: 0, cz: 1.4, hx: 8, hz: 0.1, baseY: 0, heightM: 3 },
      { cx: -2.7, cz: 0, hx: 0.1, hz: 8, baseY: 0, heightM: 3 }, { cx: 2.7, cz: 0, hx: 0.1, hz: 8, baseY: 0, heightM: 3 },
    ]);
    const boxed = await createVehicleWorld({ pos: [0, 0, 0], seated: true, setup: ({ sim }) => { sim.backend.addChunkStatics('ring', { prisms: ring }); } });
    drive(boxed, 30);
    boxed.sim.services.events.drain();
    tap(boxed);
    drive(boxed, 5);
    const events = boxed.sim.services.events.drain();
    expect(events.some((e) => e.t === 'control.refused' && e.s === CONTROL_REASON.vehicleNoExit)).toBe(true);
    expect(playerControl(boxed).owner).toBe(CONTROL_OWNER.Vehicle);
    boxed.sim.dispose();
  });

  it('refuses a locked, an occupied, a far and an unknown vehicle with a reason and changes nothing', async () => {
    const w = await standing();
    const ecs = w.sim.ecs;
    const vid = ecs.resolve(w.vehicle) as number;
    const rt = w.mod.store.rt.get(vid);
    expect(rt).toBeDefined();
    const before = { ...playerControl(w) };
    const hash = w.sim.hash();

    if (rt) rt.locked = true;
    expect(requestEnterVehicle(ecs, w.sim.backend, w.mod.store, w.player, w.vehicle)).toEqual({ ok: false, reason: CONTROL_REASON.vehicleLocked });
    if (rt) rt.locked = false;
    if (rt) rt.driver = 123;
    expect(requestEnterVehicle(ecs, w.sim.backend, w.mod.store, w.player, w.vehicle)).toEqual({ ok: false, reason: CONTROL_REASON.vehicleOccupied });
    if (rt) rt.driver = 0;
    expect(requestEnterVehicle(ecs, w.sim.backend, w.mod.store, w.player, w.player)).toEqual({ ok: false, reason: CONTROL_REASON.vehicleUnknown });
    expect(playerControl(w)).toEqual(before);
    expect(w.sim.hash()).toBe(hash);

    // the prompt shows the reason, and pressing Enter reports it
    if (rt) rt.locked = true;
    drive(w, 2);
    expect(w.mod.interaction.current()?.reason).toBe(CONTROL_REASON.vehicleLocked);
    w.sim.services.events.drain();
    tap(w);
    drive(w, 3);
    const events = w.sim.services.events.drain();
    expect(events.some((e) => e.t === 'control.refused' && e.s === CONTROL_REASON.vehicleLocked)).toBe(true);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.OnFoot);
    expect(playerControl(w).state).toBe(CONTROL_STATE.idle);
    w.sim.dispose();

    // too far away
    const far = await createVehicleWorld({ seated: false, pos: [0, 0, 0], playerAt: [0, 0, -12] });
    drive(far, 30);
    expect(requestEnterVehicle(far.sim.ecs, far.sim.backend, far.mod.store, far.player, far.vehicle)).toEqual({ ok: false, reason: CONTROL_REASON.vehicleTooFar });
    expect(far.sim.ecs.store(Control).owner[far.sim.ecs.query([LocalPlayer])[0] as number]).toBe(CONTROL_OWNER.OnFoot);
    far.sim.dispose();
  });

  it('refuses to get out of a fast vehicle', async () => {
    const w = await standing();
    tap(w);
    drive(w, 40);
    for (let i = 0; i < 200; i++) drive(w, 1, { throttle: 127 });
    expect(view(w).speed).toBeGreaterThan(10);
    w.sim.services.events.drain();
    tap(w);
    drive(w, 3);
    const events = w.sim.services.events.drain();
    expect(events.some((e) => e.t === 'control.refused' && e.s === CONTROL_REASON.vehicleTooFast)).toBe(true);
    expect(playerControl(w).owner).toBe(CONTROL_OWNER.Vehicle);
    void BodyRef;
    w.sim.dispose();
  });
});
