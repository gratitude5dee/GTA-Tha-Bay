/**
 * Suite `missions` of the canonical runner (M05a2; 13-qa.md 3.1): one mission on the real story mode, headless. QA builds and Node
 * only: the identifiers `registerScenarioLoader` and `CanonicalRunner` must not reach a production chunk (`@dv/mode-story/qa`).
 *
 * `RunSpec.scenario` is the mission id. The caller hands over, as `ScenarioEnv.packs`, the gray-box fixture pack `p0` (the world
 * the sample mission was authored against) and `mission`: the UTF-8 JSON of a `MissionBundle` (`encodeBundle`), which Node reads
 * from `assets/src/data/mission.<id>` and the browser fetches. A mission whose `worldBake` is not the bake of `p0` fails with
 * `world bake <id> not found: run pnpm map:build -- --area sf`; loading a full SF bake headless arrives with the first SF mission.
 *
 * The sim is the one the game runs for a mission: the gray-box colliders, the control and vehicle systems, the clock, and the
 * modes module (ModeHost, economy, unlocks, zone and thread services, timeline) with the story mode started by `startQa`. Only the
 * input differs: the bot writes player 0's frame. The mission state is hashed into the trace as the resource `story.mission`, so a
 * wrong seed or clock rule shows in the end hash. `ScenarioEnv.onLoaded` gets a `MissionsHandle` for tools that need the timeline
 * or the stuck objective.
 */
import {
  ENGINE_PREFABS, PrefabRegistry, CIVIC_GRAYBOX, FixtureStaticsQueue, civicGrayboxConfig, createModesModule, createPhysicsSim, fixtureChunksFromP0,
  fixtureStaticsResource, fixtureStaticsSystem, installClock, registerControlSystems, registerVehicleModule, CONTROL_OWNER, CONTROL_PHASE, CONTROL_STATE, packPending,
  type ModesModule, type SimModuleContext, type SimRuntime, type PhysicsSim,
} from '@dv/engine/sim';
import { registerScenarioLoader, type LoadedScenario, type RunSpec, type ScenarioEnv } from '@dv/engine/qa';
import { SIM_DT, readHeader, type MissionIR } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import { headlessFighterDescriptor } from '@dv/mode-fighter/qa/headless';
import { createStoryMode, type StoryController } from './mode.ts';
import { observeMission, type MissionObs } from './autoplay/observe.ts';
import { resolveMission } from './compiler/resolve.ts';
import type { RuntimeFlags } from './vm/types.ts';
import type { TimelineRecorderImpl } from '@dv/engine/sim';

export const MISSIONS_SUITE = 'missions';

/** What the host puts in `ScenarioEnv.packs.mission`: the compiled mission, its DirectorScripts and the text of its lines. */
export interface MissionBundle {
  ir: MissionIR;
  directors: DirectorScript[];
  lines: Record<string, string>;
}

export function encodeBundle(b: MissionBundle): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(b));
}

export function decodeBundle(bytes: Uint8Array): MissionBundle {
  const b = JSON.parse(new TextDecoder().decode(bytes)) as MissionBundle;
  if (!b || typeof b !== 'object' || !b.ir || typeof b.ir.id !== 'string') throw new Error("suite 'missions': packs.mission is not a mission bundle");
  return { ir: b.ir, directors: b.directors ?? [], lines: b.lines ?? {} };
}

/** What a tool gets from `ScenarioEnv.onLoaded`. */
export interface MissionsHandle {
  sim: PhysicsSim;
  controller: StoryController;
  modes: ModesModule;
  bundle: MissionBundle;
  timeline: TimelineRecorderImpl;
  /** The observation the bot sees now, or null before the mission runs. */
  mission(): MissionObs | null;
}

const MAX_WARMUP_TICKS = 900;

export function missionFlags(spec: RunSpec): Partial<RuntimeFlags> {
  const f = spec.flags ?? {};
  return {
    hooks: f.hooks ?? 'bot',
    talk: f.talk === 'scripted' ? 'scripted' : 'live',
    beats: f.beats === 'instant' ? 'instant' : 'normal',
  };
}

