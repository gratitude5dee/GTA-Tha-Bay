import { describe, expect, it } from 'vitest';
import { MATCH, MATCH_EX, doubleTapNow, makeParseParams, matchMove } from '../../src/fight/motion.ts';
import type { ParseState } from '../../src/fight/motion.ts';
import { FB } from '../../src/fight/input.ts';
import { FF, Phase } from '../../src/fight/buffer.ts';
import { St } from '../../src/fight/states.ts';
import { BTN, KIT, PP, Script, TUNING, cmoveWith, moveIndex, ringFrom, rig, run, setWord, word } from './helpers.ts';

const P = FB.LP | FB.MP | FB.HP;
const K = FB.LK | FB.MK | FB.HK;

function fires(script: Script, buttons: number, motion: Parameters<typeof cmoveWith>[0], opts: { pp?: typeof PP; ps?: Partial<ParseState>; kind?: 'special' | 'super' } = {}): number {
  const { buf, base, tick, charge } = ringFrom(script.out, script.facing);
  const m = cmoveWith(motion, opts.kind ?? 'special');
  void buttons;
  return matchMove(buf, base, tick, m, opts.pp ?? PP, { ...charge, ...opts.ps }) & 3;
}

describe('236 / 214 / 623 / 41236', () => {
  const m236 = { t: 'motion', seq: '236', buttons: P } as const;
  it('236 triggers on 2-3-6+P and on 2-6+P, rejects 6+P alone and 2+P', () => {
    expect(fires(new Script().motion('236', FB.LP), 0, m236)).toBe(MATCH);
    expect(fires(new Script().motion('26', FB.LP), 0, m236)).toBe(MATCH);
    expect(fires(new Script().motion('6', FB.LP), 0, m236)).toBe(0);
    expect(fires(new Script().motion('2', FB.LP), 0, m236)).toBe(0);
    expect(fires(new Script().motion('632', FB.LP), 0, m236)).toBe(0);
  });
  it('the motion must fit MOTION_WINDOW (12 frames)', () => {
    const ok = new Script().hold(1, 2).idle(9).hold(1, 6, FB.LP);   // 2 ... 6 spans 10 frames
    const late = new Script().hold(1, 2).idle(12).hold(1, 6, FB.LP); // spans 13 frames
    expect(fires(ok, 0, m236)).toBe(MATCH);
    expect(fires(late, 0, m236)).toBe(0);
  });
  it('214 on kicks, mirrored for a fighter facing left', () => {
    const m214 = { t: 'motion', seq: '214', buttons: K } as const;
    expect(fires(new Script().motion('214', FB.LK), 0, m214)).toBe(MATCH);
    expect(fires(new Script(-1).motion('214', FB.MK), 0, m214)).toBe(MATCH);
    expect(fires(new Script().motion('236', FB.LK), 0, m214)).toBe(0);
    expect(fires(new Script().motion('214', FB.LP), 0, m214)).toBe(0);   // a punch is not a kick
  });
  it('623 accepts 6-2-3, 6-3-2-3 and the dash-implied first 6', () => {
    const m623 = { t: 'motion', seq: '623', buttons: P } as const;
    expect(fires(new Script().motion('623', FB.HP), 0, m623)).toBe(MATCH);
    expect(fires(new Script().motion('6323', FB.HP), 0, m623)).toBe(MATCH);
    expect(fires(new Script().motion('23', FB.HP), 0, m623)).toBe(0);
    expect(fires(new Script().motion('23', FB.HP), 0, m623, { ps: { dashImplied: true } })).toBe(MATCH);
  });
  it('41236 and 63214 need every step', () => {
    const m41236 = { t: 'motion', seq: '41236', buttons: P } as const;
    expect(fires(new Script().motion('41236', FB.MP), 0, m41236)).toBe(MATCH);
    expect(fires(new Script().motion('4236', FB.MP), 0, m41236)).toBe(0);
    expect(fires(new Script().motion('4126', FB.MP), 0, m41236)).toBe(0);
    const m63214 = { t: 'motion', seq: '63214', buttons: P } as const;
    expect(fires(new Script().motion('63214', FB.MP), 0, m63214)).toBe(MATCH);
    expect(fires(new Script().motion('6324', FB.MP), 0, m63214)).toBe(0);
  });
  it('360 accepts a full circle from any start in either direction', () => {
    const m360 = { t: 'motion', seq: '360', buttons: P } as const;
    expect(fires(new Script().motion('63214789', FB.LP), 0, m360)).toBe(MATCH);
    expect(fires(new Script().motion('98741236', FB.LP), 0, m360)).toBe(MATCH);
    expect(fires(new Script().motion('6321478', FB.LP), 0, m360)).toBe(0);
  });
});

