// packages/shared/src/fight/step.ts — FC3 tick order: ingest, intent, advance, detect/resolve, post. `FightCore` is the FightSim.
// Everything mutable lives in the Int32Array; the class only holds the immutable match configuration and scratch registers.
import type { FightEventSink, FightRules, FightSim, FighterLoadout } from './buffer.ts';
import {
  BUFFER_WORDS, FF, FIGHTER_BASE, FM, Phase, RF, RING_BASE, RNG_CPU, RNG_FIGHT,
} from './buffer.ts';
import type { FrameDataPack } from './types.ts';
import { FB, FB_ATTACK, FB_PUNCH, dir9 } from './input.ts';
import type { CMove } from './pack.ts';
import { Cls, compilePack, hashWords } from './pack.ts';
import {
  MATCH_EX, chordAt, dirHas, doubleTapNow, makeParseParams, matchMove, ringDir, ringInput, ringPush, risingAt, updateCharge,
} from './motion.ts';
import { St, isActionable, isAirborne, isBlockState, isHitState, isMoveState } from './states.ts';
import type { Ctx } from './ctx.ts';
import { Int, SCHEME_CLASSIC, SCHEME_POSE, SCHEME_SIMPLE, emit, kitOf, newCtx, ppxOf, psOf } from './ctx.ts';
import { aabbWorld, computeInvuln, detect, pushboxOf, resolve } from './hit.ts';
import { spendComposure, tickMeters } from './meters.ts';
import { spawnProjectile, stepProjectiles } from './projectiles.ts';
import {
  MODE_FIGHT, MODE_FINISH, MODE_FINISH_START, MODE_NONE, MODE_REACT, afterFight, inputLocked, phaseTick, resetRound,
} from './rounds.ts';
import { hashBuffer, rngSeed } from './hash.ts';

const g = (b: Int32Array, i: number): number => b[i] as number;
const ALL = (1 << Cls.Normal) | (1 << Cls.Command) | (1 << Cls.Special) | (1 << Cls.Super);
const NO_CHECK = -2;

function schemeId(s: string): number { return s === 'simple' ? SCHEME_SIMPLE : s === 'pose' ? SCHEME_POSE : SCHEME_CLASSIC; }
function schemeOk(m: CMove, sc: number): boolean {
  return sc === SCHEME_CLASSIC ? (m.sch & 1) !== 0 : sc === SCHEME_SIMPLE ? (m.sch & 2) !== 0 : (m.sch & 6) !== 0;
}

// ---- intent --------------------------------------------------------------------------------------------------------
function fillParse(c: Ctx, buf: Int32Array, i: number): void {
  const o = FIGHTER_BASE[i] as number;
  const ps = psOf(c, i);
  ps.chargeBack = g(buf, o + FF.ChargeBack); ps.chargeDown = g(buf, o + FF.ChargeDown);
  ps.dashImplied = g(buf, o + FF.DashFrames) < 0;
  ps.lastConsumed = g(buf, o + FF.BufAge);
  ps.canEx = g(buf, o + FF.Hype) >= c.tun.STOCK;
  const ext = g(buf, o + FF.BufMove);
  const px = ppxOf(c, i);
  px.bufN = c.pp.bufN + ext; px.bufS = c.pp.bufS + ext;
}

function pressedWithin(c: Ctx, buf: Int32Array, tick: number, i: number, mask: number, buffer: number): boolean {
  const rb = RING_BASE[i] as number;
  const lc = psOf(c, i).lastConsumed;
  for (let a = 0; a <= buffer; a++) {
    if (tick - a <= lc) break;
    if (risingAt(buf, rb, tick, a, mask) !== 0) return true;
  }
  return false;
}
function chordWithin(c: Ctx, buf: Int32Array, tick: number, i: number, mask: number, buffer: number): boolean {
  const rb = RING_BASE[i] as number;
  const lc = psOf(c, i).lastConsumed;
  for (let a = 0; a <= buffer; a++) {
    if (tick - a <= lc) break;
    if (chordAt(buf, rb, tick, a, mask, c.tun.CHORD_WINDOW)) return true;
  }
  return false;
}

/** Check works while any Composure is left; a Check that cannot be paid in full burns the gauge to 0 and leaves the fighter Rattled (BD-M08a1-06). */
function canCheck(_c: Ctx, buf: Int32Array, o: number): boolean {
  return g(buf, o + FF.Rattled) === 0 && g(buf, o + FF.Composure) > 0;
}

