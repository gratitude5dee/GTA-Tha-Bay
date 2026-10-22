// packages/shared/src/fight/pack.ts — FrameDataPack builder (hash) and the load-time compiler that turns kits into the
// flat tables the step loop reads. Compile allocates; `step` never does.
import { canonicalize } from '../json.ts';
import { sha256Hex } from '../hash.ts';
import type { FighterDef, FighterSlotId, FightTuning, FrameDataPack, HitDef, InputPattern, MoveDef, ProjectileDef } from './types.ts';
import { FIGHT_DATA_VERSION } from './types.ts';
import { FB } from './input.ts';

/** hash = sha256Hex(canonicalize(pack without hash)) (FC2 `FrameDataPack`). */
export function packHash(pack: Omit<FrameDataPack, 'hash'> | FrameDataPack): string {
  return sha256Hex(canonicalize({ v: pack.v, kits: pack.kits, tuning: pack.tuning }));
}

export function buildPack(kits: Record<string, FighterDef>, tuning: FightTuning): FrameDataPack {
  const base = { v: FIGHT_DATA_VERSION, kits: kits as Record<FighterSlotId, FighterDef>, tuning };
  return { ...base, hash: packHash(base) };
}

/** First 8 and next 8 hex digits of a pack hash as two i32 words (FM.FrameDataHashLo/Hi). */
export function hashWords(hex: string): [number, number] {
  return [parseInt(hex.slice(0, 8), 16) | 0, parseInt(hex.slice(8, 16), 16) | 0];
}

// ---- compiled form -------------------------------------------------------------------------------------------------

export const enum Cls { None = 0, Normal = 1, Command = 2, Special = 3, Super = 4 }
export const enum Pat { Button, Motion, Charge, Chord }

export interface CMove {
  def: MoveDef; idx: number;
  S: number; A: number; R: number; T: number; activeEnd: number;
  cls: number; cx: number; pat: number; mask: number; dirReq: number;
  seq: Int8Array; tapDir: number; chargeHold: number; chargeRelease: number; chargeFrames: number;
  strength: number;                      // -1 none; 0 L, 1 M, 2 H
  stance: number;                        // 0 stand, 1 crouch, 2 air
  air: boolean; isSuper: boolean; minScale: number; cost: number;
  hits: HitDef[]; exHits: HitDef[]; hitFrom: Int32Array; hitEnd: Int32Array;
  exStartup: number; hasEx: boolean;
  spawnFrame: Int32Array; spawnProj: Int32Array; spawnExProj: Int32Array; spawnOx: Int32Array; spawnOy: Int32Array;
  motionFrame: Int32Array; motionVx: Int32Array; motionVy: Int32Array;
  simpleSlot: number;                    // 0..2 for Simple special 1/2/3 (neutral / 6 / 2), else -1
  sch: number;                           // scheme bits: 1 classic, 2 simple, 4 pose
}
export interface CProj { def: ProjectileDef; idx: number; id: string; exIdx: number; behavior: number }
export interface CKit {
  def: FighterDef; moves: CMove[]; projs: CProj[];
  parseOrder: Int32Array;                // classic parse order: class desc, complexity desc, kit order
  throwIdx: number; tauntIdx: number; shutdownIdx: number;
  autoIdx: Int32Array; simpleSpecial: Int32Array;   // [special1, special2, special3] move indices or -1
  superL2: number; superL3: number;
}
export interface CompiledPack { pack: FrameDataPack; tuning: FightTuning; kits: Map<string, CKit> }

const SEQS: Record<string, number[]> = {
  '236': [2, 6], '214': [2, 4], '623': [6, 2, 3], '41236': [4, 1, 2, 3, 6], '63214': [6, 3, 2, 1, 4],
  '360': [6, 3, 2, 1, 4, 7, 8, 9],
};
const TAP: Record<string, number> = { '22': 2, '66': 6, '44': 4 };

