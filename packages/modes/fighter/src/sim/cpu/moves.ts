/**
 * What the CPU knows about a kit (FC10.2, FC10.3): per move the startup, the derived advantage on block, the reach, and the macro that
 * performs it as an input script. Built once per kit from the compiled pack. Sim code under the C02 lint.
 */
import { Cls, compileKit, derivedAdvantage, FB } from '@dv/shared/fight';
import type { CKit, CMove, FighterDef, FightTuning } from '@dv/shared/fight';

/** One step of a macro: numpad direction (relative to facing), buttons, frames held. */
export interface MacroStep { d: number; b: number; n: number }

export interface MoveInfo {
  idx: number;
  id: string;
  kind: string;
  cls: number;
  S: number; A: number; R: number; T: number;
  /** Derived advantage on hit and on block of the first hit; null for launchers, projectile, throw and hitless moves. */
  advHit: number | null;
  advBlock: number | null;
  damage: number;
  /** Farthest point the move reaches from the fighter's centre (hit boxes plus travel), fight units. */
  reach: number;
  low: boolean;
  launches: boolean;
  /** The first strike frames are invulnerable (an anti-air or reversal). */
  invulnStrike: boolean;
  spawns: boolean;
  cost: number;
  macro: readonly MacroStep[];
}

export interface KitInfo {
  def: FighterDef;
  moves: MoveInfo[];
  throwIdx: number;
  /** Indices by role. */
  pokes: number[];
  heavies: number[];
  projectiles: number[];
  antiAir: number[];
  supers: number[];
}

const DIGITS: Record<string, number[]> = {
  '236': [2, 3, 6], '214': [2, 1, 4], '623': [6, 2, 3], '41236': [4, 1, 2, 3, 6], '63214': [6, 3, 2, 1, 4], '22': [2, 5, 2], '66': [6, 5, 6], '44': [4, 5, 4],
  '360': [6, 3, 2, 1, 4, 7, 8, 9],
};

const lowestBit = (mask: number): number => mask & -mask;

function macroOf(m: CMove): MacroStep[] {
  const p = m.def.input;
  if (p.t === 'button') return [{ d: p.dir ?? 5, b: lowestBit(p.buttons), n: 2 }];
  if (p.t === 'chord') return [{ d: 5, b: p.buttons, n: 2 }];
  if (p.t === 'charge') return [{ d: p.hold, b: 0, n: p.frames }, { d: p.release, b: lowestBit(p.buttons), n: 2 }];
  const base = DIGITS[p.seq] ?? [5];
  const digits = m.isSuper ? base.concat(base) : base;
  const steps: MacroStep[] = digits.map((d) => ({ d, b: 0, n: 2 }));
  const last = steps[steps.length - 1] as MacroStep;
  last.b = lowestBit(p.buttons);
  return steps;
}

function reachOf(m: CMove): number {
  let r = 0;
  for (const h of m.hits) for (const b of h.boxes) r = Math.max(r, Math.max(b.x1, b.x2) + b.r);
  const mo = m.def.motion ?? [];
  let travel = 0;
  for (let i = 0; i < mo.length; i++) {
    const from = (mo[i] as { frame: number }).frame;
    const to = i + 1 < mo.length ? (mo[i + 1] as { frame: number }).frame : m.activeEnd + 1;
    const vx = (mo[i] as { vx: number }).vx;
    if (vx > 0 && from <= m.activeEnd) travel += vx * (Math.min(to, m.activeEnd + 1) - from);
  }
  return r + travel;
}

export function kitInfo(def: FighterDef, tuning: FightTuning): KitInfo {
  const ck: CKit = compileKit(def, tuning);
  const moves: MoveInfo[] = ck.moves.map((m) => {
    const first = m.hits[0];
    const adv = first ? derivedAdvantage(m.def, first) : { advHit: null, advBlock: null };
    const low = m.hits.some((h) => h.guard === 'low');
    return {
      idx: m.idx, id: m.def.id, kind: m.def.kind, cls: m.cls,
      S: m.S, A: m.A, R: m.R, T: m.T,
      advHit: adv.advHit, advBlock: adv.advBlock,
      damage: m.hits.reduce((a, h) => a + h.damage, 0),
      reach: reachOf(m), low,
      launches: m.hits.some((h) => h.launch !== undefined),
      invulnStrike: m.def.invuln.some((e) => e.from <= 2 && (e.kind === 'strike' || e.kind === 'all')),
      spawns: (m.def.spawn ?? []).length > 0,
      cost: m.cost,
      macro: macroOf(m),
    };
  });
  const usable = (i: MoveInfo): boolean => i.kind !== 'shutdown' && i.kind !== 'taunt' && i.kind !== 'auto' && i.kind !== 'air';
  const pokes = moves.filter((i) => usable(i) && i.cls === Cls.Normal && i.S <= 8).map((i) => i.idx);
  const heavies = moves.filter((i) => usable(i) && i.cls === Cls.Normal && i.S > 8).map((i) => i.idx);
  const projectiles = moves.filter((i) => usable(i) && i.spawns && i.cls === Cls.Special && i.macro[0] !== undefined && i.id !== 'detonate').map((i) => i.idx);
  const antiAir = moves.filter((i) => usable(i) && i.launches && i.invulnStrike).map((i) => i.idx);
  const supers = moves.filter((i) => i.cls === Cls.Super).map((i) => i.idx);
  return { def, moves, throwIdx: ck.throwIdx, pokes, heavies, projectiles, antiAir, supers };
}

/** FighterInput bits of a numpad direction for a fighter facing `facing` (+1 faces right). */
export function dirBits(d: number, facing: number): number {
  let o = 0;
  const fwd = facing > 0 ? FB.Right : FB.Left;
  const back = facing > 0 ? FB.Left : FB.Right;
  if (d >= 7) o |= FB.Up;
  if (d <= 3) o |= FB.Down;
  if (d === 1 || d === 4 || d === 7) o |= back;
  if (d === 3 || d === 6 || d === 9) o |= fwd;
  return o;
}
