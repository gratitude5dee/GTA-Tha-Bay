/**
 * `whereIs` (04-npc-builder.md section C8; M06c): where a named NPC is at game time `clockT`, with no brain tick. The minimap, the phone's
 * "find" and mission triggers ask it for NPCs at LOD C. Pure; C02 lint applies (detmath only).
 *
 *  - A block that is not a commute puts the NPC at the block's POI.
 *  - A `commute` block walks from the POI of the block before it (across midnight too) to the block's own POI. The position is the point
 *    at the fraction `elapsed / length` of the route's arc length, where the route is `PlaceIndex.pedRoute` when it answers and the
 *    straight line between the two POIs otherwise.
 *  - A POI that `poi` cannot place (a soul written ahead of the world) falls back to the other end, and to the origin when both are missing;
 *    callers chain the baked table and `content/npcs/poi.stub.json` so this is the last resort.
 */
import { dsqrt } from '../detmath.ts';
import type { Activity, CompiledSoulPublic, ScheduleBlock } from '../contracts/c10-npc.ts';
import type { PoiId } from '../world/c08.ts';
import { HALF_SECONDS_PER_DAY, HALF_SECONDS_PER_MINUTE, MINUTES_PER_DAY, parseClock, scheduleAt } from './schedule.ts';

export type Vec3 = [number, number, number];

export type PoiPos = (id: PoiId) => Vec3 | null;
export type PedRouteFn = (a: PoiId, b: PoiId) => Vec3[];

export interface WhereIsResult {
  pos: Vec3;
  activity: Activity;
  /** Index into `schedule` of the active block. */
  blockIndex: number;
  /** Set during a commute: the two POIs and the fraction walked. */
  commute: { from: PoiId; to: PoiId; t: number } | null;
}

/** Half-seconds since the start of the active block's run (a block that crosses midnight counts from its `from` on the first day). */
export function elapsedInBlock(block: Pick<ScheduleBlock, 'from' | 'to'>, clockT: number): { elapsed: number; length: number } {
  const from = parseClock(block.from);
  const to = parseClock(block.to);
  const t = Math.max(0, Math.floor(clockT));
  const hs = t % HALF_SECONDS_PER_DAY;
  const fromHs = from * HALF_SECONDS_PER_MINUTE;
  const toHs = to * HALF_SECONDS_PER_MINUTE;
  if (from < 0 || to < 0 || from === to) return { elapsed: 0, length: 1 };
  if (from < to) return { elapsed: hs >= fromHs ? hs - fromHs : 0, length: toHs - fromHs };
  const length = MINUTES_PER_DAY * HALF_SECONDS_PER_MINUTE - fromHs + toHs;
  return { elapsed: hs >= fromHs ? hs - fromHs : MINUTES_PER_DAY * HALF_SECONDS_PER_MINUTE - fromHs + hs, length };
}

/** The point at fraction `t` (0..1) of the polyline's arc length. */
export function pointAlong(path: readonly Vec3[], t: number): Vec3 {
  const first = path[0];
  if (!first) return [0, 0, 0];
  if (path.length === 1 || t <= 0) return [first[0], first[1], first[2]];
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Vec3;
    const b = path[i] as Vec3;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = dsqrt(dx * dx + dy * dy + dz * dz);
    seg.push(len);
    total += len;
  }
  const last = path[path.length - 1] as Vec3;
  if (t >= 1 || total <= 0) return [last[0], last[1], last[2]];
  let want = t * total;
  for (let i = 0; i < seg.length; i++) {
    const len = seg[i] as number;
    if (want <= len || i === seg.length - 1) {
      const a = path[i] as Vec3;
      const b = path[i + 1] as Vec3;
      const u = len > 0 ? want / len : 0;
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
    want -= len;
  }
  return [last[0], last[1], last[2]];
}

export function whereIs(
  s: Pick<CompiledSoulPublic, 'schedule'>,
  clockT: number,
  poi: PoiPos,
  route?: PedRouteFn,
): WhereIsResult {
  const { index, block } = scheduleAt(s, clockT);
  const here = poi(block.place);
  if (block.activity !== 'commute') {
    const p = here ?? [0, 0, 0];
    return { pos: [p[0], p[1], p[2]], activity: block.activity, blockIndex: index, commute: null };
  }
  const { elapsed, length } = elapsedInBlock(block, clockT);
  const before = scheduleAt(s, Math.max(0, Math.floor(clockT) - elapsed - 1));
  const fromId = before.block.place;
  if (fromId === block.place) {
    const p = here ?? [0, 0, 0];
    return { pos: [p[0], p[1], p[2]], activity: block.activity, blockIndex: index, commute: null };
  }
  const a = poi(fromId);
  const b = here;
  const t = length > 0 ? Math.min(1, Math.max(0, elapsed / length)) : 1;
  let path: Vec3[] = a && b ? [a, b] : [];
  if (route && a && b) {
    const r = route(fromId, block.place);
    if (r.length >= 2) path = r;
  }
  if (path.length === 0) {
    const only = a ?? b ?? [0, 0, 0];
    return { pos: [only[0], only[1], only[2]], activity: block.activity, blockIndex: index, commute: { from: fromId, to: block.place, t } };
  }
  return { pos: pointAlong(path, t), activity: block.activity, blockIndex: index, commute: { from: fromId, to: block.place, t } };
}