/** Classic parse over the kit's priority order: class (super > special > command > normal), then complexity. */
function pickClassic(c: Ctx, buf: Int32Array, tick: number, i: number, clsMask: number, chainStr: number, chainStance: number,
  air: boolean, allowCheck: boolean): number {
  const o = FIGHTER_BASE[i] as number, rb = RING_BASE[i] as number;
  const kit = kitOf(c, i), order = kit.parseOrder, sc = c.scheme[i] as number;
  const pp = ppxOf(c, i), ps = psOf(c, i);
  const hype = g(buf, o + FF.Hype);
  let checkDone = !allowCheck || sc !== SCHEME_CLASSIC;
  let best = -1, bestScore = -1, bestCls = 0, bestEx = 0;
  for (let k = 0; k < order.length; k++) {
    const m = kit.moves[order[k] as number] as CMove;
    if (best >= 0 && m.cls < bestCls) break;
    if (!checkDone && m.cls < Cls.Command) {
      checkDone = true;
      if (canCheck(c, buf, o) && chordWithin(c, buf, tick, i, FB.MP | FB.MK, pp.bufS)) return NO_CHECK;
    }
    if (((clsMask >> m.cls) & 1) === 0 || m.air !== air || !schemeOk(m, sc)) continue;
    if (sc !== SCHEME_CLASSIC && (m.cls === Cls.Special || m.cls === Cls.Super || m.pat === 3)) continue;   // Simple reaches these through SP, HY, L+H
    if (chainStr >= 0 && !(m.def.kind === 'normal' && m.strength > chainStr && m.stance === chainStance)) continue;
    if (m.cost > hype) continue;
    const r = matchMove(buf, rb, tick, m, pp, ps);
    if (r === 0) continue;
    // Inside the best class the freshest completion wins (a 236236 with no meter throws the fireball, not the 623 it also contains),
    // then the more complex pattern, then kit order (FC5.3 rule 4).
    const score = r >> 8;
    if (score > bestScore) { best = m.idx; bestScore = score; bestCls = m.cls; bestEx = (r & MATCH_EX) !== 0 ? 1 : 0; }
  }
  if (best >= 0) { c.iEx[i] = bestEx; return best; }
  if (!checkDone && canCheck(c, buf, o) && chordWithin(c, buf, tick, i, FB.MP | FB.MK, pp.bufS)) return NO_CHECK;
  return -1;
}

function throwInRange(c: Ctx, buf: Int32Array, i: number): boolean {
  const o = FIGHTER_BASE[i] as number, ov = FIGHTER_BASE[1 - i] as number;
  const dx = Math.abs(g(buf, ov + FF.X) - g(buf, o + FF.X));
  return g(buf, ov + FF.Y) === 0 && dx <= (c.throwReach[i] as number) + 300;
}

/** Simple-scheme actions (FC5.4): HY super, SP specials and EX, L+H throw or Check, AS auto-combo. */
function pickSimple(c: Ctx, buf: Int32Array, tick: number, i: number, clsMask: number, ground: boolean): number {
  const o = FIGHTER_BASE[i] as number, rb = RING_BASE[i] as number;
  const kit = kitOf(c, i), pp = ppxOf(c, i);
  const hype = g(buf, o + FF.Hype);
  c.iSimple[i] = 1;
  if ((clsMask & (1 << Cls.Super)) !== 0 && pressedWithin(c, buf, tick, i, FB.HY, pp.bufS)) {
    const l3 = kit.superL3 >= 0 && hype >= (kit.moves[kit.superL3] as CMove).cost ? kit.superL3 : -1;
    const l2 = kit.superL2 >= 0 && hype >= (kit.moves[kit.superL2] as CMove).cost ? kit.superL2 : -1;
    const pick = l3 >= 0 ? l3 : l2;
    if (pick >= 0) return pick;
  }
  if ((clsMask & (1 << Cls.Special)) !== 0) {
    const lc = psOf(c, i).lastConsumed;
    for (let a = 0; a <= pp.bufS; a++) {
      if (tick - a <= lc) break;
      if (risingAt(buf, rb, tick, a, FB.SP) === 0) continue;
      const d = ringDir(buf, rb, tick, a);
      const slot = dirHas(d, 6) ? 1 : dirHas(d, 2) ? 2 : 0;
      const mi = kit.simpleSpecial[slot] as number;
      if (mi < 0) break;
      const m = kit.moves[mi] as CMove;
      if (m.cost > hype) break;
      const exAsk = (ringInput(buf, rb, tick, a) & FB.AS) !== 0;
      c.iEx[i] = exAsk && m.hasEx && hype >= m.cost + c.tun.STOCK ? 1 : 0;
      return mi;
    }
  }
  if (ground && (clsMask & (1 << Cls.Command)) !== 0 && chordWithin(c, buf, tick, i, FB.LP | FB.HP, pp.bufS)) {
    if (kit.throwIdx >= 0 && throwInRange(c, buf, i)) return kit.throwIdx;
    if (canCheck(c, buf, o)) return NO_CHECK;
  }
  if (ground && (clsMask & (1 << Cls.Normal)) !== 0 && kit.autoIdx.length > 0 && pressedWithin(c, buf, tick, i, FB.AS, pp.bufN)
    && (ringInput(buf, rb, tick, 0) & FB.SP) === 0) {
    c.iArg[i] = 1;   // starts the auto-combo state
    return kit.autoIdx[0] as number;
  }
  c.iSimple[i] = 0;
  return -1;
}

function setMove(c: Ctx, i: number, mi: number): void {
  if (mi === NO_CHECK) { c.iKind[i] = Int.Check; return; }
  c.iKind[i] = Int.Move; c.iMove[i] = mi;
}

function clearAllowed(c: Ctx, buf: Int32Array, tick: number, i: number): boolean {
  const o = FIGHTER_BASE[i] as number;
  if (g(buf, o + FF.Rattled) !== 0 || g(buf, o + FF.Composure) < c.tun.CLEAR_COST || g(buf, o + FF.ClearUsed) !== 0) return false;
  return chordWithin(c, buf, tick, i, c.scheme[i] === SCHEME_CLASSIC ? FB.HP | FB.HK : FB.HP | FB.SP, ppxOf(c, i).bufN);
}

