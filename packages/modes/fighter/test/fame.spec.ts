// M08b1 AC-3: the fame-domain rule of `fighter:lint` (FX4.1, FX4.2).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { domainsFor, fameMatches, fameWords, stageFameHits } from '@dv/shared/fight';
import type { FighterDef, FightTuning } from '@dv/shared/fight';
import { lintKit } from '../src/lint/index.ts';
import { loadFame, loadFameOptions } from '../src/lint/options.ts';

const here = import.meta.dirname;
const root = path.resolve(here, '..', '..', '..', '..');
const read = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8')) as unknown;
const tuning = read(path.join(root, 'config', 'fighter.tuning.json')) as FightTuning;
const fixture = (n: string): FighterDef => read(path.join(here, 'fixtures', 'kits', `${n}.json`)) as FighterDef;
const options = loadFameOptions(root);
const fame = loadFame(root);

describe('word matching', () => {
  it('splits camelCase and punctuation and matches whole words', () => {
    expect(fameWords('fighter.rap_lyricist.move.micDrop')).toEqual(['fighter', 'rap', 'lyricist', 'move', 'mic', 'drop']);
    expect(fameMatches('micDrop', 'mic')).toBe(true);
    expect(fameMatches('microphone', 'mic')).toBe(false);
    expect(fameMatches('dunker', 'dunk')).toBe(false);
    expect(fameMatches('slam-dunk', 'dunk')).toBe(true);
    expect(fameMatches('stage light show', 'stage light')).toBe(true);
    expect(fameMatches('stage', 'stage light')).toBe(false);
    expect(fameMatches('hoops', 'hoop')).toBe(true);
    expect(fameMatches('a three-pointer shot', 'three-pointer')).toBe(true);
  });
  it('a slot reserves its domain whoever fills it, and a soul adds its own', () => {
    expect(domainsFor(fame, 'ATH_SHOOTER')).toEqual(['basketball']);
    expect(domainsFor(fame, 'ATH_SHOOTER', ['streaming'])).toEqual(['basketball', 'streaming']);
    expect(domainsFor(fame, 'TECH_VISIONARY')).toEqual([]);
  });
  it('a stage tag a domain forbids is reported', () => {
    expect(stageFameHits(fame, ['basketball'], ['waterfront', 'arena_court']).map((h) => h.text)).toEqual(['arena_court']);
    expect(stageFameHits(fame, ['basketball'], ['street'])).toEqual([]);
    expect(stageFameHits(fame, [], ['arena_court'])).toEqual([]);
  });
});

describe('fixtures fail with the fame-domain rule and nothing else', () => {
  it('fame-basketball: an ath_shooter move tagged dunk', () => {
    const k = fixture('fame-basketball');
    const issues = lintKit(k, tuning, options(k.slot));
    expect(issues.map((i) => i.rule)).toEqual(['fame-domain']);
    expect(issues[0]?.message).toContain('dunk');
  });
  it('fame-rap: a rap move named with mic', () => {
    const k = fixture('fame-rap');
    const issues = lintKit(k, tuning, options(k.slot));
    expect(issues.map((i) => i.rule)).toEqual(['fame-domain']);
    expect(issues[0]?.message).toContain('mic');
  });
  it('the same kits pass without the rule (the fixtures differ from the committed kits by one word)', () => {
    for (const n of ['fame-basketball', 'fame-rap']) expect(lintKit(fixture(n), tuning)).toEqual([]);
  });
});

describe('the committed kits pass (the CLI)', () => {
  it('fighter:lint exits 0 on the repository and 1 on a fixture', () => {
    const run = (args: string[]): { status: number | null; err: string } => {
      const r = spawnSync('pnpm', ['--filter', '@dv/mode-fighter', 'fighter:lint', '--', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
      return { status: r.status, err: r.stderr + r.stdout };
    };
    expect(run(['--quiet']).status).toBe(0);
    const bad = run([path.join(here, 'fixtures', 'kits', 'fame-basketball.json')]);
    expect(bad.status).toBe(1);
    expect(bad.err).toContain('[fame-domain]');
  }, 120_000);
});
