/**
 * fighter:bench (M08a2 AC-3). A CPU-vs-CPU match (Hard against Hard, rematch when it ends) steps 10,000 ticks three times; the best
 * p99 of the core step must stay at or under 0.10 ms, and a snapshot plus a restore at or under 0.1 ms. The CPU's own decision cost
 * is measured apart (it is not part of the core step). Exit 1 when a budget is missed.
 *
 *   pnpm --filter @dv/mode-fighter fighter:bench
 */
import { fighterPack } from '../src/sim/data.ts';
import { CpuDriver, kitInfo } from '../src/sim/cpu/index.ts';
import { FighterMatch } from '../src/sim/match.ts';
import { Phase } from '@dv/shared/fight';
import type { FightRules } from '@dv/shared/fight';
import type { FightTuning } from '@dv/shared/fight';

const STEPS = 10_000;
const RUNS = 3;
const STEP_P99_MS = 0.1;
const SNAP_MS = 0.1;

const pack = fighterPack();
const kitP = kitInfo(pack.kits.PLAYER_FIGHTER, pack.tuning as FightTuning);
const kitW = kitInfo(pack.kits.RAP_NEW_WAVE, pack.tuning as FightTuning);
const rules: FightRules = {
  roundsToWin: 2, timerFrames: 5940, simpleDmgPct: 80, leniencyX100: 100, cpuLevel: [2, 2], training: false, shutdowns: false, cinematics: 'off',
};
const now = (): number => performance.now();
const p99 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.99)] as number;

function fresh(seed: number): { m: FighterMatch; a: CpuDriver; b: CpuDriver } {
  const m = new FighterMatch({
    pack, rules, seed, stage: 'powell_turntable',
    lineup: [{ slot: 'PLAYER_FIGHTER', fighterId: 'player', scheme: 'classic', costume: 0 }, { slot: 'RAP_NEW_WAVE', fighterId: 'standin_rap_new_wave', scheme: 'classic', costume: 0 }],
  });
  return { m, a: new CpuDriver({ slot: 0, level: 2, seed: seed + 1, kit: kitP, oppKit: kitW }), b: new CpuDriver({ slot: 1, level: 2, seed: seed + 2, kit: kitW, oppKit: kitP }) };
}

interface Run { stepP99: number; stepMean: number; cpuP99: number; snapRestore: number }

function once(seed: number): Run {
  let { m, a, b } = fresh(seed);
  const steps: number[] = [], cpu: number[] = [], snaps: number[] = [];
  // warm-up so the JIT has seen every path
  for (let i = 0; i < 2000; i++) {
    if (m.phase === Phase.MatchEnd) ({ m, a, b } = fresh(seed + i));
    m.step(a.input(m.buf, m.tick), b.input(m.buf, m.tick));
  }
  for (let i = 0; i < STEPS; i++) {
    if (m.phase === Phase.MatchEnd) ({ m, a, b } = fresh(seed + 7 + i));
    const c0 = now();
    const wa = a.input(m.buf, m.tick), wb = b.input(m.buf, m.tick);
    const c1 = now();
    m.step(wa, wb);
    const c2 = now();
    cpu.push(c1 - c0);
    steps.push(c2 - c1);
    if (i % 100 === 0) {
      const s0 = now();
      const snap = m.snapshot();
      m.restore(snap);
      snaps.push(now() - s0);
    }
  }
  return { stepP99: p99(steps), stepMean: steps.reduce((s, x) => s + x, 0) / steps.length, cpuP99: p99(cpu), snapRestore: p99(snaps) };
}

const runs: Run[] = [];
for (let r = 0; r < RUNS; r++) runs.push(once(1000 + r * 31));
const best = runs.reduce((x, y) => (y.stepP99 < x.stepP99 ? y : x));
const bestSnap = Math.min(...runs.map((r) => r.snapRestore));
const f = (n: number): string => n.toFixed(4);
for (const [i, r] of runs.entries()) console.log(`run ${i + 1}: step p99 ${f(r.stepP99)} ms, mean ${f(r.stepMean)} ms; cpu p99 ${f(r.cpuP99)} ms; snapshot+restore p99 ${f(r.snapRestore)} ms`);
const okStep = best.stepP99 <= STEP_P99_MS;
const okSnap = bestSnap <= SNAP_MS;
console.log(`best of ${RUNS}: step p99 ${f(best.stepP99)} ms (budget ${STEP_P99_MS}) ${okStep ? 'OK' : 'OVER'}; snapshot+restore ${f(bestSnap)} ms (budget ${SNAP_MS}) ${okSnap ? 'OK' : 'OVER'}`);
process.exit(okStep && okSnap ? 0 : 1);
