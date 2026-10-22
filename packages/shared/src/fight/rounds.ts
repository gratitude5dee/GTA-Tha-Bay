// packages/shared/src/fight/rounds.ts — FC3 phases and FC8 items 1-3: rounds, KO, time-out, sudden round, Shutdown, Cinematic.
// `phaseTick` runs at the start of every tick and says what the fighters do this tick; `afterFight` scores a finished
// Fight tick. The camera directive (FC8.4) is M08a2.
import { FF, FIGHTER_BASE, FM, Phase, RF, RING_BASE } from './buffer.ts';
import type { Ctx } from './ctx.ts';
import { emit, kitOf } from './ctx.ts';
import { FB_ATTACK, FB } from './input.ts';
import { risingAt } from './motion.ts';
import { clearProjectiles } from './projectiles.ts';
import { St } from './states.ts';

/** What the fighters do on this tick. */
export const MODE_NONE = 0, MODE_REACT = 1, MODE_FIGHT = 2, MODE_FINISH = 3, MODE_FINISH_START = 4;

/** Rings carry raw input except while the phase locks it (Ready, Ko, TimeUp, RoundEnd, MatchEnd; FC3 table). */
export function inputLocked(phase: number): boolean {
  return phase === Phase.Ready || phase === Phase.Ko || phase === Phase.TimeUp || phase === Phase.RoundEnd || phase === Phase.MatchEnd || phase === Phase.Load;
}

/** Round-start reset (FC3 `Ready`: positions reset). Hype persists across rounds; everything else returns to its start value. */
export function resetRound(c: Ctx, buf: Int32Array, sudden: boolean): void {
  const t = c.tun;
  for (let i = 0; i < 2; i++) {
    const o = FIGHTER_BASE[i] as number;
    const hype = buf[o + FF.Hype] as number;
    buf.fill(0, o, o + 64);
    buf[o + FF.X] = i === 0 ? -t.START_X : t.START_X;
    buf[o + FF.Facing] = i === 0 ? 1 : -1;
    buf[o + FF.State] = St.Idle;
    buf[o + FF.Move] = -1;
    buf[o + FF.Hp] = sudden ? t.SUDDEN_HEALTH : kitOf(c, i).def.health;
    buf[o + FF.Hype] = hype;
    buf[o + FF.Composure] = t.COMPOSURE_MAX;
    buf[o + FF.BufAge] = -1;
    buf[o + FF.CheckTimer] = t.COMP_IDLE;
  }
  clearProjectiles(buf);
  buf[FM.Timer] = sudden ? t.SUDDEN : c.rules.timerFrames;
  buf[FM.SlowDiv] = 1;
  buf[FM.ShutdownWho] = 0;
  buf[FM.CinematicLeft] = 0;
  if (sudden) buf[FM.RulesFlags] = (buf[FM.RulesFlags] as number) | RF.Sudden;
  else buf[FM.RulesFlags] = (buf[FM.RulesFlags] as number) & ~(RF.Sudden | RF.KoEnd);
}

function toPhase(buf: Int32Array, phase: number): void {
  buf[FM.Phase] = phase;
  buf[FM.PhaseFrame] = 0;
}

function attackEdge(buf: Int32Array, tick: number): boolean {
  return risingAt(buf, RING_BASE[0] as number, tick, 0, FB_ATTACK) !== 0 || risingAt(buf, RING_BASE[1] as number, tick, 0, FB_ATTACK) !== 0;
}

function enterRoundEnd(buf: Int32Array): void {
  toPhase(buf, Phase.RoundEnd);
  buf[FM.SlowDiv] = 1;
  const hp0 = buf[(FIGHTER_BASE[0] as number) + FF.Hp] as number, hp1 = buf[(FIGHTER_BASE[1] as number) + FF.Hp] as number;
  for (let i = 0; i < 2; i++) {
    const o = FIGHTER_BASE[i] as number;
    const s = buf[o + FF.State] as number;
    if (s !== St.Ko && s !== St.Slumped) buf[o + FF.State] = (i === 0 ? hp0 >= hp1 : hp1 >= hp0) ? St.RoundWin : St.RoundLose;
    buf[o + FF.Move] = -1; buf[o + FF.Hitstun] = 0; buf[o + FF.Hitstop] = 0; buf[o + FF.PushTimer] = 0; buf[o + FF.PushLeft] = 0;
  }
}

function enterMatchEnd(c: Ctx, buf: Int32Array): void {
  toPhase(buf, Phase.MatchEnd);
  const w = buf[FM.Winner] as number;
  for (let i = 0; i < 2; i++) {
    const o = FIGHTER_BASE[i] as number;
    buf[o + FF.State] = i === w ? St.Victory : St.Defeat;
    buf[o + FF.Move] = -1;
  }
  emit(c, buf[FM.Tick] as number, 'round', w === 1 ? 1 : 0, 0, 0, w, 2);
}

