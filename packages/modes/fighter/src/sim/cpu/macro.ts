/**
 * The CPU macro executor (FC10.3): an action expands to a script of `FighterInput` words (a motion is its directions, one pair of
 * frames each, then the button), played one word per tick. With the level's execution-error chance a step is dropped (the motion
 * breaks) or the whole script starts late. The CPU obeys the same motion and buffer rules as a human: it presses inputs, never moves.
 * Sim code under the C02 lint.
 */
import type { Rng } from '@dv/shared';
import { FB } from '@dv/shared/fight';
import { dirBits, type MacroStep } from './moves.ts';

export class MacroPlayer {
  private words: number[] = [];
  private at = 0;
  /** The word held after the script ends, until the next decision (walk, block); 0 = neutral. */
  hold = 0;
  /** Scripts started, and how many the execution error damaged (a step dropped) or delayed. */
  starts = 0;
  errors = 0;

  get active(): boolean { return this.at < this.words.length; }
  get remaining(): number { return this.words.length - this.at; }

  clear(): void { this.words = []; this.at = 0; this.hold = 0; }

  /** Starts a script from numpad steps. `errorPct` is the chance that it is damaged (a step lost) or late. */
  start(steps: readonly MacroStep[], facing: number, errorPct: number, rng: Rng): void {
    const words: number[] = [];
    let list = steps;
    let delay = 0;
    this.starts++;
    if (errorPct > 0 && rng.nextFloat() * 100 < errorPct) {
      this.errors++;
      if (steps.length > 1 && rng.nextFloat() < 0.5) {
        const drop = Math.min(steps.length - 2, Math.trunc(rng.nextFloat() * (steps.length - 1)));
        list = steps.filter((_, i) => i !== drop);
      } else delay = 3 + Math.trunc(rng.nextFloat() * 6);
    }
    for (let i = 0; i < delay; i++) words.push(0);
    for (const s of list) for (let i = 0; i < s.n; i++) words.push(dirBits(s.d, facing) | s.b);
    this.words = words;
    this.at = 0;
    this.hold = 0;
  }

  /** Sets a held input for the stretch between decisions. */
  setHold(word: number): void { this.words = []; this.at = 0; this.hold = word; }

  /** The word of this tick. */
  next(): number {
    if (this.at < this.words.length) return this.words[this.at++] as number;
    return this.hold;
  }
}

/** A held block: back, plus down for a low (FC6.4: standing blocks high and mid, crouching blocks high, mid and low). */
export function blockWord(facing: number, crouch: boolean): number {
  return dirBits(crouch ? 1 : 4, facing);
}

export const ATTACK_ANY = FB.LP | FB.MP | FB.HP | FB.LK | FB.MK | FB.HK;
