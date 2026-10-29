import { datan2, dcos, dsin, SimStage, TWO_PI, type EntityId, type SystemDef } from '@dv/shared';
import { Control, PlayerControlled, Transform, Velocity } from '../ecs/components.ts';
import { PHYSICS_CONFIG, type CharacterConfig } from '../physics/config.ts';
import type { EngineServices } from '../services.ts';
import { armMoveLatch, noteWaterRespawn } from './latch.ts';
import { requestTeleport } from './ownership.ts';
import { CONTROL_OWNER, CONTROL_PHASE, CONTROL_STATE, OWNER_NAMES, PHASE_NAMES, packPending, phaseOf } from './states.ts';

export const SWIM_ID = 'engine.control.swim';
/** Ticks a swimmer stays in the water before the respawn starts: 1.5 s (the water wall's stall time). */
export const SWIM_RESPAWN_TICKS = 90;
/** How far inland of the shore node the swimmer is put, metres. */
export const SHORE_INLAND_M = 2;

export interface SwimOptions {
  services: Pick<EngineServices, 'world' | 'control' | 'events'>;
  /** Defaults to the `character` block of config/physics.json; `chestY` is the depth that starts the swim. */
  config?: CharacterConfig;
}

/**
 * The swim owner (M02c1, DL-691; 01-engine.md section 2.4, Control state 800). The on-foot owner hands over to Swim when the
 * water over the capsule is deeper than the chest (`chestY`). There is no swimming locomotion in v1: after
 * `SWIM_RESPAWN_TICKS` the screen fades, the player goes back to the on-foot owner and the ownership machine teleports it to
 * the nearest shore node (`WorldBoundsPort.nearestShore`, pushed `SHORE_INLAND_M` inland), where it fades back in. Without a
 * `WorldBoundsPort` (a session without a baked world) the system does nothing.
 *
 * The fade is the SimEvent `world.teleport` with `s: 'out'` and `s: 'in'` (the page draws it).
 *
 * DL-753 (02-world-maps.md 4.1 a): the respawn turns the player inland, along the shore node's normal away from the water, and arms
 * the movement latch (`latch.ts`), so a stick held through the fade does not walk the player straight back in. When the fade-in starts
 * the respawn is recorded (`noteWaterRespawn`) and the page turns its camera to the same yaw.
 */
export function swimSystem(opts: SwimOptions): SystemDef {
  const cfg = opts.config ?? PHYSICS_CONFIG.character;
  let fadingIn = false;
  let inlandYaw = 0;
  return {
    id: SWIM_ID, owner: 'S01', stage: SimStage.Control, order: -10,
    run: ({ ecs, tick }) => {
      const services = opts.services;
      const bounds = services.world.bounds;
      if (!bounds) return;
      const ids = ecs.query([Control, Transform, PlayerControlled]);
      if (ids.length === 0) return;
      const co = ecs.store(Control);
      const tr = ecs.store(Transform);
      const ve = ecs.store(Velocity);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        const handle = ecs.handle(id as EntityId);
        const owner = co.owner[id] as number;
        const state = co.state[id] as number;
        const x = tr.px[id] as number;
        const z = tr.pz[id] as number;

        if (owner === CONTROL_OWNER.OnFoot && phaseOf(co.pending[id] as number) === CONTROL_PHASE.Ready) {
          if (fadingIn && !services.control.teleportActive && state === CONTROL_STATE.idle) {
            fadingIn = false;
            noteWaterRespawn(services.control, inlandYaw);
            services.events.push({ t: 'world.teleport', tick, a: handle, s: 'in' });
          }
          if (state === CONTROL_STATE.teleportPending || state === CONTROL_STATE.teleportWaiting) continue;
          if (bounds.waterDepth(x, z) > cfg.chestY) {
            co.owner[id] = CONTROL_OWNER.Swim;
            co.state[id] = CONTROL_STATE.swim;
            co.sinceTick[id] = tick;
            co.pending[id] = packPending(CONTROL_PHASE.Active, CONTROL_OWNER.None);
            ve.vx[id] = 0;
            ve.vy[id] = 0;
            ve.vz[id] = 0;
            services.events.push({ t: 'control.transition', tick, a: handle, n: CONTROL_STATE.swim, s: `${OWNER_NAMES[CONTROL_OWNER.Swim]} ${PHASE_NAMES[CONTROL_PHASE.Ready]}>${PHASE_NAMES[CONTROL_PHASE.Active]} deep water` });
          }
          continue;
        }

        if (owner !== CONTROL_OWNER.Swim) continue;
        if (tick - (co.sinceTick[id] as number) < SWIM_RESPAWN_TICKS) continue;
        const shore = bounds.nearestShore(x, z, false);
        if (!shore) continue;   // nowhere to go yet: keep trying
        // back to the base owner, then the ordinary teleport machine does the move (it waits for ground under the shore node)
        co.owner[id] = CONTROL_OWNER.OnFoot;
        co.state[id] = CONTROL_STATE.idle;
        co.sinceTick[id] = tick;
        co.pending[id] = packPending(CONTROL_PHASE.Ready, CONTROL_OWNER.None);
        services.events.push({ t: 'world.teleport', tick, a: handle, s: 'out' });
        const r = requestTeleport(ecs, services, handle, [shore.x - shore.nx * SHORE_INLAND_M, shore.y, shore.z - shore.nz * SHORE_INLAND_M], tick);
        if (r.ok) {
          fadingIn = true;
          // facing inland: forward (-sin yaw, -cos yaw) is minus the normal, which points to the water
          const yaw = datan2(shore.nx, shore.nz);
          inlandYaw = yaw < 0 ? yaw + TWO_PI : yaw;
          tr.qx[id] = 0;
          tr.qy[id] = dsin(inlandYaw / 2);
          tr.qz[id] = 0;
          tr.qw[id] = dcos(inlandYaw / 2);
          armMoveLatch(services.control);
        } else {
          services.events.push({ t: 'control.refused', tick, a: handle, s: r.reason });
          services.events.push({ t: 'world.teleport', tick, a: handle, s: 'in' });
        }
      }
    },
  };
}
