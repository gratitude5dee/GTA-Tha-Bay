/**
 * The CPU decision (FC10.2): once every 4 to 8 frames, on an even tick, the CPU scores the actions it has from what it SAW of the
 * opponent (`reaction` frames ago; perception.ts), its own meters and the frame data of both kits, and picks among the best few.
 * The punish rule is the spec's: the opponent's move was unsafe (`advBlock <= -4`) and a move of the CPU's with
 * `startup <= -advBlock` exists that still lands before the opponent recovers, counting the CPU's own delay. Scores are integers;
 * randomness comes from the CPU's own stream. Sim code under the C02 lint.
 */
import type { Rng } from '@dv/shared';
import { Cls, FF, FIGHTER_BASE, isActionable, isAirborne, isMoveState, St } from '@dv/shared/fight';
import type { AiProfile } from '@dv/shared/fight';
import type { CpuLevelParams } from './levels.ts';
import type { KitInfo, MoveInfo } from './moves.ts';
import type { Percept } from './perception.ts';

export type ActionKind = 'idle' | 'walkF' | 'walkB' | 'block' | 'crouchBlock' | 'jumpF' | 'dashF' | 'dashB' | 'move' | 'jumpIn' | 'taunt';

export interface Decision {
  kind: ActionKind;
  /** Move index in the CPU's kit for `move`. */
  move: number;
  score: number;
  punish: boolean;
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
}

interface Cand { kind: ActionKind; move: number; score: number; punish: boolean }

const w = (buf: Int32Array, slot: 0 | 1, word: number): number => buf[(FIGHTER_BASE[slot] as number) + word] as number;
const pick = (rng: Rng, n: number): number => Math.min(n - 1, Math.trunc(rng.nextFloat() * n));
const chance = (rng: Rng, pct: number): boolean => rng.nextFloat() * 100 < pct;

/** Margin beyond a move's reach at which a pushbox-wide hurtbox still touches it. */
const HURT_MARGIN = 280;
/** Frames between the decision and the first active frame of a move that is input at once (the buffer, the state change, the startup count). */
const INPUT_LEAD = 3;

function oppMoveOf(env: DecideEnv): MoveInfo | undefined {
  const p = env.percept;
  if (!p.valid || p.move < 0 || !isMoveState(p.state) || p.state === St.Taunt) return undefined;
  return env.oppKit.moves[p.move];
}