function computeIntent(c: Ctx, buf: Int32Array, tick: number, i: number): void {
  c.iKind[i] = Int.None; c.iMove[i] = -1; c.iEx[i] = 0; c.iSimple[i] = 0; c.iArg[i] = 0;
  const o = FIGHTER_BASE[i] as number, rb = RING_BASE[i] as number;
  if (g(buf, o + FF.Hitstop) > 0) return;
  const s = g(buf, o + FF.State);
  const sc = c.scheme[i] as number;
  const kit = kitOf(c, i);
  fillParse(c, buf, i);
  const d = ringDir(buf, rb, tick, 0);
  if (isActionable(s)) {
    let mi = sc !== SCHEME_CLASSIC ? pickSimple(c, buf, tick, i, ALL, true) : -1;
    if (mi === -1) mi = pickClassic(c, buf, tick, i, ALL, -1, 0, false, true);
    if (mi !== -1) { setMove(c, i, mi); return; }
    if (pressedWithin(c, buf, tick, i, FB.TA, ppxOf(c, i).bufN)) { c.iKind[i] = Int.Move; c.iMove[i] = kit.tauntIdx; return; }
    if (dirHas(d, 8)) { c.iKind[i] = Int.Jump; c.iArg[i] = dirHas(d, 6) ? 1 : dirHas(d, 4) ? 2 : 0; return; }
    const tap = c.pp.tap;
    if (doubleTapNow(buf, rb, tick, 6, tap)) { c.iKind[i] = Int.Dash; c.iArg[i] = 1; return; }
    if (doubleTapNow(buf, rb, tick, 4, tap)) { c.iKind[i] = Int.Dash; c.iArg[i] = 2; return; }
    if (risingAt(buf, rb, tick, 0, FB.DA) !== 0) { c.iKind[i] = Int.Dash; c.iArg[i] = dirHas(d, 4) ? 2 : 1; }
    return;
  }
  if (s === St.JumpN || s === St.JumpF || s === St.JumpB || s === St.Fall) {
    const mi = pickClassic(c, buf, tick, i, 1 << Cls.Normal, -1, 0, true, false);
    if (mi >= 0) setMove(c, i, mi);
    return;
  }
  if (isMoveState(s) && s !== St.Shutdown && s !== St.Taunt && s !== St.AirAttack) {
    const m = kit.moves[g(buf, o + FF.Move)];
    if (m === undefined) return;
    const mf = g(buf, o + FF.MoveFrame);
    const res = g(buf, o + FF.MoveResult);   // 0 whiff, 1 hit, 2 block
    let mask = 0, chain = false, jump = false, dash = false;
    const cs = m.def.cancels;
    for (let k = 0; k < cs.length; k++) {
      const e = cs[k] as (typeof cs)[number];
      if (mf < e.from || mf > e.to) continue;
      if (!e.on.includes(res === 1 ? 'hit' : res === 2 ? 'block' : 'whiff')) continue;
      if (e.into === 'chain') { mask |= 1 << Cls.Normal; chain = true; }
      else if (e.into === 'special') mask |= 1 << Cls.Special;
      else if (e.into === 'super') mask |= 1 << Cls.Super;
      else if (e.into === 'jump') jump = true;
      else dash = true;
    }
    if (mask !== 0) {
      let mi = sc !== SCHEME_CLASSIC ? pickSimple(c, buf, tick, i, mask & ~(1 << Cls.Normal), false) : -1;
      if (mi === -1) mi = pickClassic(c, buf, tick, i, mask, chain && (mask & ~(1 << Cls.Normal)) === 0 ? m.strength : (chain ? m.strength : -1), m.stance, false, false);
      if (mi >= 0) { setMove(c, i, mi); return; }
    }
    if (jump && dirHas(d, 8)) { c.iKind[i] = Int.Jump; c.iArg[i] = dirHas(d, 6) ? 1 : dirHas(d, 4) ? 2 : 0; return; }
    if (dash && doubleTapNow(buf, rb, tick, 6, c.pp.tap)) { c.iKind[i] = Int.Dash; c.iArg[i] = 1; }
    return;
  }
  if ((isHitState(s) || isBlockState(s)) && (g(buf, o + FF.Hitstun) > 0 || g(buf, o + FF.Blockstun) > 0) && clearAllowed(c, buf, tick, i)) {
    c.iKind[i] = Int.Clear;
  }
}

// ---- advance -------------------------------------------------------------------------------------------------------
function endCombo(buf: Int32Array, o: number): void {
  buf[o + FF.ComboHits] = 0; buf[o + FF.ComboDamage] = 0; buf[o + FF.JuggleLeft] = 0; buf[o + FF.Knockdown] = 0; buf[o + FF.CounterFlag] = 0;
  buf[o + FF.Hitstun] = 0; buf[o + FF.Blockstun] = 0;
}
function toIdle(buf: Int32Array, o: number): void {
  buf[o + FF.State] = St.Idle; buf[o + FF.StateFrame] = 0; buf[o + FF.Move] = -1; buf[o + FF.MoveFrame] = 0;
}

