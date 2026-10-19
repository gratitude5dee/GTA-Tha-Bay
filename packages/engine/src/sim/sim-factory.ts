import type { InputFrame, LoopStats, SimConfig } from '@dv/shared';
import { EcsWorld, type EcsWorldOptions } from './ecs/world.ts';
import { SimCore, type SimCoreOptions } from './loop/sim-core.ts';
import type { LoopStatsExt } from './loop/stats.ts';
import { RapierBackend, type RapierBackendOptions } from './physics/rapier-backend.ts';
import { registerPhysicsSystems, type PhysicsSystemOptions } from './physics/systems.ts';
import { createSimServices, type EngineServices } from './services.ts';

/** What a scenario's setup receives: a fresh world with the physics systems already registered. */
export interface ScenarioSetup {
  readonly cfg: SimConfig;
  readonly ecs: EcsWorld;
  readonly core: SimCore;
  readonly services: EngineServices;
  readonly backend: RapierBackend;
  /** `BootPayload.config` of the session (pack bytes for the gray-box scenario); empty in tests that pass none. */
  readonly boot: Readonly<Record<string, unknown>>;
}

/** A canned world for tests, benches and the debug view. */
export interface PhysicsScenario {
  readonly id: string;
  setup(s: ScenarioSetup): void;
}

export interface PhysicsSimOptions extends SimCoreOptions {
  ecs?: EcsWorldOptions;
  backend?: RapierBackendOptions;
  physics?: PhysicsSystemOptions;
  /** `BootPayload.config`, handed to the scenario's setup. */
  boot?: Readonly<Record<string, unknown>>;
  /** Called after the systems and the scenario are registered and the first commands are flushed. */
  onReady?: (s: ScenarioSetup) => void;
}

/** A SimCore with a Rapier backend, as the headless host and the sim worker both run it. */
export interface PhysicsSim {
  readonly core: SimCore;
  readonly ecs: EcsWorld;
  readonly services: EngineServices;
  readonly backend: RapierBackend;
  readonly tick: number;
  /** Run `n` ticks. `input(tick)` supplies player 0's InputFrame for each tick. */
  step(n: number, input?: (tick: number) => InputFrame): void;
  hash(): string;
  /** ECS, resources (RNG, physics) and Rapier, as bytes. */
  snapshot(): Uint8Array;
  restore(bytes: Uint8Array): void;
  readonly stats: LoopStats & Pick<LoopStatsExt, 'nanCount'>;
  dispose(): void;
}

/**
 * Builds a physics sim: loads the Rapier build named by `cfg.physicsBuild` (with retry), registers the three physics
 * systems and the scenario, and flushes the spawn commands the scenario queued.
 */
export async function createPhysicsSim(
  cfg: SimConfig,
  scenario: PhysicsScenario | null,
  options: PhysicsSimOptions = {},
): Promise<PhysicsSim> {
  const backend = new RapierBackend(cfg.physicsBuild, options.backend);
  await backend.init();
  const ecs = new EcsWorld(options.ecs ?? {});
  const services = createSimServices(cfg.seed);
  services.physics = backend;
  const core = new SimCore(cfg, ecs, services, options);
  registerPhysicsSystems(core, backend, options.physics);
  const setup: ScenarioSetup = { cfg, ecs, core, services, backend, boot: options.boot ?? {} };
  scenario?.setup(setup);
  ecs.flush();
  options.onReady?.(setup);
  return {
    core,
    ecs,
    services,
    backend,
    get tick() {
      return core.tick;
    },
    step(n, input) {
      for (let i = 0; i < n; i++) {
        services.input = input ? input(core.tick) : null;
        core.stepOnce();
      }
    },
    hash: () => core.stateHash(),
    snapshot: () => core.serialize(),
    restore: (bytes) => core.restore(bytes),
    get stats() {
      return core.loopStats;
    },
    dispose: () => backend.dispose(),
  };
}
