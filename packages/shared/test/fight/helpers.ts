// Shared helpers for the fight specs: the reference pack, a numpad input builder and scripted runs.
import kitJson from '../../../../content/fighter/kits/player.json';
import tuningJson from '../../../../config/fighter.tuning.json';
import type { FighterDef, FightTuning, FrameDataPack, InputPattern, MoveDef } from '../../src/fight/types.ts';
import { buildPack, compileKit } from '../../src/fight/pack.ts';
import type { CKit, CMove } from '../../src/fight/pack.ts';
import type { FightEvent, FightEventSink, FightRules, FighterLoadout } from '../../src/fight/buffer.ts';
import { FF, FIGHTER_BASE, FM, Phase, RING_BASE } from '../../src/fight/buffer.ts';
import { FightCore } from '../../src/fight/step.ts';
import { makeParseParams, ringPush, updateCharge, dirHas, ringDir } from '../../src/fight/motion.ts';
import type { ParseState } from '../../src/fight/motion.ts';
import { FB } from '../../src/fight/input.ts';
import { Rng } from '../../src/rng.ts';

export const TUNING = tuningJson as unknown as FightTuning;
export const PLAYER = kitJson as unknown as FighterDef;
export const PACK: FrameDataPack = buildPack({ PLAYER_FIGHTER: PLAYER }, TUNING);

export const RULES: FightRules = {
  roundsToWin: 2, timerFrames: 0, simpleDmgPct: 80, leniencyX100: 100, cpuLevel: [null, null],
  training: false, shutdowns: false, cinematics: 'off',
};
export const LINEUP: [FighterLoadout, FighterLoadout] = [
  { slot: 'PLAYER_FIGHTER', fighterId: 'player', scheme: 'classic', costume: 0 },
  { slot: 'PLAYER_FIGHTER', fighterId: 'player', scheme: 'classic', costume: 0 },
];

export const BTN = { LP: FB.LP, MP: FB.MP, HP: FB.HP, LK: FB.LK, MK: FB.MK, HK: FB.HK, SP: FB.SP, AS: FB.AS, HY: FB.HY, TA: FB.TA, BL: FB.BL, DA: FB.DA } as const;

/** Numpad digit -> FighterInput direction bits for a fighter facing `facing` (1 = right). */
export function dirBits(d: number, facing = 1): number {
  const fwd = facing >= 0 ? FB.Right : FB.Left, back = facing >= 0 ? FB.Left : FB.Right;
  let o = 0;
  if (d === 7 || d === 8 || d === 9) o |= FB.Up;
  if (d === 1 || d === 2 || d === 3) o |= FB.Down;
  if (d === 1 || d === 4 || d === 7) o |= back;
  if (d === 3 || d === 6 || d === 9) o |= fwd;
  return o;
}

/** A tiny input-script builder: numpad strings with optional buttons, one frame each unless repeated. */
export class Script {
  readonly out: number[] = [];
  constructor(readonly facing = 1) {}
  /** `hold(n, dir, buttons)`: n frames. */
  hold(n: number, d = 5, buttons = 0): this { for (let i = 0; i < n; i++) this.out.push(dirBits(d, this.facing) | buttons); return this; }
  /** One frame per digit of `digits`, the last frame carrying `buttons`. */
  motion(digits: string, buttons = 0): this {
    for (let i = 0; i < digits.length; i++) this.out.push(dirBits(Number(digits[i]), this.facing) | (i === digits.length - 1 ? buttons : 0));
    return this;
  }
  press(buttons: number, d = 5, n = 1): this { return this.hold(n, d, buttons); }
  idle(n: number): this { return this.hold(n, 5, 0); }
  get length(): number { return this.out.length; }
}

export class Events implements FightEventSink {
  list: FightEvent[] = [];
  push(e: FightEvent): void { this.list.push({ ...e }); }
  count(kind: FightEvent['kind']): number { return this.list.filter((e) => e.kind === kind).length; }
}

export interface Rig { sim: FightCore; buf: Int32Array; ev: Events }
/** A match put straight into the Fight phase. */
export function rig(opts: { rules?: Partial<FightRules>; lineup?: [FighterLoadout, FighterLoadout]; seed?: number; pack?: FrameDataPack } = {}): Rig {
  const sim = new FightCore();
  const buf = sim.init(opts.pack ?? PACK, { ...RULES, ...opts.rules }, opts.seed ?? 7, opts.lineup ?? LINEUP);
  sim.setPhase(buf, Phase.Fight);
  return { sim, buf, ev: new Events() };
}
export function run(r: Rig, a: ArrayLike<number>, b: ArrayLike<number> = []): void {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) r.sim.step(r.buf, (a[i] as number | undefined) ?? 0, (b[i] as number | undefined) ?? 0, r.ev);
}
export function idle(r: Rig, n: number): void { for (let i = 0; i < n; i++) r.sim.step(r.buf, 0, 0, r.ev); }

export function word(r: Rig, slot: 0 | 1, w: number): number { return r.buf[(FIGHTER_BASE[slot] as number) + w] as number; }
export function setWord(r: Rig, slot: 0 | 1, w: number, v: number): void { r.buf[(FIGHTER_BASE[slot] as number) + w] = v; }
export function head(r: Rig, w: number): number { return r.buf[w] as number; }

/** Place both fighters a given distance apart (fighter 0 on the left). */
export function place(r: Rig, x0: number, x1: number): void {
  setWord(r, 0, FF.X, x0); setWord(r, 1, FF.X, x1);
}

