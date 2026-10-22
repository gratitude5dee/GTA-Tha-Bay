/**
 * Regression guard (08-tycoon-events.md section 8): `tests/tycoon/baseline.json` stores the last accepted per-policy statistics.
 * A statistic that moves by more than 2 percentage points (rates) or 8 weeks (lengths) fails the guard unless a commit message in
 * the range carries `balance-rebaseline: <reason>`; `pnpm tycoon:baseline` rewrites the file.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { toolsRoot } from '../lib/common.ts';
import type { Report } from './report.ts';

export const BASELINE_PATH = path.join(toolsRoot, 'tests', 'tycoon', 'baseline.json');
/** Percentage points for rates, weeks for lengths. */
export const RATE_LIMIT_PTS = 2;
export const LENGTH_LIMIT_WEEKS = 8;

export interface PolicyStats {
  winRate: number;
  unicornRate: number;
  lossRate: number;
  reachA: number;
  runLengthP50: number;
  runLengthP90: number;
}
export interface Baseline {
  v: 1;
  runsPerPolicy: number;
  seedBase: number;
  contentVersion: string;
  balanceVersion: string;
  policies: Record<string, PolicyStats>;
}

export function statsOf(r: Report): Record<string, PolicyStats> {
  const out: Record<string, PolicyStats> = {};
  for (const [id, p] of Object.entries(r.policies)) {
    out[id] = { winRate: p.winRate, unicornRate: p.unicornRate, lossRate: p.lossRate, reachA: p.reach.a, runLengthP50: p.runLength.p50, runLengthP90: p.runLength.p90 };
  }
  return out;
}

export function baselineOf(r: Report): Baseline {
  return { v: 1, runsPerPolicy: r.runsPerPolicy, seedBase: r.seedBase, contentVersion: r.contentVersion, balanceVersion: r.balanceVersion, policies: statsOf(r) };
}

export const baselineJson = (b: Baseline): string => `${JSON.stringify(b, null, 1)}\n`;

export function loadBaseline(file: string = BASELINE_PATH): Baseline | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Baseline;
  } catch {
    return null;
  }
}

export interface Move {
  policy: string;
  stat: string;
  was: number;
  now: number;
  limit: string;
}
export interface GuardResult {
  ok: boolean;
  moves: Move[];
  message: string;
}

const RATE_KEYS: (keyof PolicyStats)[] = ['winRate', 'unicornRate', 'lossRate', 'reachA'];
const LENGTH_KEYS: (keyof PolicyStats)[] = ['runLengthP50', 'runLengthP90'];

/** The statistics that moved beyond the limits. */
export function movesBetween(current: Record<string, PolicyStats>, baseline: Record<string, PolicyStats>): Move[] {
  const moves: Move[] = [];
  for (const [policy, now] of Object.entries(current)) {
    const was = baseline[policy];
    if (!was) continue;
    for (const k of RATE_KEYS) {
      if (Math.abs(now[k] - was[k]) * 100 > RATE_LIMIT_PTS) moves.push({ policy, stat: k, was: was[k], now: now[k], limit: `${RATE_LIMIT_PTS} points` });
    }
    for (const k of LENGTH_KEYS) {
      if (Math.abs(now[k] - was[k]) > LENGTH_LIMIT_WEEKS) moves.push({ policy, stat: k, was: was[k], now: now[k], limit: `${LENGTH_LIMIT_WEEKS} weeks` });
    }
  }
  return moves;
}

/** True when a commit message has a `balance-rebaseline: <reason>` line with a reason. */
export const hasRebaselineLine = (messages: string): boolean => /^balance-rebaseline:[ \t]*\S+/m.test(messages);

/**
 * The guard. With no moves it passes. With moves it fails, unless the commits carry the rebaseline line (then it passes and says
 * that the baseline file is stale until `pnpm tycoon:baseline` runs). Runs of another size than the baseline's are not compared.
 */
export function checkBaseline(report: Report, baseline: Baseline | null, commitMessages: string): GuardResult {
  if (!baseline) return { ok: true, moves: [], message: 'baseline: no tests/tycoon/baseline.json yet (run pnpm tycoon:baseline)' };
  if (baseline.runsPerPolicy !== report.runsPerPolicy || baseline.seedBase !== report.seedBase) {
    return { ok: true, moves: [], message: `baseline: skipped (baseline is ${baseline.runsPerPolicy} runs from seed base ${baseline.seedBase}, this run is ${report.runsPerPolicy} from ${report.seedBase})` };
  }
  const moves = movesBetween(statsOf(report), baseline.policies);
  if (moves.length === 0) return { ok: true, moves, message: 'baseline: no statistic moved beyond the limits' };
  const list = moves.map((m) => `${m.policy}.${m.stat} ${m.was} -> ${m.now} (limit ${m.limit})`).join('; ');
  if (hasRebaselineLine(commitMessages)) return { ok: true, moves, message: `baseline: moved (${list}); commit line balance-rebaseline present, run pnpm tycoon:baseline to refresh the file` };
  return { ok: false, moves, message: `baseline: FAIL ${list}. Add a commit line "balance-rebaseline: <reason>" and run pnpm tycoon:baseline` };
}

/** Commit messages of the branch: `DV_BALANCE_COMMITS` if set, else `<base>..HEAD` for the first base ref that exists, else HEAD. */
export function branchCommitMessages(env: NodeJS.ProcessEnv = process.env): string {
  if (env['DV_BALANCE_COMMITS'] !== undefined) return env['DV_BALANCE_COMMITS'];
  const git = (a: string[]): string | null => {
    const r = spawnSync('git', a, { cwd: toolsRoot, encoding: 'utf8' });
    return r.status === 0 ? r.stdout : null;
  };
  for (const base of [env['DV_BASE_REF'], env['GITHUB_BASE_REF'] ? `origin/${env['GITHUB_BASE_REF']}` : undefined, 'origin/main', 'origin/claude/build']) {
    if (!base) continue;
    const out = git(['log', '--format=%B', `${base}..HEAD`]);
    if (out !== null) return out;
  }
  return git(['log', '-1', '--format=%B']) ?? '';
}
