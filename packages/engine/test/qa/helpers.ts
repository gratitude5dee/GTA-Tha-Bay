import { readFileSync } from 'node:fs';
import { createCanonicalRunner, type RunnerEnv, type RunSpec, type StateHashTrace } from '../../src/qa/runner.ts';
import { readFixturePacks } from '../../src/qa/node.ts';
import { walkDriveSpec, type WalkDriveOptions } from '../../src/qa/engine-specs.ts';

export const LINE = JSON.parse(readFileSync(new URL('../lines/walk-drive.line.json', import.meta.url), 'utf8')) as unknown;

export const spec = (o: WalkDriveOptions = {}): RunSpec => walkDriveSpec(LINE, o);

export function run(s: RunSpec, env: RunnerEnv = {}): Promise<StateHashTrace> {
  return createCanonicalRunner({ packs: readFixturePacks(), processEnv: {}, ...env }).run(s);
}
