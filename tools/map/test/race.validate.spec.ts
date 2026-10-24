/**
 * `map:races validate` (M07a1): the committed ferry sprint passes, and each rule V1 to V11 and V13 to V15 has one broken fixture
 * (`fixtures/races/V<n>.source.json`) that fails with exactly that rule. A fixture is a patch of the committed race: JSON paths to
 * new values over `source.json` (`sourcePatch`) and `race.json` (`defPatch`). V1 and V7 read the road graph, so those fixtures
 * carry a `stub` standing in for an open bake (no bake is needed here). V2 (snap) is a compile error, V12 (par bot) is M07a2.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RaceDef, RaceSource } from '../../../packages/shared/src/index.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import type { BakeGraph } from '../src/race/snap.ts';
import { schemaFindings, validateRace } from '../src/race/validate.ts';

const RACE = path.join(toolsRoot, 'content', 'races', 'sf.sprint.ferry-ocean-beach');
const FIXTURES = path.join(toolsRoot, 'tools', 'map', 'test', 'fixtures', 'races');
const read = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;

interface Fixture {
  rule: string;
  expect: string[];
  note: string;
  sourcePatch?: Record<string, unknown>;
  defPatch?: Record<string, unknown>;
  jsonPadBytes?: number;
  stub?: { to: number; from: number; out: number[] };
}

/** Sets `value` at a JSON path like `/gates/1/widthM` in a deep copy. */
function patched<T>(base: T, patch: Record<string, unknown> | undefined): T {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [p, value] of Object.entries(patch ?? {})) {
    const keys = p.split('/').slice(1);
    let node = copy as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) node = node[k] as Record<string, unknown>;
    node[keys[keys.length - 1] as string] = value;
  }
  return copy as T;
}

const stubBake = (def: RaceDef, s: NonNullable<Fixture['stub']>): BakeGraph =>
  ({ bakeId: def.worldBake, net: { has: () => true, to: () => s.to, from: () => s.from, out: () => s.out, isReverseOf: () => false } }) as unknown as BakeGraph;

const baseSource = read<RaceSource>(path.join(RACE, 'source.json'));
const baseDef = read<RaceDef>(path.join(RACE, 'race.json'));
const baseJson = readFileSync(path.join(RACE, 'race.json'), 'utf8');

describe('map:races validate', () => {
  it('the committed ferry sprint passes the rules that need no bake, and its source and def pass the schemas', () => {
    const r = validateRace({ source: baseSource, def: baseDef, json: baseJson });
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.stats.gates).toBe(baseDef.gates.length);
    expect(schemaFindings('race-source', baseSource)).toEqual([]);
    expect(schemaFindings('race-def', baseDef)).toEqual([]);
  });

  it('a file that is not a race is V0', () => {
    expect(schemaFindings('race-source', { id: 3 }).every((f) => f.rule === 'V0')).toBe(true);
    expect(schemaFindings('race-source', { id: 3 }).length).toBeGreaterThan(0);
  });

  const files = readdirSync(FIXTURES).filter((f) => /^V\d+\.source\.json$/.test(f)).sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10));

  it('has a fixture for every rule V1, V3 to V11 and V13 to V15', () => {
    expect(files.map((f) => f.split('.')[0])).toEqual(['V1', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V13', 'V14', 'V15']);
  });

  for (const file of files) {
    const fx = read<Fixture>(path.join(FIXTURES, file));
    it(`${fx.rule} fails with exactly its rule: ${fx.note}`, () => {
      const source = patched(baseSource, fx.sourcePatch);
      const def = patched(baseDef, fx.defPatch);
      const json = fx.jsonPadBytes ? baseJson + ' '.repeat(fx.jsonPadBytes) : baseJson;
      const r = validateRace({ source, def, json, bg: fx.stub ? stubBake(def, fx.stub) : null });
      const rules = [...new Set(r.findings.filter((f) => f.level === 'error').map((f) => f.rule))].sort();
      expect(rules).toEqual([...fx.expect].sort());
      expect(r.ok).toBe(false);
    });
  }
});
