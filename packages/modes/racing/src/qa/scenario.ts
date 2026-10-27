/**
 * Suite `racing` of the canonical runner (M07a1; 13-qa.md 3.1): a race on the real streets' ground, headless. QA builds and
 * Node only (the identifiers `registerScenarioLoader` and `CanonicalRunner` must not reach a production chunk).
 *
 * `RunSpec.scenario` is the `RaceId`; `bot.params.vehicle` the player's car (default the supercar). The ground is the route
 * corridor of the race (`corridor.bin`, BD-M07a1-04) handed over as `ScenarioEnv.packs.corridor`: height grids only, so the run is
 * the same in Node and in WebKit. The race itself is the real `RaceSession`; nothing here decides a rule.
 */
import {
  ENGINE_PREFABS, PrefabRegistry, RACE_CAR_PREFABS, civicGrayboxConfig, createPhysicsSim, fixtureStaticsResource, fixtureStaticsSystem,
  FixtureStaticsQueue, registerControlSystems, registerVehicleModule,
  type EngineServices, type FixtureChunk,
} from '@dv/engine/sim';
import { registerScenarioLoader, type LoadedScenario, type ScenarioEnv } from '@dv/engine/qa';
import type { RunSpec } from '@dv/engine/qa';
import { dhypot, routePoint, SimStage, SIM_DT, type InputFrame, type RaceDef } from '@dv/shared';
import { RACING_CONFIG } from '../config.ts';
import { LOANER_CAR, raceCar } from '../cars.ts';
import { RACING_COMPONENTS } from '../components.ts';
import { PUPPET_PREFABS } from '../prefabs.ts';
import { raceDef } from '../races.ts';
import { rivalSpecs } from '../sim/rivals.ts';
import { createEnginePort } from '../sim/engine-port.ts';
import { RaceSession } from '../sim/session.ts';
import { decodeCorridor, type Corridor } from './corridor.ts';

export const RACING_SUITE = 'racing';
export const DEFAULT_CAR = 'vehicle.aurelian-sorrel';

const NEUTRAL: InputFrame = { tick: 0, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0, device: 7 };

