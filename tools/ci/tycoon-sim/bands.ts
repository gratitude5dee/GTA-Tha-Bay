/**
 * Bands B1 to B12 of the Tycoon balance tool (08-tycoon-events.md section 8), read from `config/tycoon.bands.json`.
 * A band that fails makes the run exit non-zero; `pendingTune` lists ids that are known red (CI stays red, visibly).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { toolsRoot } from '../lib/common.ts';
import type { PolicyReport, Report } from './report.ts';

export interface BandsFile {
  v: 1;
  /** Band ids known to be out of band (the report says so; CI fails until they are fixed). */
  pendingTune: string[];
  bands: {
    B1: { policy: string; min: number; max: number };
    B2: { policy: string; min: number; max: number };
    B3: { policy: string; min: number; max: number };
    B4: { ratio: number };
    B5: { maxRate: number };
    B6: { ratio: number };
    B7: { policy: string; min: number; max: number };
    B8: { policy: string; eventsMin: number; eventsMax: number; choiceMin: number; choiceMax: number };
    B9: { maxRate: number };
    B10: { required: boolean };
    B11: { maxViolations: number };
    B12: { runs: number; maxSeconds: number };
  };
}

export const BANDS_PATH = path.join(toolsRoot, 'config', 'tycoon.bands.json');

export function loadBands(file: string = BANDS_PATH): BandsFile {
  const b = JSON.parse(readFileSync(file, 'utf8')) as BandsFile;
  if (b.v !== 1 || typeof b.bands !== 'object') throw new Error(`tycoon bands: ${file} is not a v1 bands file`);
  return b;
}

export interface BandResult {
  id: string;
  /** What the band says, in words. */
  want: string;
  got: string;
  pass: boolean;
  /** B12 only: logged, never asserted. */
  info?: boolean;
  /** The id is listed in `pendingTune`. */
  pending: boolean;
}

const pctText = (x: number): string => `${(100 * x).toFixed(1)} %`;

