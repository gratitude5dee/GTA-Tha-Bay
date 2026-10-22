/**
 * Scenario loaders of the canonical runner (M04d; 13-qa.md 3.1). A loader turns a `RunSpec` into a booted physics sim. Loaders
 * are registered by `suite`; the mode owners add theirs (missions M05a2, racing M07a1, fighter M08a1, tycoon M09a2).
 *
 * Suite `engine`, scenario `walk-drive`: the gray-box Civic Center block (M01f fixture) with the default sedan at the junction
 * and the player at its wheel, so the M03a1 input line `walk-drive.line.json` runs headless. The statics are decoded from the
 * committed fixture bytes `tests/fixtures/world/civic-graybox/p0-64-64.pack`, checked against `hashes.json`. Node reads the
 * file; the determinism page receives the same bytes through a Vite `?url` import. Neither path touches the asset catalog, so a
 * `DV_WORLD=synth` build, whose catalog swaps that pack for a synth tile, leaves the trace unchanged (DL-699).
 */
import { sha256Hex, SIM_DT } from '@dv/shared';
import { registerControlSystems } from '../sim/control/index.ts';
import { ENGINE_PREFABS, PrefabRegistry } from '../sim/prefabs/registry.ts';
import type { RetryEnv } from '../sim/physics/rapier-backend.ts';
import { civicGrayboxConfig } from '../sim/scenarios/civic-graybox.ts';
import { createPhysicsSim, type PhysicsSim } from '../sim/sim-factory.ts';
import { registerVehicleModule, seatDriver } from '../sim/vehicle/index.ts';
import { fixtureChunksFromP0, fixtureStaticsResource, fixtureStaticsSystem, FixtureStaticsQueue } from '../sim/world/fixture-statics.ts';
import type { EntityHandle } from '@dv/shared';
import type { RunSpec } from './runner.ts';

export interface ScenarioEnv {
  /** Fixture pack bytes by family (`p0`), already checked against `hashes.json`. */
  packs: Readonly<Record<string, Uint8Array>>;
  retry?: Partial<RetryEnv>;
  /** A loader hands the host its own handle (the story loader: the mission controller and the timeline) once the sim is built. Optional; tools only. */
  onLoaded?(handle: unknown): void;
}

export interface LoadedScenario {
  sim: PhysicsSim;
  /** Facts a bot may read (tick excluded; the runner adds it). */
  observe(): Readonly<Record<string, unknown>>;
}

export type ScenarioLoader = (spec: RunSpec, env: ScenarioEnv) => Promise<LoadedScenario>;

const loaders = new Map<string, ScenarioLoader>();

export function registerScenarioLoader(suite: string, loader: ScenarioLoader): void {
  if (loaders.has(suite)) throw new Error(`scenario loader for suite '${suite}' is already registered`);
  loaders.set(suite, loader);
}

export function getScenarioLoader(suite: string): ScenarioLoader {
  const l = loaders.get(suite);
  if (!l) throw new Error(`no scenario loader for suite '${suite}'; registered: ${[...loaders.keys()].sort().join(', ') || '(none)'}`);
  return l;
}

export function unregisterScenarioLoader(suite: string): void {
  loaders.delete(suite);
}

/** Throws unless `bytes` hash to the entry `name` of the fixture's `hashes.json`. */
export function verifyFixturePack(name: string, bytes: Uint8Array, hashes: Readonly<Record<string, string>>): void {
  const want = hashes[name];
  if (!want) throw new Error(`fixture pack '${name}' is not listed in hashes.json`);
  const got = sha256Hex(bytes);
  if (got !== want) throw new Error(`fixture pack '${name}' hash ${got} differs from hashes.json (${want})`);
}

/** Where the sedan stands and which way it faces: the street next to the fixture spawn, heading north (M03a1 e2e). */
export const WALK_DRIVE = { id: 'walk-drive', pos: [96, 15.9, 92] as [number, number, number], yaw: 0, nearSpawn: [89, 60] as [number, number] } as const;

async function loadWalkDrive(spec: RunSpec, env: ScenarioEnv): Promise<LoadedScenario> {
  const p0 = env.packs['p0'];
  if (!p0) throw new Error("scenario 'walk-drive' needs the fixture pack 'p0'");
  const holder: { vehicle: EntityHandle; player: EntityHandle; mod: ReturnType<typeof registerVehicleModule> | null } = {
    vehicle: 0 as EntityHandle, player: 0 as EntityHandle, mod: null,
  };
  const cfg = { ...civicGrayboxConfig('canonical'), seed: spec.seed, worldBake: WALK_DRIVE.id };
  const sim = await createPhysicsSim(
    cfg,
    {
      id: WALK_DRIVE.id,
      setup: (s) => {
        const { ecs, backend, core, services } = s;
        registerControlSystems(core, backend);
        const queue = new FixtureStaticsQueue(fixtureChunksFromP0(p0, WALK_DRIVE.nearSpawn[0], WALK_DRIVE.nearSpawn[1]));
        core.addSystem(fixtureStaticsSystem(backend, queue, services.events));
        core.addResource(fixtureStaticsResource(queue));
        const prefabs = new PrefabRegistry(ecs, backend);
        prefabs.load(ENGINE_PREFABS);
        holder.mod = registerVehicleModule(core, backend, prefabs);
        const [x, y, z] = WALK_DRIVE.pos;
        holder.player = prefabs.spawn('player.default', { pos: [x, y, z + 3], yaw: WALK_DRIVE.yaw }, 'player:0');
        holder.vehicle = prefabs.spawn('vehicle.sedan', { pos: [x, y, z], yaw: WALK_DRIVE.yaw }, 'veh:qa0');
        backend.step(SIM_DT, 1);
      },
    },
    {
      ...(env.retry ? { backend: { retry: env.retry } } : {}),
      onReady: (s) => {
        const mod = holder.mod;
        if (!mod) throw new Error('vehicle module missing');
        const ok = seatDriver(s.ecs, s.backend, mod.store, s.services, holder.player, holder.vehicle, s.core.tick);
        if (!ok) throw new Error("scenario 'walk-drive': could not seat the driver");
      },
    },
  );
  return { sim, observe: () => ({ scenario: WALK_DRIVE.id }) };
}

let engineLoaderRegistered = false;

/** Registers the `engine` suite loader once. The runner calls this, so no caller needs to. */
export function ensureEngineLoader(): void {
  if (engineLoaderRegistered || loaders.has('engine')) {
    engineLoaderRegistered = true;
    return;
  }
  registerScenarioLoader('engine', (spec, env) => {
    if (spec.scenario === WALK_DRIVE.id) return loadWalkDrive(spec, env);
    return Promise.reject(new Error(`suite 'engine' has no scenario '${spec.scenario}'; known: ${WALK_DRIVE.id}`));
  });
  engineLoaderRegistered = true;
}
