import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { parseLine } from '../../src/sim/lines/format.ts';
import { ControllerWheelPath } from '../../src/sim/vehicle/wheel-path-controller.ts';
import { runLine } from '../lines-runner.ts';

const line = (n: string) => parseLine(readFileSync(new URL(`../lines/${n}.line.json`, import.meta.url), 'utf8'));
it('probe', async () => {
  for (const name of ['accel-0-100', 'brake-100-0', 'filbert']) {
    const t0 = Date.now();
    const run = await runLine(line(name), { wheelPath: (b) => new ControllerWheelPath(b) });
    const t = run.trace;
    const i = t.findIndex((v) => v.kph >= 100);
    const last = t[t.length - 1];
    console.log(name, 'ms', Date.now() - t0, '0-100 s', i / 60, 'end', last?.x, last?.y, last?.z, 'kph', last?.kph, 'contacts', last?.contacts, 'upY', last?.upY);
  }
}, 120000);
