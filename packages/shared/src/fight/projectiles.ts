// packages/shared/src/fight/projectiles.ts — FC9: the pool of 16, the `linear` behaviour and the clash rule.
// `trap` (M08a2): a stationary zone that lives `life` frames and connects `hits` times; at most TRAP_CAP per owner (placing a third
// frees the oldest). A `trap` def whose id ends with `:trigger` is the trigger: spawning it fires no projectile and sets every own live trap off,
// turning it into its `:ex` def (the burst) with that def's life and hits. Other behaviours (sine, arc, orbit, summon) land in
// M08b1: `sine` (SINE64 path), `arc` (parabola, lands), `orbit` (a drone on ORBIT radius around its owner, max ORBIT_CAP, fires child defs)
// and `summon` (a crew member that stays where it was called and plays a cyclic list of child defs for its life).
import { FF, FIGHTER_BASE, PROJ_BASE, PROJ_MAX, PROJ_WORDS, PW } from './buffer.ts';
import type { Ctx } from './ctx.ts';
import { kitOf } from './ctx.ts';
import type { Capsule2 } from './types.ts';
import { capsulesOverlap } from './hit.ts';
import { detmath } from '../detmath.ts';

export const OWNER_CAP = 4;
export const TRAP_CAP = 2;
export const ORBIT_CAP = 2;
export const SUMMON_CAP = 1;
const LINEAR = 0, SINE = 1, ARC = 2, TRAP = 3, ORBIT = 4, SUMMON = 5;   // indices in pack.ts BEHAVIORS

/** sin(2 pi i / 64) scaled to +-127 (FC9): the sine path and the drone circle. Built once from the deterministic sine. */
export const SINE64: Int8Array = (() => {
  const t = new Int8Array(64);
  for (let i = 0; i < 64; i++) t[i] = Math.round(127 * detmath.sin((2 * Math.PI * i) / 64));
  return t;
})();
const sin64 = (i: number): number => SINE64[i & 63] as number;
const cos64 = (i: number): number => SINE64[(i + 16) & 63] as number;

export function clearProjectiles(buf: Int32Array): void {
  buf.fill(0, PROJ_BASE, PROJ_BASE + PROJ_MAX * PROJ_WORDS);
  buf[FIGHTER_BASE[0] as number + FF.ProjActive] = 0;
  buf[FIGHTER_BASE[1] as number + FF.ProjActive] = 0;
}

function countOwned(buf: Int32Array, owner: number): number {
  let n = 0;
  for (let p = 0; p < PROJ_MAX; p++) if ((buf[PROJ_BASE + p * PROJ_WORDS + PW.Owner] as number) === owner + 1) n++;
  return n;
}

/** Spawn kit projectile `pi` for `owner` at offset (ox, oy). At most OWNER_CAP per owner; false when the pool is full. */
export function spawnProjectile(c: Ctx, buf: Int32Array, owner: number, pi: number, ex: boolean, ox: number, oy: number): boolean {
  const o = FIGHTER_BASE[owner] as number;
  const f = buf[o + FF.Facing] as number;
  return place(c, buf, owner, pi, ex, (buf[o + FF.X] as number) + f * ox, (buf[o + FF.Y] as number) + oy, f);
}

