/** AC-5: the week-by-week state hashes of a recorded 120-week run equal the committed golden; one changed choice changes every later hash. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testContent } from './__fixtures__/content.ts';
import { hashCompany } from './company.ts';
import { replay } from './replay.ts';
import { newRun } from './setup.ts';
import type { ChoiceRecord, RunSetup } from './types.ts';

interface Golden {
  v: 1;
  setup: RunSetup;
  choices: ChoiceRecord[];
  hashes: string[];
  final: string;
}
const golden = JSON.parse(readFileSync(new URL('./__fixtures__/step-trace.golden.json', import.meta.url), 'utf8')) as Golden;
const content = testContent();

function trace(choices: ChoiceRecord[]): string[] {
  const out: string[] = [hashCompany(newRun(golden.setup, content))];
  replay(golden.setup, choices, content, undefined, (s) => out.push(hashCompany(s)));
  return out;
}

describe('tycoon.step golden trace', () => {
  it('the golden was recorded against this content and balance (regenerate with pnpm --filter @dv/shared tycoon:goldens)', () => {
    expect(golden.setup.contentVersion).toBe(content.contentVersion);
    expect(golden.setup.balanceVersion).toBe(content.balanceVersion);
    expect(golden.setup.seed).toBe(0xc0ffee);
  });

  it('seed 0xC0FFEE, 120 weeks: every week hash equals step-trace.golden.json', () => {
    const got = trace(golden.choices);
    expect(got.length).toBe(golden.hashes.length + 1);
    expect(got.slice(1)).toEqual(golden.hashes);
    expect(golden.hashes.length).toBeGreaterThanOrEqual(120);
  });

  it('a different choice at week 60 changes every later hash and none before it', () => {
    const changed: ChoiceRecord[] = [...golden.choices, { week: 60, seq: 99, cmd: { t: 'setPrice', level: 'premium' } }];
    const base = trace(golden.choices);
    const alt = trace(changed);
    for (let w = 0; w <= 60; w++) expect(alt[w], `week ${w}`).toBe(base[w]);
    for (let w = 61; w < Math.min(base.length, alt.length); w++) expect(alt[w], `week ${w}`).not.toBe(base[w]);
  });

  it('every week has a distinct hash while the run lives', () => {
    expect(new Set(golden.hashes).size).toBe(golden.hashes.length);
  });
});