function startMove(c: Ctx, buf: Int32Array, tick: number, i: number, mi: number, ex: boolean, simple: boolean, auto = false): void {
  const o = FIGHTER_BASE[i] as number;
  const m = kitOf(c, i).moves[mi] as CMove;
  const cost = m.cost + (ex ? c.tun.STOCK : 0);
  buf[o + FF.Hype] = Math.max(0, g(buf, o + FF.Hype) - cost);
  const k = m.def.kind;
  buf[o + FF.State] = auto ? St.Auto : k === 'air' ? St.AirAttack : k === 'special' ? St.Special : k === 'super' ? St.Super : k === 'throw' ? St.Throw
    : k === 'taunt' ? St.Taunt : k === 'shutdown' ? St.Shutdown : k === 'auto' ? St.Auto : St.Attack;
  buf[o + FF.StateFrame] = 0; buf[o + FF.Move] = mi; buf[o + FF.MoveFrame] = 0;
  buf[o + FF.GroupsDone] = 0; buf[o + FF.MoveResult] = 0; buf[o + FF.Ex] = ex ? 1 : 0; buf[o + FF.ViaSimple] = simple ? 1 : 0;
  buf[o + FF.ArmorLeft] = m.def.armor !== undefined ? m.def.armor.hits : 0;
  buf[o + FF.BufAge] = tick; buf[o + FF.BufMove] = 0;
  buf[o + FF.ChargeBack] = 0; buf[o + FF.ChargeDown] = 0; buf[o + FF.DashFrames] = 0;
  if (auto) buf[o + FF.AiMacroStep] = 0;
  if (k === 'super') {
    c.freeze = Math.max(c.freeze, c.tun.SUPER_FREEZE);
    emit(c, tick, 'super', i as 0 | 1, g(buf, o + FF.X), g(buf, o + FF.Y), mi, ex ? 1 : 0);
  }
  if (k !== 'air') { buf[o + FF.VX] = 0; }
}

function airPhysics(buf: Int32Array, o: number, grav: number): boolean {
  buf[o + FF.X] = g(buf, o + FF.X) + g(buf, o + FF.VX);
  buf[o + FF.Y] = g(buf, o + FF.Y) + g(buf, o + FF.VY);
  buf[o + FF.VY] = g(buf, o + FF.VY) - grav;
  if (g(buf, o + FF.Y) <= 0 && g(buf, o + FF.VY) < 0) {
    buf[o + FF.Y] = 0; buf[o + FF.VY] = 0; buf[o + FF.VX] = 0;
    return true;
  }
  return false;
}

function finishMove(c: Ctx, buf: Int32Array, i: number, o: number, m: CMove, s: number): void {
  if (g(buf, o + FF.MoveResult) === 0 && m.hits.length > 0) addWhiff(c, buf, o, m);
  if (m.def.kind === 'taunt') { buf[o + FF.Hype] = Math.min(c.tun.HYPE_MAX, g(buf, o + FF.Hype) + c.tun.TAUNT_HYPE); }
  if (s === St.Auto) {
    const next = g(buf, o + FF.AiMacroStep) + 1;
    const kit = kitOf(c, i);
    if (next < kit.autoIdx.length && g(buf, o + FF.MoveResult) !== 0) {
      buf[o + FF.AiMacroStep] = next; buf[o + FF.Move] = kit.autoIdx[next] as number; buf[o + FF.MoveFrame] = 0;
      buf[o + FF.GroupsDone] = 0; buf[o + FF.MoveResult] = 0;
      return;
    }
  }
  if (s === St.Shutdown) { buf[o + FF.State] = St.Victory; buf[o + FF.Move] = -1; return; }
  if (s === St.AirAttack) { buf[o + FF.State] = St.JumpN; buf[o + FF.Move] = -1; return; }
  toIdle(buf, o);
}
function addWhiff(c: Ctx, buf: Int32Array, o: number, m: CMove): void {
  const h = (m.hits[0] as (typeof m.hits)[number]).hype.whiff;
  buf[o + FF.Hype] = Math.min(c.tun.HYPE_MAX, g(buf, o + FF.Hype) + h);
}

/** The auto-combo steps into its next move as soon as the current one has connected and its chain window is open. */
function autoStep(c: Ctx, buf: Int32Array, i: number, o: number, m: CMove): boolean {
  const kit = kitOf(c, i);
  const next = g(buf, o + FF.AiMacroStep) + 1;
  const res = g(buf, o + FF.MoveResult);
  if (next >= kit.autoIdx.length || res === 0) return false;
  const mf = g(buf, o + FF.MoveFrame);
  const cs = m.def.cancels;
  for (let k = 0; k < cs.length; k++) {
    const e = cs[k] as (typeof cs)[number];
    if (e.into === 'chain' && mf >= e.from && mf <= e.to && e.on.includes(res === 1 ? 'hit' : 'block')) {
      buf[o + FF.AiMacroStep] = next; buf[o + FF.Move] = kit.autoIdx[next] as number; buf[o + FF.MoveFrame] = 0;
      buf[o + FF.GroupsDone] = 0; buf[o + FF.MoveResult] = 0; buf[o + FF.StateFrame] = 0;
      return true;
    }
  }
  return false;
}

