/**
 * The cross-browser state-hash suite registry (M04d; 13-qa.md 3.3). One entry per det tag of `nightly.yml`'s grep string: the
 * `RunSpec`s the determinism page runs for it with the Node golden each must equal, a spec file that already owns the tag, or
 * `pending: <milestone>` until the mode owner fills it. `det-suites.spec.ts` runs every listed spec in Chromium and WebKit;
 * `tools/ci/test/det-suites.test.ts` checks the registry against the nightly grep and the driver registry.
 */
import { readFileSync } from 'node:fs';
import { WALK_DRIVE_GOLDENS, walkDriveSpec } from '../../../packages/engine/src/qa/engine-specs.ts';
import type { RunSpec } from '../../../packages/engine/src/qa/runner.ts';
import { RACING_GOLDEN, racingSpec, racingTraceFile } from '../../../packages/modes/racing/src/qa/specs.ts';

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
    ],
  },
  { tag: '@racing-det', runs: [{ name: 'racing.line on sf.sprint.ferry-ocean-beach', spec: racingSpec(), golden: racingTraceFile(RACING_GOLDEN.line) }] },
  { tag: '@fighter-hash', pending: 'M08a1' },
  { tag: '@world-hash', ownSpec: 'tests/e2e/world-hash.spec.ts' },
  { tag: '@tycoon-det', pending: 'M09a2' },
];

export const isRuns = (s: DetSuite): s is { tag: string; runs: DetRun[] } => 'runs' in s;
