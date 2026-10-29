// packages/shared/src/fight/hit.ts — FC6: boxes, detection and resolution. Integer maths, squared distances, no allocation.
import type { Aabb2, Capsule2, HitDef } from './types.ts';
import { FF, FIGHTER_BASE, PROJ_BASE, PROJ_MAX, PROJ_WORDS, PW, RING_BASE } from './buffer.ts';
import type { CMove } from './pack.ts';
import { Cls } from './pack.ts';
import { FB } from './input.ts';
import { dirHas, ringDir, ringInput } from './motion.ts';
import { St, canBlockFrom, isActionable, isAirborne, isMoveState, isThrowable } from './states.ts';
import type { Ctx } from './ctx.ts';
import { MAX_CAND, emit, kitOf } from './ctx.ts';
import { addHype } from './meters.ts';
import { takeArmorTick } from './gimmicks.ts';

// ---- geometry ------------------------------------------------------------------------------------------------------
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Squared distance between segments P1Q1 and P2Q2 (Ericson, "Real-Time Collision Detection" 5.1.9). IEEE + - * / only. */
export function segDistSq(p1x: number, p1y: number, q1x: number, q1y: number, p2x: number, p2y: number, q2x: number, q2y: number): number {
  const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y, rx = p1x - p2x, ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
  let s = 0, t = 0;
  if (a === 0 && e === 0) return rx * rx + ry * ry;
  if (a === 0) { t = clamp01(f / e); }
  else {
    const cc = d1x * rx + d1y * ry;
    if (e === 0) { s = clamp01(-cc / a); }
    else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - cc * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-cc / a); }
      else if (t > 1) { t = 1; s = clamp01((b - cc) / a); }
    }
  }
  const c1x = p1x + d1x * s, c1y = p1y + d1y * s, c2x = p2x + d2x * t, c2y = p2y + d2y * t;
  const dx = c1x - c2x, dy = c1y - c2y;
  return dx * dx + dy * dy;
}

/** Capsule A at (ax, ay) facing fa against capsule B at (bx, by) facing fb: local x is mirrored by facing. */
export function capsulesOverlap(a: Capsule2, ax: number, ay: number, fa: number, b: Capsule2, bx: number, by: number, fb: number): boolean {
  const rr = a.r + b.r;
  return segDistSq(ax + fa * a.x1, ay + a.y1, ax + fa * a.x2, ay + a.y2, bx + fb * b.x1, by + b.y1, bx + fb * b.x2, by + b.y2) <= rr * rr;
}

const BOX = new Int32Array(4);   // scratch: minX, minY, maxX, maxY
export function aabbWorld(a: Aabb2, x: number, y: number, f: number, out: Int32Array = BOX): Int32Array {
  const lo = f >= 0 ? a.x : -(a.x + a.w);
  out[0] = x + lo; out[1] = y + a.y; out[2] = x + lo + a.w; out[3] = y + a.y + a.h;
  return out;
}

// ---- boxes of a fighter ---------------------------------------------------------------------------------------------
function stanceOf(c: Ctx, buf: Int32Array, i: number): 'stand' | 'crouch' | 'air' | 'down' {
  const o = FIGHTER_BASE[i] as number;
  const s = buf[o + FF.State] as number;
  switch (s) {
    case St.Crouch: case St.CrouchDown: case St.BlockCrouch: case St.HitCrouch: return 'crouch';
    case St.JumpN: case St.JumpF: case St.JumpB: case St.Fall: case St.HitAir: return 'air';
    case St.Knockdown: case St.Slumped: return 'down';
    case St.Attack: case St.Special: case St.Super: case St.Throw: case St.Auto: case St.AirAttack: case St.Taunt: case St.Shutdown: {
      const m = kitOf(c, i).moves[buf[o + FF.Move] as number];
      return m === undefined ? 'stand' : m.stance === 2 ? 'air' : m.stance === 1 ? 'crouch' : 'stand';
    }
    default: return 'stand';
  }
}
function curMove(c: Ctx, buf: Int32Array, i: number): CMove | undefined {
  const o = FIGHTER_BASE[i] as number;
  const s = buf[o + FF.State] as number;
  return isMoveState(s) ? kitOf(c, i).moves[buf[o + FF.Move] as number] : undefined;
}

