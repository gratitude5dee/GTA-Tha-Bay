/**
 * Scenario `civic-graybox` (M01b2): the S02 gray-box Civic Center block (M01f fixture: four 256 m chunks around City Hall,
 * a 2 % slope north, 12 boxes, a four-way road) with `player.default` standing at the fixture's spawn node. The page fetches
 * the `p0` pack and hands the bytes to the worker in `BootPayload.config.packs.p0`; the sim decodes it and adds one chunk's
 * colliders per tick, nearest to the spawn first. The player waits for ground (control 700, 701) until the first chunk is in.
 *
 * The page draws the terrain, roads and buildings itself from the `l0` pack (`client/graybox`), so the scenario spawns no
 * render entities besides the player.
 */
import { SIM_DT, type SimConfig, type SimProfile } from '@dv/shared';
import { registerControlSystems } from '../control/index.ts';
import { CONTROL_OWNER, CONTROL_PHASE, CONTROL_STATE, packPending } from '../control/states.ts';
import { ENGINE_PREFABS, PrefabRegistry } from '../prefabs/registry.ts';
import type { PhysicsScenario, ScenarioSetup } from '../sim-factory.ts';
import { fixtureChunksFromP0, fixtureStaticsResource, fixtureStaticsSystem, FixtureStaticsQueue } from '../world/fixture-statics.ts';
import { physicsDropConfig } from './physics-drop.ts';

export const CIVIC_GRAYBOX = {
  id: 'civic-graybox',
  seed: 0x6a2b0b,
  /** `tp.graybox.spawn` of the fixture (README of tests/fixtures/world/civic-graybox): ENU metres, feet. */
  spawn: [89, 16.4, 60] as [number, number, number],
  /** Facing the four-way junction at (100, 100): forward is (-sin yaw, -cos yaw), so the heading to (11, 40) is this. */
  spawnYaw: -2.87,
} as const;

export function civicGrayboxConfig(profile: SimProfile = 'local', hashEvery = 0): SimConfig {
  return { ...physicsDropConfig(profile, hashEvery), seed: CIVIC_GRAYBOX.seed, worldBake: CIVIC_GRAYBOX.id };
}

/** The pack bytes in a boot payload: an ArrayBuffer, or a Uint8Array view of one. */
export function packBytes(boot: Readonly<Record<string, unknown>>, family: 'p0' | 'l0'): Uint8Array | null {
  const packs = boot['packs'] as Record<string, unknown> | undefined;
  const v = packs?.[family];
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return null;
}

export function setupCivicGraybox(s: ScenarioSetup, p0?: Uint8Array): void {
  const { ecs, backend, core, services } = s;
  const bytes = p0 ?? packBytes(s.boot, 'p0');
  if (!bytes) throw new Error('civic-graybox needs BootPayload.config.packs.p0 (the p0 world pack)');
  const spawn = CIVIC_GRAYBOX.spawn;

  registerControlSystems(core, backend);
  const queue = new FixtureStaticsQueue(fixtureChunksFromP0(bytes, spawn[0], spawn[2]));
  core.addSystem(fixtureStaticsSystem(backend, queue, services.events));
  core.addResource(fixtureStaticsResource(queue));

  // The player starts in the teleport wait (700): the ownership machine moves it to the ground once a collider is under it.
  const prefabs = new PrefabRegistry(ecs, backend);
  prefabs.load(ENGINE_PREFABS);
  prefabs.spawn('player.default', { pos: [...spawn], yaw: CIVIC_GRAYBOX.spawnYaw }, 'player:0', {
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

export const civicGrayboxScenario: PhysicsScenario = {
  id: CIVIC_GRAYBOX.id,
  setup: (s) => setupCivicGraybox(s),
};