/** The corridor's chunks as statics, nearest to the grid first (a fixed order keeps the tick each chunk appears on). */
export function corridorChunks(c: Corridor, nearX: number, nearZ: number): FixtureChunk[] {
  const out: FixtureChunk[] = c.chunks.map((k) => {
    const heights = new Float32Array(k.dm.length);
    for (let i = 0; i < heights.length; i++) heights[i] = (k.dm[i] as number) * 0.1;
    const edge = k.cellM * 64;
    return {
      key: k.key,
      shapes: { heightfield: { nx: 65, nz: 65, cell: k.cellM, heights, at: [k.originX, 0, k.originZ] }, prisms: k.decks },
      cx: k.originX + edge / 2,
      cz: k.originZ + edge / 2,
    };
  });
  out.sort((a, b) => {
    const da = dhypot(a.cx - nearX, a.cz - nearZ);
    const db = dhypot(b.cx - nearX, b.cz - nearZ);
    return da !== db ? da - db : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return out;
}

export interface RacingObservation {
  phase: string;
  tick: number;
  s: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  gate: number;
  outcome: string | null;
}

async function loadRacing(spec: RunSpec, env: ScenarioEnv): Promise<LoadedScenario & { session: RaceSession; def: RaceDef; events: { t: string; tick: number; n?: number | undefined; s?: string | undefined }[] }> {
  const def = raceDef(spec.scenario);
  if (!def) throw new Error(`suite 'racing' has no race '${spec.scenario}'`);
  const params = (spec.bot.params ?? {}) as Record<string, unknown>;
  const vehicle = typeof params['vehicle'] === 'string' ? params['vehicle'] : DEFAULT_CAR;
  const car = raceCar(vehicle) ?? raceCar(LOANER_CAR);
  if (!car) throw new Error(`suite 'racing': unknown vehicle ${vehicle}`);
  const bytes = env.packs['corridor'];
  if (!bytes) throw new Error("suite 'racing' needs the corridor bytes (ScenarioEnv.packs.corridor)");
  const corridor = await decodeCorridor(bytes);
  if (corridor.bakeId !== def.worldBake) throw new Error(`corridor.bin is for bake ${corridor.bakeId.slice(0, 12)}, race.json for ${def.worldBake.slice(0, 12)}`);

  const g0 = def.grid[0];
  const gp = routePoint(def, g0 ? g0.s : 0);
  const holder: { session: RaceSession | null; services: EngineServices | null } = { session: null, services: null };
  const events: { t: string; tick: number; n?: number | undefined; s?: string | undefined }[] = [];
  const cfg = { ...civicGrayboxConfig('canonical'), seed: spec.seed, worldBake: def.worldBake };
  const sim = await createPhysicsSim(
    cfg,
    {
      id: `racing:${def.id}`,
      setup: (s) => {
        const { ecs, backend, core, services } = s;
        holder.services = services;
        registerControlSystems(core, backend);
        const queue = new FixtureStaticsQueue(corridorChunks(corridor, gp.x, gp.z));
        core.addSystem(fixtureStaticsSystem(backend, queue, services.events));
        core.addResource(fixtureStaticsResource(queue));
        const prefabs = new PrefabRegistry(ecs, backend);
        prefabs.load(ENGINE_PREFABS);
        const mod = registerVehicleModule(core, backend, prefabs);
        prefabs.load(RACE_CAR_PREFABS);
        // the rivals are puppets; a race without opponents loads none, so its string table (and its golden) is what M07a1 recorded
        if (def.opponents.length > 0) prefabs.load(PUPPET_PREFABS);
        prefabs.spawn('player.default', { pos: [gp.x, gp.y + 3, gp.z], yaw: 0 }, 'player:0');
        const port = createEnginePort({ ecs, backend, services, store: mod.store, prefabs, tick: () => core.tick });
        const session = new RaceSession({
          def,
          cfg: RACING_CONFIG as never,
          profile: car.profile,
          vehicleDef: car.vehicleDef,
          port,
          sinks: { event: (e) => events.push({ t: e.t, tick: e.tick, n: e.n, s: e.s }), hud: () => undefined },
          telemetry: { emit: () => undefined },
          seed: spec.seed,
          simProfile: 'canonical',
          rivals: rivalSpecs(def, 'normal'),
          ...(typeof params['ghost'] === 'object' && params['ghost'] !== null ? { ghost: params['ghost'] as never } : {}),
          buildId: 'qa',
          vehiclePriceCents: car.priceCents,
          ...(typeof params['noRivals'] === 'boolean' && params['noRivals'] ? { rivals: [] } : {}),
        });
        holder.session = session;
        core.addResource({ name: 'racing.session', hash: (h) => session.hashInto(h), save() {}, load() {} });
        core.addSystem({
          id: 'racing.scenario.session', owner: 'S06', stage: SimStage.Script, order: 100,
          run: ({ tick }) => session.step(services.input ?? NEUTRAL, tick),
        });
        backend.step(SIM_DT, 1);
      },
    },
    { ecs: { components: RACING_COMPONENTS }, ...(env.retry ? { backend: { retry: env.retry } } : {}) },
  );
  const session = holder.session as RaceSession;
  const observe = (): Readonly<Record<string, unknown>> => {
    const st = session.state();
    const car2 = st.car;
    const o: RacingObservation = {
      phase: st.phase, tick: st.tick, s: st.s, x: car2 ? car2.pos[0] : 0, z: car2 ? car2.pos[2] : 0, yaw: car2 ? car2.yaw : 0,
      speed: car2 ? car2.speedMps : 0, gate: st.gate, outcome: st.outcome,
    };
    return o as unknown as Record<string, unknown>;
  };
  return { sim, observe, session, def, events };
}

let registered = false;

/** Registers the `racing` suite loader once. */
export function ensureRacingLoader(): void {
  if (registered) return;
  registerScenarioLoader(RACING_SUITE, loadRacing);
  registered = true;
}
