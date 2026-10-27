// packages/shared/src/fight/ctx.ts — the immutable per-match configuration plus the scratch registers the step loop
// reuses every tick (so `step` allocates nothing). The buffer holds all mutable match state; nothing here is hashed.
import type { FightEvent, FightEventSink, FightRules } from './buffer.ts';
import { NULL_SINK } from './buffer.ts';
import type { CKit, CMove, CompiledPack } from './pack.ts';
import type { ParseParams, ParseState } from './motion.ts';
import type { FightTuning, HitDef } from './types.ts';

export const MAX_CAND = 20;

/** Intent kinds decided from start-of-tick state (FC3 step 4), applied in step 5. */
export const enum Int { None, Move, Jump, Dash, Check, Clear }

export interface Ctx {
  pack: CompiledPack; tun: FightTuning; rules: FightRules;
  kit: [CKit, CKit]; scheme: [number, number];   // 0 classic, 1 simple, 2 pose
  autoBlock: [boolean, boolean];
  pp: ParseParams; ppx: [ParseParams, ParseParams];   // ppx: pp with the per-fighter buffer extension (hitstop) applied
  ev: FightEventSink; evObj: FightEvent;
  ps: [ParseState, ParseState];
  // intent registers per fighter
  iKind: Int32Array; iMove: Int32Array; iEx: Int32Array; iArg: Int32Array; iSimple: Int32Array;
  freeze: number;                                 // super freeze requested this tick (frames)
  // hit candidate scratch
  cN: number; cAtk: Int32Array; cKind: Int32Array; cIdx: Int32Array; cHitNo: Int32Array; cHit: (HitDef | null)[];
  cMv: (CMove | null)[]; cEx: Int32Array; cSimple: Int32Array;
  throwReach: [number, number];
  // child shots fired by a drone or crew member this tick, placed after the projectile pass (so a new shot is not stepped in its birth tick)
  pendN: number; pendOwner: Int32Array; pendDef: Int32Array; pendX: Int32Array; pendY: Int32Array; pendDir: Int32Array;
}

export const SCHEME_CLASSIC = 0, SCHEME_SIMPLE = 1, SCHEME_POSE = 2;

export function newCtx(pack: CompiledPack, rules: FightRules, kit: [CKit, CKit], scheme: [number, number],
  autoBlock: [boolean, boolean], pp: ParseParams): Ctx {
  const mkPs = (): ParseState => ({ chargeBack: 0, chargeDown: 0, dashImplied: false, lastConsumed: -1, canEx: false });
  const hits: (HitDef | null)[] = [];
  const mvs: (CMove | null)[] = [];
  for (let i = 0; i < MAX_CAND; i++) { hits.push(null); mvs.push(null); }
  return {
    pack, tun: pack.tuning, rules, kit, scheme, autoBlock, pp, ppx: [{ ...pp }, { ...pp }],
    ev: NULL_SINK, evObj: { tick: 0, kind: 'hit', slot: 0, x: 0, y: 0, a: 0, b: 0 },
    ps: [mkPs(), mkPs()],
    iKind: new Int32Array(2), iMove: new Int32Array(2), iEx: new Int32Array(2), iArg: new Int32Array(2), iSimple: new Int32Array(2),
    freeze: 0,
    cN: 0, cAtk: new Int32Array(MAX_CAND), cKind: new Int32Array(MAX_CAND), cIdx: new Int32Array(MAX_CAND),
    cHitNo: new Int32Array(MAX_CAND), cHit: hits,
    cMv: mvs, cEx: new Int32Array(MAX_CAND), cSimple: new Int32Array(MAX_CAND),
    throwReach: [900, 900],
    pendN: 0, pendOwner: new Int32Array(16), pendDef: new Int32Array(16), pendX: new Int32Array(16), pendY: new Int32Array(16), pendDir: new Int32Array(16),
  };
}

/** Push one presentation event through the reused object (never allocates). */
export function emit(c: Ctx, tick: number, kind: FightEvent['kind'], slot: 0 | 1, x: number, y: number, a: number, b: number): void {
  const e = c.evObj;
  e.tick = tick; e.kind = kind; e.slot = slot; e.x = x; e.y = y; e.a = a; e.b = b;
  c.ev.push(e);
}

// Variable indexing of a tuple is `T | undefined` under noUncheckedIndexedAccess; these keep the call sites cast-free.
export function kitOf(c: Ctx, i: number): CKit { return i === 0 ? c.kit[0] : c.kit[1]; }
export function psOf(c: Ctx, i: number): ParseState { return i === 0 ? c.ps[0] : c.ps[1]; }
export function ppxOf(c: Ctx, i: number): ParseParams { return i === 0 ? c.ppx[0] : c.ppx[1]; }
