// packages/shared/src/fight/meters.ts — FC7: Hype, Composure, Rattled. `o` is the fighter's word offset.
import { FF } from './buffer.ts';
import type { Ctx } from './ctx.ts';
import { scaledHype } from './gimmicks.ts';

export function addHype(c: Ctx, buf: Int32Array, o: number, n: number): void {
  if (n === 0) return;
  const v = (buf[o + FF.Hype] as number) + scaledHype(c, buf, o, n);
  buf[o + FF.Hype] = v > c.tun.HYPE_MAX ? c.tun.HYPE_MAX : v < 0 ? 0 : v;
}

/** Spend Composure (Check, Clear). Resets the idle timer; hitting 0 makes the fighter Rattled. */
export function spendComposure(_c: Ctx, buf: Int32Array, o: number, n: number): void {
  const v = Math.max(0, (buf[o + FF.Composure] as number) - n);
  buf[o + FF.Composure] = v;
  buf[o + FF.CheckTimer] = 0;
  if (v === 0) buf[o + FF.Rattled] = 1;
}

/** End-of-tick meter upkeep: Composure regeneration after COMP_IDLE frames without spending, Rattled exit. */
export function tickMeters(c: Ctx, buf: Int32Array, o: number): void {
  const t = c.tun;
  const idle = buf[o + FF.CheckTimer] as number;
  if (idle < 1 << 20) buf[o + FF.CheckTimer] = idle + 1;
  if (idle >= t.COMP_IDLE && (buf[o + FF.Composure] as number) < t.COMPOSURE_MAX) {
    const v = (buf[o + FF.Composure] as number) + t.COMP_REGEN;
    buf[o + FF.Composure] = v > t.COMPOSURE_MAX ? t.COMPOSURE_MAX : v;
  }
  if ((buf[o + FF.Rattled] as number) !== 0 && (buf[o + FF.Composure] as number) >= t.RATTLED_EXIT) buf[o + FF.Rattled] = 0;
  if ((buf[o + FF.TauntTimer] as number) > 0) buf[o + FF.TauntTimer] = (buf[o + FF.TauntTimer] as number) - 1;
}
