import type { SimCore } from '../loop/sim-core.ts';
import type { PhysicsSystemsBackend } from '../physics/backend.ts';
import { cameraCollisionSystem } from '../camera/collision.ts';
import { controlResource } from '../services.ts';
import { fallRecoverySystem } from './fall.ts';
import { onFootSystem } from './onfoot.ts';
import { ownershipSystem } from './ownership.ts';
import { swimSystem } from './swim.ts';
import { VaultStore, vaultResource } from './vault.ts';

export * from './fall.ts';
export * from './latch.ts';
export * from './onfoot.ts';
export * from './ownership.ts';
export * from './swim.ts';
export * from './states.ts';
export * from './vault.ts';

/**
 * Registers the on-foot controller, the ownership machine and the camera collision system, and the `control` resource
 * (ownership shared state and the camera lock) that is hashed and checkpointed with them. Scenarios that spawn a
 * player call this after `registerPhysicsSystems`; physics-only scenarios do not, so their hashes stay as they were.
 */
export function registerControlSystems(core: SimCore, backend: PhysicsSystemsBackend, opts: { vault?: boolean } = {}): void {
  const vault = opts.vault === false ? undefined : new VaultStore();
  core.addSystem(swimSystem({ services: core.services }));
  core.addSystem(fallRecoverySystem({ services: core.services }));
  core.addSystem(ownershipSystem({ backend, services: core.services }));
  core.addSystem(onFootSystem({ backend, services: core.services, ...(vault ? { vault } : {}) }));
  core.addSystem(cameraCollisionSystem(backend, core.services));
  core.addResource(controlResource(core.services));
  if (vault) core.addResource(vaultResource(vault));
}
