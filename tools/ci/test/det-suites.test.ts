/** M04d AC-5: the det-suite registry against the nightly grep string and the driver registry. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DET_SUITES, isRuns } from '../../../tests/e2e/det/suites.ts';
import { getBot, registeredBots } from '../../../packages/engine/src/qa/bots.ts';
import { ensureBuiltinDrivers, validateRunSpec } from '../../../packages/engine/src/qa/runner.ts';
import { registerRacingQa } from '../../../packages/modes/racing/src/qa/index.ts';
import { registerStoryQa } from '../../../packages/modes/story/src/qa.ts';
import { repoRoot } from '../run.ts';

const nightly = readFileSync(path.join(repoRoot, '.github', 'workflows', 'nightly.yml'), 'utf8');
const ci = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

/** The tags of the nightly `--grep "..."` that carries `@determinism`. */
function nightlyTags(): string[] {
  const m = /--grep "([^"]*@determinism[^"]*)"/.exec(nightly);
  if (!m) throw new Error('nightly.yml has no determinism grep string');
  return (m[1] as string).split('|').map((t) => t.trim());
}

describe('det suites', () => {
  it('lists every tag of the nightly grep string, and only those', () => {
    const tags = nightlyTags();
    expect(tags.length).toBeGreaterThanOrEqual(5);
    expect(DET_SUITES.map((s) => s.tag).sort()).toEqual([...tags].sort());
  });

  it('each listed RunSpec names a registered driver; the others are pending or own a spec file', () => {
    ensureBuiltinDrivers();
    registerRacingQa();   // the racing suite's driver (M07a1)
    registerStoryQa();    // the story autoplayer (M05a2)
    for (const s of DET_SUITES) {
      if (isRuns(s)) {
        expect(s.runs.length, s.tag).toBeGreaterThan(0);
        for (const r of s.runs) {
          expect(registeredBots(), `${s.tag} / ${r.name}`).toContain(r.spec.bot.driver);
          expect(() => getBot(r.spec.bot.driver)).not.toThrow();
          expect(() => validateRunSpec(r.spec)).not.toThrow();
          expect(r.golden, `${s.tag} / ${r.name}`).toMatch(/^tests\/golden\/[a-z0-9-]+\/[a-z0-9._-]+\.json$/);
          expect(existsSync(path.join(repoRoot, r.golden)), r.golden).toBe(true);
        }
      } else if ('ownSpec' in s) {
        expect(existsSync(path.join(repoRoot, s.ownSpec)), s.ownSpec).toBe(true);
        expect(readFileSync(path.join(repoRoot, s.ownSpec), 'utf8'), s.ownSpec).toContain(s.tag);
      } else {
        expect(s.pending, s.tag).toMatch(/^M\d{2}[a-z0-9]*$/);
      }
    }
  });

  it('the pending tags name the milestones that fill them', () => {
    const pending = Object.fromEntries(DET_SUITES.filter((s): s is { tag: string; pending: string } => 'pending' in s).map((s) => [s.tag, s.pending]));
    expect(pending).toEqual({ '@fighter-hash': 'M08a1' });
  });

  it('@determinism joins no gray-box grep: it is world-agnostic (the page reads the committed fixture, DL-699)', () => {
    const grep = readFileSync(path.join(repoRoot, 'tests', 'e2e', 'graybox-grep.txt'), 'utf8');
    expect(grep).not.toContain('@determinism');
    expect(ci).not.toMatch(/GRAYBOX_GREP: '[^']*@determinism/);
    expect(nightly).not.toMatch(/GRAYBOX_GREP: '[^']*@determinism/);
  });

  it('the content job runs pnpm check:balance', () => {
    const content = /\n {2}content:\n([\s\S]*?)(?=\n {2}[A-Za-z0-9_-]+:\n|$)/.exec(ci)?.[1] ?? '';
    expect(content).toContain('pnpm check:balance');
  });
});
