/**
 * `fighter.script` (M08a1): the QA input driver. It implements the C03 `BotInput` (`device: 'bot'`) from a script of
 * `FighterInput` words (one per tick) that is either given or generated from a seed. The same seed gives the same
 * stream, so a scripted match is reproducible and its replay can be recorded and verified headlessly.
 * Registration in the M04d bot registry is M08a2.
 */
import { Rng } from '@dv/shared';
import type { BotInput, InputFrame } from '@dv/shared';
import { FB, toInputFrame } from '@dv/shared/fight';

export interface ScriptDriverOptions {
  /** Seed of the generated script (ignored when `script` is given). */
  seed: number;
  /** +1 when the bot's fighter starts on the left (faces right), -1 on the right. */
  facing?: 1 | -1;
  /** An explicit stream of FighterInput words, one per tick; ticks past its end read neutral. */
  script?: ArrayLike<number>;
  /** Ticks to generate when no `script` is given (default 6,000). */
  length?: number;
}

export interface ScriptDriver extends BotInput {
  readonly seed: number;
  /** The FighterInput word of a tick (what `fromInputFrame(frame(tick))` returns). */
  word(tick: number): number;
  readonly length: number;
}

/** Numpad input builder shared by the generated script and the golden authoring. */
export class ScriptBuilder {
  readonly out: number[] = [];
  constructor(readonly facing: 1 | -1 = 1) {}
  private dir(d: number): number {
    const fwd = this.facing > 0 ? FB.Right : FB.Left, back = this.facing > 0 ? FB.Left : FB.Right;
    let o = 0;
    if (d >= 7) o |= FB.Up;
    if (d <= 3) o |= FB.Down;
    if (d === 1 || d === 4 || d === 7) o |= back;
    if (d === 3 || d === 6 || d === 9) o |= fwd;
    return o;
  }
  /** `n` frames of numpad direction `d` with `buttons` held. */
  hold(n: number, d = 5, buttons = 0): this { for (let i = 0; i < n; i++) this.out.push(this.dir(d) | buttons); return this; }
  idle(n: number): this { return this.hold(n); }
  press(buttons: number, d = 5, n = 1): this { return this.hold(n, d, buttons); }
  /** One frame per digit, the last frame carrying `buttons`. */
  motion(digits: string, buttons = 0): this {
    for (let i = 0; i < digits.length; i++) this.out.push(this.dir(Number(digits[i])) | (i === digits.length - 1 ? buttons : 0));
    return this;
  }
  get length(): number { return this.out.length; }
}

const P = [FB.LP, FB.MP, FB.HP] as const, K = [FB.LK, FB.MK, FB.HK] as const;

/** A seeded stream of macros: walks, jumps, normals, motions, throws, Check, Clear, supers. Deterministic from `seed`. */
export function scriptFrames(seed: number, ticks: number, facing: 1 | -1 = 1): number[] {
  const rng = new Rng(seed);
  const s = new ScriptBuilder(facing);
  const pick = (n: number): number => Math.floor(rng.nextFloat() * n);
  while (s.length < ticks) {
    switch (pick(24)) {
      case 0: case 1: case 2: s.hold(4 + pick(20), 6); break;
      case 3: s.hold(4 + pick(14), 4); break;
      case 4: s.hold(8 + pick(20), pick(2) === 0 ? 1 : 4); break;
      case 5: s.hold(1, pick(3) === 0 ? 7 : pick(2) === 0 ? 9 : 8).idle(2 + pick(30)); break;
      case 6: s.press(P[pick(3)] as number).idle(pick(10)); break;
      case 7: s.press(P[pick(3)] as number, 2).idle(pick(10)); break;
      case 8: s.press(K[pick(3)] as number).idle(pick(10)); break;
      case 9: case 10: s.motion('236', P[pick(3)] as number).idle(pick(20)); break;
      case 11: s.motion('623', P[pick(3)] as number).idle(pick(20)); break;
      case 12: s.motion('214', K[pick(3)] as number).idle(pick(20)); break;
      case 13: s.press(FB.LP | FB.LK).idle(pick(20)); break;
      case 14: s.press(FB.MP | FB.MK).idle(pick(20)); break;
      case 15: s.press(FB.HP | FB.HK).idle(pick(10)); break;
      case 16: s.motion('236236', P[pick(3)] as number).idle(pick(30)); break;
      case 17: s.motion('623', FB.LP | FB.MP).idle(pick(20)); break;
      case 18: s.hold(1, 6).idle(2).hold(1, 6).idle(pick(10)); break;
      case 19: s.press(FB.TA).idle(pick(10)); break;
      case 20: s.press(FB.LP).idle(2).press(FB.MP).idle(2).press(FB.HP).idle(pick(12)); break;
      case 21: s.motion('214214', P[pick(3)] as number).idle(pick(20)); break;
      default: s.idle(2 + pick(20));
    }
  }
  return s.out.slice(0, ticks);
}

export function createScriptDriver(opts: ScriptDriverOptions): ScriptDriver {
  const words: ArrayLike<number> = opts.script ?? scriptFrames(opts.seed, opts.length ?? 6000, opts.facing ?? 1);
  const word = (tick: number): number => (tick >= 0 && tick < words.length ? (words[tick] as number) & 0xffff : 0);
  return {
    device: 'bot',
    seed: opts.seed,
    length: words.length,
    word,
    frame: (tick: number): InputFrame => toInputFrame(word(tick), tick, 7),
  };
}
