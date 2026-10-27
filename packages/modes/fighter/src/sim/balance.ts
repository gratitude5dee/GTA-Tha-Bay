/**
 * The CPU-vs-CPU bout runner behind `fighter:balance` (FC11) and the CPU level tests (M08b1). One bout is a full match on the pure
 * fight core with two `CpuDriver`s; the result carries the winner, the length and how the match ended. Sim code under the C02 lint:
 * no clock, no randomness beyond the seeded streams.
 */
import { FF, FIGHTER_BASE, Phase, St } from '@dv/shared/fight';
import type { FightRules, FighterSlotId, FrameDataPack, FightTuning } from '@dv/shared/fight';
import type { CpuLevel } from '../types.ts';
import { CpuDriver, kitInfo } from './cpu/index.ts';
import type { KitInfo } from './cpu/index.ts';
import { FighterMatch } from './match.ts';

export interface BoutResult {
  /** 0 or 1, or -1 for a draw (the tick cap). */
  winner: number;
  ticks: number;
  /** The match ended on a knockout (the loser's health is 0); false = time-out. */
  ko: boolean;
  checks: number;
  clears: number;
  shutdowns: number;
}

export const BALANCE_RULES: FightRules = {
  roundsToWin: 2, timerFrames: 5940, simpleDmgPct: 80, leniencyX100: 100, cpuLevel: [null, null], training: false, shutdowns: true, cinematics: 'off',
};

/** A bout that has not ended after this many ticks is a draw (three full rounds plus a sudden round and the finishers). */
export const TICK_CAP = 26_000;

export class KitCache {
  private readonly m = new Map<string, KitInfo>();
  constructor(readonly pack: FrameDataPack) {}
  get(slot: FighterSlotId): KitInfo {
    let k = this.m.get(slot);
    if (k === undefined) {
      k = kitInfo(this.pack.kits[slot], this.pack.tuning as FightTuning);
      this.m.set(slot, k);
    }
    return k;
  }
}

export interface BoutOptions {
  levels?: [CpuLevel, CpuLevel];
  rules?: Partial<FightRules>;
  /** Fighter ids; default the slot name in lower case. */
  ids?: [string, string];
}

export function playBout(cache: KitCache, a: FighterSlotId, b: FighterSlotId, seed: number, o: BoutOptions = {}): BoutResult {
  const levels = o.levels ?? [2, 2];
  const ids = o.ids ?? [a.toLowerCase(), b.toLowerCase()];
  const m = new FighterMatch({
    pack: cache.pack, rules: { ...BALANCE_RULES, ...o.rules, cpuLevel: levels }, seed, stage: 'powell_turntable',
    lineup: [{ slot: a, fighterId: ids[0], scheme: 'classic', costume: 0 }, { slot: b, fighterId: ids[1], scheme: 'classic', costume: 0 }],
  });
  const ka = cache.get(a), kb = cache.get(b);
  const d0 = new CpuDriver({ slot: 0, level: levels[0], seed: seed * 2 + 1, kit: ka, oppKit: kb });
  const d1 = new CpuDriver({ slot: 1, level: levels[1], seed: seed * 2 + 2, kit: kb, oppKit: ka });
  let checks = 0, clears = 0, shutdowns = 0;
  const prev = [0, 0];
  let prevPhase = -1;
  let t = 0;
  for (; t < TICK_CAP && !m.ended; t++) {
    const tick = m.tick;
    const i0 = d0.input(m.buf, tick), i1 = d1.input(m.buf, tick);
    m.step(i0, i1);
    for (let s = 0; s < 2; s++) {
      const st = m.buf[(FIGHTER_BASE[s] as number) + FF.State] as number;
      if (st === St.Clear && prev[s] !== St.Clear) clears++;
      if (st === St.Check && prev[s] !== St.Check) checks++;
      prev[s] = st;
    }
    const ph = m.phase;
    if (ph === Phase.Shutdown && prevPhase !== Phase.Shutdown) shutdowns++;
    prevPhase = ph;
  }
  const winner = m.ended ? m.winner : -1;
  const loser = winner === 0 ? 1 : 0;
  const ko = winner >= 0 && (m.buf[(FIGHTER_BASE[loser] as number) + FF.Hp] as number) <= 0;
  return { winner, ticks: t, ko, checks, clears, shutdowns };
}