function clsOf(m: MoveDef): number {
  switch (m.kind) {
    case 'super': return Cls.Super;
    case 'special': return Cls.Special;
    case 'throw': case 'command': return Cls.Command;
    case 'normal': case 'air': return Cls.Normal;
    default: return Cls.None;
  }
}
function buttonStrength(mask: number): number {
  if (mask & (FB.HP | FB.HK)) return 2;
  if (mask & (FB.MP | FB.MK)) return 1;
  if (mask & (FB.LP | FB.LK)) return 0;
  return -1;
}
function patternOf(p: InputPattern, isSuper: boolean): { pat: number; mask: number; dirReq: number; seq: number[]; tap: number; hold: number; rel: number; frames: number; cx: number } {
  const r = { pat: Pat.Button, mask: 0, dirReq: 0, seq: [] as number[], tap: 0, hold: 0, rel: 0, frames: 0, cx: 1 };
  if (p.t === 'button') { r.mask = p.buttons; r.dirReq = p.dir === undefined || p.dir === 5 ? 0 : p.dir; r.cx = r.dirReq ? 5 : 1; }
  else if (p.t === 'chord') { r.pat = Pat.Chord; r.mask = p.buttons; r.cx = 3; }
  else if (p.t === 'charge') { r.pat = Pat.Charge; r.mask = p.buttons; r.hold = p.hold; r.rel = p.release; r.frames = p.frames; r.cx = 12; }
  else {
    r.pat = Pat.Motion; r.mask = p.buttons;
    const tap = TAP[p.seq];
    if (tap !== undefined) { r.tap = tap; r.cx = 8; }
    else {
      const base = SEQS[p.seq] ?? [];
      // Supers read as the doubled motion (236236 / 214214; FC5.4) -- BD-M08a1-02.
      r.seq = isSuper ? base.concat(base) : base.slice();
      r.cx = p.seq === '360' ? 80 : 10 * p.seq.length;   // numpad length: 623 is as complex as 236
    }
  }
  return r;
}

function mergeHit(h: HitDef, ex: MoveDef['ex']): HitDef {
  if (!ex) return h;
  const { startup: _s, ...rest } = ex;
  void _s;
  return { ...h, ...rest } as HitDef;
}

function compileMove(def: MoveDef, idx: number, _kit: FighterDef, projs: CProj[], forceSuper: boolean, tun: FightTuning): CMove {
  const isSuper = forceSuper || def.kind === 'super';
  const p = patternOf(def.input, isSuper);
  const S = def.startup, A = def.active, R = def.recovery;
  const hits = def.hits.map((h) => h.hit);
  const exHits = hits.map((h) => mergeHit(h, def.ex));
  const hitFrom = Int32Array.from(def.hits.map((h) => Math.max(h.from, S)));
  const activeEnd = S + A - 1;
  const hitEnd = new Int32Array(hits.length);
  for (let i = 0; i < hits.length; i++) hitEnd[i] = i + 1 < hits.length ? Math.min(activeEnd, (hitFrom[i + 1] as number) - 1) : activeEnd;
  const sp = def.spawn ?? [];
  const projIndex = (id: string): number => { for (let i = 0; i < projs.length; i++) if ((projs[i] as CProj).id === id) return i; return -1; };
  const mo = (def.motion ?? []).slice().sort((a, b) => a.frame - b.frame);
  const stance = def.kind === 'air' ? 2 : p.dirReq === 2 || (p.dirReq === 1) || (p.dirReq === 3) ? 1 : 0;
  const cost = def.hypeCost ?? 0;
  return {
    def, idx, S, A, R, T: S - 1 + A + R, activeEnd,
    cls: clsOf(def), cx: p.cx + (isSuper ? 20 : 0), pat: p.pat, mask: p.mask, dirReq: p.dirReq,
    seq: Int8Array.from(p.seq), tapDir: p.tap, chargeHold: p.hold, chargeRelease: p.rel, chargeFrames: p.frames,
    strength: def.kind === 'normal' || def.kind === 'air' || def.kind === 'command' ? buttonStrength(p.mask) : -1,
    stance, air: def.kind === 'air', isSuper, minScale: isSuper ? (cost >= 3000 ? tun.L3_MIN : tun.L2_MIN) : tun.SCALE_FLOOR, cost,
    hits, exHits, hitFrom, hitEnd, exStartup: def.ex?.startup ?? 0, hasEx: def.ex !== undefined,
    spawnFrame: Int32Array.from(sp.map((s) => s.frame)), spawnProj: Int32Array.from(sp.map((s) => projIndex(s.def))),
    spawnExProj: Int32Array.from(sp.map((s) => projIndex(`${s.def}:ex`))),
    spawnOx: Int32Array.from(sp.map((s) => s.ox)), spawnOy: Int32Array.from(sp.map((s) => s.oy)),
    motionFrame: Int32Array.from(mo.map((m) => m.frame)), motionVx: Int32Array.from(mo.map((m) => m.vx)), motionVy: Int32Array.from(mo.map((m) => m.vy)),
    simpleSlot: -1,
    sch: (def.schemes.includes('classic') ? 1 : 0) | (def.schemes.includes('simple') ? 2 : 0) | (def.schemes.includes('pose') ? 4 : 0),
  };
}

