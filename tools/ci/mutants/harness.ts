/**
 * Mutant harness (M04d; 13-qa.md 2.3 item 2 and 3.6): a suite is a function from knobs (`deps`) to pass or fail; a mutant file in
 * `tools/ci/mutants/<suite>/` exports `patch(deps)` that turns one knob the wrong way. A suite that stays green under a mutant is
 * vacuous, and the test fails. (The milestone's fallback for module overrides: Vitest cannot reach a module the runner imports
 * dynamically, so the runner and the ledger model take an injectable `deps` object, set by tests only.)
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WALK_DRIVE_GOLDENS, walkDriveSpec } from '../../../packages/engine/src/qa/engine-specs.ts';
import { readGolden, sameTrace } from '../../../packages/engine/src/qa/golden.ts';
import { readFixturePacks } from '../../../packages/engine/src/qa/node.ts';
import { createCanonicalRunner, DEFAULT_DEPS, type RunnerDeps } from '../../../packages/engine/src/qa/runner.ts';
import { readFileSync } from 'node:fs';
import { newRefereeState, refereeStep, straightRaceDef, type RaceEvent } from '../../../packages/shared/src/index.ts';
import { RACING_GOLDEN, racingSpec } from '../../../packages/modes/racing/src/qa/specs.ts';
import { registerRacingQa } from '../../../packages/modes/racing/src/qa/index.ts';
import { runEconSuite } from '../econ-sim/index.ts';
import { DEFAULT_MODEL_DEPS, type ModelDeps } from '../econ-sim/model.ts';
import { toolsRoot } from '../lib/common.ts';

export interface SuiteResult {
  pass: boolean;
  detail: string;
}

export interface MutantSuite<D> {
  id: string;
  base: D;
  run(deps: D): Promise<SuiteResult>;
}

export interface MutantModule<D> {
  description: string;
  patch(deps: D): D;
}

const LINE = JSON.parse(readFileSync(path.join(toolsRoot, 'packages', 'engine', 'test', 'lines', 'walk-drive.line.json'), 'utf8')) as unknown;

/** `engine-lines`: the walk-drive specs (plain and with the seeded steer noise) must equal their Node goldens. */
export const ENGINE_LINES: MutantSuite<RunnerDeps> = {
  id: 'engine-lines',
  base: DEFAULT_DEPS,
  async run(deps) {
    const runner = createCanonicalRunner({ packs: readFixturePacks(), deps, processEnv: {} });
    const bad: string[] = [];
    for (const [name, opts] of [[WALK_DRIVE_GOLDENS.plain, {}], [WALK_DRIVE_GOLDENS.noise, { noise: 12 }]] as const) {
      const trace = await runner.run(walkDriveSpec(LINE, opts));
      const want = readGolden('engine', name);
      if (!want || !sameTrace(trace, want)) bad.push(name);
    }
    return { pass: bad.length === 0, detail: bad.length ? `differs from the golden: ${bad.join(', ')}` : 'matches the goldens' };
  },
};

/** `econ`: the economy bands and exact probes. */
export const ECON: MutantSuite<ModelDeps> = {
  id: 'econ',
  base: DEFAULT_MODEL_DEPS,
  async run(deps) {
    const r = runEconSuite({ deps, runs: 200 });
    const fails = r.lines.filter((l) => l.startsWith('FAIL'));
    return { pass: r.ok, detail: fails.length ? fails.slice(0, 2).join('; ') : 'every band passes' };
  },
};

/** The knobs of the `racing` suite: the runner's (bot stream, skipped ticks) and the referee that counts gates. */
export interface RacingDeps extends RunnerDeps {
  referee: typeof refereeStep;
}

/**
 * `racing` (M07a1): (a) the seeded steer-noise run of `racing.line` on the sprint, first 3,000 ticks, must equal its Node golden
 * (the bot stream and the whole sim path); (b) on a straight five-gate fixture a car that skips gate 3 gets gates 1 and 2 only
 * (the referee counts gates in order).
 */
export const RACING: MutantSuite<RacingDeps> = {
  id: 'racing',
  base: { ...DEFAULT_DEPS, referee: refereeStep },
  async run(deps) {
    registerRacingQa();
    const corridor = new Uint8Array(readFileSync(path.join(toolsRoot, 'content', 'races', 'sf.sprint.ferry-ocean-beach', 'corridor.bin')));
    const bad: string[] = [];
    const runner = createCanonicalRunner({ packs: { corridor }, deps, processEnv: {} });
    const trace = await runner.run(racingSpec({ noise: 4, maxTicks: 3000 }));
    const want = readGolden('racing', RACING_GOLDEN.noise);
    if (!want || !sameTrace(trace, want)) bad.push('the noise run differs from its golden');

    const def = straightRaceDef({ lengthM: 1000, gates: 5 });
    const st = newRefereeState(def, 0);
    const events: RaceEvent[] = [];
    const at = (s: number, x: number): [number, number, number] => [x, 0, -s];
    const x = (v: number): number => (v > 570 && v < 640 ? 20 : 0);   // round gate 3 (s 600), 20 m to the side
    for (let s = 0, t = 1; s < 1010; s += 2, t++) events.push(...deps.referee(def, st, at(s, x(s)), at(s + 2, x(s + 2)), 20, t));
    const gates = events.filter((e) => e.t === 'race.gate').map((e) => (e as { i: number }).i);
    if (gates.join(',') !== '1,2') bad.push(`a skipped gate 3 gave gates ${gates.join(',') || 'none'}`);
    return { pass: bad.length === 0, detail: bad.length ? bad.join('; ') : 'matches the golden; the skipped gate is not counted' };
  },
};

export const MUTANT_SUITES = [ENGINE_LINES, ECON, RACING] as const;

export function mutantFiles(suite: string): string[] {
  const dir = path.join(toolsRoot, 'tools', 'ci', 'mutants', suite);
  return readdirSync(dir).filter((f) => f.endsWith('.ts')).sort().map((f) => path.join(dir, f));
}

export async function loadMutant<D>(file: string): Promise<MutantModule<D>> {
  return (await import(pathToFileURL(file).href)) as MutantModule<D>;
}

/** Runs the suite under the mutant and throws `vacuous suite` when it stays green. */
export async function assertKilled<D>(suite: MutantSuite<D>, mutant: MutantModule<D>, label: string): Promise<SuiteResult> {
  const result = await suite.run(mutant.patch(suite.base));
  if (result.pass) throw new Error(`vacuous suite: '${suite.id}' stays green under mutant '${label}' (${mutant.description})`);
  return result;
}