describe('button leeway (BUTTON_LEEWAY 4)', () => {
  const m236 = { t: 'motion', seq: '236', buttons: P } as const;
  it('button 4 frames after the motion ends triggers, 5 does not (motion released)', () => {
    const at4 = new Script().motion('236').idle(3).press(FB.LP);   // last '6' is 4 frames before the press
    const at5 = new Script().motion('236').idle(4).press(FB.LP);
    expect(fires(at4, 0, m236)).toBe(MATCH);
    expect(fires(at5, 0, m236)).toBe(0);
  });
  it('button pressed before the motion completes: motion done within 4 frames triggers, 5 does not', () => {
    const early4 = new Script().hold(1, 2).hold(1, 3).press(FB.LP, 2).hold(3, 2).hold(1, 6);   // press 4 frames before the 6
    const early5 = new Script().hold(1, 2).hold(1, 3).press(FB.LP, 2).hold(4, 2).hold(1, 6);
    expect(fires(early4, 0, m236)).toBe(MATCH);
    expect(fires(early5, 0, m236)).toBe(0);
  });
  it('leniencyX100 150 widens the leeway to 6 frames', () => {
    const pp150 = makeParseParams(TUNING, 150);
    expect(pp150.leeway).toBe(6);
    const at6 = new Script().motion('236').idle(5).press(FB.LP);
    const at7 = new Script().motion('236').idle(6).press(FB.LP);
    expect(fires(at6, 0, m236, { pp: pp150 })).toBe(MATCH);
    expect(fires(at7, 0, m236, { pp: pp150 })).toBe(0);
    expect(fires(at6, 0, m236)).toBe(0);   // 100 % rejects the same input
  });
});

describe('charge [4]6', () => {
  const charge = { t: 'charge', hold: 4, release: 6, frames: 45, buttons: P } as const;
  it('45 held frames with a 3-frame gap triggers', () => {
    const s = new Script().hold(20, 4).idle(3).hold(25, 4).hold(1, 6, FB.LP);
    expect(fires(s, 0, charge)).toBe(MATCH);
  });
  it('a 4-frame gap resets the charge', () => {
    const s = new Script().hold(20, 4).idle(4).hold(25, 4).hold(1, 6, FB.LP);
    expect(fires(s, 0, charge)).toBe(0);
  });
  it('44 frames are not enough', () => {
    const s = new Script().hold(44, 4).hold(1, 6, FB.LP);
    expect(fires(s, 0, charge)).toBe(0);
    expect(fires(new Script().hold(45, 4).hold(1, 6, FB.LP), 0, charge)).toBe(MATCH);
  });
  it('[2]8 charges downward', () => {
    const up = { t: 'charge', hold: 2, release: 8, frames: 45, buttons: P } as const;
    expect(fires(new Script().hold(45, 2).hold(1, 8, FB.LP), 0, up)).toBe(MATCH);
  });
});