export function hurtOf(c: Ctx, buf: Int32Array, i: number): Capsule2[] {
  const o = FIGHTER_BASE[i] as number;
  const m = curMove(c, buf, i);
  if (m !== undefined) {
    const mf = buf[o + FF.MoveFrame] as number;
    const tr = m.def.tracks;
    for (let k = 0; k < tr.length; k++) {
      const t = tr[k] as (typeof tr)[number];
      if (t.hurt !== undefined && mf >= t.from && mf <= t.to) return t.hurt;
    }
  }
  return kitOf(c, i).def.hurtDefault[stanceOf(c, buf, i)];
}
export function pushboxOf(c: Ctx, buf: Int32Array, i: number): Aabb2 {
  const o = FIGHTER_BASE[i] as number;
  const m = curMove(c, buf, i);
  if (m !== undefined) {
    const mf = buf[o + FF.MoveFrame] as number;
    const tr = m.def.tracks;
    for (let k = 0; k < tr.length; k++) {
      const t = tr[k] as (typeof tr)[number];
      if (t.push !== undefined && mf >= t.from && mf <= t.to) return t.push;
    }
  }
  const st = stanceOf(c, buf, i);
  const p = kitOf(c, i).def.push;
  return st === 'crouch' ? p.crouch : st === 'air' ? p.air : p.stand;
}
function throwBoxOf(m: CMove, mf: number): Aabb2 | undefined {
  const tr = m.def.tracks;
  for (let k = 0; k < tr.length; k++) {
    const t = tr[k] as (typeof tr)[number];
    if (t.throw !== undefined && mf >= t.from && mf <= t.to) return t.throw;
  }
  return undefined;
}

// invulnerability bits
export const INV_STRIKE = 1, INV_PROJ = 2, INV_THROW = 4, INV_ALL = 7;

/** FF.Invuln for this tick from move data and state (FC6.12). */
export function computeInvuln(c: Ctx, buf: Int32Array, i: number): void {
  const o = FIGHTER_BASE[i] as number;
  const s = buf[o + FF.State] as number;
  let inv = 0;
  const m = curMove(c, buf, i);
  if (m !== undefined) {
    const mf = buf[o + FF.MoveFrame] as number;
    const iv = m.def.invuln;
    for (let k = 0; k < iv.length; k++) {
      const e = iv[k] as (typeof iv)[number];
      if (mf >= e.from && mf <= e.to) inv |= e.kind === 'all' ? INV_ALL : e.kind === 'strike' ? INV_STRIKE : e.kind === 'projectile' ? INV_PROJ : INV_THROW;
    }
  }
  if (s === St.Knockdown || s === St.Slumped || s === St.Ko) inv |= INV_ALL;
  if (s === St.Wakeup && (buf[o + FF.StateFrame] as number) <= c.tun.WAKE_THROW_INVULN) inv |= INV_THROW;
  if (s === St.Clear && (buf[o + FF.StateFrame] as number) <= c.tun.CLEAR_INVULN) inv |= INV_ALL;
  if (isAirborne(s) || (buf[o + FF.Y] as number) > 0) inv |= INV_THROW;
  buf[o + FF.Invuln] = inv;
}

// ---- detection -----------------------------------------------------------------------------------------------------
function strikeLands(c: Ctx, buf: Int32Array, h: HitDef, ax: number, ay: number, af: number, v: number, kindBit: number): boolean {
  const ov = FIGHTER_BASE[v] as number;
  if (((buf[ov + FF.Invuln] as number) & kindBit) !== 0) return false;
  const vx = buf[ov + FF.X] as number, vy = buf[ov + FF.Y] as number, vf = buf[ov + FF.Facing] as number;
  const hurt = hurtOf(c, buf, v);
  for (let i = 0; i < h.boxes.length; i++) {
    for (let j = 0; j < hurt.length; j++) if (capsulesOverlap(h.boxes[i] as Capsule2, ax, ay, af, hurt[j] as Capsule2, vx, vy, vf)) return true;
  }
  return false;
}

function liveHit(m: CMove, mf: number): number {
  for (let k = 0; k < m.hits.length; k++) if (mf >= (m.hitFrom[k] as number) && mf <= (m.hitEnd[k] as number)) return k;
  return -1;
}