export function moveIndex(id: string, kit: CKit = KIT): number { return kit.moves.findIndex((m) => m.def.id === id); }
export const KIT: CKit = compileKit(PLAYER, TUNING);

/** Build a one-move kit from the reference kit with a different input pattern and compile it. */
export function cmoveWith(input: InputPattern, kind: MoveDef['kind'] = 'special', id = 'probe', tweak: Partial<MoveDef> = {}): CMove {
  const base = PLAYER.moves.find((m) => m.id === 'sparkToss') as MoveDef;
  const def: MoveDef = { ...base, ...tweak, id, kind, input };
  const kit = compileKit({ ...PLAYER, moves: [def], supers: [] }, TUNING);
  return kit.moves[0] as CMove;
}

/** A ring filled from a script of inputs; the last frame is the current tick. */
export function ringFrom(inputs: ArrayLike<number>, facing = 1): { buf: Int32Array; base: number; tick: number; charge: ParseState } {
  const buf = new Int32Array(504);
  const base = RING_BASE[0] as number;
  const ps: ParseState = { chargeBack: 0, chargeDown: 0, dashImplied: false, lastConsumed: -1, canEx: false };
  const t = TUNING;
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i] as number;
    ringPush(buf, base, i + 40, inp, facing);   // start away from tick 0 so ages never read before the first entry
    const d = ringDir(buf, base, i + 40, 0);
    ps.chargeBack = updateCharge(ps.chargeBack, dirHas(d, 4), t.CHARGE_GAP);
    ps.chargeDown = updateCharge(ps.chargeDown, dirHas(d, 2), t.CHARGE_GAP);
  }
  return { buf, base, tick: inputs.length - 1 + 40, charge: ps };
}
export const PP = makeParseParams(TUNING, 100);

/** A two-kit pack: slot PLAYER_FIGHTER is the reference kit, RAP_NEW_WAVE a clone `mutate` may edit. */
export function packWith(mutate: (a: FighterDef, b: FighterDef) => void): { pack: FrameDataPack; lineup: [FighterLoadout, FighterLoadout] } {
  const a = structuredClone(PLAYER), b = structuredClone(PLAYER);
  b.slot = 'RAP_NEW_WAVE';
  mutate(a, b);
  const pack = buildPack({ PLAYER_FIGHTER: a, RAP_NEW_WAVE: b }, TUNING);
  return {
    pack,
    lineup: [
      { slot: 'PLAYER_FIGHTER', fighterId: 'player', scheme: 'classic', costume: 0 },
      { slot: 'RAP_NEW_WAVE', fighterId: 'new-wave', scheme: 'classic', costume: 0 },
    ],
  };
}
/**
 * A seeded scripted opponent: random macros (walk, jump, normals, motions, throw, Check, Clear, supers) strung together.
 * Deterministic from `seed`; used by the hash, replay and allocation specs.
 */
export function randomBot(seed: number, ticks: number, facing: number): number[] {
  const rng = new Rng(seed);
  const s = new Script(facing);
  const pick = (n: number): number => Math.floor(rng.nextFloat() * n);
  const P = [BTN.LP, BTN.MP, BTN.HP], K = [BTN.LK, BTN.MK, BTN.HK];
  while (s.length < ticks) {
    switch (pick(24)) {
      case 0: case 1: case 2: s.hold(4 + pick(20), 6); break;
      case 3: s.hold(4 + pick(14), 4); break;
      case 4: s.hold(8 + pick(20), pick(2) === 0 ? 1 : 4); break;           // block
      case 5: s.hold(1, pick(3) === 0 ? 7 : pick(2) === 0 ? 9 : 8).idle(2 + pick(30)); break;   // jump
      case 6: s.press(P[pick(3)] as number).idle(pick(10)); break;
      case 7: s.press(P[pick(3)] as number, 2).idle(pick(10)); break;
      case 8: s.press(K[pick(3)] as number).idle(pick(10)); break;
      case 9: case 10: s.motion('236', P[pick(3)] as number).idle(pick(20)); break;
      case 11: s.motion('623', P[pick(3)] as number).idle(pick(20)); break;
      case 12: s.motion('214', K[pick(3)] as number).idle(pick(20)); break;
      case 13: s.press(BTN.LP | BTN.LK).idle(pick(20)); break;
      case 14: s.press(BTN.MP | BTN.MK).idle(pick(20)); break;
      case 15: s.press(BTN.HP | BTN.HK).idle(pick(10)); break;
      case 16: s.motion('236236', P[pick(3)] as number).idle(pick(30)); break;
      case 17: s.motion('623', BTN.LP | BTN.MP).idle(pick(20)); break;
      case 18: s.hold(1, 6).idle(2).hold(1, 6).idle(pick(10)); break;       // dash
      case 19: s.press(BTN.TA).idle(pick(10)); break;
      case 20: s.press(BTN.LP).idle(2).press(BTN.MP).idle(2).press(BTN.HP).idle(pick(12)); break;   // chain
      case 21: s.motion('214214', P[pick(3)] as number).idle(pick(20)); break;
      default: s.idle(2 + pick(20));
    }
  }
  return s.out.slice(0, ticks);
}

export function moveOf(def: FighterDef, id: string): MoveDef {
  const m = [...def.moves, ...def.supers].find((x) => x.id === id);
  if (!m) throw new Error(`no move ${id}`);
  return m;
}
/** Index of a move id inside the compiled kit of `slot` (0 or 1) of a rig. */
export function moveIdx(r: Rig, slot: 0 | 1, id: string): number {
  return r.sim.c.kit[slot].moves.findIndex((m) => m.def.id === id);
}
export { FF, FM, Phase, FIGHTER_BASE };
