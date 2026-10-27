// packages/shared/src/fight/projectiles.ts — FC9: the pool of 16, the `linear` behaviour and the clash rule.
// `trap` (M08a2): a stationary zone that lives `life` frames and connects `hits` times; at most TRAP_CAP per owner (placing a third
// frees the oldest). A `trap` def whose id ends with `:trigger` is the trigger: spawning it fires no projectile and sets every own live trap off,
// turning it into its `:ex` def (the burst) with that def's life and hits. Other behaviours (sine, arc, orbit, summon) land in
// M08b1; until then they move like `linear`.
import { FF, FIGHTER_BASE, PROJ_BASE, PROJ_MAX, PROJ_WORDS, PW } from './buffer.ts';
import type { Ctx } from './ctx.ts';
import { kitOf } from './ctx.ts';
import type { Capsule2 } from './types.ts';
import { capsulesOverlap } from './hit.ts';

export const OWNER_CAP = 4;
export const TRAP_CAP = 2;
const TRAP = 3;   // index of 'trap' in pack.ts BEHAVIORS

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
  const proj = kitOf(c, owner).projs[pi];
  if (proj === undefined || countOwned(buf, owner) >= OWNER_CAP) return false;
  const use = ex && proj.exIdx >= 0 ? (kitOf(c, owner).projs[proj.exIdx] as typeof proj) : proj;
  if (proj.behavior === TRAP) {
    if (isTrigger(proj.id)) { detonate(c, buf, owner); return true; }
    limitTraps(c, buf, owner);
  }
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((buf[b + PW.Owner] as number) !== 0) continue;
    const f = buf[o + FF.Facing] as number;
    buf[b + PW.Owner] = owner + 1;
    buf[b + PW.Def] = proj.idx;
    buf[b + PW.X] = (buf[o + FF.X] as number) + f * ox;
    buf[b + PW.Y] = (buf[o + FF.Y] as number) + oy;
    buf[b + PW.VX] = proj.behavior === TRAP ? 0 : f * use.def.speed;
    buf[b + PW.VY] = 0;
    buf[b + PW.Life] = use.def.life;
    buf[b + PW.Hits] = use.def.hits;
    buf[b + PW.Frame] = 0;
    buf[b + PW.Dir] = f;
    buf[b + PW.Ex] = ex && proj.exIdx >= 0 ? 1 : 0;
    buf[b + PW.Cool] = 0;
    buf[b + PW.Hitstop] = 0;
    buf[b + PW.OriginY] = (buf[b + PW.Y] as number);
    return true;
  }
  return false;
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

/** One tick: move, age, expire, then clash (higher power wins, equal destroys both). */
export function stepProjectiles(c: Ctx, buf: Int32Array): void {
  const limit = c.tun.STAGE_HALF_WIDTH + 3000;
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((buf[b + PW.Owner] as number) === 0) continue;
    if ((buf[b + PW.Hitstop] as number) > 0) { buf[b + PW.Hitstop] = (buf[b + PW.Hitstop] as number) - 1; continue; }
    buf[b + PW.X] = (buf[b + PW.X] as number) + (buf[b + PW.VX] as number);
    buf[b + PW.Y] = (buf[b + PW.Y] as number) + (buf[b + PW.VY] as number);
    buf[b + PW.Frame] = (buf[b + PW.Frame] as number) + 1;
    buf[b + PW.Life] = (buf[b + PW.Life] as number) - 1;
    if ((buf[b + PW.Cool] as number) > 0) buf[b + PW.Cool] = (buf[b + PW.Cool] as number) - 1;
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