function pushCand(c: Ctx, a: number, kind: number, idx: number, hitNo: number, h: HitDef, mv: CMove | null, ex: boolean, simple: boolean): void {
  if (c.cN >= MAX_CAND) return;
  const n = c.cN;
  c.cAtk[n] = a; c.cKind[n] = kind; c.cIdx[n] = idx; c.cHitNo[n] = hitNo; c.cHit[n] = h;
  c.cMv[n] = mv; c.cEx[n] = ex ? 1 : 0; c.cSimple[n] = simple ? 1 : 0;
  c.cN++;
}

/** Collect every connecting hit against the start-of-step state, ordered by (attacker slot, hit index) (FC6.3). */
export function detect(c: Ctx, buf: Int32Array): void {
  c.cN = 0;
  for (let a = 0; a < 2; a++) {
    const v = 1 - a;
    const oa = FIGHTER_BASE[a] as number;
    const m = curMove(c, buf, a);
    if (m !== undefined && (buf[oa + FF.Hitstop] as number) === 0) {
      const mf = buf[oa + FF.MoveFrame] as number;
      const hi = liveHit(m, mf);
      if (hi >= 0) {
        const ex = (buf[oa + FF.Ex] as number) !== 0;
        const h = (ex ? m.exHits[hi] : m.hits[hi]) as HitDef;
        let ok = true;
        if (h.multi !== undefined) {
          const rel = mf - (m.hitFrom[hi] as number);
          ok = rel % h.multi.every === 0 && Math.trunc(rel / h.multi.every) < h.multi.max;
        } else ok = ((buf[oa + FF.GroupsDone] as number) & (1 << h.group)) === 0;
        if (ok) {
          const ax = buf[oa + FF.X] as number, ay = buf[oa + FF.Y] as number, af = buf[oa + FF.Facing] as number;
          let touch = false;
          if (h.guard === 'throw') {
            const tb = throwBoxOf(m, mf);
            if (tb !== undefined && ((buf[FIGHTER_BASE[v] as number + FF.Invuln] as number) & INV_THROW) === 0) {
              const w = aabbWorld(tb, ax, ay, af);
              const pb = pushboxOf(c, buf, v);
              const ovv = FIGHTER_BASE[v] as number;
              const pw = throwWorld(pb, buf[ovv + FF.X] as number, buf[ovv + FF.Y] as number, buf[ovv + FF.Facing] as number);
              touch = (w[0] as number) <= (pw[2] as number) && (w[2] as number) >= (pw[0] as number) && (w[1] as number) <= (pw[3] as number) && (w[3] as number) >= (pw[1] as number);
            } else if (tb === undefined) touch = strikeLands(c, buf, h, ax, ay, af, v, INV_THROW);
          } else touch = strikeLands(c, buf, h, ax, ay, af, v, INV_STRIKE);
          if (touch) pushCand(c, a, 0, hi, hi, h, m, ex, (buf[oa + FF.ViaSimple] as number) !== 0 && (m.cls === Cls.Special || (buf[oa + FF.State] as number) === St.Auto));
        }
      }
    }
    // projectiles owned by a, in pool order
    for (let p = 0; p < PROJ_MAX; p++) {
      const pb = PROJ_BASE + p * PROJ_WORDS;
      if ((buf[pb + PW.Owner] as number) !== a + 1) continue;
      if ((buf[pb + PW.Hitstop] as number) > 0 || (buf[pb + PW.Cool] as number) > 0) continue;
      const pd = kitOf(c, a).projs[buf[pb + PW.Def] as number];
      if (pd === undefined) continue;
      const h = (buf[pb + PW.Ex] as number) !== 0 && pd.exIdx >= 0 ? (kitOf(c, a).projs[pd.exIdx] as (typeof pd)).def.hit : pd.def.hit;
      if (strikeLands(c, buf, h, buf[pb + PW.X] as number, buf[pb + PW.Y] as number, buf[pb + PW.Dir] as number, v, INV_PROJ)) pushCand(c, a, 1, p, 0, h, null, (buf[pb + PW.Ex] as number) !== 0, false);
    }
  }
  // Strike beats throw on the same tick (FC6.3).
  for (let k = 0; k < c.cN; k++) {
    const h = c.cHit[k] as HitDef;
    if (c.cKind[k] !== 0 || h.guard !== 'throw') continue;
    const v = 1 - (c.cAtk[k] as number);
    for (let j = 0; j < c.cN; j++) {
      const hj = c.cHit[j] as HitDef;
      if ((c.cAtk[j] as number) === v && hj.guard !== 'throw') { c.cKind[k] = -1; break; }
    }
  }
}
const W4 = new Int32Array(4);
function throwWorld(pb: Aabb2, x: number, y: number, f: number): Int32Array { return aabbWorld(pb, x, y, f, W4); }