describe('double tap (66, 22)', () => {
  it('66 inside DASH_TAP_WINDOW (10) triggers, outside does not', () => {
    const inside = ringFrom(new Script().hold(1, 6).idle(8).hold(1, 6).out);   // taps 9 frames apart
    const outside = ringFrom(new Script().hold(1, 6).idle(10).hold(1, 6).out); // 11 apart
    expect(doubleTapNow(inside.buf, inside.base, inside.tick, 6, PP.tap)).toBe(true);
    expect(doubleTapNow(outside.buf, outside.base, outside.tick, 6, PP.tap)).toBe(false);
  });
  it('a held direction is not a second tap', () => {
    const held = ringFrom(new Script().hold(1, 6).idle(3).hold(8, 6).out);
    expect(doubleTapNow(held.buf, held.base, held.tick, 6, PP.tap)).toBe(false);   // the second tap began 7 frames earlier
  });
  it('22 + button as a special', () => {
    const m22 = { t: 'motion', seq: '22', buttons: P } as const;
    expect(fires(new Script().hold(1, 2).idle(2).press(FB.LP, 2), 0, m22)).toBe(MATCH);
    expect(fires(new Script().hold(4, 2).press(FB.LP, 2), 0, m22)).toBe(0);
  });
});

describe('EX', () => {
  const m = { t: 'motion', seq: '236', buttons: P } as const;
  it('two same-type buttons with a stock of Hype request EX', () => {
    const s = new Script().motion('236', FB.LP | FB.MP);
    expect(fires(s, 0, m, { ps: { canEx: true } })).toBe(MATCH | MATCH_EX);
    expect(fires(s, 0, m, { ps: { canEx: false } })).toBe(MATCH);
    expect(fires(new Script().motion('236', FB.LP | FB.LK), 0, m, { ps: { canEx: true } })).toBe(MATCH);   // a kick is not the same type
  });
});

describe('priority and throw in the running sim', () => {
  const surge = moveIndex('surge'), spark = moveIndex('sparkToss'), throwI = moveIndex('throw'), fiveL = moveIndex('5L');

  function firstMove(hype: number, script: Script): number {
    const r = rig();
    setWord(r, 0, FF.Hype, hype);
    run(r, script.out);
    return word(r, 0, FF.Move);
  }
  it('super beats special on overlap, and falls back to the special without Hype', () => {
    const s = () => new Script().motion('236236', FB.LP);
    expect(firstMove(2000, s())).toBe(surge);
    expect(firstMove(1999, s())).toBe(spark);
    expect(firstMove(0, new Script().motion('236', FB.LP))).toBe(spark);
  });
  it('LP+LK on one frame is a throw, two frames apart is a normal', () => {
    const r1 = rig();
    run(r1, new Script().press(BTN.LP | BTN.LK).out);
    expect(word(r1, 0, FF.Move)).toBe(throwI);
    expect(word(r1, 0, FF.State)).toBe(St.Throw);
    const r2 = rig();
    run(r2, new Script().press(BTN.LP).idle(2).press(BTN.LK).out);
    expect(word(r2, 0, FF.Move)).toBe(fiveL);
  });
  it('MP+MK on one frame is a Check, not a medium normal', () => {
    const r = rig();
    run(r, new Script().press(BTN.MP | BTN.MK).out);
    expect(word(r, 0, FF.State)).toBe(St.Check);
    expect(Phase.Fight).toBe(3);
  });
  it('a pressed button is consumed once (no second trigger from the buffer)', () => {
    const r = rig();
    run(r, new Script().press(BTN.LP).idle(30).out);
    expect(word(r, 0, FF.State)).toBe(St.Idle);
    expect(word(r, 0, FF.MoveResult)).toBe(0);
  });
});

describe('kit compile', () => {
  it('orders super, special, command, normal; complex before simple within a class', () => {
    const order = Array.from(KIT.parseOrder).map((i) => (KIT.moves[i] as { cls: number }).cls);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]).toBeGreaterThanOrEqual(order[i] as number);
    expect(KIT.moves[KIT.parseOrder[0] as number]?.def.kind).toBe('super');
  });
});
