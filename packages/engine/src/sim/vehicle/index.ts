import type { EntityId } from '@dv/shared';
import type { SimCore } from '../loop/sim-core.ts';
import type { VehiclePhysics } from '../physics/backend.ts';
import { InteractionService } from '../interaction/interaction.ts';
import { enterVehicleHandler } from '../interaction/handlers.ts';
import { PrefabRegistry, ENGINE_PREFABS, VEHICLE_PREFABS } from '../prefabs/registry.ts';
import { ragdollCap, RagdollLite, vehiclePedHitSystem } from '../ragdoll/ragdoll-lite.ts';
import { closureBarrierSystem } from '../world/closures.ts';
import { LocalPlayer, Control, Vehicle, Transform } from '../ecs/components.ts';
import { CONTROL_OWNER } from '../control/states.ts';
import { driverSyncSystem, enterExitSystem } from './enter-exit.ts';
import { registerVehicleDebug } from './debug.ts';
import type { VehicleStore } from './components.ts';
import { registerVehicleSystems, type VehicleSystems } from './vehicle-system.ts';

export * from './components.ts';
export * from './presets.ts';
export * from './raycast-vehicle.ts';
export * from './vehicle-system.ts';
export * from './enter-exit.ts';

/** What `registerVehicleModule` hands back: the pieces tests, the bridge and later milestones talk to. */
export interface VehicleModule {
  readonly systems: VehicleSystems;
  readonly store: VehicleStore;
  readonly interaction: InteractionService;
  readonly ragdoll: RagdollLite;
  readonly prefabs: PrefabRegistry;
}

/** The local player's vehicle for the snapshot side block `veh`, or null while on foot. */
function playerVehicleSide(core: SimCore, store: VehicleStore): Record<string, unknown> | null {
  const ecs = core.ecs;
  const players = ecs.query([LocalPlayer, Control]);
  if (players.length === 0) return null;
  const pid = players[0] as number;
  const co = ecs.store(Control);
  if (co.owner[pid] !== CONTROL_OWNER.Vehicle) return null;
  const vid = co.target[pid] as number;
  if (!ecs.hasId(vid, Vehicle)) return null;
  const rt = store.rt.get(vid);
  const veh = ecs.store(Vehicle);
  const tr = ecs.store(Transform);
  return {
    handle: ecs.handle(vid as EntityId),
    speed: veh.speed[vid],
    gear: veh.gear[vid],
    rpm: veh.rpm[vid],
    handling: rt?.profile.id ?? '',
    pos: [tr.px[vid], tr.py[vid], tr.pz[vid]],
    state: co.state[pid],
  };
}

/**
 * Wires the whole M03a1 module into a sim that already has the physics and control systems: the handling substep, enter and
 * exit, the interaction service with the `EnterVehicle` handler, ragdoll-lite, the closure barriers, the vehicle prefabs and
 * the snapshot side keys `veh` and `prompt`. The prefab registry it returns also holds `player.default`.
 */
export function registerVehicleModule(
  core: SimCore,
  backend: VehiclePhysics,
  existing?: PrefabRegistry,
): VehicleModule {
  const systems = registerVehicleSystems(core, backend);
  const store = systems.store;
  core.addSystem(enterExitSystem({ backend, services: core.services, store }));
  core.addSystem(driverSyncSystem({ backend, store }));

  const prefabs = existing ?? new PrefabRegistry(core.ecs, backend);
  if (!existing) prefabs.load(ENGINE_PREFABS);
  prefabs.load(VEHICLE_PREFABS);

  const interaction = new InteractionService(core.ecs, core.services);
  interaction.register(enterVehicleHandler({ backend, store }));
  core.addSystem(interaction.system());
  core.addResource(interaction.resource());

  const ragdoll = new RagdollLite({ ecs: core.ecs, backend, services: core.services, cap: ragdollCap(core.cfg.tier) });
  core.addSystem(ragdoll.system());
  core.addSystem(vehiclePedHitSystem(ragdoll, store));
  core.addResource(ragdoll.resource());

  core.addSystem(closureBarrierSystem({ prefabs, services: core.services }));

  registerVehicleDebug({ core, backend, store, prefabs });
  core.services.side.set('veh', () => playerVehicleSide(core, store));
  core.services.side.set('prompt', () => interaction.side());
  return { systems, store, interaction, ragdoll, prefabs };
}
