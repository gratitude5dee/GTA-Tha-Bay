/**
 * The `CanonicalRunner` (M04d; 13-qa.md 3.1). One `RunSpec` gives one `StateHashTrace`, in Node and in the browser
 * determinism page. QA builds and Node only: the identifiers `CanonicalRunner`, `BotDriver` and `registerBot` must not appear
 * in a production chunk (`check:bundle`).
 *
 * The runner boots the sim through the scenario loader registered for `spec.suite`, steps it with the bot's frames written as
 * player 0's `InputFrame`, and records the FNV-1a-64 `stateHash` every `checkpointEvery` ticks and at the end. It stops at
 * `maxTicks` with outcome `timeout` and the checkpoints taken so far.
 */
import { RngStreams, type SimProfile } from '@dv/shared';
import type { RetryEnv } from '../sim/physics/rapier-backend.ts';
import { getBot, registerBot, registeredBots, type BotContext } from './bots.ts';
import { createLinesDriver, LINES_DRIVER_ID } from './drivers/lines.ts';
import { ensureEngineLoader, getScenarioLoader, type ScenarioEnv } from './scenarios.ts';

export interface RunSpec {
  /** 'missions' | 'racing' | 'fighter' | 'tycoon' | 'world' | 'econ' | 'engine' */
  suite: string;
  scenario: string;
  /** u32 */
  seed: number;
  profile: Extract<SimProfile, 'canonical'>;
  /** Hard stop; `expectedSec x 60 x 1.5` for missions. */
  maxTicks: number;
  /** Ticks between checkpoints; 600 unless the suite says otherwise. */
  checkpointEvery: number;
  bot: { driver: string; params?: Record<string, unknown> };
  flags?: Partial<{ hooks: 'stub' | 'bot'; talk: 'scripted'; beats: 'instant' }>;
}

export interface StateHashTrace {
  v: 1;
  spec: RunSpec;
  /** The git short sha, or `local`. */
  build: string;
  checkpoints: { tick: number; hash: string }[];
  end: { tick: number; hash: string; outcome: string };
}

export interface CanonicalRunner {
  run(spec: RunSpec): Promise<StateHashTrace>;
}

/**
 * The parts of the loop a mutant replaces (`tools/ci/mutants/engine-lines`, DL-AC-6 fallback of the milestone: a mutant exports
 * `patch(deps)` instead of overriding a module). Tests only; nothing in a real run sets them.
 */
export interface RunnerDeps {
  /** The `bot` stream of a run: seeded from the spec seed. */
  botRng(seed: number): () => number;
  /** True to step loop iteration `i` without the bot's frame (the tick is skipped for the bot). */
  skipTick(i: number): boolean;
}

export const DEFAULT_DEPS: RunnerDeps = {
  botRng(seed) {
    const r = new RngStreams(seed).get('bot');
    return () => r.nextFloat();
  },
  skipTick: () => false,
};

export interface RunnerEnv {
  /** Fixture packs by family (`p0`), verified by the caller. */
  packs?: Readonly<Record<string, Uint8Array>>;
  retry?: Partial<RetryEnv>;
  /** `build` of the trace; default `local`. */
  build?: string;
  deps?: Partial<RunnerDeps>;
  /** Process environment for the golden guard; default `process.env` where it exists. */
  processEnv?: Readonly<Record<string, string | undefined>>;
}

let driversRegistered = false;

/** Registers the drivers this package ships (`lines`). Idempotent. */
export function ensureBuiltinDrivers(): void {
  if (driversRegistered) return;
  if (!registeredBots().includes(LINES_DRIVER_ID)) registerBot(LINES_DRIVER_ID, createLinesDriver);
  driversRegistered = true;
}

function defaultProcessEnv(): Readonly<Record<string, string | undefined>> {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return p?.env ?? {};
}

/** Throws when a CI run has `DV_UPDATE_GOLDEN` set: goldens change only through a labelled PR (13-qa.md 3.4). */
export function assertNoGoldenUpdateInCi(env: Readonly<Record<string, string | undefined>>): void {
  const ci = env['CI'];
  if (ci !== undefined && ci !== '' && ci !== '0' && ci !== 'false' && env['DV_UPDATE_GOLDEN'] !== undefined && env['DV_UPDATE_GOLDEN'] !== '') {
    throw new Error('DV_UPDATE_GOLDEN is set in a CI run; goldens are updated only in a pull request labelled golden-update');
  }
}

export function validateRunSpec(spec: RunSpec): void {
  if (!spec || typeof spec !== 'object') throw new Error('RunSpec must be an object');
  if (typeof spec.suite !== 'string' || spec.suite === '') throw new Error('RunSpec.suite must be a non-empty string');
  if (typeof spec.scenario !== 'string' || spec.scenario === '') throw new Error('RunSpec.scenario must be a non-empty string');
  if (!Number.isInteger(spec.seed) || spec.seed < 0 || spec.seed > 0xffffffff) throw new Error('RunSpec.seed must be a u32');
  if (spec.profile !== 'canonical') throw new Error("RunSpec.profile must be 'canonical'");
  if (!Number.isInteger(spec.maxTicks) || spec.maxTicks < 1) throw new Error('RunSpec.maxTicks must be a positive integer');
  if (!Number.isInteger(spec.checkpointEvery) || spec.checkpointEvery < 1) throw new Error('RunSpec.checkpointEvery must be a positive integer');
  if (!spec.bot || typeof spec.bot.driver !== 'string') throw new Error('RunSpec.bot.driver must be a string');
}

export function createCanonicalRunner(env: RunnerEnv = {}): CanonicalRunner {
  const deps: RunnerDeps = { ...DEFAULT_DEPS, ...env.deps };
  return {
    async run(spec: RunSpec): Promise<StateHashTrace> {
      assertNoGoldenUpdateInCi(env.processEnv ?? defaultProcessEnv());
      validateRunSpec(spec);
      ensureBuiltinDrivers();
      ensureEngineLoader();
      // Resolve both before booting a sim: an unknown driver or suite fails fast and lists what exists.
      const bot = getBot(spec.bot.driver);
      const loader = getScenarioLoader(spec.suite);
      const scenarioEnv: ScenarioEnv = { packs: env.packs ?? {}, ...(env.retry ? { retry: env.retry } : {}) };
      const loaded = await loader(spec, scenarioEnv);
      const { sim } = loaded;
      try {
        // One stream per run: `rng` returns the same function every call, so a driver cannot fork it.
        const stream = deps.botRng(spec.seed);
        const ctx: BotContext = { observe: () => ({ ...loaded.observe(), tick: sim.tick }), rng: () => stream };
        bot.init(ctx, spec.bot.params);

        const checkpoints: StateHashTrace['checkpoints'] = [];
        let outcome = 'timeout';
        const input = (tick: number) => bot.frame(tick);
        let i = 0;
        while (sim.tick < spec.maxTicks) {
          if (deps.skipTick(i)) sim.step(1);
          else sim.step(1, input);
          if (sim.tick % spec.checkpointEvery === 0) checkpoints.push({ tick: sim.tick, hash: sim.hash() });
          i++;
          const d = bot.done();
          if (d.done) {
            outcome = d.outcome ?? 'end';
            break;
          }
        }
        return {
          v: 1,
          spec,
          build: env.build ?? 'local',
          checkpoints,
          end: { tick: sim.tick, hash: sim.hash(), outcome },
        };
      } finally {
        sim.dispose();
      }
    },
  };
}
