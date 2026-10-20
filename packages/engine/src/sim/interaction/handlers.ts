/**
 * Interaction handlers owned by the engine. M03a1 ships `EnterVehicle`; the other kinds are registered by their owners
 * (Talk by S04, Pickup and Door by the world, Shop and Respray by S06, MissionStart by S03, and so on).
 */
import { Vehicle } from '../ecs/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import type { VehiclePhysics } from '../physics/backend.ts';
import { CONTROL_REASON } from '../control/states.ts';
import { requestEnterVehicle } from '../vehicle/enter-exit.ts';
import type { VehicleStore } from '../vehicle/components.ts';
import { INTERACT_KIND } from './kinds.ts';
import type { InteractionHandler } from './interaction.ts';

export interface EnterVehicleHandlerOptions {
  backend: VehiclePhysics;
  store: VehicleStore;
}

/** `sim.Enter` next to a vehicle puts the player in the driver's seat; a locked or taken vehicle shows its reason. */
export function enterVehicleHandler(opts: EnterVehicleHandlerOptions): InteractionHandler {
  return {
    kind: INTERACT_KIND.EnterVehicle,
    canInteract(ctx, _actor, target) {
      const world = ctx.ecs as unknown as EcsWorld;
      const vid = ctx.ecs.resolve(target);
      if (vid === null || !world.hasId(vid, Vehicle)) return CONTROL_REASON.vehicleUnknown;
      const rt = opts.store.rt.get(vid);
      if (!rt) return true;
      if (rt.locked) return CONTROL_REASON.vehicleLocked;
      if (rt.driver !== 0) return CONTROL_REASON.vehicleOccupied;
      return true;
    },
    begin(ctx, actor, target) {
      const r = requestEnterVehicle(ctx.ecs, opts.backend, opts.store, actor, target);
      if (!r.ok) ctx.services.events.push({ t: 'control.refused', tick: ctx.tick, a: actor, b: target, s: r.reason });
    },
  };
}
