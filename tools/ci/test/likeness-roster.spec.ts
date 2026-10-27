// M08b1 AC-4: the likeness gate's roster rules (tier equality, mandatory stand-ins, fame-domain exclusion) on fixtures and on the committed roster.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FameConfig } from '../../../packages/shared/src/fight/fame.ts';
import type { FighterDef, RosterEntry } from '../../../packages/shared/src/fight/types.ts';
import { loadRosterGateInput, rosterFindings, runRosterGate } from '../likeness-gate/roster.ts';
import type { RosterGateInput, RosterSoul } from '../likeness-gate/roster.ts';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const dir = path.join(root, 'packages/modes/fighter/test/fixtures/roster');
const base = loadRosterGateInput(root) as RosterGateInput;

interface Fixture { note: string; roster: RosterEntry[]; souls: RosterSoul[]; stages: { id: string; tags: string[] }[]; expect: string[] }
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ name: f.replace('.json', ''), fx: JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Fixture }));
const withFixture = (fx: Fixture): RosterGateInput => ({ ...base, roster: fx.roster, souls: fx.souls, stages: fx.stages });

describe('fixtures are reported by rule', () => {
  it('has the four scenarios', () => {
    expect(fixtures.map((f) => f.name)).toEqual(['clean', 'parody-basketball-court', 'parody-no-standin', 'tier-mismatch']);
  });
  for (const { name, fx } of fixtures) {
    it(`${name}: ${fx.note}`, () => {
      const rules = [...new Set(rosterFindings(withFixture(fx)).map((f) => f.rule))].sort();
      expect(rules).toEqual([...fx.expect].sort());
    });
  }
});

describe('the committed roster', () => {
  it('passes: eight slots, tiers equal the souls, stand-ins present, no fame-domain overlap', () => {
    expect(base.roster).toHaveLength(8);
    const r = runRosterGate(root);
    expect(r.findings).toEqual([]);
    expect(r.scanned).toBe(8);
  });
  it('a kit tagged with a word of the slot fame domain is reported', () => {
    const kits: Record<string, FighterDef> = structuredClone(base.kits);
    (kits['ATH_SHOOTER'] as FighterDef).moves[8]?.tags.push('dunk');
    const f = rosterFindings({ ...base, kits });
    expect(f.map((x) => x.rule)).toContain('roster-fame-kit');
    expect(f.find((x) => x.rule === 'roster-fame-kit')?.detail).toContain('dunk');
  });
  it('a whole word only: "dunker" or "microphone" is not "dunk" or "mic"', () => {
    const kits: Record<string, FighterDef> = structuredClone(base.kits);
    (kits['ATH_SHOOTER'] as FighterDef).moves[8]?.tags.push('dunker');
    (kits['RAP_LYRICIST'] as FighterDef).moves[8]?.tags.push('microphone');
    expect(rosterFindings({ ...base, kits })).toEqual([]);
  });
  it('an unknown soul or an older soul version is reported', () => {
    const f = rosterFindings({ ...base, souls: base.souls.filter((s) => s.id !== 'dev_shooter') });
    expect(f.map((x) => x.rule)).toEqual(['roster-soul-missing']);
    const old = rosterFindings({ ...base, souls: base.souls.map((s) => (s.id === 'dev_hacker' ? { ...s, soulVersion: 0 } : s)) });
    expect(old.map((x) => x.rule)).toEqual(['roster-soul-missing']);
  });
  it('the gate is part of likeness:gate (the command runs it on the repository)', () => {
    const src = readFileSync(path.join(root, 'tools/ci/likeness-gate.ts'), 'utf8');
    expect(src).toContain('runRosterGate');
  });
  it('fame config shape', () => {
    const fame = base.fame as FameConfig;
    expect(fame.schema).toBe('fame-domains/1');
    expect(Object.keys(fame.domains).sort()).toEqual(['basketball', 'football', 'rap_performance', 'streaming']);
    expect(fame.forbiddenStageTags['basketball']).toContain('arena_court');
  });
});