function runMove(c: Ctx, buf: Int32Array, tick: number, i: number, o: number, s: number): void {
  let m = kitOf(c, i).moves[g(buf, o + FF.Move)];
  if (m === undefined) { toIdle(buf, o); return; }
  if (s === St.Auto && autoStep(c, buf, i, o, m)) m = kitOf(c, i).moves[g(buf, o + FF.Move)] as CMove;
  const mf = g(buf, o + FF.MoveFrame) + 1;
  buf[o + FF.MoveFrame] = mf;
  const f = g(buf, o + FF.Facing);
  let mi = -1;
  for (let k = 0; k < m.motionFrame.length; k++) if ((m.motionFrame[k] as number) <= mf) mi = k;
  if (mi >= 0 && s !== St.AirAttack) {
    buf[o + FF.X] = g(buf, o + FF.X) + f * (m.motionVx[mi] as number);
    const vy = m.motionVy[mi] as number;
    if (vy !== 0) buf[o + FF.Y] = Math.max(0, g(buf, o + FF.Y) + vy);
  }
  if (s === St.AirAttack) {
    if (airPhysics(buf, o, kitOf(c, i).def.jump.gravity)) {
      buf[o + FF.State] = St.Land; buf[o + FF.StateFrame] = 0; buf[o + FF.Move] = -1; buf[o + FF.MoveFrame] = 0;
      return;
    }
  }
  for (let k = 0; k < m.spawnFrame.length; k++) {
    if ((m.spawnFrame[k] as number) !== mf) continue;
    const ex = g(buf, o + FF.Ex) !== 0;
    spawnProjectile(c, buf, i, m.spawnProj[k] as number, ex, m.spawnOx[k] as number, m.spawnOy[k] as number);
  }
  if (mf >= m.T) finishMove(c, buf, i, o, m, s);
  void tick;
}

function applyIntent(c: Ctx, buf: Int32Array, tick: number, i: number, o: number): void {
  const t = c.tun;
  switch (c.iKind[i]) {
    case Int.Move: startMove(c, buf, tick, i, c.iMove[i] as number, c.iEx[i] !== 0, c.iSimple[i] !== 0, c.iArg[i] === 1); break;
    case Int.Jump:
      buf[o + FF.State] = St.PreJump; buf[o + FF.StateFrame] = 0; buf[o + FF.AirKind] = c.iArg[i] as number;
      buf[o + FF.BufMove] = 0; buf[o + FF.DashFrames] = 0;
      break;
    case Int.Dash: {
      const fwd = c.iArg[i] === 1;
      buf[o + FF.State] = fwd ? St.DashF : St.DashB; buf[o + FF.StateFrame] = 0;
      buf[o + FF.DashFrames] = fwd ? kitOf(c, i).def.dash.f.frames : kitOf(c, i).def.dash.b.frames;
      break;
    }
    case Int.Check:
      spendComposure(c, buf, o, t.CHECK_COST);
      buf[o + FF.State] = St.Check; buf[o + FF.StateFrame] = 0; buf[o + FF.Move] = -1; buf[o + FF.BufAge] = tick;
      break;
    case Int.Clear: {
      spendComposure(c, buf, o, t.CLEAR_COST);
      buf[o + FF.ClearUsed] = 1; buf[o + FF.State] = St.Clear; buf[o + FF.StateFrame] = 0; buf[o + FF.BufAge] = tick;
      buf[o + FF.Y] = 0; buf[o + FF.VX] = 0; buf[o + FF.VY] = 0; endCombo(buf, o); buf[o + FF.Move] = -1;
      break;
    }
    default: break;
  }
}

