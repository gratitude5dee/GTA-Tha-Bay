/**
 * The CPU decision (FC10.2): once every 4 to 8 frames, on an even tick, the CPU scores the actions it has from what it SAW of the
 * opponent (`reaction` frames ago; perception.ts), its own meters and the frame data of both kits, and picks among the best few.
 * Every candidate belongs to a named habit (`content/fighter/ai/habits.json`); a level enables the first 3 / 5 / 8 / 12 habits of
 * the kit's list, so a harder level knows more ways to act. The punish rule is the spec's: the opponent's move was unsafe
 * (`advBlock <= -4`) and a move of the CPU's with `startup <= -advBlock` exists that still lands before the opponent recovers,
 * counting the CPU's own delay. Scores are integers; randomness comes from the CPU's own stream. Sim code under the C02 lint.
 */
import type { Rng } from '@dv/shared';
import { candidates } from './candidates.ts';
import type { Cand } from './candidates.ts';
import type { AiProfile } from '@dv/shared/fight';
import type { CpuLevelParams } from './levels.ts';
import type { KitInfo } from './moves.ts';
import type { Percept } from './perception.ts';

export type ActionKind = 'idle' | 'walkF' | 'walkB' | 'block' | 'crouchBlock' | 'jumpF' | 'dashF' | 'dashB' | 'move' | 'jumpIn' | 'taunt' | 'check' | 'clear';

export interface Decision {
  kind: ActionKind;
  /** Move index in the CPU's kit for `move`. */
  move: number;
  /** Play the EX script of the move. */
  ex: boolean;
  score: number;
  punish: boolean;
  /** The habit that proposed it ('' for the always-on reflexes). */
  habit: string;
}

export interface DecideEnv {
  me: 0 | 1;
  buf: Int32Array;
  kit: KitInfo;
  oppKit: KitInfo;
  ai: AiProfile;
  level: CpuLevelParams;
  rng: Rng;
  percept: Percept;
  /** The reaction delay in force for this decision, frames. */
  delay: number;
  /** Habits this level knows (a prefix of the kit's list). */
  habits: ReadonlySet<string>;
}

/** The decision of one look: the candidates are scored in candidates.ts; the best wins outright when it is a punish or a defence, else a weighted pick among the `level.habits` best. */
export function decide(env: DecideEnv): Decision {
  const { rng, level } = env;
  const { cands, now } = candidates(env);
  if (now !== null) return now;
  cands.sort((a, b) => b.score - a.score || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.move - b.move);
  // The best candidate wins outright when it is a punish or a defence; otherwise the CPU picks among its `habits` best, weighted by score.
  const top = cands[0] as Cand;
  if (top.punish || top.score >= 200) return top;
  const k = Math.max(1, Math.min(level.habits, cands.length));
  let total = 0;
  for (let i = 0; i < k; i++) total += (cands[i] as Cand).score;
  let roll = rng.nextFloat() * total;
  for (let i = 0; i < k; i++) {
    roll -= (cands[i] as Cand).score;
    if (roll < 0) return cands[i] as Cand;
  }
  return cands[0] as Cand;
}
