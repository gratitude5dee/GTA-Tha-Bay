/** The `RunSpec`s of suite `engine` (M04d): the Node tests, the Node goldens and the browser det suites build them the same way. */
import type { RunSpec } from './runner.ts';

export const ENGINE_SEED = 0xc0ffee;

export interface WalkDriveOptions {
  /** Ticks between checkpoints; the AC spec uses 600. */
  checkpointEvery?: number;
  /** Adds the seeded steer offset of the `lines` driver (a run that uses the `bot` stream). */
  noise?: number;
}

/** `walk-drive.line.json` replayed by driver `lines` on the gray-box block. `line` is the parsed file. */
export function walkDriveSpec(line: unknown, o: WalkDriveOptions = {}): RunSpec {
  return {
    suite: 'engine',
    scenario: 'walk-drive',
    seed: ENGINE_SEED,
    profile: 'canonical',
    maxTicks: 1200,
    checkpointEvery: o.checkpointEvery ?? 600,
    bot: { driver: 'lines', params: { line, ...(o.noise ? { noise: o.noise } : {}) } },
  };
}

/** Golden names under `tests/golden/engine/`. */
export const WALK_DRIVE_GOLDENS = { plain: 'walk-drive', fine: 'walk-drive-fine', noise: 'walk-drive-noise' } as const;