export function decide(env: DecideEnv): Decision {
  const { buf, me, kit, ai, level, rng, percept: p } = env;
  const state = w(buf, me, FF.State);
  const myX = w(buf, me, FF.X);
  const hype = w(buf, me, FF.Hype);
  const comp = w(buf, me, FF.Composure);
  const cands: Cand[] = [];
  const add = (kind: ActionKind, move: number, score: number, punish = false): void => { cands.push({ kind, move, score, punish }); };
  add('idle', -1, 10);
  if (!isActionable(state) || !p.valid) {
    // Not free to act (blockstun, hitstun, recovery) or nothing seen yet: hold whatever defence is up.
    return { kind: state === St.BlockCrouch ? 'crouchBlock' : state === St.BlockStand ? 'block' : 'idle', move: -1, score: 0, punish: false };
  }
  const dx = Math.abs(p.x - myX);
  const oppMove = oppMoveOf(env);
  const oppAirborne = isAirborne(p.state) || p.y > 0;
  const blockPct = Math.max(0, Math.min(100, ai.blockRate + level.blockDelta));

  // ---- the opponent is in a move -------------------------------------------------------------------------------
  if (oppMove) {
    const active = p.moveFrame < oppMove.S + oppMove.A;
    const inReach = dx <= oppMove.reach + HURT_MARGIN + 150;
    if (active && inReach && oppMove.cls !== Cls.Super && oppMove.kind !== 'throw') {
      if (chance(rng, blockPct)) add(oppMove.low ? 'crouchBlock' : 'block', -1, 220);
      else if (kit.antiAir.length > 0 && oppAirborne) add('move', kit.antiAir[0] as number, 150);
    }
    // Punish: the opponent is recovering from an unsafe or whiffed move.
    const remaining = oppMove.T - p.moveFrame - env.delay;
    const adv = oppMove.advBlock;
    const unsafe = adv !== null && adv <= -4;
    const whiffed = dx > oppMove.reach + HURT_MARGIN + 100 && oppMove.R >= 12;
    if (!active && remaining > INPUT_LEAD && (unsafe || whiffed)) {
      let best: MoveInfo | null = null;
      for (const m of kit.moves) {
        if (m.damage <= 0 || m.kind === 'shutdown' || m.kind === 'taunt' || m.kind === 'auto' || m.kind === 'air') continue;
        if (m.cost > hype) continue;
        if (m.S + INPUT_LEAD > remaining) continue;
        if (unsafe && adv !== null && m.S > -adv) continue;
        if (dx > m.reach + HURT_MARGIN) continue;
        if (best === null || m.damage > best.damage) best = m;
      }
      if (best) add('move', best.idx, 400 + Math.min(100, best.damage / 20), true);
    }
  }

  // ---- projectile in flight -------------------------------------------------------------------------------------
  if (p.projCount > 0) {
    const pd = Math.abs(p.projX - myX);
    const toward = (p.projDir > 0 && p.projX < myX) || (p.projDir < 0 && p.projX > myX);
    if (toward && pd < 3000 && chance(rng, blockPct)) add('block', -1, 180);
  }

  // ---- neutral ---------------------------------------------------------------------------------------------------
  const neutralOpp = !oppMove || p.moveFrame >= oppMove.S + oppMove.A;
  if (oppAirborne && dx < 1700 && kit.antiAir.length > 0 && chance(rng, ai.antiAir)) add('move', kit.antiAir[0] as number, 260);
  if (!oppAirborne && neutralOpp && dx < 750 && kit.throwIdx >= 0 && chance(rng, ai.throwRate)) add('move', kit.throwIdx, 140);
  if (!oppAirborne && neutralOpp) {
    for (const i of kit.pokes) {
      const m = kit.moves[i] as MoveInfo;
      if (dx <= m.reach + HURT_MARGIN) add('move', i, 60 + Math.trunc(ai.aggression / 2) + pick(rng, 30));
    }
    for (const i of kit.heavies) {
      const m = kit.moves[i] as MoveInfo;
      if (dx <= m.reach + HURT_MARGIN - 100) add('move', i, 40 + Math.trunc(ai.aggression / 3) + pick(rng, 25));
    }
  }
  if (dx > 2000 && kit.projectiles.length > 0 && chance(rng, ai.zoning)) {
    const choices = kit.projectiles;
    add('move', choices[pick(rng, choices.length)] as number, 110 + Math.trunc(ai.zoning / 2));
  }
  // Guard up when close: a person anticipates what the reaction delay cannot catch. The better the level, the likelier.
  if (!oppAirborne && dx < 1250 && chance(rng, Math.trunc(blockPct / 2) + 10)) add(chance(rng, 35) ? 'crouchBlock' : 'block', -1, 95);
  if (dx > 1100) {
    add('walkF', -1, 40 + Math.trunc(ai.aggression / 2) + pick(rng, 20));
    if (dx > 2400 && chance(rng, ai.aggression)) add('dashF', -1, 55);
    if (dx > 1500 && dx < 3000 && chance(rng, 10)) add('jumpIn', -1, 45);
  } else if (dx < 650) {
    if (chance(rng, 100 - ai.aggression)) add('walkB', -1, 50);
  }
  if (comp > 3000 && hype >= 1000) {
    for (const i of kit.supers) {
      const m = kit.moves[i] as MoveInfo;
      if (hype >= m.cost && dx <= m.reach + HURT_MARGIN && neutralOpp && level.habits >= 8 && chance(rng, 18)) add('move', i, 300);
    }
  }

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
