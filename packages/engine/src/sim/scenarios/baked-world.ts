/**
 * Scenario `baked-world` (M02b1): the player standing at the spawn point of a baked world (the `synth` or `sf` bake), waiting for
 * ground. The scenario adds no colliders: the world streaming module (`@dv/world`, applied through `SimModule`, DL-651) adds each
 * chunk's statics as the `p0` packs arrive, nearest to the player first, and the ownership machine releases the player when a
 * collider is under the spawn (control 700, 701), exactly as in `civic-graybox`.
 *
 * `BootPayload.config.spawn` is `[x, y, z]` (feet, ENU metres) and `BootPayload.config.spawnYaw` the heading in radians. The page
 * derives both from the world index (an `arrival` pose) and the ground height of the spawn chunk (`bootSet` in `@dv/world`).
 */
import { SIM_DT, type SimConfig, type SimProfile } from '@dv/shared';
import { registerControlSystems } from '../control/index.ts';
import { CONTROL_OWNER, CONTROL_PHASE, CONTROL_STATE, packPending } from '../control/states.ts';
import { ENGINE_PREFABS, PrefabRegistry } from '../prefabs/registry.ts';
import type { PhysicsScenario, ScenarioSetup } from '../sim-factory.ts';
import { physicsDropConfig } from './physics-drop.ts';

export const BAKED_WORLD = {
  id: 'baked-world',
  seed: 0x6a2b0c,
} as const;

/** `worldBake` is the 64-hex bake id of the world (C05), or the scenario id when the page passes none. */
export function bakedWorldConfig(profile: SimProfile = 'local', hashEvery = 0, bakeId: string = BAKED_WORLD.id): SimConfig {
  return { ...physicsDropConfig(profile, hashEvery), seed: BAKED_WORLD.seed, worldBake: bakeId };
}

function triple(v: unknown): [number, number, number] | null {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0] as number, v[1] as number, v[2] as number] : null;
}

export function setupBakedWorld(s: ScenarioSetup): void {
  const { ecs, backend, core, services } = s;
  const spawn = triple(s.boot['spawn']);
  if (!spawn) throw new Error('baked-world needs BootPayload.config.spawn ([x, y, z])');
  const yaw = typeof s.boot['spawnYaw'] === 'number' ? (s.boot['spawnYaw'] as number) : 0;

  registerControlSystems(core, backend);
  const prefabs = new PrefabRegistry(ecs, backend);
  prefabs.load(ENGINE_PREFABS);
  prefabs.spawn('player.default', { pos: [...spawn], yaw }, 'player:0', {
    'Control.state': CONTROL_STATE.teleportPending,
    'Control.pending': packPending(CONTROL_PHASE.Waiting, CONTROL_OWNER.OnFoot),
    'Control.sinceTick': 0,
  });
  services.control.teleportActive = true;
  services.control.teleportX = spawn[0];
  services.control.teleportY = spawn[1];
  services.control.teleportZ = spawn[2];
  backend.step(SIM_DT, 1);
}

export const bakedWorldScenario: PhysicsScenario = {
  id: BAKED_WORLD.id,
  setup: (s) => setupBakedWorld(s),
};
