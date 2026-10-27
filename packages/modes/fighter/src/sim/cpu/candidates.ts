/**
 * The CPU candidate actions (FC10.2): approach, retreat, hold ground, block, jump in, anti-air, poke by range band, whiff punish,
 * throw, projectile, special, Check, Clear, EX and super, taunt. Each candidate is proposed by a named habit (habits.ts) and is
 * dropped when the level does not know that habit. `decide.ts` picks among the best-scored. Sim code under the C02 lint.
 */
import { Cls, FF, FIGHTER_BASE, isActionable, isAirborne, isBlockState, isHitState, isMoveState, St } from '@dv/shared/fight';
import type { Rng } from '@dv/shared';
import type { ActionKind, Decision, DecideEnv } from './decide.ts';
import type { MoveInfo } from './moves.ts';

export interface Cand { kind: ActionKind; move: number; ex: boolean; score: number; punish: boolean; habit: string }

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

/** The candidates of one decision; `now` is set instead when the CPU is not free to act (it holds a guard, or clears). */
export function candidates(env: DecideEnv): { cands: Cand[]; now: Decision | null } {
  const { buf, me, kit, ai, level, rng, percept: p, habits } = env;
  const state = w(buf, me, FF.State);
  const myX = w(buf, me, FF.X);
  const hype = w(buf, me, FF.Hype);
  const comp = w(buf, me, FF.Composure);
  const rattled = w(buf, me, FF.Rattled) !== 0;
  const cands: Cand[] = [];
  const has = (h: string): boolean => habits.has(h);
  const add = (kind: ActionKind, move: number, score: number, habit: string, punish = false, ex = false): void => {
    if (habit !== '' && !habits.has(habit)) return;
    cands.push({ kind, move, ex, score, punish, habit });
  };
  const idle = (): Decision => ({ kind: 'idle', move: -1, ex: false, score: 0, punish: false, habit: '' });
  add('idle', -1, 10, '');
  const blockPct = Math.max(0, Math.min(100, ai.blockRate + level.blockDelta));

  if (!isActionable(state) || !p.valid) {
    // Clear the Air out of a combo (once a round, 2,000 Composure).
    if ((isHitState(state) || isBlockState(state)) && p.valid && has('check_parry') && !rattled && comp >= 2000 && w(buf, me, FF.ClearUsed) === 0
      && (w(buf, me, FF.Hitstun) > 0 || w(buf, me, FF.Blockstun) > 0) && chance(rng, 15 + Math.trunc(level.blockDelta / 2))) {
      return { cands, now: { kind: 'clear', move: -1, ex: false, score: 250, punish: false, habit: 'check_parry' } };
    }
    // Not free to act (blockstun, hitstun, recovery) or nothing seen yet: hold whatever defence is up.
    return { cands, now: { ...idle(), kind: state === St.BlockCrouch ? 'crouchBlock' : state === St.BlockStand ? 'block' : 'idle' } };
  }

  const dx = Math.abs(p.x - myX);
  const oppMove = oppMoveOf(env);
  const oppAirborne = isAirborne(p.state) || p.y > 0;
  const cornered = Math.abs(myX) > 4800;
  const exOk = hype >= 1000;

  // ---- the opponent is in a move -------------------------------------------------------------------------------
  if (oppMove) {
    const active = p.moveFrame < oppMove.S + oppMove.A;
    const inReach = dx <= oppMove.reach + HURT_MARGIN + 150;
    if (active && inReach && oppMove.cls !== Cls.Super && oppMove.kind !== 'throw') {
      if (chance(rng, blockPct)) add(oppMove.low ? 'crouchBlock' : 'block', -1, 220, 'block_reach');
      else if (kit.antiAir.length > 0 && oppAirborne) add('move', kit.antiAir[0] as number, 150, 'anti_air');
      else if (!rattled && comp > 1200 && chance(rng, 6 + Math.trunc(level.blockDelta / 4))) add('check', -1, 215, 'check_parry');
    }
    // Punish: the opponent is recovering from an unsafe or whiffed move.
    const remaining = oppMove.T - p.moveFrame - env.delay;
    const adv = oppMove.advBlock;
    const unsafe = adv !== null && adv <= -4;
    const whiffed = dx > oppMove.reach + HURT_MARGIN + 100 && oppMove.R >= 12;
    if (!active && remaining > INPUT_LEAD && (unsafe || whiffed)) {
      let best: MoveInfo | null = null;
      for (const m of kit.moves) {
        if (m.damage <= 0 || m.kind === 'shutdown' || m.kind === 'taunt' || m.kind === 'auto' || m.kind === 'air' || m.role === 'stance') continue;
        if (m.cost > hype) continue;
        if (m.S + INPUT_LEAD > remaining) continue;
        if (unsafe && adv !== null && m.S > -adv) continue;
        if (dx > m.reach + HURT_MARGIN) continue;
        if (best === null || m.damage > best.damage) best = m;
      }
      if (best) add('move', best.idx, 400 + Math.min(100, best.damage / 20), 'punish_unsafe', true);
    }
  }

  // ---- projectile in flight -------------------------------------------------------------------------------------
  if (p.projCount > 0) {
    const pd = Math.abs(p.projX - myX);
    const toward = (p.projDir > 0 && p.projX < myX) || (p.projDir < 0 && p.projX > myX);
    if (toward && pd < 3000 && chance(rng, blockPct)) add('block', -1, 180, 'block_reach');
  }

  // ---- neutral ---------------------------------------------------------------------------------------------------
  const neutralOpp = !oppMove || p.moveFrame >= oppMove.S + oppMove.A;
  if (oppAirborne && dx < 1700 && kit.antiAir.length > 0 && chance(rng, ai.antiAir)) add('move', kit.antiAir[0] as number, 260, 'anti_air');
  if (!oppAirborne && neutralOpp && dx < 750 && kit.throwIdx >= 0 && chance(rng, ai.throwRate)) add('move', kit.throwIdx, 140, 'throw_close');
  if (!oppAirborne && neutralOpp && dx < 800) {
    for (const i of kit.grabs) if (chance(rng, ai.throwRate)) add('move', i, 150, 'throw_close');
  }
  if (!oppAirborne && neutralOpp) {
    for (const i of kit.pokes) {
      const m = kit.moves[i] as MoveInfo;
      if (dx <= m.reach + HURT_MARGIN) add('move', i, 60 + Math.trunc(ai.aggression / 2) + pick(rng, 30), 'poke_neutral');
    }
    for (const i of kit.heavies) {
      const m = kit.moves[i] as MoveInfo;
      if (dx <= m.reach + HURT_MARGIN - 100) add('move', i, 40 + Math.trunc(ai.aggression / 3) + pick(rng, 25), 'heavy_bait');
    }
    for (const i of kit.strikers) {
      const m = kit.moves[i] as MoveInfo;
      if (m.cost <= hype && dx <= m.reach + HURT_MARGIN) add('move', i, 70 + Math.trunc(ai.aggression / 3) + pick(rng, 25), 'heavy_bait');
    }
  }
  if (dx > 2000 && kit.projectiles.length > 0 && chance(rng, ai.zoning)) {
    const i = kit.projectiles[pick(rng, kit.projectiles.length)] as number;
    const m = kit.moves[i] as MoveInfo;
    if (m.cost <= hype) add('move', i, 110 + Math.trunc(ai.zoning / 2), 'fireball_zone', false, m.exMacro !== null && exOk && chance(rng, 25));
  }
  // Own traps or drones on the field: trigger them when the opponent is close.
  if (w(buf, me, FF.ProjActive) > 0 && dx < 1100) for (const i of kit.triggers) add('move', i, 130, 'fireball_zone');
  // Gimmick moves.
  if (!oppAirborne && neutralOpp && dx > 1500 && dx < 3600) {
    for (const i of kit.installs) {
      const m = kit.moves[i] as MoveInfo;
      if (m.cost <= hype && w(buf, me, FF.Gimmick1) === 0) add('move', i, 120, 'super_spend');
    }
  }
  if (!oppAirborne && neutralOpp && dx > 700 && dx < 1500 && !oppMove) {
    for (const i of kit.stances) if (chance(rng, 30)) add('move', i, 90, 'block_reach');
  }
  if (cornered && dx < 1300) {
    for (const i of kit.escapes) {
      const m = kit.moves[i] as MoveInfo;
      if (m.cost <= hype) add('move', i, 150, 'dash_in');
    }
  }
  // Guard up when close: a person anticipates what the reaction delay cannot catch. The better the level, the likelier.
  if (!oppAirborne && dx < 1250 && chance(rng, Math.trunc(blockPct / 2) + 10)) add(chance(rng, 35) ? 'crouchBlock' : 'block', -1, 95, 'block_reach');
  if (dx > 1100) {
    add('walkF', -1, 40 + Math.trunc(ai.aggression / 2) + pick(rng, 20), 'walk_in');
    if (dx > 2400 && chance(rng, ai.aggression)) add('dashF', -1, 55, 'dash_in');
    if (dx > 1500 && dx < 3000 && chance(rng, 10)) add('jumpIn', -1, 45, 'jump_in');
  } else if (dx < 650) {
    if (chance(rng, 100 - ai.aggression)) add('walkB', -1, 50, 'walk_in');
    if (chance(rng, 6)) add('dashB', -1, 48, 'dash_in');
  }
  // Hype: spend it on EX and supers, or build it with a taunt when nothing threatens.
  if (comp > 3000 && hype >= 1000) {
    for (const i of kit.supers) {
      const m = kit.moves[i] as MoveInfo;
      if (hype >= m.cost && dx <= m.reach + HURT_MARGIN && neutralOpp && chance(rng, 18)) add('move', i, 300, 'super_spend');
    }
    if (neutralOpp && dx < 900 && hype >= 2000) {
      for (const i of kit.strikers) {
        const m = kit.moves[i] as MoveInfo;
        if (m.exMacro !== null && dx <= m.reach + HURT_MARGIN && chance(rng, 20)) add('move', i, 130, 'super_spend', false, true);
      }
    }
  }
  if (dx > 3600 && neutralOpp && !oppAirborne && p.projCount === 0 && hype < 2400 && chance(rng, 8)) add('taunt', -1, 52, 'super_spend');
  return { cands, now: null };
}
