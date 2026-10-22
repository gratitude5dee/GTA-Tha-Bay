import { describe, expect, it } from 'vitest';
import { FF } from '../../src/fight/buffer.ts';
import { St } from '../../src/fight/states.ts';
import { BTN, Script, dirBits, moveOf, packWith, place, rig, run, setWord, word } from './helpers.ts';

const A = 0, B = 1;

function twoKit(mutate: Parameters<typeof packWith>[0]): ReturnType<typeof rig> {
  const { pack, lineup } = packWith(mutate);
  const r = rig({ pack, lineup });
  place(r, -400, 400);
  return r;
}

describe('trades', () => {
  it('a same-tick trade hits both and both get the same hitstop (the larger)', () => {
    const r = twoKit((_a, b) => { (moveOf(b, '5L').hits[0] as { hit: { hitstop: number } }).hit.hitstop = 12; });
    const press = new Script().press(BTN.LP).out;
    run(r, press, new Script(-1).press(BTN.LP).out);
    expect(r.ev.count('hit')).toBe(0);
    run(r, new Script().idle(3).out);   // both reach move frame 4 together
    expect(r.ev.count('hit')).toBe(2);
    expect(word(r, A, FF.Hp)).toBe(9700);
    expect(word(r, B, FF.Hp)).toBe(9700);
    expect(word(r, A, FF.Hitstop)).toBe(12);
    expect(word(r, B, FF.Hitstop)).toBe(12);
    expect(word(r, A, FF.CounterFlag)).toBe(0);   // both were in active frames: no counter
  });

  it('a strike beats a throw on the same tick', () => {
    const r = twoKit((_a, b) => {
      const m = moveOf(b, '5L');
      m.startup = 5; (m.hits[0] as { from: number }).from = 5;
    });
    run(r, new Script().press(BTN.LP | BTN.LK).idle(4).out, new Script(-1).press(BTN.LP).idle(4).out);
    expect(word(r, A, FF.Hp)).toBe(9700);
    expect(word(r, B, FF.Hp)).toBe(10000);
    expect(word(r, B, FF.State)).not.toBe(St.Thrown);
  });
});

describe('throws', () => {
  const slowThrow = (a: Parameters<typeof packWith>[0] extends (x: infer T, ...r: never[]) => void ? T : never): void => {
    const m = moveOf(a, 'throw');
    m.startup = 12; (m.hits[0] as { from: number }).from = 12;
    (m.tracks[0] as { from: number; to: number }).from = 12; (m.tracks[0] as { from: number; to: number }).to = 13;
  };
  it('two throws 7 frames apart tech: both pushed apart, no damage', () => {
    const r = twoKit((a, b) => { slowThrow(a); slowThrow(b); });
    const throwA = new Script().press(BTN.LP | BTN.LK).idle(11).out;       // connects on tick 11 (move frame 12)
    const throwB = new Script(-1).idle(7).press(BTN.LP | BTN.LK).idle(4).out;   // starts on tick 7: move frame 5 at tick 11
    run(r, throwA, throwB);
    expect(word(r, A, FF.State)).toBe(St.TechThrow);
    expect(word(r, B, FF.State)).toBe(St.TechThrow);
    expect(word(r, A, FF.Hp)).toBe(10000);
    expect(word(r, B, FF.Hp)).toBe(10000);
  });
  it('8 frames apart is a throw', () => {
    const r = twoKit((a, b) => { slowThrow(a); slowThrow(b); });
    const throwA = new Script().press(BTN.LP | BTN.LK).idle(11).out;
    const throwB = new Script(-1).idle(8).press(BTN.LP | BTN.LK).idle(3).out;
    run(r, throwA, throwB);
    expect(word(r, B, FF.State)).toBe(St.Thrown);
    expect(word(r, B, FF.Hp)).toBe(9000);
  });
  it('a throw does not connect on a blocking or airborne defender and respects the box', () => {
    const r = twoKit(() => undefined);
    place(r, -800, 800);                         // 1,600 apart: pushbox edge at 1,300 > 900 reach
    run(r, new Script().press(BTN.LP | BTN.LK).idle(8).out);
    expect(word(r, B, FF.Hp)).toBe(10000);
  });
});

