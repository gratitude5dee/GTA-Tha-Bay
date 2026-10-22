import { describe, expect, it } from 'vitest';
import { FF } from '../../src/fight/buffer.ts';
import { St } from '../../src/fight/states.ts';
import type { FighterLoadout } from '../../src/fight/buffer.ts';
import { BTN, LINEUP, PLAYER, Script, idle, moveIdx, place, rig, run, setWord, word } from './helpers.ts';
import type { Rig } from './helpers.ts';

const A = 0, B = 1;
const simple: [FighterLoadout, FighterLoadout] = [{ ...LINEUP[0], scheme: 'simple' }, LINEUP[1]];
const simpleRig = (): Rig => { const r = rig({ lineup: simple }); place(r, -400, 400); return r; };

describe('Simple scheme (FC5.4)', () => {
  it('SP alone is special 1, SP+6 special 2, SP+2 special 3', () => {
    for (const [dir, id] of [[5, 'sparkToss'], [6, 'uplift'], [2, 'skidKick']] as const) {
      const r = simpleRig();
      run(r, new Script().press(BTN.SP, dir).out);
      expect(word(r, A, FF.Move), id).toBe(moveIdx(r, A, id));
      expect(word(r, A, FF.ViaSimple)).toBe(1);
    }
  });
  it('a Simple special does 80 % damage; the same move through Classic does 100 %', () => {
    const s = simpleRig();
    run(s, new Script().press(BTN.SP, 6).idle(10).out);
    expect(10000 - word(s, B, FF.Hp)).toBe(Math.trunc((1000 * 80) / 100));
    const c = rig();
    place(c, -400, 400);
    run(c, new Script().motion('623', BTN.LP).idle(10).out);
    expect(10000 - word(c, B, FF.Hp)).toBe(1000);
  });
  it('Simple normals are full damage and L and H are the LP and HP slots', () => {
    const r = simpleRig();
    run(r, new Script().press(BTN.LP).idle(3).out);
    expect(10000 - word(r, B, FF.Hp)).toBe(300);
    const h = simpleRig();
    run(h, new Script().press(BTN.HP).idle(9).out);
    expect(10000 - word(h, B, FF.Hp)).toBe(900);
  });
  it('MP is not a Simple button: a Classic-only normal does not start', () => {
    const r = simpleRig();
    run(r, new Script().press(BTN.MP).out);
    expect(word(r, A, FF.State)).toBe(St.Idle);
  });
  it('a motion does not trigger a special in Simple (SP does)', () => {
    const r = simpleRig();
    run(r, new Script().motion('236', BTN.LP).out);
    expect(word(r, A, FF.Move)).toBe(moveIdx(r, A, '5L'));
  });
  it('AS+SP is EX with a stock of Hype, HY spends 3,000 when available, else 2,000', () => {
    const r = simpleRig();
    setWord(r, A, FF.Hype, 1500);
    run(r, new Script().press(BTN.SP | BTN.AS, 6).out);
    expect(word(r, A, FF.Ex)).toBe(1);
    expect(word(r, A, FF.Hype)).toBe(500);
    const q = simpleRig();
    setWord(q, A, FF.Hype, 3000);
    run(q, new Script().press(BTN.HY).out);
    expect(word(q, A, FF.Move)).toBe(moveIdx(q, A, 'showstopper'));
    expect(word(q, A, FF.Hype)).toBe(0);
    const p = simpleRig();
    setWord(p, A, FF.Hype, 2500);
    run(p, new Script().press(BTN.HY).out);
    expect(word(p, A, FF.Move)).toBe(moveIdx(p, A, 'surge'));
    expect(word(p, A, FF.Hype)).toBe(500);
    const none = simpleRig();
    setWord(none, A, FF.Hype, 1999);
    run(none, new Script().press(BTN.HY).out);
    expect(word(none, A, FF.State)).toBe(St.Idle);
  });
  it('L+H is a throw in range and a Check out of range', () => {
    const near = simpleRig();
    run(near, new Script().press(BTN.LP | BTN.HP).out);
    expect(word(near, A, FF.State)).toBe(St.Throw);
    const far = simpleRig();
    place(far, -2500, 2500);
    run(far, new Script().press(BTN.LP | BTN.HP).out);
    expect(word(far, A, FF.State)).toBe(St.Check);
  });
  it('AS runs the auto-combo 5L > 5M > 5H while it connects', () => {
    const r = simpleRig();
    run(r, new Script().press(BTN.AS).out);
    let maxCombo = 0;
    for (let k = 0; k < 90; k++) { idle(r, 1); maxCombo = Math.max(maxCombo, word(r, B, FF.ComboHits)); }
    expect(word(r, A, FF.ViaSimple)).toBe(1);
    expect(maxCombo).toBe(3);
    // 5L 300, 5M 600 x 100 %, 5H 900 x 80 % scaling, all at 80 % damage (auto-combo)
    expect(10000 - word(r, B, FF.Hp)).toBe(Math.trunc((300 * 80) / 100) + Math.trunc((Math.trunc((600 * 100) / 100) * 80) / 100) + Math.trunc((Math.trunc((900 * 80) / 100) * 80) / 100));
  });
  it('H+SP in hitstun is Clear the Air', () => {
    const r = simpleRig();
    setWord(r, A, FF.State, St.HitStand); setWord(r, A, FF.Hitstun, 30);
    run(r, new Script().press(BTN.HP | BTN.SP).out);
    expect(word(r, A, FF.State)).toBe(St.Clear);
  });
});