function advance(c: Ctx, buf: Int32Array, tick: number, i: number): void {
  const o = FIGHTER_BASE[i] as number;
  const t = c.tun;
  if (g(buf, o + FF.Hitstop) > 0) { buf[o + FF.Hitstop] = g(buf, o + FF.Hitstop) - 1; return; }
  if (g(buf, o + FF.BufMove) > 0) buf[o + FF.BufMove] = g(buf, o + FF.BufMove) - 1;
  if (g(buf, o + FF.DashFrames) < 0) buf[o + FF.DashFrames] = g(buf, o + FF.DashFrames) + 1;
  applyIntent(c, buf, tick, i, o);
  const s = g(buf, o + FF.State);
  buf[o + FF.StateFrame] = g(buf, o + FF.StateFrame) + 1;
  const sf = g(buf, o + FF.StateFrame);
  const kit = kitOf(c, i).def;
  const f = g(buf, o + FF.Facing);
  switch (s) {
    case St.Idle: case St.WalkF: case St.WalkB: case St.Crouch: case St.CrouchDown: case St.StandUp: {
      const d = ringDir(buf, RING_BASE[i] as number, tick, 0);
      if (dirHas(d, 2)) buf[o + FF.State] = St.Crouch;
      else if (dirHas(d, 6)) { buf[o + FF.State] = St.WalkF; buf[o + FF.X] = g(buf, o + FF.X) + f * kit.walk.f; }
      else if (dirHas(d, 4)) { buf[o + FF.State] = St.WalkB; buf[o + FF.X] = g(buf, o + FF.X) - f * kit.walk.b; }
      else buf[o + FF.State] = St.Idle;
      break;
    }
    case St.DashF: case St.DashB: {
      const spec = s === St.DashF ? kit.dash.f : kit.dash.b;
      const k = sf - 1;
      const step = Math.trunc((spec.dist * (k + 1)) / spec.frames) - Math.trunc((spec.dist * k) / spec.frames);
      buf[o + FF.X] = g(buf, o + FF.X) + (s === St.DashF ? f : -f) * step;
      buf[o + FF.DashFrames] = g(buf, o + FF.DashFrames) - 1;
      if (sf >= spec.frames) { toIdle(buf, o); buf[o + FF.DashFrames] = s === St.DashF ? -t.DASH_IMPLY : 0; }
      break;
    }
    case St.PreJump:
      if (sf >= kit.jump.pre) {
        const kd = g(buf, o + FF.AirKind);
        buf[o + FF.State] = kd === 1 ? St.JumpF : kd === 2 ? St.JumpB : St.JumpN;
        buf[o + FF.VY] = kit.jump.v0;
        buf[o + FF.VX] = kd === 1 ? f * kit.jump.vxF : kd === 2 ? -f * kit.jump.vxB : 0;
        buf[o + FF.StateFrame] = 0;
      }
      break;
    case St.JumpN: case St.JumpF: case St.JumpB: case St.Fall:
      if (airPhysics(buf, o, kit.jump.gravity)) { buf[o + FF.State] = St.Land; buf[o + FF.StateFrame] = 0; }
      break;
    case St.Land:
      if (sf >= kit.jump.land) toIdle(buf, o);
      break;
    case St.Attack: case St.Special: case St.Super: case St.Throw: case St.Auto: case St.AirAttack: case St.Taunt: case St.Shutdown:
      runMove(c, buf, tick, i, o, s);
      break;
    case St.BlockStand: case St.BlockCrouch:
      buf[o + FF.Blockstun] = g(buf, o + FF.Blockstun) - 1;
      if (g(buf, o + FF.Blockstun) <= 0) { toIdle(buf, o); buf[o + FF.Blockstun] = 0; }
      break;
    case St.HitStand: case St.HitCrouch:
      buf[o + FF.Hitstun] = g(buf, o + FF.Hitstun) - 1;
      if (g(buf, o + FF.Hitstun) <= 0) { toIdle(buf, o); endCombo(buf, o); }
      break;
    case St.HitAir:
      if (airPhysics(buf, o, t.GRAVITY)) {
        buf[o + FF.State] = St.Knockdown; buf[o + FF.StateFrame] = 0; buf[o + FF.WakeFrames] = t.KNOCKDOWN; buf[o + FF.Hitstun] = 0;
        if (g(buf, o + FF.Knockdown) === 0) buf[o + FF.Knockdown] = 1;
      }
      break;
    case St.Thrown:
      buf[o + FF.Stun] = g(buf, o + FF.Stun) - 1;
      if (g(buf, o + FF.Stun) <= 0) { buf[o + FF.State] = St.Knockdown; buf[o + FF.StateFrame] = 0; buf[o + FF.WakeFrames] = t.KNOCKDOWN; buf[o + FF.Knockdown] = 2; }
      break;
    case St.TechThrow:
      buf[o + FF.Stun] = g(buf, o + FF.Stun) - 1;
      if (g(buf, o + FF.Stun) <= 0) { toIdle(buf, o); endCombo(buf, o); }
      break;
    case St.Knockdown:
      buf[o + FF.WakeFrames] = g(buf, o + FF.WakeFrames) - 1;
      if (g(buf, o + FF.WakeFrames) <= 0) {
        let quick = false;
        if (g(buf, o + FF.Knockdown) === 1) {
          const rb = RING_BASE[i] as number;
          let bits = 0, moved = false;
          for (let a = 0; a < 5; a++) { bits |= risingAt(buf, rb, tick, a, FB_ATTACK); if (ringDir(buf, rb, tick, a) !== 5) moved = true; }
          quick = moved && (bits & (bits - 1)) !== 0;
        }
        buf[o + FF.State] = St.Wakeup; buf[o + FF.StateFrame] = 0; buf[o + FF.RiseQuick] = quick ? 1 : 0;
        buf[o + FF.Knockdown] = 0;
      }
      break;
    case St.Wakeup:
      if (sf >= (g(buf, o + FF.RiseQuick) !== 0 ? t.QUICKRISE : t.WAKEUP)) { toIdle(buf, o); endCombo(buf, o); buf[o + FF.RiseQuick] = 0; }
      break;
    case St.Check:
      if (sf >= t.CHECK_STARTUP - 1 + t.CHECK_ACTIVE + t.CHECK_WHIFF_RECOVERY) toIdle(buf, o);
      break;
    case St.CheckSuccess:
      buf[o + FF.Stun] = g(buf, o + FF.Stun) - 1;
      if (g(buf, o + FF.Stun) <= 0) toIdle(buf, o);
      break;
    case St.Clear:
      if (sf === t.CLEAR_STARTUP) {
        const ov = FIGHTER_BASE[1 - i] as number;
        const away = g(buf, ov + FF.X) >= g(buf, o + FF.X) ? 1 : -1;
        buf[o + FF.PushLeft] = -away * 1200; buf[o + FF.PushTimer] = t.PUSH_FRAMES;
        if (Math.abs(g(buf, ov + FF.X) - g(buf, o + FF.X)) <= 3000 && g(buf, ov + FF.Hp) > 0) {
          const vs = g(buf, ov + FF.State);
          if (vs !== St.Ko && vs !== St.Knockdown) {
            buf[ov + FF.PushLeft] = away * 1200; buf[ov + FF.PushTimer] = t.PUSH_FRAMES;
            buf[ov + FF.State] = St.HitStand; buf[ov + FF.StateFrame] = 0; buf[ov + FF.Hitstun] = 14; buf[ov + FF.Move] = -1; buf[ov + FF.MoveFrame] = 0;
            buf[ov + FF.Y] = 0; buf[ov + FF.VX] = 0; buf[ov + FF.VY] = 0; buf[ov + FF.ComboHits] = 0;
          }
        }
      }
      if (sf >= t.CLEAR_TOTAL) toIdle(buf, o);
      break;
    default: break;
  }
  if (g(buf, o + FF.PushTimer) > 0) {
    const left = g(buf, o + FF.PushLeft), timer = g(buf, o + FF.PushTimer);
    const sign = left < 0 ? -1 : 1;
    const stepAbs = Math.ceil(Math.abs(left) / timer);
    buf[o + FF.X] = g(buf, o + FF.X) + sign * stepAbs;
    buf[o + FF.PushLeft] = left - sign * stepAbs;
    buf[o + FF.PushTimer] = timer - 1;
  }
}

