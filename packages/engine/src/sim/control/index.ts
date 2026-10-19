import type { SimCore } from '../loop/sim-core.ts';
import type { PhysicsSystemsBackend } from '../physics/backend.ts';
import { cameraCollisionSystem } from '../camera/collision.ts';
import { controlResource } from '../services.ts';
import { onFootSystem } from './onfoot.ts';
import { ownershipSystem } from './ownership.ts';

export * from './onfoot.ts';
export * from './ownership.ts';
export * from './states.ts';

/**
 * Registers the on-foot controller, the ownership machine and the camera collision system, and the `control` resource
 * (ownership shared state and the camera lock) that is hashed and checkpointed with them. Scenarios that spawn a
 * player call this after `registerPhysicsSystems`; physics-only scenarios do not, so their hashes stay as they were.
 */
export function registerControlSystems(core: SimCore, backend: PhysicsSystemsBackend): void {
  core.addSystem(ownershipSystem({ backend, services: core.services }));
  core.addSystem(onFootSystem({ backend, services: core.services }));
  core.addSystem(cameraCollisionSystem(backend, core.services));
  core.addResource(controlResource(core.services));
}