async function loadMissions(spec: RunSpec, env: ScenarioEnv): Promise<LoadedScenario & MissionsHandle> {
  const p0 = env.packs['p0'];
  if (!p0) throw new Error("suite 'missions' needs the fixture pack 'p0' (ScenarioEnv.packs.p0)");
  const missionBytes = env.packs['mission'];
  if (!missionBytes) throw new Error(`suite 'missions' needs the compiled mission (ScenarioEnv.packs.mission) for ${spec.scenario}`);
  const bundle = decodeBundle(missionBytes);
  if (bundle.ir.id !== spec.scenario) throw new Error(`suite 'missions': scenario ${spec.scenario}, bundle holds ${bundle.ir.id}`);
  const bake = readHeader(p0).bakeId;
  if (bundle.ir.worldBake !== bake) throw new Error(`world bake ${bundle.ir.worldBake} not found: run pnpm map:build -- --area sf`);

  const params = (spec.bot.params ?? {}) as Record<string, unknown>;
  const holder: { controller: StoryController | null } = { controller: null };
  const spawn = CIVIC_GRAYBOX.spawn;
  const cfg = { ...civicGrayboxConfig('canonical'), seed: spec.seed, worldBake: bake };
  const sim = await createPhysicsSim(cfg, {
    id: `missions:${bundle.ir.id}`,
    setup: (s) => {
      const { ecs, backend, core, services } = s;
      registerControlSystems(core, backend);
      const queue = new FixtureStaticsQueue(fixtureChunksFromP0(p0, spawn[0], spawn[2]));
      core.addSystem(fixtureStaticsSystem(backend, queue, services.events));
      core.addResource(fixtureStaticsResource(queue));
      const prefabs = new PrefabRegistry(ecs, backend);
      prefabs.load(ENGINE_PREFABS);
      registerVehicleModule(core, backend, prefabs);
      // the player waits in the teleport state until the first collider is under it (as the gray-box scenario does)
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
    },
  }, env.retry ? { backend: { retry: env.retry } } : {});

  installClock(sim.core);
  // M08a2: the real fighter plays the bout hook (the bot plays slot 0); without it the hook takes its stub path.
  const modes = createModesModule({
    // the loop has no turns for promises, so the sim half answers at once (headless descriptor)
    descriptors: [headlessFighterDescriptor()],
    wrapStory: (free, senv) => {
      const m = createStoryMode(free, senv, { headless: true });
      holder.controller = m.controller;
      return m.sim;
    },
  });
  for (const d of modes.systems) sim.core.addSystem(d);
  const runtime = { env: { qa: true, modules: [] }, saveControl: null, transport: { postEvent: () => true } } as unknown as SimRuntime;
  await modes.onInit?.({ sim, cfg: sim.core.cfg, boot: { strings: [], prefabs: [], config: {} }, runtime, ports: {} } as SimModuleContext);
  sim.core.addResource({
    name: 'story.mission',
    hash: (h) => h.str(holder.controller?.rt?.stateHash() ?? ''),
    save() {},
    load() {},
  });

  const host = modes.host();
  if (!host) throw new Error("suite 'missions': the modes module has no host");
  const started = host.startQa('story');
  if (!started.ok) throw new Error(`suite 'missions': the story mode did not start (${JSON.stringify(started)})`);

  // Warm up: let the mode enter and the colliders appear until the mission resolves, then start it (the QA boot path waits the same way)
  const ctrl = (): StoryController => holder.controller as StoryController;
  let ready = false;
  for (let i = 0; i < MAX_WARMUP_TICKS && !ready; i++) {
    sim.step(1);
    await Promise.resolve();
    const c = holder.controller;
    ready = c !== null && c.ctx !== null && !('errors' in resolveMission(bundle.ir, c.ctx.world.resolver));
  }
  const begun = ctrl().begin(bundle.ir, {
    seed: spec.seed,
    flags: missionFlags(spec),
    directors: bundle.directors,
    lines: bundle.lines,
    ...(typeof params['stage'] === 'number' ? { stage: params['stage'] } : {}),
  });
  if (!begun.ok) throw new Error(`suite 'missions': ${bundle.ir.id} did not resolve in the world: ${begun.errors.map((e) => `${e.code} ${e.pointer}`).join(', ')}`);

  const script = modes.script();
  if (!script) throw new Error("suite 'missions': the modes module has no script services");
  const mission = (): MissionObs | null => {
    const c = holder.controller;
    return c && c.rt && c.ctx ? observeMission(c.rt, c.ctx) : null;
  };
  const handle: MissionsHandle = { sim, controller: ctrl(), modes, bundle, timeline: script.timeline, mission };
  env.onLoaded?.(handle);
  return {
    ...handle,
    observe: () => (mission() ?? { phase: 'none' }) as unknown as Readonly<Record<string, unknown>>,
  } as LoadedScenario & MissionsHandle;
}

let registered = false;

/** Registers the `missions` suite loader once. */
export function ensureMissionsLoader(): void {
  if (registered) return;
  registerScenarioLoader(MISSIONS_SUITE, loadMissions);
  registered = true;
}