/** The pool entry: kit projectile `pi` of `owner` at world (x, y) travelling in direction `dir`. */
function place(c: Ctx, buf: Int32Array, owner: number, pi: number, ex: boolean, x: number, y: number, dir: number): boolean {
  const proj = kitOf(c, owner).projs[pi];
  if (proj === undefined) return false;
  const use = ex && proj.exIdx >= 0 ? (kitOf(c, owner).projs[proj.exIdx] as typeof proj) : proj;
  if (proj.behavior === TRAP) {
    if (isTrigger(proj.id)) { detonate(c, buf, owner); return true; }
    limitTraps(c, buf, owner);
  } else if (proj.behavior === ORBIT) {
    if (isTrigger(proj.id)) { recall(c, buf, owner); return true; }
    limitKind(c, buf, owner, ORBIT, ORBIT_CAP);
  } else if (proj.behavior === SUMMON) {
    limitKind(c, buf, owner, SUMMON, SUMMON_CAP);
  }
  if (countOwned(buf, owner) >= OWNER_CAP) return false;
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((buf[b + PW.Owner] as number) !== 0) continue;
    const still = proj.behavior === TRAP || proj.behavior === ORBIT || proj.behavior === SUMMON;
    buf[b + PW.Owner] = owner + 1;
    buf[b + PW.Def] = proj.idx;
    buf[b + PW.X] = x;
    buf[b + PW.Y] = y;
    buf[b + PW.VX] = still ? 0 : dir * use.def.speed;
    buf[b + PW.VY] = proj.behavior === ARC ? (use.def.arc?.vy ?? 0) : 0;
    buf[b + PW.Life] = use.def.life;
    buf[b + PW.Hits] = use.def.hits;
    buf[b + PW.Frame] = 0;
    buf[b + PW.Dir] = dir;
    buf[b + PW.Ex] = ex && proj.exIdx >= 0 ? 1 : 0;
    buf[b + PW.Cool] = 0;
    buf[b + PW.Hitstop] = 0;
    buf[b + PW.OriginY] = y;
    buf[b + PW.Aux] = 0;
    // A second drone starts half a turn behind the first.
    buf[b + PW.Aux2] = proj.behavior === ORBIT && countKind(c, buf, owner, ORBIT) % 2 === 1 ? 32 : 0;
    return true;
  }
  return false;
}

function behaviorOf(c: Ctx, buf: Int32Array, p: number): number {
  const b = PROJ_BASE + p * PROJ_WORDS;
  const owner = (buf[b + PW.Owner] as number) - 1;
  if (owner < 0) return -1;
  const pd = kitOf(c, owner === 1 ? 1 : 0).projs[buf[b + PW.Def] as number];
  return pd === undefined ? -1 : pd.behavior;
}

function countKind(c: Ctx, buf: Int32Array, owner: number, behavior: number): number {
  let n = 0;
  for (let p = 0; p < PROJ_MAX; p++) if ((buf[PROJ_BASE + p * PROJ_WORDS + PW.Owner] as number) === owner + 1 && behaviorOf(c, buf, p) === behavior && !isTriggerAt(c, buf, p)) n++;
  return n;
}

/** Placing one entity of `behavior` beyond `cap` frees the owner's oldest of that kind (the one with the least life left). */
function limitKind(c: Ctx, buf: Int32Array, owner: number, behavior: number, cap: number): void {
  if (countKind(c, buf, owner, behavior) < cap) return;
  let oldest = -1, least = 0x7fffffff;
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((buf[b + PW.Owner] as number) !== owner + 1 || behaviorOf(c, buf, p) !== behavior) continue;
    const life = buf[b + PW.Life] as number;
    if (life < least) { least = life; oldest = p; }
  }
  if (oldest >= 0) free(buf, oldest);
}

/** The recall trigger: every drone of `owner` returns (is removed). */
function recall(c: Ctx, buf: Int32Array, owner: number): void {
  for (let p = 0; p < PROJ_MAX; p++) {
    if ((buf[PROJ_BASE + p * PROJ_WORDS + PW.Owner] as number) === owner + 1 && behaviorOf(c, buf, p) === ORBIT) free(buf, p);
  }
}

function isTriggerAt(c: Ctx, buf: Int32Array, p: number): boolean {
  const b = PROJ_BASE + p * PROJ_WORDS;
  const owner = (buf[b + PW.Owner] as number) - 1;
  const pd = kitOf(c, owner === 1 ? 1 : 0).projs[buf[b + PW.Def] as number];
  return pd !== undefined && isTrigger(pd.id);
}

const isTrigger = (id: string): boolean => id.endsWith(':trigger');

