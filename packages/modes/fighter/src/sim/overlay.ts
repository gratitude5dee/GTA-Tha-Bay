/**
 * The boxes of Training's overlay (FC11): hit capsules red, hurt capsules blue, pushboxes yellow, throw boxes green. A pure
 * function of the view model of a tick and the compiled kits: it repeats the choice the core makes (the active `BoxTrack` or the
 * stance default for hurt and push, the live `HitDef` of the move for hit) without touching the buffer, so the page can draw the boxes
 * from `mode.fighter.view` alone. Sim code under the C02 lint.
 */
import type { Aabb2, Capsule2, CKit, CMove } from '@dv/shared/fight';
import { St, isMoveState } from '@dv/shared/fight';
import type { FightView } from './vm.ts';

export type BoxKind = 'hit' | 'hurt' | 'push' | 'throw';
/** A capsule (x1,y1)-(x2,y2) of radius r, or, for `push` and `throw`, an axis-aligned box (x1,y1)-(x2,y2) with r = 0. World fight units. */
export interface OverlayBox { k: BoxKind; slot: 0 | 1 | 2; x1: number; y1: number; x2: number; y2: number; r: number }

type Stance = 'stand' | 'crouch' | 'air' | 'down';

function stanceOf(state: number, move: CMove | undefined): Stance {
  switch (state) {
    case St.Crouch: case St.CrouchDown: case St.BlockCrouch: case St.HitCrouch: return 'crouch';
    case St.JumpN: case St.JumpF: case St.JumpB: case St.Fall: case St.HitAir: return 'air';
    case St.Knockdown: case St.Slumped: return 'down';
    default:
      if (move !== undefined && isMoveState(state)) return move.stance === 2 ? 'air' : move.stance === 1 ? 'crouch' : 'stand';
      return 'stand';
  }
}

const cap = (c: Capsule2, x: number, y: number, f: number): [number, number, number, number, number] => [x + f * c.x1, y + c.y1, x + f * c.x2, y + c.y2, c.r];

function aabb(a: Aabb2, x: number, y: number, f: number): [number, number, number, number] {
  const lo = f >= 0 ? a.x : -(a.x + a.w);
  return [x + lo, y + a.y, x + lo + a.w, y + a.y + a.h];
}

/** The overlay boxes of one fighter (row of `view.f`) with its compiled kit. */
export function fighterBoxes(row: readonly number[], kit: CKit, slot: 0 | 1): OverlayBox[] {
  const x = row[0] as number, y = row[1] as number, f = row[2] as number, state = row[3] as number, mv = row[4] as number, mf = row[5] as number;
  const out: OverlayBox[] = [];
  const move = isMoveState(state) && mv >= 0 ? kit.moves[mv] : undefined;
  const stance = stanceOf(state, move);
  let hurt = kit.def.hurtDefault[stance];
  let push = stance === 'crouch' ? kit.def.push.crouch : stance === 'air' ? kit.def.push.air : kit.def.push.stand;
  if (move !== undefined) {
    for (const t of move.def.tracks) {
      if (mf < t.from || mf > t.to) continue;
      if (t.hurt !== undefined) hurt = t.hurt;
      if (t.push !== undefined) push = t.push;
    }
  }
  if (state !== St.Slumped) for (const c of hurt) { const b = cap(c, x, y, f); out.push({ k: 'hurt', slot, x1: b[0], y1: b[1], x2: b[2], y2: b[3], r: b[4] }); }
  const p = aabb(push, x, y, f);
  out.push({ k: 'push', slot, x1: p[0], y1: p[1], x2: p[2], y2: p[3], r: 0 });
  if (move !== undefined) {
    for (let k = 0; k < move.hits.length; k++) {
      if (mf < (move.hitFrom[k] as number) || mf > (move.hitEnd[k] as number)) continue;
      const h = move.hits[k];
      if (h === undefined) continue;
      for (const c of h.boxes) { const b = cap(c, x, y, f); out.push({ k: 'hit', slot, x1: b[0], y1: b[1], x2: b[2], y2: b[3], r: b[4] }); }
    }
    for (const t of move.def.tracks) {
      if (t.throw !== undefined && mf >= t.from && mf <= t.to) { const b = aabb(t.throw, x, y, f); out.push({ k: 'throw', slot, x1: b[0], y1: b[1], x2: b[2], y2: b[3], r: 0 }); }
    }
  }
  return out;
}

/** Every box of the view: both fighters and the live projectiles (their hit capsules, slot 2). `kits[slot]` is the compiled kit of that side. */
export function overlayBoxes(view: Pick<FightView, 'f' | 'p'>, kits: readonly [CKit, CKit]): OverlayBox[] {
  const out: OverlayBox[] = [...fighterBoxes(view.f[0], kits[0], 0), ...fighterBoxes(view.f[1], kits[1], 1)];
  for (const pr of view.p) {
    const owner = (pr[0] as number) === 1 ? 1 : 0;
    const def = kits[owner].projs[pr[1] as number];
    if (!def) continue;
    const use = (pr[5] as number) !== 0 && def.exIdx >= 0 ? (kits[owner].projs[def.exIdx] ?? def) : def;
    for (const c of use.def.hit.boxes) { const b = cap(c, pr[2] as number, pr[3] as number, pr[6] as number || 1); out.push({ k: 'hit', slot: 2, x1: b[0], y1: b[1], x2: b[2], y2: b[3], r: b[4] }); }
  }
  return out;
}
