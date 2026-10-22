/** The 200-run smoke of `median` (check:unit), the report schema, and the band evaluator on synthetic reports. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { toolsRoot } from '../../lib/common.ts';
import { evaluateBands, failingBands, loadBands, type BandsFile } from '../bands.ts';
import { runSuite } from '../cli.ts';
import { aggregate, reportJson, stripTimings, type PolicyReport, type Report } from '../report.ts';
import { playPolicyRuns, loadContent, buildPolicies } from '../run.ts';

const schema = JSON.parse(readFileSync(path.join(toolsRoot, 'tests/tycoon/report.schema.json'), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

describe('tycoon balance smoke (200 median runs)', () => {
  const res = runSuite({ runs: 200, policies: ['median'], seedBase: 1, determinismRuns: 50 });

  it('produces a report that validates against report.schema.json', () => {
    const ok = validate(JSON.parse(reportJson(res.report)));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    expect(res.report.policies['median']?.runs).toBe(200);
  });

  it('the rules that do not depend on the run count hold: determinism, replay, throughput, the cap, offers, the cap table, payouts', () => {
    const rs = Object.fromEntries(res.bands.map((b) => [b.id, b]));
    for (const id of ['B5', 'B9', 'B10', 'B11']) expect(rs[id]?.pass, `${id}: ${rs[id]?.got}`).toBe(true);
    expect(rs['B12']?.info).toBe(true);
  });

  it('the median policy plays the whole game: it raises, hires, meets events and ends runs', () => {
    const m = res.report.policies['median'] as PolicyReport;
    expect(m.reach.safe).toBeGreaterThan(0.9);
    expect(m.reach.a).toBeGreaterThan(0.2);
    expect(m.events.firedPerRun).toBeGreaterThan(10);
    expect(m.events.choicePerRun).toBeGreaterThan(2);
    expect(m.timedOut).toBe(0);
    expect(Object.keys(m.outcomes).length).toBeGreaterThanOrEqual(3);
    expect(m.violations).toEqual({ offersOutOfBand: 0, captableInvariant: 0, payoutMismatch: 0, stuck: 0 });
  });

  it('every shipped event id the median policy meets is in the catalog', () => {
    const content = loadContent();
    const ids = new Set(content.events.map((d) => d.id));
    for (const id of Object.keys((res.report.policies['median'] as PolicyReport).events.byId)) expect(ids.has(id), id).toBe(true);
  });
});

function fakePolicy(over: Partial<PolicyReport> = {}): PolicyReport {
  const content = loadContent();
  const set = buildPolicies(content);
  const base = aggregate(playPolicyRuns(content, set.policies['median']!.policy, 3, 1));
  return { ...base, ...over };
}

function fakeReport(policies: Record<string, PolicyReport>): Report {
  return { schema: 'tycoon.report.v1', contentVersion: 'aaaaaaaaaaaa', balanceVersion: 'bbbbbbbbbbbb', runsPerPolicy: 3, seedBase: 1, policies, determinism: { runsChecked: 3, twiceIdentical: true, replayMismatches: 0 } };
}

describe('band evaluator', () => {
  const bands: BandsFile = loadBands();
  const good = fakePolicy({
    runLength: { p10: 100, p50: 150, p90: 220, mean: 155 }, reach: { safe: 0.9, seed: 0.7, a: 0.45, b: 0.3, c: 0.2 }, unicornRate: 0.05, winRate: 0.7, meanScore: 1000,
    dilution: { p10: 17, p50: 20, p90: 23, n: 50 }, events: { firedPerRun: 30, choicePerRun: 10, suppressedPerWeek: 0.003, byId: {} }, lethality: { 'biz.outage': 0.02 },
    violations: { offersOutOfBand: 0, captableInvariant: 0, payoutMismatch: 0, stuck: 0 },
  });

  it('a report inside every band passes B1 to B11', () => {
    const rs = evaluateBands(fakeReport({ median: good, aggressive: { ...good, winRate: 0.5, meanScore: 800 }, random: { ...good, winRate: 0.1, meanScore: 50 } }), bands);
    expect(failingBands(rs).map((r) => `${r.id} ${r.got}`)).toEqual([]);
    expect(rs.map((r) => r.id)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11']);
  });

  it.each([
    ['B1', { runLength: { p10: 1, p50: 119, p90: 3, mean: 1 } }],
    ['B2', { reach: { safe: 1, seed: 1, a: 0.34, b: 0, c: 0 } }],
    ['B3', { unicornRate: 0.09 }],
    ['B7', { dilution: { p10: 1, p50: 25, p90: 1, n: 5 } }],
    ['B8', { events: { firedPerRun: 46, choicePerRun: 10, suppressedPerWeek: 0, byId: {} } }],
    ['B9', { events: { firedPerRun: 30, choicePerRun: 10, suppressedPerWeek: 0.011, byId: {} } }],
    ['B5', { lethality: { 'biz.outage': 0.06 } }],
    ['B11', { violations: { offersOutOfBand: 1, captableInvariant: 0, payoutMismatch: 0, stuck: 0 } }],
  ] as [string, Partial<PolicyReport>][])('%s fails when its number leaves the band', (id, over) => {
    const rs = evaluateBands(fakeReport({ median: { ...good, ...over } }), bands);
    expect(rs.find((r) => r.id === id)?.pass).toBe(false);
  });

  it('B4 fails for a policy above 1.5 x median in win rate or in mean score; B6 for a random policy above 0.5 x', () => {
    const rs = evaluateBands(fakeReport({ median: good, frugal: { ...good, meanScore: 1600 } }), bands);
    expect(rs.find((r) => r.id === 'B4')?.pass).toBe(false);
    const rs2 = evaluateBands(fakeReport({ median: good, random: { ...good, winRate: 0.4 } }), bands);
    expect(rs2.find((r) => r.id === 'B6')?.pass).toBe(false);
  });

  it('B10 fails without a determinism section', () => {
    const r = fakeReport({ median: good });
    delete r.determinism;
    expect(evaluateBands(r, bands).find((x) => x.id === 'B10')?.pass).toBe(false);
  });

  it('stripTimings removes every wall-clock field', () => {
    const r = fakeReport({ median: { ...good, wallTimeMs: 12 } });
    r.wallTimeMs = 99;
    expect(JSON.stringify(stripTimings(r))).not.toContain('wallTimeMs');
  });
});
