/** AC-11: the slice of a 300-week run validates, stays under 100 KB, equals the v1 golden, and loads through replay or, on other content, from the snapshot. */
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { JsonObject } from '@dv/shared';
import { buildContent, hashCompany, replay, stepWeek, type CompanyState } from '@dv/shared/tycoon';
import { SLICE_SCHEMAS, validateSlice } from '../../../engine/src/sim/save/index.ts';
import { DEFAULT_MIGRATIONS, migrateData } from '../../../engine/src/sim/save/index.ts';
import { RAW_CONTENT } from '../../../shared/src/tycoon/__fixtures__/content.ts';
import { SLICE_MAX_BYTES, emptySlice, restoreRun, sliceBytes, sliceFromJson, tycoonContent, type TycoonSlice } from '../src/sim/index.ts';
import { fixtureRun, FIXTURE_WEEKS } from '../scripts/fixture-run.ts';

const content = tycoonContent();
const goldenUrl = new URL('../../../engine/src/sim/save/__golden__/tycoon/v1.json', import.meta.url);
const golden = JSON.parse(readFileSync(goldenUrl, 'utf8')) as JsonObject;
const fx = fixtureRun();

describe('tycoon slice (C05 mode:tycoon, schema 1)', () => {
  it('the fixture run is a 150-week run that is still going', () => {
    expect(fx.state.week).toBe(FIXTURE_WEEKS);
    expect(fx.state.phase).not.toBe('ended');
    expect(fx.choices.length).toBeGreaterThan(10);
  });

  it('validates against slice-1.schema.json (the engine validator and Ajv agree) and is under 100 KB', () => {
    expect(validateSlice('tycoon', 1, fx.json)).toBeNull();
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(SLICE_SCHEMAS.tycoon?.[1] as object);
    expect(validate(fx.json)).toBe(true);
    const bytes = sliceBytes(fx.json as unknown as TycoonSlice);
    expect(bytes).toBeLessThan(SLICE_MAX_BYTES);
    // a broken copy fails in both
    const broken = { ...fx.json, schema: 2 };
    expect(validateSlice('tycoon', 1, broken)).not.toBeNull();
    expect(validate(broken)).toBe(false);
    const noHash = JSON.parse(JSON.stringify(fx.json)) as { active: { snapshot: { hash: string } } };
    noHash.active.snapshot.hash = 'xyz';
    expect(validateSlice('tycoon', 1, noHash)).not.toBeNull();
  });

  it('equals the v1 golden (regenerate with pnpm --filter @dv/mode-tycoon golden:write, in a golden-update pull request)', () => {
    expect(JSON.parse(JSON.stringify(fx.json))).toEqual(golden);
    expect(validateSlice('tycoon', 1, golden)).toBeNull();
  });

  it('the golden carries a finished run: history, best score, hardcore unlock and a capped dividend', () => {
    const s = golden as unknown as TycoonSlice;
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0]?.result.kind).toBe('ramen');
    expect(s.bestScores.ramen).toBe(s.runs[0]?.result.score);
    expect(s.hardcore).toBe(true);
    expect(s.dividendEarnedCents).toBe(Math.min(1_000_000, Math.floor((s.runs[0]?.result.founderPayoutCents ?? 0) * 0.0002)));
  });

  it('the migration table is registered for tycoon and a v1 record needs no step', () => {
    expect(DEFAULT_MIGRATIONS.current.tycoon).toBe(1);
    expect(DEFAULT_MIGRATIONS.steps.tycoon).toBeDefined();
    expect(migrateData(DEFAULT_MIGRATIONS, 'tycoon', 1, golden)).toEqual(golden);
  });
});

describe('load path (08-tycoon.md section 4.6.2)', () => {
  const slice = sliceFromJson(JSON.parse(JSON.stringify(fx.json)) as JsonObject, content);

  it('same versions: the choices are replayed and the hash matches the snapshot', () => {
    const r = restoreRun(slice, content);
    expect(r?.source).toBe('replay');
    expect(r?.unverifiable).toBe(false);
    expect(hashCompany(r?.state as CompanyState)).toBe(fx.hash);
  });

  it('a save and load in the middle of the run does not change what happens next', () => {
    const live = replay(fx.setup, fx.choices, content, 150);
    const midSlice: TycoonSlice = { ...emptySlice(content), active: { setup: fx.setup, choices: fx.choices.filter((c) => c.week <= 150), snapshot: { week: 150, state: live.state, hash: live.hash } } };
    const loaded = restoreRun(JSON.parse(JSON.stringify(midSlice)) as TycoonSlice, content);
    expect(loaded?.source).toBe('replay');
    const a = loaded?.state as CompanyState;
    const b = JSON.parse(JSON.stringify(live.state)) as CompanyState;
    for (let i = 0; i < 12; i++) {
      stepWeek(a, content);
      stepWeek(b, content);
      expect(hashCompany(a)).toBe(hashCompany(b));
    }
  });

  it('a changed balanceVersion loads from the snapshot, marked unverifiable, without losing the run', () => {
    const other = buildContent({ ...RAW_CONTENT, balance: { ...RAW_CONTENT.balance, founder: { ...RAW_CONTENT.balance.founder, rest: 9 } } });
    expect(other.balanceVersion).not.toBe(content.balanceVersion);
    const r = restoreRun(slice, other);
    expect(r?.source).toBe('snapshot');
    expect(r?.unverifiable).toBe(true);
    expect(r?.state.week).toBe(FIXTURE_WEEKS);
    expect(hashCompany(r?.state as CompanyState)).toBe(fx.hash);
    expect(r?.choices).toHaveLength(fx.choices.length);
  });

  it('a snapshot whose hash the replay cannot reproduce is used as it is and marked unverifiable', () => {
    const tampered = JSON.parse(JSON.stringify(slice)) as TycoonSlice;
    (tampered.active as NonNullable<TycoonSlice['active']>).snapshot = { ...(tampered.active?.snapshot as NonNullable<NonNullable<TycoonSlice['active']>['snapshot']>), hash: '0000000000000000' };
    const r = restoreRun(tampered, content);
    expect(r?.source).toBe('snapshot');
    expect(r?.unverifiable).toBe(true);
    expect(r?.state.week).toBe(FIXTURE_WEEKS);
  });

  it('a slice without an active run restores nothing; a missing slice is the empty one', () => {
    expect(restoreRun(emptySlice(content), content)).toBeNull();
    expect(sliceFromJson(null, content)).toEqual(emptySlice(content));
  });
});