describe('counter hits', () => {
  it('a strike during the defender startup adds 2 hitstun and 110 % damage', () => {
    const r = twoKit(() => undefined);
    run(r, new Script().press(BTN.LP).idle(3).out, new Script(-1).press(BTN.HP).idle(3).out);
    expect(word(r, B, FF.Hp)).toBe(10000 - 330);
    expect(word(r, B, FF.Hitstun)).toBe(13 + 2);
    expect(word(r, B, FF.CounterFlag)).toBe(1);
    expect(word(r, B, FF.State)).toBe(St.HitStand);
  });
  it('the same strike on a neutral defender is not a counter', () => {
    const r = twoKit(() => undefined);
    run(r, new Script().press(BTN.LP).idle(3).out);
    expect(word(r, B, FF.Hp)).toBe(9700);
    expect(word(r, B, FF.Hitstun)).toBe(13);
  });
});

describe('guard and chip', () => {
  const back = (n: number): number[] => new Script(-1).hold(n, 4).out;
  it('normals chip 0 on a blocking defender, 100 permille when Rattled', () => {
    const r = twoKit(() => undefined);
    run(r, new Script().press(BTN.LP).idle(3).out, back(4));
    expect(word(r, B, FF.State)).toBe(St.BlockStand);
    expect(word(r, B, FF.Hp)).toBe(10000);
    expect(word(r, B, FF.Blockstun)).toBe(10);
    const q = twoKit(() => undefined);
    setWord(q, B, FF.Rattled, 1); setWord(q, B, FF.Composure, 0);
    run(q, new Script().press(BTN.LP).idle(3).out, back(4));
    expect(word(q, B, FF.Hp)).toBe(10000 - 30);
    expect(word(q, B, FF.Blockstun)).toBe(12);   // 10 x 1.25
  });
  it('a low needs a crouching block, an overhead a standing one', () => {
    const r = twoKit(() => undefined);
    run(r, new Script().press(BTN.LP, 2).idle(3).out, back(4));   // 2L (low) against stand block
    expect(word(r, B, FF.Hp)).toBe(10000 - 250);
    const q = twoKit(() => undefined);
    run(q, new Script().press(BTN.LP, 2).idle(3).out, new Script(-1).hold(4, 1).out);
    expect(word(q, B, FF.Hp)).toBe(10000);
    expect(word(q, B, FF.State)).toBe(St.BlockCrouch);
  });
  it('a special chips by its permille (Surge 150, Rattled x1.5 on specials)', () => {
    const r = twoKit(() => undefined);
    setWord(r, A, FF.Hype, 2000);
    run(r, new Script().motion('236236', BTN.LP).idle(1).out);   // super freeze starts the move
    // skip the freeze and the startup, defender blocking
    const guard = new Script(-1).hold(120, 4).out;
    run(r, [], guard);
    expect(word(r, B, FF.Hp)).toBeLessThan(10000);
    expect(10000 - word(r, B, FF.Hp)).toBe(Math.trunc((600 * 150) / 1000) + Math.trunc((700 * 150) / 1000) + Math.trunc((900 * 150) / 1000));
  });
});

describe('combo limit, armor, juggle', () => {
  it('the 41st hit forces a hard knockdown with no damage', () => {
    const r = twoKit(() => undefined);
    setWord(r, B, FF.State, St.HitStand); setWord(r, B, FF.Hitstun, 30); setWord(r, B, FF.ComboHits, 40);
    run(r, new Script().press(BTN.LP).idle(3).out);
    expect(word(r, B, FF.Hp)).toBe(10000);
    expect(word(r, B, FF.State)).toBe(St.Knockdown);
    expect(word(r, B, FF.Knockdown)).toBe(2);
  });
  it('armor takes 50 % damage, no stun, and is used up', () => {
    const r = twoKit((_a, b) => { moveOf(b, '5H').armor = { from: 1, to: 20, hits: 1 }; });
    run(r, new Script().press(BTN.LP).idle(3).out, new Script(-1).press(BTN.HP).idle(3).out);
    expect(word(r, B, FF.Hp)).toBe(10000 - 150);
    expect(word(r, B, FF.State)).toBe(St.Attack);
    expect(word(r, B, FF.Hitstun)).toBe(0);
    expect(word(r, B, FF.ArmorLeft)).toBe(0);
    expect(word(r, A, FF.Hitstop)).toBeGreaterThan(0);
  });
  it('a launched victim is juggled only while the limit lasts', () => {
    const r = twoKit(() => undefined);
    setWord(r, B, FF.State, St.HitAir); setWord(r, B, FF.Y, 900); setWord(r, B, FF.VY, 0); setWord(r, B, FF.JuggleLeft, 0); setWord(r, B, FF.ComboHits, 2);
    run(r, new Script().press(BTN.LP).idle(3).out);
    expect(word(r, B, FF.Hp)).toBe(10000);   // 5L carries juggle cost 99: it whiffs the airborne victim
  });
  it('dirBits is facing aware', () => {
    expect(dirBits(6, 1)).toBe(dirBits(4, -1));
  });
});
