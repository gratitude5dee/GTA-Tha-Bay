/**
 * Interaction system v1 (M03a1, AC-6): scored candidates, the prompt, hold prompts and `setEnabled`.
 */
import { describe, expect, it } from 'vitest';
import { SimButton, type EntityHandle } from '@dv/shared';
import { INTERACT_KIND } from '../src/sim/interaction/kinds.ts';
import { HOLD_TICKS } from '../src/sim/interaction/interaction.ts';
import type { EntityPrefabDef } from '../src/sim/index.ts';
import { createVehicleWorld, drive, type VehicleWorld } from './vehicle-sim.ts';

const INTERACT = 1 << SimButton.Interact;

function def(id: string, kind: keyof typeof INTERACT_KIND, o: { priority?: number; hold?: boolean; cone?: number; radius?: number } = {}): EntityPrefabDef {
  return {
    id, kind: 'marker', version: 1, render: { asset: 'prop/graybox.marker' }, physics: null, components: { Transform: { qw: 1 } },
    interact: {
      kind, radius: o.radius ?? 2.5, promptKey: `interact.${id}`, coneDeg: o.cone ?? 100, priority: o.priority ?? 0, ...(o.hold ? { hold: true } : {}),
    },
  };
}

/** A player at the origin facing -Z (north) with no vehicle. */
async function world(): Promise<VehicleWorld & { begun: EntityHandle[] }> {
  const w = await createVehicleWorld({ prefab: null, playerAt: [0, 0, 0], playerYaw: 0 });
  const begun: EntityHandle[] = [];
  for (const kind of [INTERACT_KIND.Talk, INTERACT_KIND.Pickup, INTERACT_KIND.Generic]) {
    w.mod.interaction.register({ kind, canInteract: () => true, begin: (_c, _a, target) => { begun.push(target); } });
  }
  drive(w, 5);
  return Object.assign(w, { begun });
}

/** An item `dist` metres from the player at `angleDeg` to the right of its heading (north). */
function at(dist: number, angleDeg: number): { pos: [number, number, number]; yaw: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { pos: [dist * Math.sin(a), 0, -dist * Math.cos(a)], yaw: 0 };
}

describe('interaction candidates', () => {
  it('publishes the best of priority x 10 - distance - angle / 45, and nothing outside 2.5 m or 100 degrees', async () => {
    const w = await world();
    w.mod.prefabs.load([def('talk.a', 'Talk'), def('talk.b', 'Talk'), def('talk.c', 'Talk', { priority: 1 }), def('talk.far', 'Talk', { priority: 5 }), def('talk.side', 'Talk', { priority: 5 })]);
    const a = w.mod.prefabs.spawn('talk.a', at(1.0, 0));        // score -1
    const b = w.mod.prefabs.spawn('talk.b', at(2.0, 40));       // score -2 - 0.89
    drive(w, 3);
    expect(w.mod.interaction.current()?.target).toBe(a);

    const c = w.mod.prefabs.spawn('talk.c', at(2.4, 10));       // score 10 - 2.4 - 0.22
    drive(w, 3);
    expect(w.mod.interaction.current()?.target).toBe(c);
    expect(w.mod.interaction.current()?.promptKey).toBe('interact.talk.c');
    expect(w.mod.interaction.current()?.kind).toBe(INTERACT_KIND.Talk);

    // priority 5 but out of reach: 2.6 m, and 80 degrees to the side (the cone is 100 degrees in all, 50 each way)
    w.mod.prefabs.spawn('talk.far', at(2.6, 0));
    w.mod.prefabs.spawn('talk.side', at(1.0, 80));
    drive(w, 3);
    expect(w.mod.interaction.current()?.target).toBe(c);

    // the ordering of the rest follows the scores: remove c, then a wins over b
    w.mod.prefabs.despawn(c);
    drive(w, 3);
    expect(w.mod.interaction.current()?.target).toBe(a);
    w.mod.prefabs.despawn(a);
    drive(w, 3);
    expect(w.mod.interaction.current()?.target).toBe(b);
    w.sim.dispose();
  });

  it('breaks ties by handle', async () => {
    const w = await world();
    w.mod.prefabs.load([def('talk.t', 'Talk')]);
    const first = w.mod.prefabs.spawn('talk.t', at(1.5, 20));
    const second = w.mod.prefabs.spawn('talk.t', at(1.5, 20));
    drive(w, 3);
    expect(first).toBeLessThan(second);
    expect(w.mod.interaction.current()?.target).toBe(first);
    w.sim.dispose();
  });

  it('begins a plain prompt on the press of Interact, once', async () => {
    const w = await world();
    w.mod.prefabs.load([def('talk.a', 'Talk')]);
    const a = w.mod.prefabs.spawn('talk.a', at(1.0, 0));
    drive(w, 3);
    expect(w.begun).toEqual([]);
    w.sim.step(1, (tick) => ({ tick, buttons: INTERACT, pressed: INTERACT, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0, device: 7 }));
    expect(w.begun).toEqual([a]);
    drive(w, 3);
    expect(w.begun).toEqual([a]);
    w.sim.dispose();
  });

  it('a hold prompt begins only after 30 ticks held, and releasing resets it', async () => {
    const w = await world();
    expect(HOLD_TICKS).toBe(30);
    w.mod.prefabs.load([def('pick.a', 'Pickup', { hold: true })]);
    const a = w.mod.prefabs.spawn('pick.a', at(1.0, 0));
    drive(w, 3);
    expect(w.mod.interaction.current()?.hold).toBe(true);
    const held = { buttons: INTERACT };
    drive(w, 29, held);
    expect(w.begun).toEqual([]);
    expect(w.mod.interaction.current()?.progress).toBeCloseTo(29 / 30, 5);
    drive(w, 1, { buttons: 0 });                 // let go: back to zero
    expect(w.mod.interaction.current()?.progress).toBe(0);
    drive(w, 29, held);
    expect(w.begun).toEqual([]);
    drive(w, 1, held);                            // the 30th tick of this hold
    expect(w.begun).toEqual([a]);
    expect(w.mod.interaction.current()?.progress).toBe(0);
    w.sim.dispose();
  });

  it('setEnabled(kind, false) removes the kind from the candidates, and true brings it back', async () => {
    const w = await world();
    w.mod.prefabs.load([def('talk.a', 'Talk', { priority: 1 }), def('pick.a', 'Pickup')]);
    const talk = w.mod.prefabs.spawn('talk.a', at(1.0, 0));
    const pick = w.mod.prefabs.spawn('pick.a', at(1.2, 0));
    drive(w, 3);
    expect(w.mod.interaction.current()?.target).toBe(talk);
    w.mod.interaction.setEnabled(INTERACT_KIND.Talk, false);
    drive(w, 3);
    expect(w.mod.interaction.current()?.target).toBe(pick);
    w.mod.interaction.setEnabled(INTERACT_KIND.Pickup, false);
    drive(w, 3);
    expect(w.mod.interaction.current()).toBeNull();
    w.mod.interaction.setEnabled(INTERACT_KIND.Talk, true);
    drive(w, 3);
    expect(w.mod.interaction.current()?.target).toBe(talk);
    w.sim.dispose();
  });

  it('offers nothing while the player is not on foot', async () => {
    const w = await createVehicleWorld({ prefab: 'vehicle.sedan', seated: true });
    drive(w, 5);
    expect(w.mod.interaction.current()).toBeNull();
    w.sim.dispose();
  });
});