// ---- resolution ----------------------------------------------------------------------------------------------------
function guardMode(c: Ctx, buf: Int32Array, tick: number, v: number, h: HitDef): number {
  const o = FIGHTER_BASE[v] as number;
  if (!canBlockFrom(buf[o + FF.State] as number) || (buf[o + FF.Y] as number) !== 0) return 0;
  if (h.guard === 'unblockable' || h.guard === 'throw') return 0;
  const rb = RING_BASE[v] as number;
  const d = ringDir(buf, rb, tick, 0);
  const bl = (ringInput(buf, rb, tick, 0) & FB.BL) !== 0;
  const auto = c.autoBlock[v];
  if (!dirHas(d, 4) && !bl && !auto) return 0;
  const crouch = auto ? h.guard === 'low' : dirHas(d, 2);
  if (h.guard === 'low') return crouch ? 2 : 0;
  if (h.guard === 'overhead') return crouch ? 0 : 1;
  return crouch ? 2 : 1;
}

/** The poll armor tick only covers a fighter who is on his feet and free (not mid-hit, not blocking, not airborne). */
function isStrikeTarget(s: number): boolean { return isActionable(s); }

function armorActive(m: CMove | undefined, buf: Int32Array, o: number): boolean {
  if (m === undefined || m.def.armor === undefined) return false;
  const mf = buf[o + FF.MoveFrame] as number;
  return (buf[o + FF.ArmorLeft] as number) > 0 && mf >= m.def.armor.from && mf <= m.def.armor.to;
}

function setHitstop(buf: Int32Array, hs: number): void {
  for (let i = 0; i < 2; i++) {
    const o = FIGHTER_BASE[i] as number;
    if ((buf[o + FF.Hitstop] as number) < hs) buf[o + FF.Hitstop] = hs;
    buf[o + FF.BufMove] = Math.max(buf[o + FF.BufMove] as number, hs);
  }
}

function pushFighter(buf: Int32Array, o: number, signedTotal: number, frames: number): void {
  buf[o + FF.PushLeft] = signedTotal;
  buf[o + FF.PushTimer] = signedTotal === 0 ? 0 : frames;
}

function damageOf(c: Ctx, base: number, scale: number, counter: boolean, ex: boolean, exOverride: boolean, simple: boolean): number {
  let d = Math.trunc((base * scale) / 100);
  if (counter) d = Math.trunc((d * c.tun.COUNTER_DMG_PCT) / 100);
  if (ex && !exOverride) d = Math.trunc((d * c.tun.EX_DMG_PCT) / 100);
  if (simple) d = Math.trunc((d * c.rules.simpleDmgPct) / 100);
  return base > 0 && d < 1 ? 1 : d;
}

function loseHp(buf: Int32Array, ov: number, dmg: number, a: number, chip: boolean, c: Ctx): void {
  const hp = Math.max(0, (buf[ov + FF.Hp] as number) - dmg);
  buf[ov + FF.Hp] = hp;
  buf[ov + FF.LastHitBy] = (a + 1) | (chip ? 256 : 0);
  addHype(c, buf, ov, Math.trunc((dmg * c.tun.HYPE_ON_DAMAGE_PCT) / 100));
}

function markSpent(buf: Int32Array, isProj: boolean, pbase: number, oa: number, h: HitDef): void {
  if (isProj) {
    buf[pbase + PW.Hits] = (buf[pbase + PW.Hits] as number) - 1;
    buf[pbase + PW.Cool] = h.multi !== undefined ? h.multi.every : 8;
    if ((buf[pbase + PW.Hits] as number) <= 0) buf[pbase + PW.Owner] = 0;
  } else if (h.multi === undefined) buf[oa + FF.GroupsDone] = (buf[oa + FF.GroupsDone] as number) | (1 << h.group);
}