/** Evaluates every band that the report has the policies for. A band whose policy is absent is skipped. */
export function evaluateBands(report: Report, bandsFile: BandsFile): BandResult[] {
  const b = bandsFile.bands;
  const out: BandResult[] = [];
  const add = (id: string, want: string, got: string, pass: boolean, info = false): void => {
    out.push({ id, want, got, pass, pending: bandsFile.pendingTune.includes(id), ...(info ? { info: true } : {}) });
  };
  const pol = (id: string): PolicyReport | undefined => report.policies[id];
  const med = pol(b.B1.policy);

  if (med) {
    add('B1', `${b.B1.policy} median run length ${b.B1.min} to ${b.B1.max} weeks`, `${med.runLength.p50} weeks`, med.runLength.p50 >= b.B1.min && med.runLength.p50 <= b.B1.max);
    const a = med.reach.a * 100;
    add('B2', `${b.B2.policy} P(closed priced Series A) ${b.B2.min} to ${b.B2.max} %`, pctText(med.reach.a), a >= b.B2.min && a <= b.B2.max);
    const u = med.unicornRate * 100;
    add('B3', `${b.B3.policy} P(unicorn win) ${b.B3.min} to ${b.B3.max} %`, pctText(med.unicornRate), u >= b.B3.min && u <= b.B3.max);
    const others = Object.entries(report.policies).filter(([id]) => id !== b.B1.policy);
    if (others.length > 0) {
      const bad = others.filter(([, p]) => p.winRate > b.B4.ratio * med.winRate || p.meanScore > b.B4.ratio * med.meanScore).map(([id, p]) => `${id} win ${pctText(p.winRate)} score ${p.meanScore.toFixed(0)}`);
      add('B4', `every other policy: winRate and meanScore at most ${b.B4.ratio} x median (${pctText(med.winRate)}, ${med.meanScore.toFixed(0)})`, bad.length ? bad.join('; ') : 'none above', bad.length === 0);
    }
    const rnd = pol('random');
    if (rnd) add('B6', `random winRate at most ${b.B6.ratio} x median`, `${pctText(rnd.winRate)} vs ${pctText(med.winRate)}`, rnd.winRate <= b.B6.ratio * med.winRate);
    const d = med.dilution;
    add('B7', `${b.B7.policy} median dilution at seed and A ${b.B7.min} to ${b.B7.max} %`, `${d.p50} % (n ${d.n})`, d.n > 0 && d.p50 >= b.B7.min && d.p50 <= b.B7.max);
    add(
      'B8',
      `${b.B8.policy} events per run ${b.B8.eventsMin} to ${b.B8.eventsMax}, choice events ${b.B8.choiceMin} to ${b.B8.choiceMax}`,
      `${med.events.firedPerRun} events, ${med.events.choicePerRun} choice events`,
      med.events.firedPerRun >= b.B8.eventsMin && med.events.firedPerRun <= b.B8.eventsMax && med.events.choicePerRun >= b.B8.choiceMin && med.events.choicePerRun <= b.B8.choiceMax,
    );
  }

  // B5: lethality of every root event, every policy
  let worst = { id: '', policy: '', rate: 0 };
  for (const [pid, p] of Object.entries(report.policies)) for (const [eid, rate] of Object.entries(p.lethality)) if (rate > worst.rate) worst = { id: eid, policy: pid, rate };
  add('B5', `no root event followed by a lost run within 10 weeks in more than ${pctText(b.B5.maxRate)} of runs`, worst.id ? `${worst.id} (${worst.policy}) ${pctText(worst.rate)}` : 'none', worst.rate <= b.B5.maxRate);

  // B9: weekly cap
  let supp = { policy: '', rate: 0 };
  for (const [pid, p] of Object.entries(report.policies)) if (p.events.suppressedPerWeek > supp.rate) supp = { policy: pid, rate: p.events.suppressedPerWeek };
  add('B9', `suppressed events below ${pctText(b.B9.maxRate)} of weeks`, `${pctText(supp.rate)} (${supp.policy || 'none'})`, supp.rate < b.B9.maxRate);

  if (b.B10.required) {
    const d = report.determinism;
    add('B10', 'two executions identical and replay equals the live result', d ? `identical ${d.twiceIdentical}, ${d.replayMismatches} replay mismatches in ${d.runsChecked} runs` : 'not run', d !== undefined && d.twiceIdentical && d.replayMismatches === 0);
  }

  // B11
  let viol = 0;
  const parts: string[] = [];
  for (const [pid, p] of Object.entries(report.policies)) {
    const v = p.violations;
    const n = v.offersOutOfBand + v.captableInvariant + v.payoutMismatch;
    viol += n;
    if (n > 0) parts.push(`${pid}: offers ${v.offersOutOfBand}, invariant ${v.captableInvariant}, payout ${v.payoutMismatch}`);
  }
  add('B11', 'zero bot offers outside the envelope, zero CAPTABLE_INVARIANT, zero payouts different from proceeds', parts.length ? parts.join('; ') : 'zero', viol <= b.B11.maxViolations);

  // B12 is information only
  if (med?.wallTimeMs !== undefined) {
    const secPer10k = (med.wallTimeMs / 1000 / Math.max(1, med.runs)) * b.B12.runs;
    add('B12', `${b.B12.runs} median runs in at most ${b.B12.maxSeconds} s (logged, not asserted)`, `${secPer10k.toFixed(0)} s per ${b.B12.runs} runs`, true, true);
  }
  return out.sort((x, y) => (x.id.length === y.id.length ? (x.id < y.id ? -1 : 1) : x.id.length - y.id.length));
}

/** The ids that fail and are not excused. B12 never fails. */
export const failingBands = (rs: readonly BandResult[]): BandResult[] => rs.filter((r) => !r.pass && !r.info);

export function bandTable(rs: readonly BandResult[]): string[] {
  return rs.map((r) => `${r.pass ? 'PASS' : 'FAIL'}${r.pending ? ' (pendingTune)' : ''} ${r.id}: ${r.want} -> ${r.got}`);
}
