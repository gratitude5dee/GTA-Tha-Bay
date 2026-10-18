/**
 * Headless sim host (spec/domains/01-engine.md section 2.12): runs the same `sim/` code in Node or a Worker with no
 * DOM and no GPU. M01a1 covers step, hash, snapshot, restore and stats; the Rapier world joins in M01a2 and the timeline
 * export in M05a1.
 */
import type { InputFrame, LoopStats, SimConfig } from '@dv/shared';
import { EcsWorld, type EcsWorldOptions } from '../sim/ecs/world.ts';
import { SimCore, type SimCoreOptions } from '../sim/loop/sim-core.ts';
import type { LoopStatsExt } from '../sim/loop/stats.ts';
import { createSimServices, type EngineServices } from '../sim/services.ts';

/** What the setup callback receives: register systems, prefabs, resources and initial entities. */
export interface HeadlessSetup {
  readonly cfg: SimConfig;
  readonly ecs: EcsWorld;
  readonly core: SimCore;
  readonly services: EngineServices;
}

export interface HeadlessOptions extends SimCoreOptions {
  ecs?: EcsWorldOptions;
}

export interface HeadlessSim {
  readonly core: SimCore;
  readonly ecs: EcsWorld;
  readonly services: EngineServices;
  /** Ticks completed. */
  readonly tick: number;
  /** Run `n` ticks. `input(tick)` supplies player 0's InputFrame for each tick (C02 determinism rule 4). */
  step(n: number, input?: (tick: number) => InputFrame): void;
  /** stateHash of the current tick, 16 lowercase hex digits. */
  hash(): string;
  /** Serialized tick, accumulator, ECS and resources. */
  snapshot(): Uint8Array;
  /** Replace the sim state with a snapshot taken from a sim built by the same setup. */
  restore(bytes: Uint8Array): void;
  readonly stats: LoopStats & Pick<LoopStatsExt, 'nanCount'>;
}

function defaultNow(): () => number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? () => p.now() : () => 0;
}

export function createHeadlessSim(
  cfg: SimConfig,
  setup?: (s: HeadlessSetup) => void,
  options: HeadlessOptions = {},
): HeadlessSim {
  const ecs = new EcsWorld(options.ecs ?? {});
  const services = createSimServices(cfg.seed);
  const core = new SimCore(cfg, ecs, services, { ...options, now: options.now ?? defaultNow() });
  setup?.({ cfg, ecs, core, services });
  ecs.flush();
  return {
    core,
    ecs,
    services,
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
  };
}