const BEHAVIORS = ['linear', 'sine', 'arc', 'trap', 'orbit', 'summon'];

export function compileKit(def: FighterDef, tun: FightTuning): CKit {
  const projs: CProj[] = def.projectiles.map((p, i) => ({ def: p, idx: i, id: p.id, exIdx: -1, behavior: BEHAVIORS.indexOf(p.behavior) }));
  for (const p of projs) p.exIdx = projs.findIndex((q) => q.id === `${p.id}:ex`);
  const moves: CMove[] = [];
  def.moves.forEach((m) => moves.push(compileMove(m, moves.length, def, projs, false, tun)));
  def.supers.forEach((m) => moves.push(compileMove(m, moves.length, def, projs, true, tun)));
  const shutdownIdx = moves.length; moves.push(compileMove(def.shutdown, shutdownIdx, def, projs, false, tun));
  const tauntIdx = moves.length; moves.push(compileMove(def.taunt, tauntIdx, def, projs, false, tun));
  const order: number[] = [];
  moves.forEach((m, i) => { if (i !== shutdownIdx && i !== tauntIdx && m.cls !== Cls.None && m.def.kind !== 'auto') order.push(i); });
  order.sort((a, b) => {
    const ma = moves[a] as CMove, mb = moves[b] as CMove;
    return mb.cls - ma.cls || mb.cx - ma.cx || a - b;
  });
  const throwIdx = moves.findIndex((m) => m.def.kind === 'throw');
  const byId = (id: string): number => moves.findIndex((m) => m.def.id === id);
  const simpleSpecials = moves.filter((m) => m.def.kind === 'special' && m.def.schemes.includes('simple'));
  const simpleSpecial = new Int32Array(3).fill(-1);
  simpleSpecials.slice(0, 3).forEach((m, i) => { simpleSpecial[i] = m.idx; m.simpleSlot = i; });
  const supersSorted = moves.filter((m) => m.def.kind === 'super');
  const l3 = supersSorted.find((m) => m.cost >= 3000);
  const l2 = supersSorted.find((m) => m.cost < 3000);
  return {
    def, moves, projs, parseOrder: Int32Array.from(order), throwIdx, tauntIdx, shutdownIdx,
    autoIdx: Int32Array.from(def.autoCombo.map(byId).filter((i) => i >= 0)), simpleSpecial,
    superL2: l2 ? l2.idx : -1, superL3: l3 ? l3.idx : -1,
  };
}

export function compilePack(pack: FrameDataPack): CompiledPack {
  const kits = new Map<string, CKit>();
  const slots = Object.keys(pack.kits).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const s of slots) kits.set(s, compileKit((pack.kits as Record<string, FighterDef>)[s] as FighterDef, pack.tuning));
  return { pack, tuning: pack.tuning, kits };
}

/** Derived advantage (FC1.2): advHit = hitstun - (A + R - 1), advBlock = blockstun - (A + R - 1). Per hit of the move's first HitDef. */
export function derivedAdvantage(m: MoveDef, hit: HitDef): { advHit: number | null; advBlock: number | null } {
  const tail = m.active + m.recovery - 1;
  return {
    advHit: hit.launch ? null : hit.hitstun - tail,
    advBlock: hit.guard === 'throw' || hit.blockstun === 0 ? null : hit.blockstun - tail,
  };
}