function isTrap(c: Ctx, buf: Int32Array, p: number): boolean {
  const b = PROJ_BASE + p * PROJ_WORDS;
  const owner = (buf[b + PW.Owner] as number) - 1;
  if (owner < 0) return false;
  const pd = kitOf(c, owner === 1 ? 1 : 0).projs[buf[b + PW.Def] as number];
  return pd !== undefined && pd.behavior === TRAP && !isTrigger(pd.id);
}

/** Placing a trap beyond TRAP_CAP frees the owner's oldest (the one with the least life left). */
function limitTraps(c: Ctx, buf: Int32Array, owner: number): void {
  let n = 0, oldest = -1, least = 0x7fffffff;
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((buf[b + PW.Owner] as number) !== owner + 1 || !isTrap(c, buf, p)) continue;
    n++;
    const life = buf[b + PW.Life] as number;
    if (life < least) { least = life; oldest = p; }
  }
  if (n >= TRAP_CAP && oldest >= 0) free(buf, oldest);
}

/** The trigger: every live trap of `owner` becomes its burst (`:ex` def), live for that def's life and hits. */
function detonate(c: Ctx, buf: Int32Array, owner: number): void {
  const kit = kitOf(c, owner);
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((buf[b + PW.Owner] as number) !== owner + 1 || !isTrap(c, buf, p) || (buf[b + PW.Ex] as number) !== 0) continue;
    const base = kit.projs[buf[b + PW.Def] as number];
    if (base === undefined || base.exIdx < 0) continue;
    const burst = kit.projs[base.exIdx] as typeof base;
    buf[b + PW.Ex] = 1;
    buf[b + PW.Life] = burst.def.life;
    buf[b + PW.Hits] = burst.def.hits;
    buf[b + PW.Frame] = 0;
    buf[b + PW.Cool] = 0;
  }
}

function free(buf: Int32Array, p: number): void {
  buf.fill(0, PROJ_BASE + p * PROJ_WORDS, PROJ_BASE + (p + 1) * PROJ_WORDS);
}

function defOf(c: Ctx, buf: Int32Array, p: number): { def: { hit: { boxes: Capsule2[] }; power: number; life: number } } | undefined {
  const b = PROJ_BASE + p * PROJ_WORDS;
  const owner = (buf[b + PW.Owner] as number) - 1;
  const pd = kitOf(c, owner === 1 ? 1 : 0).projs[buf[b + PW.Def] as number];
  if (pd === undefined) return undefined;
  return (buf[b + PW.Ex] as number) !== 0 && pd.exIdx >= 0 ? (kitOf(c, owner === 1 ? 1 : 0).projs[pd.exIdx] as typeof pd) : pd;
}

/** A drone or crew member fires the next child def of its list when its timer comes round (first at frame `first`, then every `every`). */
function fireChild(c: Ctx, buf: Int32Array, b: number, owner: number, proj: { def: { child?: { every: number; first: number } }; childIdx: Int32Array }, frame: number): void {
  const ch = proj.def.child;
  if (ch === undefined || proj.childIdx.length === 0 || frame < ch.first || (frame - ch.first) % ch.every !== 0) return;
  const k = buf[b + PW.Aux] as number;
  buf[b + PW.Aux] = k + 1;
  const pi = proj.childIdx[k % proj.childIdx.length] as number;
  if (pi < 0) return;
  place(c, buf, owner === 1 ? 1 : 0, pi, false, buf[b + PW.X] as number, buf[b + PW.Y] as number, buf[b + PW.Dir] as number);
}