/** Start-of-tick phase logic. Returns the MODE_* the fighters run this tick. */
export function phaseTick(c: Ctx, buf: Int32Array, tick: number): number {
  const t = c.tun;
  const phase = buf[FM.Phase] as number;
  switch (phase) {
    case Phase.Intro:
      buf[FM.PhaseFrame] = (buf[FM.PhaseFrame] as number) + 1;
      if (attackEdge(buf, tick) || (buf[FM.PhaseFrame] as number) >= t.INTRO_INGAME) toPhase(buf, Phase.Ready);
      return MODE_NONE;
    case Phase.Ready:
      buf[FM.PhaseFrame] = (buf[FM.PhaseFrame] as number) + 1;
      if ((buf[FM.PhaseFrame] as number) >= t.READY) {
        toPhase(buf, Phase.Fight);
        emit(c, tick, 'round', 0, 0, 0, buf[FM.Round] as number, 0);
      }
      return MODE_NONE;
    case Phase.Fight: {
      buf[FM.PhaseFrame] = (buf[FM.PhaseFrame] as number) + 1;
      if ((c.rules.timerFrames > 0 || ((buf[FM.RulesFlags] as number) & RF.Sudden) !== 0) && (buf[FM.Timer] as number) > 0) buf[FM.Timer] = (buf[FM.Timer] as number) - 1;
      return MODE_FIGHT;
    }
    case Phase.Ko: {
      if (tick % 3 !== 0) return MODE_NONE;
      buf[FM.PhaseFrame] = (buf[FM.PhaseFrame] as number) + 1;
      if ((buf[FM.PhaseFrame] as number) >= t.KO_SLOW) {
        const w = buf[FM.Winner] as number;
        const flags = buf[FM.RulesFlags] as number;
        const loser = w === 0 ? 1 : 0;
        const lo = FIGHTER_BASE[loser] as number;
        const eligible = w >= 0 && (flags & RF.Shutdowns) !== 0 && (flags & RF.Training) === 0 && (flags & RF.KoEnd) !== 0
          && (buf[(FIGHTER_BASE[w] as number) + FF.Hp] as number) > 0 && (buf[lo + FF.Hp] as number) <= 0
          && ((buf[lo + FF.LastHitBy] as number) & 256) === 0;
        for (let i = 0; i < 2; i++) {
          const o = FIGHTER_BASE[i] as number;
          if ((buf[o + FF.Hp] as number) <= 0) { buf[o + FF.State] = eligible ? St.Slumped : St.Ko; buf[o + FF.Y] = 0; buf[o + FF.VX] = 0; buf[o + FF.VY] = 0; }
        }
        buf[FM.SlowDiv] = 1;
        if (eligible) { toPhase(buf, Phase.Shutdown); buf[FM.ShutdownWho] = 0; } else enterRoundEnd(buf);
        return MODE_REACT;
      }
      return MODE_REACT;
    }
    case Phase.TimeUp:
      buf[FM.PhaseFrame] = (buf[FM.PhaseFrame] as number) + 1;
      if ((buf[FM.PhaseFrame] as number) >= t.TIME_UP) enterRoundEnd(buf);
      return MODE_NONE;
    case Phase.Shutdown: {
      buf[FM.PhaseFrame] = (buf[FM.PhaseFrame] as number) + 1;
      const w = buf[FM.Winner] as number;
      if ((buf[FM.ShutdownWho] as number) === 0) {
        if (w >= 0 && risingAt(buf, RING_BASE[w] as number, tick, 0, FB.HY) !== 0) {
          if (c.rules.cinematics !== 'off') { toPhase(buf, Phase.Cinematic); buf[FM.CinematicLeft] = t.CINEMATIC_HOLD; return MODE_NONE; }
          buf[FM.ShutdownWho] = w + 1;
          return MODE_FINISH_START;
        }
        if ((buf[FM.PhaseFrame] as number) >= t.SHUTDOWN_WINDOW) enterMatchEnd(c, buf);
        return MODE_NONE;
      }
      if ((buf[(FIGHTER_BASE[(buf[FM.ShutdownWho] as number) - 1] as number) + FF.State] as number) !== St.Shutdown) { enterMatchEnd(c, buf); return MODE_NONE; }
      return MODE_FINISH;
    }
    case Phase.Cinematic: {
      buf[FM.CinematicLeft] = (buf[FM.CinematicLeft] as number) - 1;
      if (attackEdge(buf, tick)) buf[FM.CinematicLeft] = 0;
      if ((buf[FM.CinematicLeft] as number) <= 0) {
        buf[FM.Phase] = Phase.Shutdown;
        buf[FM.ShutdownWho] = (buf[FM.Winner] as number) + 1;
        return MODE_FINISH_START;
      }
      return MODE_NONE;
    }
    case Phase.RoundEnd:
      buf[FM.PhaseFrame] = (buf[FM.PhaseFrame] as number) + 1;
      if ((buf[FM.PhaseFrame] as number) >= t.ROUND_END) {
        if ((buf[FM.Winner] as number) >= 0) enterMatchEnd(c, buf);
        else {
          const sudden = ((buf[FM.RulesFlags] as number) & RF.SuddenNext) !== 0;
          buf[FM.RulesFlags] = (buf[FM.RulesFlags] as number) & ~RF.SuddenNext;
          buf[FM.Round] = (buf[FM.Round] as number) + 1;
          resetRound(c, buf, sudden);
          toPhase(buf, Phase.Ready);
        }
      }
      return MODE_NONE;
    case Phase.MatchEnd:
      if ((buf[FM.PhaseFrame] as number) < t.MATCH_END) buf[FM.PhaseFrame] = (buf[FM.PhaseFrame] as number) + 1;
      return MODE_NONE;
    default:
      return MODE_NONE;
  }
}

