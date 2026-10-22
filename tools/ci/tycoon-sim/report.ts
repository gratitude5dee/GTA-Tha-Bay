/**
 * Aggregation and the report of the Tycoon balance tool (`report.json`, schema `tests/tycoon/report.schema.json`).
 * Rates are fractions of runs (0..1); lengths are weeks; dilution is percent of the post-money.
 */
import { percentile } from '../econ-sim/bands.ts';
import type { RunRecord } from './run.ts';

export interface Pct {
  p10: number;
  p50: number;
  p90: number;
}

export interface PolicyReport {
  runs: number;
  outcomes: Record<string, number>;
  timedOut: number;
  runLength: Pct & { mean: number };
  winRate: number;
  unicornRate: number;
  lossRate: number;
  meanScore: number;
  score: Pct;
  /** Share of runs that closed a SAFE or priced round of the kind. */
  reach: Record<'safe' | 'seed' | 'a' | 'b' | 'c', number>;
  dilution: Pct & { n: number };
  events: {
    firedPerRun: number;
    choicePerRun: number;
    suppressedPerWeek: number;
    byId: Record<string, number>;
  };
  /** Per root event id: share of runs where it fired while the company was healthy and a loss followed within 10 weeks. */
  lethality: Record<string, number>;
  violations: { offersOutOfBand: number; captableInvariant: number; payoutMismatch: number; stuck: number };
  refusedCommands: number;
  wallTimeMs?: number;
}

export interface Report {
  schema: 'tycoon.report.v1';
  contentVersion: string;
  balanceVersion: string;
  runsPerPolicy: number;
  seedBase: number;
  policies: Record<string, PolicyReport>;
  determinism?: { runsChecked: number; twiceIdentical: boolean; replayMismatches: number };
  wallTimeMs?: number;
}

const round = (x: number, d = 4): number => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};
const pct = (xs: number[]): Pct => {
  if (xs.length === 0) return { p10: 0, p50: 0, p90: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return { p10: percentile(s, 10), p50: percentile(s, 50), p90: percentile(s, 90) };
};
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

export function aggregate(records: readonly RunRecord[]): PolicyReport {
  const n = records.length;
  const outcomes: Record<string, number> = {};
  for (const r of records) outcomes[r.kind] = (outcomes[r.kind] ?? 0) + 1;
  const lens = records.map((r) => r.weeks);
  const scores = records.map((r) => r.score);
  const reach = { safe: 0, seed: 0, a: 0, b: 0, c: 0 };
  for (const r of records) for (const k of new Set(r.reached)) if (k in reach) reach[k as keyof typeof reach]++;
  const dil: number[] = [];
  for (const r of records) dil.push(...r.dilutionsPct);
  const byId: Record<string, number> = {};
  let fired = 0;
  let choices = 0;
  let suppressed = 0;
  let weeks = 0;
  const lethal: Record<string, number> = {};
  for (const r of records) {
    for (const f of r.fired) {
      byId[f.defId] = (byId[f.defId] ?? 0) + 1;
      fired++;
      if (f.choice) choices++;
    }
    suppressed += r.suppressed;
    weeks += r.weeks;
    for (const id of r.lethal) lethal[id] = (lethal[id] ?? 0) + 1;
  }
  const sortedKeys = (o: Record<string, number>): string[] => Object.keys(o).sort();
  const sortRecord = (o: Record<string, number>, f: (v: number) => number = (v) => v): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const k of sortedKeys(o)) out[k] = f(o[k] as number);
    return out;
  };
  return {
    runs: n,
    outcomes: sortRecord(outcomes),
    timedOut: records.filter((r) => r.timedOut).length,
    runLength: { ...pct(lens), mean: round(mean(lens), 2) },
    winRate: round(records.filter((r) => r.win).length / n),
    unicornRate: round((outcomes['unicorn'] ?? 0) / n),
    lossRate: round(records.filter((r) => r.kind === 'insolvent' || r.kind === 'ousted' || r.kind === 'burnout').length / n),
    meanScore: round(mean(scores), 2),
    score: pct(scores),
    reach: { safe: round(reach.safe / n), seed: round(reach.seed / n), a: round(reach.a / n), b: round(reach.b / n), c: round(reach.c / n) },
    dilution: { ...pct(dil), n: dil.length },
    events: {
      firedPerRun: round(fired / n, 2),
      choicePerRun: round(choices / n, 2),
      suppressedPerWeek: round(suppressed / Math.max(1, weeks), 5),
      byId: sortRecord(byId),
    },
    lethality: sortRecord(lethal, (v) => round(v / n)),
    violations: {
      offersOutOfBand: records.reduce((a, r) => a + r.offersOutOfBand, 0),
      captableInvariant: records.reduce((a, r) => a + r.captableInvariant, 0),
      payoutMismatch: records.reduce((a, r) => a + r.payoutMismatch, 0),
      stuck: records.reduce((a, r) => a + r.stuck, 0),
    },
    refusedCommands: records.reduce((a, r) => a + r.refused, 0),
  };
}

/** The report without any wall-clock field (what AC-9 compares byte for byte). */
export function stripTimings(r: Report): Report {
  const copy = JSON.parse(JSON.stringify(r)) as Report;
  delete copy.wallTimeMs;
  for (const p of Object.values(copy.policies)) delete p.wallTimeMs;
  return copy;
}

export const reportJson = (r: Report): string => `${JSON.stringify(r, null, 1)}\n`;

export function summaryTable(r: Report): string[] {
  const head = 'policy      win%   unicorn%  loss%  len p50  seriesA%  score    events/run  choice/run';
  const lines = [head];
  for (const [id, p] of Object.entries(r.policies)) {
    lines.push(
      `${id.padEnd(11)} ${(100 * p.winRate).toFixed(1).padStart(5)}  ${(100 * p.unicornRate).toFixed(1).padStart(7)}  ${(100 * p.lossRate).toFixed(1).padStart(5)}  ${String(p.runLength.p50).padStart(7)}  ${(100 * p.reach.a).toFixed(1).padStart(8)}  ${p.meanScore.toFixed(0).padStart(6)}  ${p.events.firedPerRun.toFixed(1).padStart(10)}  ${p.events.choicePerRun.toFixed(1).padStart(10)}`,
    );
  }
  return lines;
}