/** One tick: move, age, expire, then clash (higher power wins, equal destroys both). */
export function stepProjectiles(c: Ctx, buf: Int32Array): void {
  const limit = c.tun.STAGE_HALF_WIDTH + 3000;
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((buf[b + PW.Owner] as number) === 0) continue;
    if ((buf[b + PW.Hitstop] as number) > 0) { buf[b + PW.Hitstop] = (buf[b + PW.Hitstop] as number) - 1; continue; }
    const owner = (buf[b + PW.Owner] as number) - 1;
    const proj = kitOf(c, owner === 1 ? 1 : 0).projs[buf[b + PW.Def] as number];
    const beh = proj === undefined ? LINEAR : proj.behavior;
    buf[b + PW.Frame] = (buf[b + PW.Frame] as number) + 1;
    buf[b + PW.Life] = (buf[b + PW.Life] as number) - 1;
    if ((buf[b + PW.Cool] as number) > 0) buf[b + PW.Cool] = (buf[b + PW.Cool] as number) - 1;
    const frame = buf[b + PW.Frame] as number;
    if (proj !== undefined && beh === ORBIT) {
      const oo = FIGHTER_BASE[owner === 1 ? 1 : 0] as number;
      const spec = proj.def.orbit ?? { radius: 600, period: 120, height: 1400 };
      const ang = Math.trunc((frame * 64) / spec.period) + (buf[b + PW.Aux2] as number);
      buf[b + PW.X] = (buf[oo + FF.X] as number) + Math.trunc((cos64(ang) * spec.radius) / 127);
      buf[b + PW.Y] = (buf[oo + FF.Y] as number) + spec.height + Math.trunc((sin64(ang) * (spec.radius >> 1)) / 127);
      fireChild(c, buf, b, owner, proj, frame);
    } else if (proj !== undefined && beh === SUMMON) {
      fireChild(c, buf, b, owner, proj, frame);
    } else {
      buf[b + PW.X] = (buf[b + PW.X] as number) + (buf[b + PW.VX] as number);
      if (beh === SINE && proj !== undefined) {
        const sp = proj.def.sine ?? { amp: 400, period: 48 };
        buf[b + PW.Y] = (buf[b + PW.OriginY] as number) + Math.trunc((sin64(Math.trunc((frame * 64) / sp.period)) * sp.amp) / 127);
      } else if (beh === ARC && proj !== undefined) {
        buf[b + PW.Y] = (buf[b + PW.Y] as number) + (buf[b + PW.VY] as number);
        buf[b + PW.VY] = (buf[b + PW.VY] as number) - (proj.def.arc?.gravity ?? 9);
        if ((buf[b + PW.Y] as number) <= 0) buf[b + PW.Life] = 0;   // the arc lands
      } else buf[b + PW.Y] = (buf[b + PW.Y] as number) + (buf[b + PW.VY] as number);
    }
    const x = buf[b + PW.X] as number;
    if ((buf[b + PW.Life] as number) <= 0 || x > limit || x < -limit) free(buf, p);
  }
  for (let p = 0; p < PROJ_MAX; p++) {
    const bp = PROJ_BASE + p * PROJ_WORDS;
    const op = buf[bp + PW.Owner] as number;
    if (op === 0) continue;
    for (let q = p + 1; q < PROJ_MAX; q++) {
      const bq = PROJ_BASE + q * PROJ_WORDS;
      const oq = buf[bq + PW.Owner] as number;
      if (oq === 0 || oq === op) continue;
      const dp = defOf(c, buf, p), dq = defOf(c, buf, q);
      if (dp === undefined || dq === undefined) continue;
      let touch = false;
      const bpx = dp.def.hit.boxes, bqx = dq.def.hit.boxes;
      for (let i = 0; i < bpx.length && !touch; i++) {
        for (let j = 0; j < bqx.length; j++) {
          if (capsulesOverlap(bpx[i] as Capsule2, buf[bp + PW.X] as number, buf[bp + PW.Y] as number, buf[bp + PW.Dir] as number,
            bqx[j] as Capsule2, buf[bq + PW.X] as number, buf[bq + PW.Y] as number, buf[bq + PW.Dir] as number)) { touch = true; break; }
        }
      }
      if (!touch) continue;
      if (dp.def.power >= dq.def.power) free(buf, q);
      if (dq.def.power >= dp.def.power) free(buf, p);
      if ((buf[bp + PW.Owner] as number) === 0) break;
    }
  }
  for (let s = 0; s < 2; s++) buf[(FIGHTER_BASE[s] as number) + FF.ProjActive] = countOwned(buf, s);
}
