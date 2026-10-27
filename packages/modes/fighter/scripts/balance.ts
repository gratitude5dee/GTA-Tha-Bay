/**
 * `pnpm --filter @dv/mode-fighter fighter:balance [-- --bouts N] [--level 0..3] [--seed S] [--build ID] [--threads T] [--slots A,B,..] [--no-write] [--gate]`
 * (FC11). CPU against CPU for every pair of the eight roster kits, both sides, on worker threads, seeded. For each unordered pair it plays
 * `bouts` bouts with the first kit on the left and `bouts` with it on the right, and reports the win rate of the first kit (a draw counts a
 * half). Writes `balance/<build>.json`: the win-rate matrix, the mean match length, the KO / time-out split and the Check, Clear and
 * Shutdown rates. Exit 1 when a pair is outside 35 to 65 % (`--gate`, the default; `--no-gate` only prints).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { FighterSlotId } from '@dv/shared/fight';
import { loadPack } from '../src/pack-files.ts';
import { KitCache, playBout } from '../src/sim/balance.ts';
import type { CpuLevel } from '../src/types.ts';

const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), '..', '..', '..', '..');

export const ROSTER_SLOTS: readonly FighterSlotId[] = [
  'RAP_HYPHY_ELDER', 'RAP_LYRICIST', 'RAP_NEW_WAVE', 'TECH_VISIONARY', 'TECH_HACKER', 'ATH_SHOOTER', 'ATH_POWER_BACK', 'INFLUENCER',
];

interface Job { a: number; b: number; side: 0 | 1; from: number; to: number; level: CpuLevel; seed: number; slots: string[] }
interface Tally { a: number; b: number; side: 0 | 1; wins: number; draws: number; n: number; ticks: number; ko: number; checks: number; clears: number; shutdowns: number }

function runJob(j: Job, cache: KitCache): Tally {
  const t: Tally = { a: j.a, b: j.b, side: j.side, wins: 0, draws: 0, n: 0, ticks: 0, ko: 0, checks: 0, clears: 0, shutdowns: 0 };
  const sa = j.slots[j.a] as FighterSlotId, sb = j.slots[j.b] as FighterSlotId;
  for (let i = j.from; i < j.to; i++) {
    const seed = (j.seed + i * 7919 + j.a * 104729 + j.b * 1299709) | 0;
    const [x, y] = j.side === 0 ? [sa, sb] : [sb, sa];
    const r = playBout(cache, x, y, seed, { levels: [j.level, j.level] });
    t.n++; t.ticks += r.ticks; t.ko += r.ko ? 1 : 0; t.checks += r.checks; t.clears += r.clears; t.shutdowns += r.shutdowns;
    if (r.winner < 0) t.draws++;
    else if ((r.winner === 0) === (j.side === 0)) t.wins++;   // the first kit won
  }
  return t;
}

if (!isMainThread) {
  const cache = new KitCache(loadPack(root));
  parentPort?.on('message', (j: Job | 'stop') => {
    if (j === 'stop') { process.exit(0); }
    parentPort?.postMessage(runJob(j, cache));
  });
} else {
  void main();
}

function flag(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined && !(process.argv[i + 1] as string).startsWith('--') ? (process.argv[i + 1] as string) : dflt;
}

async function main(): Promise<void> {
  const bouts = Number(flag('bouts', '100'));
  const level = Number(flag('level', '2')) as CpuLevel;
  const seed = Number(flag('seed', '20261025'));
  const build = flag('build', 'dev');
  const threads = Math.max(1, Number(flag('threads', String(Math.max(1, os.availableParallelism())))));
  const slots = flag('slots', ROSTER_SLOTS.join(',')).split(',');
  const noWrite = process.argv.includes('--no-write');
  const gate = !process.argv.includes('--no-gate');
  const chunk = Math.max(1, Math.min(50, Math.ceil(bouts / 4)));

  const jobs: Job[] = [];
  for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
    for (const side of [0, 1] as const) for (let from = 0; from < bouts; from += chunk) jobs.push({ a, b, side, from, to: Math.min(bouts, from + chunk), level, seed, slots });
  }
  const results: Tally[] = [];
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    let next = 0, done = 0;
    const pool: Worker[] = [];
    const feed = (w: Worker): void => {
      if (next < jobs.length) w.postMessage(jobs[next++]);
      else { w.postMessage('stop'); }
    };
    for (let k = 0; k < Math.min(threads, jobs.length); k++) {
      // Node does not hand the tsx hooks of the main thread to a worker: the worker registers them itself, then loads this file.
      const w = new Worker(`import('tsx/esm/api').then((t) => { t.register(); return import(${JSON.stringify(pathToFileURL(here).href)}); });`, { eval: true });
      pool.push(w);
      w.on('message', (t: Tally) => {
        results.push(t);
        done++;
        if (done % Math.max(1, Math.trunc(jobs.length / 10)) === 0) process.stderr.write(`balance: ${done}/${jobs.length} jobs, ${Math.round((Date.now() - started) / 1000)} s\n`);
        if (done === jobs.length) resolve();
        feed(w);
      });
      w.on('error', reject);
      feed(w);
    }
  });
  void workerData;

  const n = slots.length;
  const wins: number[][] = slots.map(() => slots.map(() => 0));
  const games: number[][] = slots.map(() => slots.map(() => 0));
  const sideWins: number[][][] = slots.map(() => slots.map(() => [0, 0]));
  let ticks = 0, total = 0, ko = 0, checks = 0, clears = 0, shutdowns = 0;
  for (const t of results) {
    const score = t.wins + t.draws / 2;
    wins[t.a]![t.b]! += score; wins[t.b]![t.a]! += t.n - score;
    games[t.a]![t.b]! += t.n; games[t.b]![t.a]! += t.n;
    (sideWins[t.a]![t.b] as number[])[t.side] += score;
    ticks += t.ticks; total += t.n; ko += t.ko; checks += t.checks; clears += t.clears; shutdowns += t.shutdowns;
  }
  const matrix = slots.map((_, a) => slots.map((__, b) => (a === b || games[a]![b] === 0 ? null : Math.round((1000 * (wins[a]![b] as number)) / (games[a]![b] as number)) / 10)));
  const bad: string[] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const v = matrix[a]![b];
    if (v !== null && v !== undefined && (v < 35 || v > 65)) bad.push(`${slots[a]} vs ${slots[b]}: ${v} %`);
  }
  const report = {
    v: 1, build, level, bouts, seed, boutsPlayed: total,
    slots, winRatePct: matrix,
    meanTicks: Math.round(ticks / Math.max(1, total)), koPct: Math.round((1000 * ko) / Math.max(1, total)) / 10, timeoutPct: Math.round((1000 * (total - ko)) / Math.max(1, total)) / 10,
    checkPerBout: Math.round((100 * checks) / Math.max(1, total)) / 100, clearPerBout: Math.round((100 * clears) / Math.max(1, total)) / 100,
    shutdownPerBout: Math.round((100 * shutdowns) / Math.max(1, total)) / 100,
    outOfRange: bad,
  };
  const dir = path.join(root, 'packages', 'modes', 'fighter', 'balance');
  if (!noWrite) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${build}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  const pad = (s: string, k: number): string => s.padStart(k);
  console.log(`fighter:balance: ${total} bouts, level ${level}, mean ${report.meanTicks} ticks, KO ${report.koPct} % / time-out ${report.timeoutPct} %, ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`${''.padEnd(16)}${slots.map((s) => pad(s.slice(0, 7), 8)).join('')}`);
  for (let a = 0; a < n; a++) console.log(`${(slots[a] as string).padEnd(16)}${matrix[a]!.map((v) => pad(v === null ? '--' : String(v), 8)).join('')}`);
  console.log(`Check ${report.checkPerBout}/bout, Clear ${report.clearPerBout}/bout, Shutdown ${report.shutdownPerBout}/bout`);
  if (bad.length > 0) {
    console.error(`fighter:balance: ${bad.length} pair(s) outside 35-65 %:\n  ${bad.join('\n  ')}`);
    if (gate) process.exit(1);
  } else console.log('fighter:balance: every pair is inside 35-65 %');
}
