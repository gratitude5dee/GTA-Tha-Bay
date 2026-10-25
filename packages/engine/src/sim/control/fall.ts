import { SimStage, type EntityId, type SystemDef } from '@dv/shared';
import boundsJson from '../../../../../config/world.bounds.json';
import { CharacterBody, Control, PlayerControlled, Transform } from '../ecs/components.ts';
import type { EngineServices } from '../services.ts';
import { requestTeleport } from './ownership.ts';
import { CONTROL_OWNER, CONTROL_PHASE, CONTROL_STATE, phaseOf } from './states.ts';

export const FALL_RECOVERY_ID = 'engine.control.fall-recovery';
/** A player has to be in the air this long before it counts as out of the world: 2 s. */
export const FALL_RECOVER_TICKS = 120;
/** Out of the world: this far under the lowest surface at its (x, z) (terrain, slab or hood top), metres. */
export const FALL_BELOW_M = 3;
/** Out of the world wherever the ground is: under the floor of the play box (`config/world.bounds.json` `play.minY`). */
export const FALL_FLOOR_Y = (boundsJson as { play: { minY: number } }).play.minY;
/** How far from the fall the nearest walkable point (the pedestrian graph) is looked for, metres. */
export const FALL_SEARCH_M = 60;
/**
 * With no resident ground at the fall, the teleport aims here and the ownership machine waits for the colliders under it: its probe
 * runs `groundProbeM` (200 m) above and below, so it finds any ground of the city from 350 m down to -50 m.
 */
export const FALL_PROBE_Y = 150;
/** A `groundY` hint far below the city: the surface it returns is the lowest one at that point. */
const LOWEST_HINT = -1e6;

export interface FallRecoveryOptions {
  services: Pick<EngineServices, 'world' | 'control' | 'events'>;
}

/**
 * The out-of-the-world safety net (BD-FIX-SPAWN-02; the specs give the water and the play-bounds walls, 02-world-maps.md 4.1, but
 * nothing for a player that ends up under the ground). An on-foot player that has been in the air for `FALL_RECOVER_TICKS` while it
 * is under the floor of the play box, or more than `FALL_BELOW_M` under the lowest surface of the resident ground at its (x, z), is
 * put back on the nearest valid ground: the nearest walkable point within `FALL_SEARCH_M`, else the top of the ground at its (x, z),
 * else, where nothing is resident yet, the ground the ownership machine finds under it once the colliders arrive. The move is the
 * ordinary teleport of the ownership machine (Control 700, 701), with the swim owner's fade (`world.teleport` out and in), and the
 * SimEvent `control.recover` names why. Without a baked world (`services.world.api` null) the system does nothing, so the gray-box
 * scenes and their hashes are unchanged.
 */
export function fallRecoverySystem(opts: FallRecoveryOptions): SystemDef {
  let fadingIn = false;
  return {
    id: FALL_RECOVERY_ID, owner: 'S01', stage: SimStage.Control, order: -9,
    run: ({ ecs, tick }) => {
      const services = opts.services;
      const api = services.world.api;
      if (!api) return;
      const ids = ecs.query([Control, Transform, PlayerControlled, CharacterBody]);
      if (ids.length === 0) return;
      const co = ecs.store(Control);
      const tr = ecs.store(Transform);
      const cb = ecs.store(CharacterBody);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        if (co.owner[id] !== CONTROL_OWNER.OnFoot || phaseOf(co.pending[id] as number) !== CONTROL_PHASE.Ready) continue;
        const handle = ecs.handle(id as EntityId);
        const state = co.state[id] as number;
        if (fadingIn && !services.control.teleportActive && state === CONTROL_STATE.idle) {
          fadingIn = false;
          services.events.push({ t: 'world.teleport', tick, a: handle, s: 'in' });
        }
        if (state === CONTROL_STATE.teleportPending || state === CONTROL_STATE.teleportWaiting) continue;
        if ((cb.airTicks[id] as number) < FALL_RECOVER_TICKS) continue;
        const x = tr.px[id] as number;
        const y = tr.py[id] as number;
        const z = tr.pz[id] as number;
        const lowest = api.query.groundY(x, z, LOWEST_HINT);
        const why = y < FALL_FLOOR_Y ? 'below-bounds' : lowest !== null && y < lowest - FALL_BELOW_M ? 'below-ground' : null;
        if (why === null) continue;
        const walk = api.query.nearestWalkable(x, z, FALL_SEARCH_M);
        const top = walk ? null : api.query.groundY(x, z);
        const to: [number, number, number] = walk ? [walk.x, walk.y, walk.z] : top !== null ? [x, top, z] : [x, FALL_PROBE_Y, z];
        const r = requestTeleport(ecs, services, handle, to, tick);
        if (!r.ok) continue;
        fadingIn = true;
        services.events.push({ t: 'control.recover', tick, a: handle, s: why });
        services.events.push({ t: 'world.teleport', tick, a: handle, s: 'out' });
      }
    },
  };
}
