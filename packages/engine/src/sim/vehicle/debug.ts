/**
 * QA debug commands of the vehicle module (M03a1): `debug.spawn` and `debug.vehicle`. The sim worker entry installs
 * `vehicleQa` behind `VITE_DV_QA` (a production bundle does not contain this file); the commands run between ticks (C02 rule 9).
 * Replies are `qa` messages the page's bridge waits for.
 */
import { dsqrt, type EntityHandle, type EntityId, type StableKey } from '@dv/shared';
import { Control, LocalPlayer, Transform, Vehicle, VehicleDamage } from '../ecs/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import type { PrefabRegistry } from '../prefabs/registry.ts';
import { CONTROL_OWNER, CONTROL_PHASE, phaseOf } from '../control/states.ts';
import type { PhysicsSim } from '../sim-factory.ts';
import type { DebugCommand } from '../transport/envelope.ts';
import { requestEnterVehicle, requestExitVehicle, seatDriver } from './enter-exit.ts';
import type { VehicleStore } from './components.ts';
import type { VehiclePhysics } from '../physics/backend.ts';

/** What the vehicle module hands the QA commands: set on `EngineServices.vehicleCtx` by `registerVehicleModule`. */
export interface VehicleDebugContext {
  backend: VehiclePhysics;
  store: VehicleStore;
  prefabs: PrefabRegistry;
}

type Reply = (name: string, data: unknown) => void;

/** The vehicle (dense id) nearest to the local player, or 0 when there is none. */
function nearestVehicle(ecs: EcsWorld, player: number): number {
  const ids = ecs.query([Vehicle, Transform]);
  const tr = ecs.store(Transform);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as number;
    const dx = (tr.px[id] as number) - (tr.px[player] as number);
    const dz = (tr.pz[id] as number) - (tr.pz[player] as number);
    const d = dsqrt(dx * dx + dz * dz);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

let serial = 0;

/** Handles `debug.spawn` and `debug.vehicle`; any other command is ignored. */
export function vehicleQa(sim: PhysicsSim, cmd: DebugCommand, reply: Reply): void {
  const core = sim.core;
  const ctx = sim.services.vehicleCtx;
  if (!ctx) return;
  const { backend, store, prefabs } = ctx;
  const ecs = core.ecs;

  if (cmd.t === 'debug.spawn') {
    try {
      const isVehicle = prefabs.has(cmd.prefab) && prefabs.def(cmd.prefab).vehicle !== undefined;
      const key = isVehicle ? (`veh:qa${serial++}` as StableKey) : undefined;
      const handle = prefabs.spawn(cmd.prefab, { pos: cmd.at, yaw: cmd.yaw ?? 0 }, key);
      reply(`spawn.reply.${cmd.id}`, { ok: true, handle, key: key ?? null });
    } catch (e) {
      reply(`spawn.reply.${cmd.id}`, { ok: false, reason: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (cmd.t === 'debug.vehicle') {
    const out = (data: unknown): void => reply(`vehicle.reply.${cmd.id}`, data);
    const players = ecs.query([LocalPlayer, Control, Transform]);
    if (players.length === 0) {
      out({ ok: false, reason: 'no local player' });
      return;
    }
    const pid = players[0] as number;
    const playerHandle = ecs.handle(pid as EntityId);
    const targetId = cmd.target !== undefined ? (ecs.resolve(cmd.target as EntityHandle) ?? 0) : nearestVehicle(ecs, pid);
    const targetHandle = targetId !== 0 ? ecs.handle(targetId as EntityId) : (0 as EntityHandle);
    switch (cmd.op) {
      case 'enter': {
        const r = requestEnterVehicle(ecs, backend, store, playerHandle, targetHandle);
        out(r.ok ? { ok: true } : { ok: false, reason: r.reason });
        break;
      }
      case 'seat':
        out({ ok: seatDriver(ecs, backend, store, core.services, playerHandle, targetHandle, core.tick) });
        break;
      case 'exit': {
        const co = ecs.store(Control);
        const vid = co.target[pid] as number;
        const r = requestExitVehicle(ecs, store, playerHandle);
        out(r.ok ? { ok: true, vehicle: vid } : { ok: false, reason: r.reason });
        break;
      }
      case 'lock':
      case 'unlock': {
        const rt = store.rt.get(targetId);
        if (rt) rt.locked = cmd.op === 'lock';
        out({ ok: rt !== undefined });
        break;
      }
      case 'state': {
        const co = ecs.store(Control);
        const owner = co.owner[pid] as number;
        const vid = owner === CONTROL_OWNER.Vehicle ? (co.target[pid] as number) : targetId;
        const rt = store.rt.get(vid);
        const veh = ecs.store(Vehicle);
        const dm = ecs.store(VehicleDamage);
        const tr = ecs.store(Transform);
        out({
          ok: true,
          player: { owner, state: co.state[pid], phase: phaseOf(co.pending[pid] as number) as number, driving: phaseOf(co.pending[pid] as number) === CONTROL_PHASE.Active && owner === CONTROL_OWNER.Vehicle },
          vehicle: vid === 0 ? null : {
            handle: ecs.handle(vid as EntityId), speed: veh.speed[vid], gear: veh.gear[vid], rpm: veh.rpm[vid], body: dm.body[vid], engine: dm.engine[vid],
            pos: [tr.px[vid], tr.py[vid], tr.pz[vid]], handling: rt?.profile.id ?? null, locked: rt?.locked ?? false, driver: rt?.driver ?? 0,
          },
          camera: core.services.camera.reason,
        });
        break;
      }
    }
  }
}
