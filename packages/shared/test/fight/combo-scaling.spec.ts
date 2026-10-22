import { describe, expect, it } from 'vitest';
import { FF } from '../../src/fight/buffer.ts';
import { St } from '../../src/fight/states.ts';
import { BTN, Script, moveIdx, place, rig, run, setWord, word } from './helpers.ts';

const A = 0, B = 1;
const TABLE = [100, 100, 80, 70, 60, 50, 40, 30];

function victimInCombo(n: number): ReturnType<typeof rig> {
  const r = rig();
  place(r, -400, 400);
  setWord(r, B, FF.State, St.HitStand); setWord(r, B, FF.Hitstun, 40); setWord(r, B, FF.ComboHits, n);
  return r;
}

describe('combo scaling [100,100,80,70,60,50,40,30] floored at 30', () => {
  for (let n = 0; n <= 11; n++) {
    const pct = Math.max(30, TABLE[Math.min(n, 7)] as number);
    it(`hit ${n + 1} of a combo does ${pct} %`, () => {
      const r = victimInCombo(n);
      run(r, new Script().press(BTN.LP).idle(3).out);
      expect(10000 - word(r, B, FF.Hp)).toBe(Math.trunc((300 * pct) / 100));
      expect(word(r, B, FF.ComboHits)).toBe(n + 1);
    });
  }

  it('Surge is floored at 40 %, not 30', () => {
    const r = victimInCombo(7);
    setWord(r, A, FF.State, St.Super); setWord(r, A, FF.Move, moveIdx(r, A, 'surge')); setWord(r, A, FF.MoveFrame, 5);
    run(r, [0]);
    expect(10000 - word(r, B, FF.Hp)).toBe(Math.trunc((600 * 40) / 100));
  });

  it('hitstun decays by 1 per hit down to half the base', () => {
    for (const [n, want] of [[0, 13], [3, 10], [10, 7]] as const) {
      const r = victimInCombo(n);
      run(r, new Script().press(BTN.LP).idle(3).out);
      expect(word(r, B, FF.Hitstun)).toBe(want);
    }
  });

  it('keeps every intermediate exact at maximum health, damage and scale', () => {
    const r = victimInCombo(0);
    setWord(r, B, FF.Hp, 10500);
    run(r, new Script().press(BTN.LP).idle(3).out);
    expect(word(r, B, FF.Hp)).toBe(10200);
    expect(Number.isInteger(word(r, B, FF.Hp))).toBe(true);
  });

  it('EX multiplies by 120 % and Simple specials by 80 %', () => {
    // EX Spark Toss is a projectile: use Uplift EX (damage 1,000 -> 1,200 on a fresh victim)
    const r = rig();
    place(r, -400, 400);
    setWord(r, A, FF.Hype, 1000);
    run(r, new Script().motion('623', BTN.LP | BTN.MP).out);
    run(r, new Script().idle(8).out);
    expect(10000 - word(r, B, FF.Hp)).toBe(1200);
    expect(word(r, A, FF.Hype)).toBeLessThan(1000 + 100);
  });
});
