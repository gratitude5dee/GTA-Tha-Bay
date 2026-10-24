/**
 * The fixture of the tycoon save tests (M09a1). Two runs of the scripted founder of the shared fixtures:
 *  1. seed 0xC0FFEE, played to its end (a `ramen` win in week 206), archived by the mode into `runs`, `bestScores`, `hardcore`
 *     and `dividendEarnedCents`;
 *  2. seed 1, played for 150 weeks with the founder switching to growth focus in week 60, still running: the `active` run.
 * The slice the mode saves for this pair is the v1 golden `packages/engine/src/sim/save/__golden__/tycoon/v1.json`.
 */
import type { JsonObject, ModeContext, SaveReason } from '@dv/shared';
import { hashCompany, setupFromSeed, type ChoiceRecord, type CompanyState, type RunSetup } from '@dv/shared/tycoon';
import { playPolicy } from '../../../shared/src/tycoon/__fixtures__/policy.ts';
import { emptySlice, tycoonContent, tycoonSim, type TycoonSlice } from '../src/sim/index.ts';

export const FIXTURE_SEED = 1;
export const FIXTURE_WEEKS = 150;
export const FINISHED_SEED = 0xc0ffee;

export interface FixtureRun {
  /** The slice the mode saved: the golden. */
  json: JsonObject;
  /** The live run at week 150. */
  state: CompanyState;
  setup: RunSetup;
  choices: ChoiceRecord[];
  hash: string;
}

function viaMode(slice: TycoonSlice): JsonObject {
  const saves: SaveReason[] = [];
  const ctx = { tick: 0, ui: { patch: () => undefined }, save: { request: (r: SaveReason) => void saves.push(r) }, telemetry: { emit: () => undefined } } as unknown as ModeContext;
  tycoonSim.enter(ctx, { origin: { kind: 'menu' }, seed: 1 }, slice as unknown as JsonObject);
  const json = tycoonSim.saveSlice(ctx) as JsonObject;
  tycoonSim.exit(ctx, 'quit');
  return json;
}

const snapshotOf = (s: CompanyState): { week: number; state: CompanyState; hash: string } => ({ week: s.week, state: s, hash: hashCompany(s) });

export function fixtureRun(weeks = FIXTURE_WEEKS): FixtureRun {
  const content = tycoonContent();
  const base = emptySlice(content);

  const doneSetup = setupFromSeed(FINISHED_SEED, undefined, content);
  const done = playPolicy(doneSetup, content, 400);
  const afterFirst = viaMode({ ...base, active: { setup: doneSetup, choices: done.choices, snapshot: snapshotOf(done.state) } }) as unknown as TycoonSlice;

  const setup = setupFromSeed(FIXTURE_SEED, undefined, content);
  const run = playPolicy(setup, content, weeks, (w, cmds) => {
    if (w === 60) cmds.push({ t: 'setFocus', focus: 'growth' });
  });
  const json = viaMode({ ...afterFirst, active: { setup, choices: run.choices, snapshot: snapshotOf(run.state) } });
  return { json, state: run.state, setup, choices: run.choices, hash: hashCompany(run.state) };
}
