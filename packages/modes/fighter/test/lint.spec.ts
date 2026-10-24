import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FighterDef, FightTuning } from '@dv/shared/fight';
import { FX3_EXPECT, kitTable, lintKit, lintReplay, lintTuning } from '../src/lint/index.ts';
import type { LintRule } from '../src/lint/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..');
const read = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8')) as unknown;
const tuning = read(path.join(root, 'config', 'fighter.tuning.json')) as FightTuning;
const kit = read(path.join(root, 'content', 'fighter', 'kits', 'player.json')) as FighterDef;
const fixture = (n: string): unknown => read(path.join(here, 'fixtures', 'kits', `${n}.json`));

describe('reference kit', () => {
  it('is clean', () => {
    expect(lintKit(kit, tuning)).toEqual([]);
    expect(lintTuning(tuning)).toEqual([]);
  });
  it('the derived advantage equals FX3 (5L +4/+1, 5M +5/-1, 5H +3/-4, 2L +4/+2, 2M +4/-2, 2H -9, Skid Kick +2/-5, Uplift -25, Surge -31)', () => {
    const rows = new Map(kitTable(kit).map((r) => [r.id, r]));
    const want: [string, number | null, number | null][] = [
      ['5L', 4, 1], ['5M', 5, -1], ['5H', 3, -4], ['2L', 4, 2], ['2M', 4, -2], ['2H', null, -9],
      ['skidKick', 2, -5], ['uplift', null, -25], ['surge', null, -31],
    ];
    for (const [id, h, b] of want) {
      expect([rows.get(id)?.advHit, rows.get(id)?.advBlock], id).toEqual([h, b]);
      expect(FX3_EXPECT[id]).toEqual({ advHit: h, advBlock: b });
    }
  });
  it('the shipped kit has the twelve FX3 moves plus the schema-valid placeholders', () => {
    expect(kit.moves.map((m) => m.id)).toEqual(['5L', '5M', '5H', '2L', '2M', '2H', 'jM', 'throw', 'sparkToss', 'uplift', 'skidKick']);
    expect(kit.supers.map((m) => m.id)).toEqual(['surge', 'showstopper']);
    expect(kit.shutdown.kind).toBe('shutdown');
    expect(kit.taunt.kind).toBe('taunt');
    expect(kit.shutdown.startup - 1 + kit.shutdown.active + kit.shutdown.recovery).toBe(170);
  });
});

describe('bad fixtures each fail with their rule', () => {
  const cases: [string, LintRule][] = [
    ['bad-schema', 'schema'], ['bad-authored-advantage', 'schema'], ['bad-startup', 'startup-min'], ['bad-recovery', 'recovery-min'],
    ['bad-box-bounds', 'box-bounds'], ['bad-no-overlap', 'hit-no-overlap'], ['bad-hit-window', 'hit-window'],
    ['bad-unreachable', 'unreachable-input'], ['bad-shadowed-input', 'unreachable-input'], ['bad-name-collision', 'name-collision'],
    ['bad-fx3', 'fx3-reference'], ['bad-combo-loop', 'combo-loop'], ['bad-combo-damage', 'combo-loop'], ['bad-spawn-ref', 'spawn-ref'],
    ['bad-auto-ref', 'auto-ref'], ['bad-cancel-range', 'cancel-range'],
  ];
  for (const [name, rule] of cases) {
    it(`${name} -> ${rule}`, () => {
      const issues = lintKit(fixture(name), tuning);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.map((i) => i.rule)).toContain(rule);
    });
  }
  it('every bad-*.json on disk is covered by a case', () => {
    const files = readdirSync(path.join(here, 'fixtures', 'kits')).filter((f) => f.startsWith('bad-')).map((f) => f.replace('.json', '')).sort();
    expect(files).toEqual(cases.map((c) => c[0]).sort());
  });
});

describe('tuning and replay schemas', () => {
  it('a tuning with an increasing scaling table or a missing key fails', () => {
    expect(lintTuning({ ...tuning, COMBO_SCALE: [100, 100, 120] }).length).toBeGreaterThan(0);
    const { HEALTH: _h, ...missing } = tuning;
    void _h;
    expect(lintTuning(missing).length).toBeGreaterThan(0);
  });
  it('a replay without checkpoints fails the schema', () => {
    expect(lintReplay({ v: 1 }).length).toBeGreaterThan(0);
  });
});

describe('fighter:lint CLI', () => {
  it('prints the table and exits 0 on the reference kit, exits 1 on a bad fixture', () => {
    const ok = spawnSync('pnpm', ['--filter', '@dv/mode-fighter', 'fighter:lint'], { cwd: root, encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('5L');
    expect(ok.stdout).toContain('fighter:lint: clean');
    const bad = spawnSync('pnpm', ['--filter', '@dv/mode-fighter', 'fighter:lint', '--', path.join(here, 'fixtures', 'kits', 'bad-startup.json')], { cwd: root, encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('startup-min');
  }, 60_000);
});