/** Resolve candidate `k`. Returns nothing; all effects land in the buffer. */
function applyCand(c: Ctx, buf: Int32Array, tick: number, k: number): void {
  const kind = c.cKind[k] as number;
  if (kind < 0) return;
  const a = c.cAtk[k] as number, v = 1 - a;
  const oa = FIGHTER_BASE[a] as number, ov = FIGHTER_BASE[v] as number;
  const h = c.cHit[k] as HitDef;
  const isProj = kind === 1;
  const mv = c.cMv[k] ?? undefined;
  const ex = c.cEx[k] !== 0;
  const simple = c.cSimple[k] !== 0;
  const vs = buf[ov + FF.State] as number;
  const af = buf[oa + FF.Facing] as number;
  const px = buf[ov + FF.X] as number, py = buf[ov + FF.Y] as number;
  const T = c.tun;
  const pbase = PROJ_BASE + (c.cIdx[k] as number) * PROJ_WORDS;


  // ---- throws ---------------------------------------------------------------------------------------------------
  if (h.guard === 'throw') {
    if (isProj) return;
    if (vs === St.TechThrow) return;
    if (!isThrowable(vs) || (buf[ov + FF.Y] as number) !== 0 || ((buf[ov + FF.Invuln] as number) & INV_THROW) !== 0) return;
    if (vs === St.Throw && Math.abs((buf[oa + FF.MoveFrame] as number) - (buf[ov + FF.MoveFrame] as number)) <= T.THROW_TECH) {
      for (let s = 0; s < 2; s++) {
        const o = FIGHTER_BASE[s] as number;
        buf[o + FF.State] = St.TechThrow; buf[o + FF.StateFrame] = 0; buf[o + FF.Stun] = T.THROW_TECH * 2 + 1;
        buf[o + FF.Move] = -1; buf[o + FF.MoveFrame] = 0; buf[o + FF.Hitstun] = 0;
        pushFighter(buf, o, -(buf[o + FF.Facing] as number) * 600, T.PUSH_FRAMES);
      }
      emit(c, tick, 'cue', a as 0 | 1, px, py, 1, 0);
      return;
    }
    const dmg = damageOf(c, h.damage, 100, false, ex, mv?.def.ex?.damage !== undefined, false);
    buf[ov + FF.State] = St.Thrown; buf[ov + FF.StateFrame] = 0; buf[ov + FF.Stun] = h.hitstun > 0 ? h.hitstun : 24;
    buf[ov + FF.Knockdown] = 2; buf[ov + FF.Move] = -1; buf[ov + FF.MoveFrame] = 0; buf[ov + FF.Hitstun] = 0;
    buf[ov + FF.ComboHits] = 1; buf[ov + FF.ComboDamage] = dmg; buf[ov + FF.Y] = 0; buf[ov + FF.VX] = 0; buf[ov + FF.VY] = 0;
    loseHp(buf, ov, dmg, a, false, c);
    pushFighter(buf, ov, af * h.pushHit, T.PUSH_FRAMES);
    addHype(c, buf, oa, h.hype.hit);
    buf[oa + FF.MoveResult] = 1;
    markSpent(buf, isProj, pbase, oa, h);
    setHitstop(buf, h.hitstop);
    emit(c, tick, 'hit', a as 0 | 1, px, py, dmg, 3);
    return;
  }

  // ---- parry ----------------------------------------------------------------------------------------------------
  if (vs === St.Check && (buf[ov + FF.StateFrame] as number) >= 1 && (buf[ov + FF.StateFrame] as number) <= T.CHECK_STARTUP - 1 + T.CHECK_ACTIVE && h.guard !== 'unblockable') {
    buf[ov + FF.State] = St.CheckSuccess; buf[ov + FF.StateFrame] = 0; buf[ov + FF.Stun] = T.CHECK_SUCCESS_RECOVERY;
    buf[ov + FF.Composure] = Math.min(T.COMPOSURE_MAX, (buf[ov + FF.Composure] as number) + T.CHECK_REFUND);
    if (!isProj) {
      buf[oa + FF.State] = St.HitStand; buf[oa + FF.StateFrame] = 0; buf[oa + FF.Hitstun] = T.CHECK_ATTACKER_STUN;
      buf[oa + FF.Move] = -1; buf[oa + FF.MoveFrame] = 0; buf[oa + FF.ComboHits] = 0;
    } else buf[pbase + PW.Owner] = 0;
    setHitstop(buf, h.hitstop);
    emit(c, tick, 'check', v as 0 | 1, px, py, 1, 0);
    return;
  }

  // ---- armor ----------------------------------------------------------------------------------------------------
  const vm = curMove(c, buf, v);
  const moveArmor = h.guard !== 'unblockable' && armorActive(vm, buf, ov);
  if (moveArmor || (h.guard !== 'unblockable' && isStrikeTarget(vs) && takeArmorTick(c, buf, v))) {
    const prev = buf[ov + FF.ComboHits] as number;
    const scale = Math.max(T.COMBO_SCALE[Math.min(prev, T.COMBO_SCALE.length - 1)] as number, mv?.minScale ?? T.SCALE_FLOOR);
    const dmg = Math.trunc(damageOf(c, h.damage, scale, false, ex, mv?.def.ex?.damage !== undefined, simple) / 2);
    if (moveArmor) buf[ov + FF.ArmorLeft] = (buf[ov + FF.ArmorLeft] as number) - 1;
    // A `counter` stance (patch) answers the absorbed strike: the move jumps to its last frame before startup ends.
    if (moveArmor && vm !== undefined && vm.def.tags.includes('counter')) buf[ov + FF.MoveFrame] = Math.max(buf[ov + FF.MoveFrame] as number, vm.S - 1);
    loseHp(buf, ov, dmg, a, false, c);
    addHype(c, buf, oa, h.hype.hit);
    buf[oa + FF.MoveResult] = 1;
    markSpent(buf, isProj, pbase, oa, h);
    setHitstop(buf, h.hitstop);
    emit(c, tick, 'hit', a as 0 | 1, px, py, dmg, 2);
    return;
  }

  // ---- block ----------------------------------------------------------------------------------------------------
  const gm = guardMode(c, buf, tick, v, h);
  if (gm !== 0) {
    const rattled = (buf[ov + FF.Rattled] as number) !== 0;
    let basis = damageOf(c, h.damage, 100, false, ex, mv?.def.ex?.damage !== undefined, simple);
    let chip = Math.trunc((basis * h.chipPermille) / 1000);
    if (rattled) chip = h.chipPermille === 0 ? Math.trunc((basis * 100) / 1000) : Math.trunc((chip * 3) / 2);
    basis = 0; void basis;
    if (!T.CHIP_KILLS && chip >= (buf[ov + FF.Hp] as number)) chip = (buf[ov + FF.Hp] as number) - 1;
    const bs = rattled ? Math.trunc((h.blockstun * 5) / 4) : h.blockstun;
    buf[ov + FF.State] = gm === 2 ? St.BlockCrouch : St.BlockStand; buf[ov + FF.StateFrame] = 0; buf[ov + FF.Blockstun] = bs;
    buf[ov + FF.Move] = -1; buf[ov + FF.MoveFrame] = 0;
    if (chip > 0) loseHp(buf, ov, chip, a, true, c);
    pushFighter(buf, ov, af * h.pushBlock, T.PUSH_FRAMES);
    if (Math.abs(px + af * h.pushBlock) >= T.STAGE_HALF_WIDTH) pushFighter(buf, oa, -af * h.pushBlock, T.PUSH_FRAMES);
    addHype(c, buf, oa, h.hype.block);
    buf[oa + FF.MoveResult] = 2;
    markSpent(buf, isProj, pbase, oa, h);
    setHitstop(buf, h.hitstop);
    emit(c, tick, 'block', v as 0 | 1, px, py, chip, ex ? 1 : 0);
    return;
  }

  // ---- hit ------------------------------------------------------------------------------------------------------
  const airborne = isAirborne(vs) || (buf[ov + FF.Y] as number) > 0;
  if (vs === St.HitAir && h.juggle.cost > (buf[ov + FF.JuggleLeft] as number)) return;   // no OTG / juggle limit: the hit whiffs the victim
  const prev = buf[ov + FF.ComboHits] as number;
  if (prev >= T.MAX_COMBO_HITS) {
    buf[ov + FF.State] = St.Knockdown; buf[ov + FF.StateFrame] = 0; buf[ov + FF.Knockdown] = 2; buf[ov + FF.Y] = 0; buf[ov + FF.VX] = 0; buf[ov + FF.VY] = 0;
    buf[ov + FF.Hitstun] = 0; buf[ov + FF.WakeFrames] = T.KNOCKDOWN; buf[ov + FF.ComboHits] = 0; buf[ov + FF.ComboDamage] = 0;
    buf[oa + FF.MoveResult] = 1; markSpent(buf, isProj, pbase, oa, h); setHitstop(buf, h.hitstop);
    emit(c, tick, 'hit', a as 0 | 1, px, py, 0, 4);
    return;
  }
  const counter = !airborne && isMoveState(vs) && vm !== undefined
    && ((buf[ov + FF.MoveFrame] as number) < vm.S || (buf[ov + FF.MoveFrame] as number) > vm.activeEnd);
  const scale = Math.max(T.COMBO_SCALE[Math.min(prev, T.COMBO_SCALE.length - 1)] as number, mv?.minScale ?? T.SCALE_FLOOR);
  const dmg = damageOf(c, h.damage, scale, counter, ex, mv?.def.ex?.damage !== undefined, simple);
  let stun = h.hitstun + (counter ? T.COUNTER_HITSTUN : 0);
  stun -= Math.min(T.HITSTUN_DECAY * prev, Math.trunc(h.hitstun / 2));
  if (stun < 1) stun = 1;
  const crouching = vs === St.Crouch || vs === St.CrouchDown || vs === St.BlockCrouch || vs === St.HitCrouch
    || (vm !== undefined && vm.stance === 1);
  buf[ov + FF.Move] = -1; buf[ov + FF.MoveFrame] = 0; buf[ov + FF.StateFrame] = 0; buf[ov + FF.Blockstun] = 0; buf[ov + FF.ArmorLeft] = 0;
  buf[ov + FF.CounterFlag] = counter ? 1 : 0;
  if (h.launch !== undefined || airborne) {
    const lv = h.launch;
    buf[ov + FF.State] = St.HitAir;
    buf[ov + FF.VX] = af * (lv !== undefined ? lv.vx : 12);
    buf[ov + FF.VY] = lv !== undefined ? lv.vy : 60;
    buf[ov + FF.Knockdown] = lv !== undefined && lv.kd === 'hard' ? 2 : 1;
    if (buf[ov + FF.Y] === 0) buf[ov + FF.Y] = 1;
    buf[ov + FF.JuggleLeft] = vs === St.HitAir ? (buf[ov + FF.JuggleLeft] as number) - h.juggle.cost : h.juggle.limit;
    buf[ov + FF.Hitstun] = stun;
  } else {
    buf[ov + FF.State] = crouching ? St.HitCrouch : St.HitStand;
    buf[ov + FF.Hitstun] = stun; buf[ov + FF.Knockdown] = 0; buf[ov + FF.JuggleLeft] = 0;
  }
  buf[ov + FF.ComboHits] = prev + 1;
  buf[ov + FF.ComboDamage] = (buf[ov + FF.ComboDamage] as number) + dmg;
  loseHp(buf, ov, dmg, a, false, c);
  pushFighter(buf, ov, af * h.pushHit, T.PUSH_FRAMES);
  if (Math.abs(px + af * h.pushHit) >= T.STAGE_HALF_WIDTH) pushFighter(buf, oa, -af * h.pushHit, T.PUSH_FRAMES);
  addHype(c, buf, oa, h.hype.hit);
  buf[oa + FF.MoveResult] = 1;
  markSpent(buf, isProj, pbase, oa, h);
  setHitstop(buf, h.hitstop);
  emit(c, tick, 'hit', a as 0 | 1, px, py, dmg, (counter ? 1 : 0) | (ex ? 2 : 0));
}

/** Resolve all candidates in order (FC6.3) and equalise hitstop over a trade. */
export function resolve(c: Ctx, buf: Int32Array, tick: number): void {
  for (let k = 0; k < c.cN; k++) applyCand(c, buf, tick, k);
}