/** Slot that wins a decided sudden-round tie-break: lower health loses, then more Hype, then slot 0. */
function suddenWinner(buf: Int32Array): number {
  const h0 = buf[(FIGHTER_BASE[0] as number) + FF.Hp] as number, h1 = buf[(FIGHTER_BASE[1] as number) + FF.Hp] as number;
  if (h0 !== h1) return h0 > h1 ? 0 : 1;
  const y0 = buf[(FIGHTER_BASE[0] as number) + FF.Hype] as number, y1 = buf[(FIGHTER_BASE[1] as number) + FF.Hype] as number;
  return y1 > y0 ? 1 : 0;
}

function score(c: Ctx, buf: Int32Array, win0: boolean, win1: boolean, ko: boolean): void {
  const target = c.rules.roundsToWin;
  const sudden = ((buf[FM.RulesFlags] as number) & RF.Sudden) !== 0;
  if (win0) buf[FM.RoundsWon0] = (buf[FM.RoundsWon0] as number) + 1;
  if (win1) buf[FM.RoundsWon1] = (buf[FM.RoundsWon1] as number) + 1;
  const d0 = (buf[FM.RoundsWon0] as number) >= target, d1 = (buf[FM.RoundsWon1] as number) >= target;
  if (sudden) buf[FM.Winner] = win0 ? 0 : 1;
  else if (d0 && d1) buf[FM.RulesFlags] = (buf[FM.RulesFlags] as number) | RF.SuddenNext;
  else if (d0) buf[FM.Winner] = 0;
  else if (d1) buf[FM.Winner] = 1;
  buf[FM.RulesFlags] = ko ? (buf[FM.RulesFlags] as number) | RF.KoEnd : (buf[FM.RulesFlags] as number) & ~RF.KoEnd;
}

/** After a full Fight tick: KO, time-out and sudden-round resolution (FC8.1). */
export function afterFight(c: Ctx, buf: Int32Array, tick: number): void {
  const o0 = FIGHTER_BASE[0] as number, o1 = FIGHTER_BASE[1] as number;
  const flags = buf[FM.RulesFlags] as number;
  if ((flags & RF.Training) !== 0) {
    for (let i = 0; i < 2; i++) { const o = FIGHTER_BASE[i] as number; if ((buf[o + FF.Hp] as number) < 1) buf[o + FF.Hp] = 1; }
    return;
  }
  const sudden = (flags & RF.Sudden) !== 0;
  const hp0 = buf[o0 + FF.Hp] as number, hp1 = buf[o1 + FF.Hp] as number;
  if (hp0 <= 0 || hp1 <= 0) {
    if (sudden) { const w = suddenWinner(buf); score(c, buf, w === 0, w === 1, true); }
    else score(c, buf, hp1 <= 0, hp0 <= 0, true);
    for (let i = 0; i < 2; i++) {
      const o = FIGHTER_BASE[i] as number;
      if ((buf[o + FF.Hp] as number) <= 0) { buf[o + FF.State] = (buf[o + FF.Y] as number) > 0 ? buf[o + FF.State] as number : St.Ko; buf[o + FF.Move] = -1; }
    }
    toPhase(buf, Phase.Ko);
    buf[FM.SlowDiv] = 3;
    emit(c, tick, 'ko', hp0 <= 0 ? 0 : 1, buf[(hp0 <= 0 ? o0 : o1) + FF.X] as number, 0, hp0 <= 0 ? 1 : 0, hp1 <= 0 ? 1 : 0);
    return;
  }
  if (sudden && (hp0 < c.tun.SUDDEN_HEALTH || hp1 < c.tun.SUDDEN_HEALTH)) {
    const w = suddenWinner(buf);
    const loser = w === 0 ? o1 : o0;
    buf[loser + FF.Hp] = 0;
    score(c, buf, w === 0, w === 1, true);
    buf[loser + FF.State] = St.Ko; buf[loser + FF.Move] = -1;
    toPhase(buf, Phase.Ko);
    buf[FM.SlowDiv] = 3;
    emit(c, tick, 'ko', w === 0 ? 1 : 0, buf[loser + FF.X] as number, 0, 0, 1);
    return;
  }
  if ((c.rules.timerFrames > 0 || sudden) && (buf[FM.Timer] as number) === 0) {
    if (sudden) { const w = suddenWinner(buf); score(c, buf, w === 0, w === 1, false); }
    else score(c, buf, hp0 >= hp1, hp1 >= hp0, false);
    toPhase(buf, Phase.TimeUp);
    emit(c, tick, 'round', 0, 0, 0, buf[FM.Round] as number, 1);
  }
}