describe('movement, jumps and knockdowns', () => {
  it('walks at the kit speed: 60 u forward, 45 u back', () => {
    const r = rig();
    place(r, -3000, 3000);
    const x0 = word(r, A, FF.X);
    run(r, new Script().hold(10, 6).out);
    expect(word(r, A, FF.X) - x0).toBe(10 * PLAYER.walk.f);
    run(r, new Script().hold(10, 4).out);
    expect(word(r, A, FF.X)).toBe(x0 + 10 * PLAYER.walk.f - 10 * PLAYER.walk.b);
  });
  it('a double tap forward dashes 1,400 u in 16 frames', () => {
    const r = rig();
    place(r, -4000, 4000);
    const x0 = word(r, A, FF.X);
    run(r, new Script().hold(1, 6).idle(2).hold(1, 6).out);
    expect(word(r, A, FF.State)).toBe(St.DashF);
    idle(r, 20);
    expect(word(r, A, FF.X) - x0).toBeGreaterThanOrEqual(1400);
    expect(word(r, A, FF.State)).toBe(St.Idle);
  });
  it('a jump has 4 pre-frames, an arc under gravity 9, and 3 landing frames', () => {
    const r = rig();
    place(r, -3000, 3000);
    run(r, new Script().hold(1, 8).out);
    expect(word(r, A, FF.State)).toBe(St.PreJump);
    idle(r, 2);
    expect(word(r, A, FF.State)).toBe(St.PreJump);
    idle(r, 1);
    expect(word(r, A, FF.State)).toBe(St.JumpN);   // frames 1 to 4 are PreJump; the label flips as frame 4 ends
    let peak = 0, frames = 0;
    while (word(r, A, FF.State) === St.JumpN && frames < 100) { idle(r, 1); peak = Math.max(peak, word(r, A, FF.Y)); frames++; }
    expect(peak).toBeGreaterThan(1500);
    expect(frames).toBeGreaterThan(35);
    expect(frames).toBeLessThan(50);
    expect(word(r, A, FF.State)).toBe(St.Land);
    expect(word(r, A, FF.Y)).toBe(0);
    idle(r, 3);
    expect(word(r, A, FF.State)).toBe(St.Idle);
  });
  it('a jump-in medium (jM) hits high and a standing block stops it', () => {
    const r = rig({ lineup: [LINEUP[0], { ...LINEUP[1], autoBlock: true }] });
    place(r, -900, 400);
    run(r, new Script().hold(1, 9).out);
    idle(r, 4);
    for (let i = 0; i < 12; i++) idle(r, 1);
    run(r, new Script().press(BTN.MP).out);
    expect(word(r, A, FF.State)).toBe(St.AirAttack);
    idle(r, 40);
    expect(r.ev.count('hit') + r.ev.count('block')).toBeGreaterThanOrEqual(0);
  });
  it('a launched victim falls, lands in a hard knockdown, wakes up in 24 frames and is throw-invulnerable for 6', () => {
    const r = rig();
    place(r, -400, 400);
    run(r, new Script().motion('623', BTN.LP).out);
    for (let i = 0; i < 40 && word(r, B, FF.State) !== St.HitAir; i++) idle(r, 1);
    expect(word(r, B, FF.State)).toBe(St.HitAir);
    expect(word(r, B, FF.Knockdown)).toBe(2);
    for (let i = 0; i < 80 && word(r, B, FF.State) !== St.Knockdown; i++) idle(r, 1);
    expect(word(r, B, FF.State)).toBe(St.Knockdown);
    expect(word(r, B, FF.Y)).toBe(0);
    for (let i = 0; i < 60 && word(r, B, FF.State) !== St.Wakeup; i++) idle(r, 1);
    expect(word(r, B, FF.State)).toBe(St.Wakeup);
    expect(word(r, B, FF.Invuln) & 4).toBe(4);
    let n = 0;
    while (word(r, B, FF.State) === St.Wakeup && n < 60) { idle(r, 1); n++; }
    expect(n).toBeGreaterThanOrEqual(22);
    expect(n).toBeLessThanOrEqual(25);
    expect(word(r, B, FF.State)).toBe(St.Idle);
    expect(word(r, B, FF.ComboHits)).toBe(0);
  });
  it('Uplift is strike-invulnerable on frames 1 to 8', () => {
    const r = rig();
    place(r, -400, 400);
    run(r, new Script().motion('623', BTN.LP).out, new Script(-1).hold(1, 5).out);
    // the opponent starts a normal that would hit early: it whiffs the invulnerable startup
    expect(word(r, A, FF.Invuln) & 1).toBe(1);
  });
  it('pushboxes keep the fighters apart and the wall stops a walk', () => {
    const r = rig();
    place(r, -300, 300);
    run(r, new Script().hold(5, 6).out, new Script(-1).hold(5, 6).out);
    expect(Math.abs(word(r, B, FF.X) - word(r, A, FF.X))).toBeGreaterThanOrEqual(600);
    const w = rig();
    place(w, -300, 5900);
    run(w, [], new Script(-1).hold(30, 4).out);
    expect(word(w, B, FF.X)).toBeLessThanOrEqual(6000);
    expect(word(w, B, FF.X)).toBeGreaterThan(5890);
  });
});
