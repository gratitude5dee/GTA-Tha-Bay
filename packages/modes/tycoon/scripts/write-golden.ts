/**
 * Writes `packages/engine/src/sim/save/__golden__/tycoon/v1.json` from the fixture run (C05 rule 5). Goldens change only in a pull
 * request labelled golden-update: a different content or balance version changes the file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureRun } from './fixture-run.ts';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '..', '..', '..', 'engine', 'src', 'sim', 'save', '__golden__', 'tycoon', 'v1.json');
const { json } = fixtureRun();
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(json, null, 1)}\n`);
console.log(`wrote ${file} (${JSON.stringify(json).length} bytes)`);
