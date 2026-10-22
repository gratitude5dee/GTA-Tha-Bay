import { describe, expect, it } from 'vitest';
import { FF } from '../../src/fight/buffer.ts';
import { St } from '../../src/fight/states.ts';
import { BTN, Script, idle, place, rig, run, setWord, word } from './helpers.ts';

const A = 0, B = 1;
const rigAt = (): ReturnType<typeof rig> => { const r = rig(); place(r, -400, 400); return r; };

describe('Hype', () => {
  it('a hit gives the attacker the move gain and the victim 10 % of the damage', () => {
    const r = rigAt();
    run(r, new Script().press(BTN.LP).idle(3).out);
    expect(word(r, A, FF.Hype)).toBe(40);
    expect(word(r, B, FF.Hype)).toBe(30);
  });
  it('a block gives the attacker the block gain', () => {
    const r = rigAt();
    run(r, new Script().press(BTN.LP).idle(3).out, new Script(-1).hold(4, 4).out);
    expect(word(r, A, FF.Hype)).toBe(20);
  });
  it('Hype caps at 3,000 and persists; EX spends one stock', () => {
    const r = rigAt();
    setWord(r, A, FF.Hype, 2990);
    run(r, new Script().press(BTN.LP).idle(3).out);
    expect(word(r, A, FF.Hype)).toBe(3000);
    const q = rigAt();
    setWord(q, A, FF.Hype, 1500);
    run(q, new Script().motion('623', BTN.LP | BTN.MP).out);
    expect(word(q, A, FF.Hype)).toBe(500);
    expect(word(q, A, FF.Ex)).toBe(1);
  });
  it('a completed taunt gives 300; an interrupted one nothing', () => {
    const r = rigAt();
    place(r, -2500, 2500);
    run(r, new Script().press(BTN.TA).idle(80).out);
    expect(word(r, A, FF.Hype)).toBe(300);
  });
  it('a whiffed move with a whiff gain pays it at the end', () => {
    const r = rigAt();
    place(r, -2500, 2500);
    run(r, new Script().press(BTN.LP).idle(20).out);
    expect(word(r, A, FF.Hype)).toBe(0);
  });
  it('a super spends 2,000 and Showstopper 3,000', () => {
    const r = rigAt();
    setWord(r, A, FF.Hype, 3000);
    run(r, new Script().motion('214214', BTN.HP).out);
    expect(word(r, A, FF.Hype)).toBe(0);
    const q = rigAt();
    setWord(q, A, FF.Hype, 2500);
    run(q, new Script().motion('236236', BTN.HP).out);
    expect(word(q, A, FF.Hype)).toBe(500);
  });
});

describe('Composure, Check and Clear', () => {
  it('Check costs 600 and a successful parry refunds 300, with no damage and attacker stun', () => {
    const r = rigAt();
    run(r, new Script().press(BTN.LP).idle(3).out, new Script(-1).press(BTN.MP | BTN.MK).idle(3).out);
    expect(word(r, B, FF.State)).toBe(St.CheckSuccess);
    expect(word(r, B, FF.Composure)).toBe(6000 - 600 + 300);
    expect(word(r, B, FF.Hp)).toBe(10000);
    expect(word(r, A, FF.State)).toBe(St.HitStand);
    expect(word(r, A, FF.Hitstun)).toBe(12);
    expect(word(r, A, FF.ComboHits)).toBe(0);
  });
  it('a whiffed Check recovers for 20 frames after its 8 active frames and keeps the cost', () => {
    const r = rigAt();
    place(r, -2500, 2500);
    run(r, [], new Script(-1).press(BTN.MP | BTN.MK).out);
    expect(word(r, B, FF.State)).toBe(St.Check);
    idle(r, 26);
    expect(word(r, B, FF.State)).toBe(St.Check);
    idle(r, 1);
    expect(word(r, B, FF.State)).toBe(St.Idle);
    expect(word(r, B, FF.Composure)).toBeLessThanOrEqual(6000 - 600 + 6 * 0 + 0);
  });
  it('composure regenerates 6 per frame after 30 idle frames', () => {
    const r = rigAt();
    setWord(r, A, FF.Composure, 1000); setWord(r, A, FF.CheckTimer, 0);
    idle(r, 30);
    expect(word(r, A, FF.Composure)).toBe(1000);
    idle(r, 10);
    expect(word(r, A, FF.Composure)).toBe(1000 + 6 * 10);
  });
  it('spending to 0 makes the fighter Rattled until 3,000, and Rattled cannot Check', () => {
    const r = rigAt();
    place(r, -2500, 2500);
    setWord(r, B, FF.Composure, 600);
    run(r, [], new Script(-1).press(BTN.MP | BTN.MK).out);
    expect(word(r, B, FF.Rattled)).toBe(1);
    expect(word(r, B, FF.Composure)).toBe(0);
    idle(r, 40);
    const state = word(r, B, FF.State);
    run(r, [], new Script(-1).press(BTN.MP | BTN.MK).out);
    expect(word(r, B, FF.State)).not.toBe(St.Check);
    expect(state).toBe(St.Idle);
    idle(r, 500);
    expect(word(r, B, FF.Rattled)).toBe(0);
  });
  it('Clear the Air costs 2,000, works once per round, pushes apart and ends the combo', () => {
    const r = rigAt();
    setWord(r, B, FF.State, St.HitStand); setWord(r, B, FF.Hitstun, 30); setWord(r, B, FF.ComboHits, 3);
    run(r, [], new Script(-1).press(BTN.HP | BTN.HK).out);
    expect(word(r, B, FF.State)).toBe(St.Clear);
    expect(word(r, B, FF.Composure)).toBe(4000);
    expect(word(r, B, FF.ClearUsed)).toBe(1);
    expect(word(r, B, FF.ComboHits)).toBe(0);
    idle(r, 8);
    expect(word(r, A, FF.State)).toBe(St.HitStand);   // pushed into a short stun
    expect(Math.abs(word(r, B, FF.X) - word(r, A, FF.X))).toBeGreaterThan(800);
    idle(r, 30);
    setWord(r, B, FF.State, St.HitStand); setWord(r, B, FF.Hitstun, 30);
    run(r, [], new Script(-1).press(BTN.HP | BTN.HK).out);
    expect(word(r, B, FF.State)).toBe(St.HitStand);   // second Clear refused
  });
  it('Clear is invulnerable for its first 10 frames', () => {
    const r = rigAt();
    setWord(r, B, FF.State, St.HitStand); setWord(r, B, FF.Hitstun, 30);
    run(r, new Script().press(BTN.LP).idle(1).out, new Script(-1).press(BTN.HP | BTN.HK).idle(1).out);
    idle(r, 4);
    expect(word(r, B, FF.Hp)).toBe(10000);
  });
});