// ---- post ----------------------------------------------------------------------------------------------------------
const PB0 = new Int32Array(4), PB1 = new Int32Array(4);

function flippable(buf: Int32Array, o: number): boolean {
  const s = g(buf, o + FF.State);
  if (g(buf, o + FF.Y) !== 0) return false;
  return isActionable(s) || isBlockState(s) || s === St.HitStand || s === St.HitCrouch || s === St.Knockdown || s === St.Wakeup
    || s === St.Land || s === St.PreJump || s === St.CheckSuccess || s === St.Check;
}

function post(c: Ctx, buf: Int32Array): void {
  const t = c.tun;
  const o0 = FIGHTER_BASE[0] as number, o1 = FIGHTER_BASE[1] as number;
  for (let i = 0; i < 2; i++) {
    const o = FIGHTER_BASE[i] as number;
    const x = g(buf, o + FF.X);
    if (x > t.STAGE_HALF_WIDTH) buf[o + FF.X] = t.STAGE_HALF_WIDTH;
    else if (x < -t.STAGE_HALF_WIDTH) buf[o + FF.X] = -t.STAGE_HALF_WIDTH;
  }
  aabbWorld(pushboxOf(c, buf, 0), g(buf, o0 + FF.X), g(buf, o0 + FF.Y), g(buf, o0 + FF.Facing), PB0);
  aabbWorld(pushboxOf(c, buf, 1), g(buf, o1 + FF.X), g(buf, o1 + FF.Y), g(buf, o1 + FF.Facing), PB1);
  const ox = Math.min(PB0[2] as number, PB1[2] as number) - Math.max(PB0[0] as number, PB1[0] as number);
  const oy = Math.min(PB0[3] as number, PB1[3] as number) - Math.max(PB0[1] as number, PB1[1] as number);
  if (ox > 0 && oy > 0) {
    const left = g(buf, o0 + FF.X) <= g(buf, o1 + FF.X) ? 0 : 1;
    const h = Math.trunc(ox / 2);
    const oL = left === 0 ? o0 : o1, oR = left === 0 ? o1 : o0;
    buf[oL + FF.X] = g(buf, oL + FF.X) - (ox - h);
    buf[oR + FF.X] = g(buf, oR + FF.X) + h;
    if (g(buf, oL + FF.X) < -t.STAGE_HALF_WIDTH) { const e = -t.STAGE_HALF_WIDTH - g(buf, oL + FF.X); buf[oL + FF.X] = -t.STAGE_HALF_WIDTH; buf[oR + FF.X] = g(buf, oR + FF.X) + e; }
    if (g(buf, oR + FF.X) > t.STAGE_HALF_WIDTH) { const e = g(buf, oR + FF.X) - t.STAGE_HALF_WIDTH; buf[oR + FF.X] = t.STAGE_HALF_WIDTH; buf[oL + FF.X] = g(buf, oL + FF.X) - e; }
    if (g(buf, oL + FF.X) < -t.STAGE_HALF_WIDTH) buf[oL + FF.X] = -t.STAGE_HALF_WIDTH;
    if (g(buf, oR + FF.X) > t.STAGE_HALF_WIDTH) buf[oR + FF.X] = t.STAGE_HALF_WIDTH;
  }
  const dx = g(buf, o1 + FF.X) - g(buf, o0 + FF.X);
  if (Math.abs(dx) > t.MAX_SEPARATION) {
    const far = Math.abs(g(buf, o0 + FF.X)) >= Math.abs(g(buf, o1 + FF.X)) ? o0 : o1;
    const other = far === o0 ? o1 : o0;
    buf[far + FF.X] = g(buf, other + FF.X) + (g(buf, far + FF.X) < g(buf, other + FF.X) ? -t.MAX_SEPARATION : t.MAX_SEPARATION);
  }
  if (flippable(buf, o0) && flippable(buf, o1)) {
    const d = g(buf, o1 + FF.X) - g(buf, o0 + FF.X);
    if (d > 0) { buf[o0 + FF.Facing] = 1; buf[o1 + FF.Facing] = -1; }
    else if (d < 0) { buf[o0 + FF.Facing] = -1; buf[o1 + FF.Facing] = 1; }
  }
}

