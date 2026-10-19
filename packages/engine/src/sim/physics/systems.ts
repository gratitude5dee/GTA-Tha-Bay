import { SIM_DT, SimStage, type StableKey, type SystemDef } from '@dv/shared';
import { BodyRef, CharacterBody, LocalPlayer, Transform, Velocity } from '../ecs/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import type { SimResource } from '../services.ts';
import type { SimCore } from '../loop/sim-core.ts';
import type { PhysicsSystemsBackend, Vec3 } from './backend.ts';
import { PHYSICS_CONFIG } from './config.ts';
import { needsRebase, snapOrigin } from './origin.ts';

export interface PhysicsSystemOptions {
  /** The entity the floating origin follows. Default: the entity tagged LocalPlayer. */
  followKey?: StableKey;
  /** Horizontal distance that triggers a rebase. Default: config/physics.json. */
  rebaseDistanceM?: number;
  /** 2 when any player vehicle is faster than 100 km/h (M03a1 supplies it). Default: always 1. */
  substeps?: () => 1 | 2;
}

export const PHYSICS_PRE_ID = 'engine.physics.pre';
export const PHYSICS_STEP_ID = 'engine.physics.step';
export const PHYSICS_POST_ID = 'engine.physics.post';

/**
 * The three physics systems (C02 stages 4 to 6).
 *  - PhysicsPre: automatic rebase when the followed entity is too far from the origin, then the ECS `Transform` of
 *    every kinematic body becomes its next target.
 *  - PhysicsStep: `backend.step(SIM_DT, substeps)`.
 *  - PhysicsPost: dynamic bodies write position (f64), rotation and both velocities back to the ECS.
 */
export function physicsSystems(backend: PhysicsSystemsBackend, opts: PhysicsSystemOptions = {}): SystemDef[] {
  const limit = opts.rebaseDistanceM ?? PHYSICS_CONFIG.rebaseDistanceM;
  const out = new Float64Array(13);
  const pos: Vec3 = [0, 0, 0];

  const pre: SystemDef = {
    id: PHYSICS_PRE_ID, owner: 'S01', stage: SimStage.PhysicsPre, order: 0,
    run: ({ ecs }) => {
      const tr = ecs.store(Transform);
      let follow: number | null = null;
      if (opts.followKey) follow = ecs.resolve(ecs.byKey(opts.followKey));
      else {
        const list = ecs.query([LocalPlayer, Transform]);
        if (list.length > 0) follow = list[0] as number;
      }
      if (follow !== null) {
        pos[0] = tr.px[follow] as number;
        pos[1] = tr.py[follow] as number;
        pos[2] = tr.pz[follow] as number;
        if (needsRebase(pos, backend.origin, limit)) backend.rebase(snapOrigin(pos, backend.origin));
      }
      const bodies = ecs.store(BodyRef).body;
      const ids = ecs.query([BodyRef, Transform]);
      const world = ecs as unknown as EcsWorld; // SimCore always runs systems against an EcsWorld
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        const body = bodies[id] as number;
        if (backend.bodyKind(body) !== 'kinematic') continue;
        // A character's Transform is its feet; the on-foot controller sets the body's target itself.
        if (world.hasId(id, CharacterBody)) continue;
        backend.setKinematicTarget(
          body,
          [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number],
          [tr.qx[id] as number, tr.qy[id] as number, tr.qz[id] as number, tr.qw[id] as number],
        );
      }
    },
  };

  const step: SystemDef = {
    id: PHYSICS_STEP_ID, owner: 'S01', stage: SimStage.PhysicsStep, order: 0,
    run: () => backend.step(SIM_DT, opts.substeps ? opts.substeps() : 1),
  };

  const post: SystemDef = {
    id: PHYSICS_POST_ID, owner: 'S01', stage: SimStage.PhysicsPost, order: 0,
    run: ({ ecs }) => {
      const tr = ecs.store(Transform);
      const ve = ecs.store(Velocity);
      const bodies = ecs.store(BodyRef).body;
      const ids = ecs.query([BodyRef, Transform]);
      const world = ecs as unknown as EcsWorld; // SimCore always runs systems against an EcsWorld
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        const body = bodies[id] as number;
        if (backend.bodyKind(body) !== 'dynamic') continue;
        backend.readBody(body, out);
        tr.px[id] = out[0] as number;
        tr.py[id] = out[1] as number;
        tr.pz[id] = out[2] as number;
        tr.qx[id] = out[3] as number;
        tr.qy[id] = out[4] as number;
        tr.qz[id] = out[5] as number;
        tr.qw[id] = out[6] as number;
        if (world.hasId(id, Velocity)) {
          ve.vx[id] = out[7] as number;
          ve.vy[id] = out[8] as number;
          ve.vz[id] = out[9] as number;
          ve.wx[id] = out[10] as number;
          ve.wy[id] = out[11] as number;
          ve.wz[id] = out[12] as number;
        }
      }
    },
  };

  return [pre, step, post];
}

export function registerPhysicsSystems(core: SimCore, backend: PhysicsSystemsBackend, opts: PhysicsSystemOptions = {}): void {
  for (const def of physicsSystems(backend, opts)) core.addSystem(def);
  core.addResource(physicsResource(backend));
}

/**
 * The backend as a hashed, checkpointed resource (C02 rule 7). The hash covers the origin and counters; body
 * transforms are already in the hashed Transform and Velocity stores. The checkpoint carries Rapier's own snapshot.
 */
export function physicsResource(backend: PhysicsSystemsBackend): SimResource {
  return {
    name: 'physics',
    hash(h) {
      h.f64(backend.origin[0]).f64(backend.origin[1]).f64(backend.origin[2]);
      h.u32(backend.bodyCount);
    },
    save(w) {
      const bytes = backend.snapshot();
      w.u32(bytes.length);
      w.bytes(bytes);
    },
    load(r) {
      const n = r.u32();
      backend.restore(r.bytes(n));
    },
  };
}
