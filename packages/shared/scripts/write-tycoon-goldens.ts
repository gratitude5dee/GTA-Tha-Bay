/**
 * Writes the two tycoon goldens (M09a1): the 120-week step trace (`__fixtures__/step-trace.golden.json`) and the Node golden of the
 * cross-browser det suite (`tests/golden/tycoon/det-001.json`). Both hold the recorded choice lists, so a test can replay them.
 * Run `pnpm --filter @dv/shared tycoon:goldens` and commit the result in a pull request labelled golden-update; the content or
 * balance version changes every hash.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testContent } from '../src/tycoon/__fixtures__/content.ts';
import { playPolicy } from '../src/tycoon/__fixtures__/policy.ts';
import { hashCompany } from '../src/tycoon/company.ts';
import { replay } from '../src/tycoon/replay.ts';
import { setupFromSeed } from '../src/tycoon/setup.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const content = testContent();

function write(rel: string, value: unknown): void {
  const file = resolve(repo, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
  console.log(`wrote ${rel}`);
}

// 1. step trace: seed 0xC0FFEE, 120 weeks
{
  const setup = setupFromSeed(0xc0ffee, undefined, content);
  const run = playPolicy(setup, content, 120);
  const hashes: string[] = [];
  replay(setup, run.choices, content, undefined, (s) => hashes.push(hashCompany(s)));
  write('packages/shared/src/tycoon/__fixtures__/step-trace.golden.json', { v: 1, setup, choices: run.choices, hashes, final: run.state.result?.stateHash ?? hashCompany(run.state) });
}

// 2. det suite: three seeds, 150 weeks each
{
  const runs = [0xc0ffee, 0xbeef, 7].map((seed) => {
    const setup = setupFromSeed(seed, undefined, content);
    const run = playPolicy(setup, content, 150);
    const out = replay(setup, run.choices, content);
    return { seed, weeks: 150, setup, choices: run.choices, finalHash: out.hash, endWeek: out.state.week, result: out.result };
  });
  write('tests/golden/tycoon/det-001.json', { v: 1, suite: 'tycoon', contentVersion: content.contentVersion, balanceVersion: content.balanceVersion, runs });
}