function fightTick(c: Ctx, buf: Int32Array, tick: number, mode: number): void {
  const live = mode === MODE_FIGHT;
  c.iKind[0] = Int.None; c.iKind[1] = Int.None;
  if (live) { computeIntent(c, buf, tick, 0); computeIntent(c, buf, tick, 1); }
  c.freeze = 0;
  advance(c, buf, tick, 0);
  advance(c, buf, tick, 1);
  if (c.freeze > 0) {
    for (let i = 0; i < 2; i++) {
      const o = FIGHTER_BASE[i] as number;
      if (g(buf, o + FF.Hitstop) < c.freeze) buf[o + FF.Hitstop] = c.freeze;
    }
  }
  if (live) stepProjectiles(c, buf);
  computeInvuln(c, buf, 0);
  computeInvuln(c, buf, 1);
  if (live) { detect(c, buf); resolve(c, buf, tick); }
  post(c, buf);
  tickMeters(c, buf, FIGHTER_BASE[0] as number);
  tickMeters(c, buf, FIGHTER_BASE[1] as number);
  if (live) afterFight(c, buf, tick);
}

// ---- the FightSim --------------------------------------------------------------------------------------------------
export class FightCore implements FightSim {
  /** Match configuration; set by `init` and immutable afterwards. */
  c!: Ctx;

  init(pack: FrameDataPack, rules: FightRules, seed: number, lineup: [FighterLoadout, FighterLoadout]): Int32Array {
    const cp = compilePack(pack);
    const k0 = cp.kits.get(lineup[0].slot), k1 = cp.kits.get(lineup[1].slot);
    if (k0 === undefined || k1 === undefined) throw new Error(`fight: kit not in pack for ${lineup[0].slot} / ${lineup[1].slot}`);
    const pp = makeParseParams(pack.tuning, rules.leniencyX100);
    const c = newCtx(cp, rules, [k0, k1], [schemeId(lineup[0].scheme), schemeId(lineup[1].scheme)],
      [lineup[0].autoBlock === true, lineup[1].autoBlock === true], pp);
    for (let i = 0; i < 2; i++) {
      const kit = kitOf(c, i);
      const tm = kit.throwIdx >= 0 ? (kit.moves[kit.throwIdx] as CMove) : undefined;
      let reach = 900;
      if (tm !== undefined) for (const tr of tm.def.tracks) if (tr.throw !== undefined) reach = Math.max(reach, tr.throw.x + tr.throw.w);
      c.throwReach[i] = reach;
    }
    this.c = c;
    const buf = new Int32Array(BUFFER_WORDS);
    const [lo, hi] = hashWords(pack.hash);
    buf[FM.Seed] = seed | 0;
    buf[FM.FrameDataHashLo] = lo; buf[FM.FrameDataHashHi] = hi;
    buf[FM.Phase] = Phase.Ready;
    buf[FM.Round] = 1;
    buf[FM.Winner] = -1;
    buf[FM.RulesFlags] = (rules.training ? RF.Training : 0) | (rules.shutdowns ? RF.Shutdowns : 0)
      | (rules.cinematics === 'first' ? RF.CineFirst : rules.cinematics === 'always' ? RF.CineAlways : 0);
    rngSeed(buf, RNG_FIGHT, seed, 'fight');
    rngSeed(buf, RNG_CPU, seed, 'cpu');
    resetRound(c, buf, false);
    return buf;
  }

  step(buf: Int32Array, in0: number, in1: number, ev: FightEventSink): void {
    const c = this.c;
    c.ev = ev;
    const tick = g(buf, FM.Tick);
    const phase = g(buf, FM.Phase);
    const locked = inputLocked(phase);
    for (let i = 0; i < 2; i++) {
      const o = FIGHTER_BASE[i] as number;
      const raw = locked ? 0 : (i === 0 ? in0 : in1) & 0xffff;
      ringPush(buf, RING_BASE[i] as number, tick, raw, g(buf, o + FF.Facing));
      const d = ringDir(buf, RING_BASE[i] as number, tick, 0);
      buf[o + FF.ChargeBack] = updateCharge(g(buf, o + FF.ChargeBack), dirHas(d, 4), c.tun.CHARGE_GAP);
      buf[o + FF.ChargeDown] = updateCharge(g(buf, o + FF.ChargeDown), dirHas(d, 2), c.tun.CHARGE_GAP);
    }
    let mode = phaseTick(c, buf, tick);
    if (mode === MODE_FINISH_START) {
      const w = g(buf, FM.ShutdownWho) - 1;
      const wo = FIGHTER_BASE[w] as number;
      startMove(c, buf, tick, w, kitOf(c, w).shutdownIdx, false, false);
      buf[wo + FF.StateFrame] = 0;
      mode = MODE_FINISH;
    }
    if (mode === MODE_REACT || mode === MODE_FIGHT || mode === MODE_FINISH) fightTick(c, buf, tick, mode);
    buf[FM.Tick] = tick + 1;
  }

  hash(buf: Int32Array): [number, number] { return hashBuffer(buf); }
  snapshot(buf: Int32Array): Int32Array { return buf.slice(); }
  restore(buf: Int32Array, snap: Int32Array): void { buf.set(snap); }

  /** Put the match in a phase (the mode drives Intro; tests set Fight). */
  setPhase(buf: Int32Array, phase: number): void { buf[FM.Phase] = phase; buf[FM.PhaseFrame] = 0; }
}

export function createFightSim(): FightCore { return new FightCore(); }
export { MODE_NONE, FB_PUNCH, dir9, isAirborne };
