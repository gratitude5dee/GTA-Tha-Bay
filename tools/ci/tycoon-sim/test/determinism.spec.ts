/** AC-9 (two executions are byte-identical) and AC-10 (the baseline guard). */
import { describe, expect, it } from 'vitest';
import { baselineOf, checkBaseline, hasRebaselineLine, movesBetween, statsOf, type Baseline } from '../baseline.ts';
import { simulate } from '../cli.ts';
import { reportJson, stripTimings, type Report } from '../report.ts';

describe('tycoon harness determinism (AC-9)', () => {
  it('seed base 1, 200 median runs, twice: report.json is byte-identical once wallTimeMs is removed', () => {
    const a = simulate({ runs: 200, policies: ['median'], seedBase: 1 }).report;
    const b = simulate({ runs: 200, policies: ['median'], seedBase: 1 }).report;
    expect(a.wallTimeMs).toBeGreaterThan(0);
    expect(reportJson(stripTimings(a))).toBe(reportJson(stripTimings(b)));
    expect(reportJson(stripTimings(a))).not.toContain('wallTimeMs');
  });

  it('another seed base gives another report', () => {
    const a = simulate({ runs: 60, policies: ['median'], seedBase: 1 }).report;
    const b = simulate({ runs: 60, policies: ['median'], seedBase: 2 }).report;
    expect(reportJson(stripTimings(a))).not.toBe(reportJson(stripTimings(b)));
  });
});

describe('tycoon baseline guard (AC-10)', () => {
  const report = simulate({ runs: 60, policies: ['median', 'frugal'], seedBase: 1 }).report;
  const base: Baseline = baselineOf(report);

  /** The same report with the median run length moved by `weeks`. */
  const moved = (weeks: number): Report => {
    const r = JSON.parse(JSON.stringify(report)) as Report;
    (r.policies['median'] as Report['policies'][string]).runLength.p50 += weeks;
    return r;
  };

  it('an unchanged report passes', () => {
    expect(checkBaseline(report, base, '').ok).toBe(true);
    expect(movesBetween(statsOf(report), base.policies)).toEqual([]);
  });

  it('a move of 8 weeks passes, a move of 9 weeks fails without the commit line', () => {
    expect(checkBaseline(moved(8), base, '').ok).toBe(true);
    const g = checkBaseline(moved(9), base, 'feat(tycoon): retune');
    expect(g.ok).toBe(false);
    expect(g.moves.map((m) => `${m.policy}.${m.stat}`)).toEqual(['median.runLengthP50']);
    expect(g.message).toContain('balance-rebaseline');
  });

  it('with the line a 9-week move is allowed; a baseline regenerated from the new report then has no moves at all', () => {
    const msg = 'feat(tycoon): retune\n\nbalance-rebaseline: longer runs after the grant event';
    expect(hasRebaselineLine(msg)).toBe(true);
    const g = checkBaseline(moved(9), base, msg);
    expect(g.ok).toBe(true);
    expect(g.message).toContain('pnpm tycoon:baseline');
    const regenerated = baselineOf(moved(9));
    const again = checkBaseline(moved(9), regenerated, '');
    expect(again.ok).toBe(true);
    expect(again.moves).toEqual([]);
  });

  it('rates move by more than 2 points fail too; the line needs a reason', () => {
    const r = JSON.parse(JSON.stringify(report)) as Report;
    const m = r.policies['median'] as Report['policies'][string];
    m.reach.a = Math.min(1, m.reach.a + 0.03);
    const g = checkBaseline(r, { ...base, policies: { ...base.policies, median: { ...(base.policies['median'] as Baseline['policies'][string]), reachA: m.reach.a - 0.03 } } }, '');
    expect(g.ok).toBe(false);
    expect(hasRebaselineLine('balance-rebaseline:')).toBe(false);
    expect(hasRebaselineLine('balance-rebaseline:   ')).toBe(false);
    expect(hasRebaselineLine('chore\nbalance-rebaseline: tuned B2')).toBe(true);
  });

  it('a baseline of another size or seed base is not compared', () => {
    const g = checkBaseline(moved(50), { ...base, runsPerPolicy: base.runsPerPolicy + 1 }, '');
    expect(g.ok).toBe(true);
    expect(g.message).toContain('skipped');
    expect(checkBaseline(moved(50), null, '').ok).toBe(true);
  });
});
