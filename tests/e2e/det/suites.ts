/**
 * The cross-browser state-hash suite registry (M04d; 13-qa.md 3.3). One entry per det tag of `nightly.yml`'s grep string: the
 * `RunSpec`s the determinism page runs for it with the Node golden each must equal, a spec file that already owns the tag, or
 * `pending: <milestone>` until the mode owner fills it. `det-suites.spec.ts` runs every listed spec in Chromium and WebKit;
 * `tools/ci/test/det-suites.test.ts` checks the registry against the nightly grep and the driver registry.
 */
import { readFileSync } from 'node:fs';
import { WALK_DRIVE_GOLDENS, walkDriveSpec } from '../../../packages/engine/src/qa/engine-specs.ts';
import type { RunSpec } from '../../../packages/engine/src/qa/runner.ts';
import { RACING_GOLDEN, race3Spec, racingSpec, racingTraceFile } from '../../../packages/modes/racing/src/qa/specs.ts';
import { MISSIONS_GOLDEN, missionDetSpec, missionsTraceFile } from '../../../packages/modes/story/src/specs.ts';

export interface DetRun {
  /** Short name; the test title carries it. */
  name: string;
  spec: RunSpec;
  /** Repository path of the Node golden (`tests/golden/<suite>/<name>.json`). */
  golden: string;
}

export type DetSuite =
  | { tag: string; runs: DetRun[] }
  /** A spec file that already runs the tag with its own golden. */
  | { tag: string; ownSpec: string }
  | { tag: string; pending: string };

const LINE = JSON.parse(readFileSync(new URL('../../../packages/engine/test/lines/walk-drive.line.json', import.meta.url), 'utf8')) as unknown;

const golden = (name: string): string => `tests/golden/engine/${name}.json`;

export const DET_SUITES: readonly DetSuite[] = [
  {
    tag: '@determinism',
    runs: [
      { name: 'lines walk-drive', spec: walkDriveSpec(LINE), golden: golden(WALK_DRIVE_GOLDENS.plain) },
      { name: 'lines walk-drive checkpoints every 60 ticks', spec: walkDriveSpec(LINE, { checkpointEvery: 60 }), golden: golden(WALK_DRIVE_GOLDENS.fine) },
      { name: 'lines walk-drive with seeded steer noise', spec: walkDriveSpec(LINE, { noise: 12 }), golden: golden(WALK_DRIVE_GOLDENS.noise) },
      // M05a2: the story autoplayer plays m.dev.sample seed 1 (beats played) in the gray-box block
      { name: 'story.autoplayer on m.dev.sample seed 1', spec: missionDetSpec({ id: 'm.dev.sample', seed: 1, expectedSecMax: 900 }), golden: missionsTraceFile(MISSIONS_GOLDEN.sample) },
    ],
  },
  {
    tag: '@racing-det',
    runs: [
      { name: 'racing.line on sf.sprint.ferry-ocean-beach', spec: racingSpec(), golden: racingTraceFile(RACING_GOLDEN.line) },
      // M07a2: the line bot and the two AI rivals on the circuit (3 cars, 3 laps)
      { name: 'racing.line and two AI rivals on sf.circuit.embarcadero-vanness', spec: race3Spec(), golden: racingTraceFile(RACING_GOLDEN.race3) },
    ],
  },
  // M08a2: the golden .dvfight replays run inside the sim worker (__dvBridge.fighter.replay) and must match every checkpoint
  { tag: '@fighter-hash', ownSpec: 'tests/e2e/fighter-hash.spec.ts' },
  { tag: '@world-hash', ownSpec: 'tests/e2e/world-hash.spec.ts' },
  // M09a1: the pure tycoon core replays recorded runs in the page (__dvBridge.tycoon.runDet) against tests/golden/tycoon/det-001.json
  { tag: '@tycoon-det', ownSpec: 'tests/e2e/tycoon/tycoon-det.spec.ts' },
];

export const isRuns = (s: DetSuite): s is { tag: string; runs: DetRun[] } => 'runs' in s;
