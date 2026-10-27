/**
 * AC-6 (FC5): the Simple scheme through the mode's match wrapper (specials at 80 % damage, AS runs the auto-combo, L+H throws in
 * range and Checks out of range, HY spends 3,000 else 2,000 of Hype) and the second pad driving slot 1. The binding files validate
 * in `packages/engine/test/config.spec.ts` (they need the schema validator).
 */
import { FF, FIGHTER_BASE, Phase, St } from '@dv/shared/fight';
import type { FighterLoadout } from '@dv/shared/fight';
import { describe, expect, it } from 'vitest';
import { dirBits } from '../src/sim/cpu/moves.ts';
import { fighterSim, activeSession } from '../src/sim/mode.ts';
import { FB, PLAYER, fakeCtx, frameOf, newMatch } from './helpers.ts';
import type { FighterMatch } from '../src/sim/match.ts';

const SIMPLE: FighterLoadout = { ...PLAYER, scheme: 'simple' };
const A = 0, B = 1;

function ready(x0 = -400, x1 = 400): FighterMatch {
  const m = newMatch({}, [SIMPLE, PLAYER]);
  let guard = 0;
  while (m.phase !== Phase.Fight && guard++ < 600) m.step(0, 0);
  m.buf[(FIGHTER_BASE[0] as number) + FF.X] = x0;
  m.buf[(FIGHTER_BASE[1] as number) + FF.X] = x1;
  return m;
}
const run = (m: FighterMatch, words: number[], idle = 0): void => { for (const w of words) m.step(w, 0); for (let i = 0; i < idle; i++) m.step(0, 0); };
const press = (bits: number, dir = 5): number[] => [bits | dirBits(dir, 1)];

describe('Simple scheme on the mode match (FC5.4)', () => {
  it('a Simple special lands at 80 % of the Classic damage', () => {
    const s = ready();
    run(s, press(FB.SP, 6), 12);
    expect(10000 - s.w(B, FF.Hp)).toBe(800);
    const c = newMatch({}, [PLAYER, PLAYER]);
    while (c.phase !== Phase.Fight) c.step(0, 0);
    c.buf[(FIGHTER_BASE[0] as number) + FF.X] = -400;
    c.buf[(FIGHTER_BASE[1] as number) + FF.X] = 400;
    for (const d of [dirBits(6, 1), dirBits(2, 1), dirBits(3, 1) | FB.LP]) c.step(d, 0);
    for (let i = 0; i < 12; i++) c.step(0, 0);
    expect(10000 - c.w(B, FF.Hp)).toBe(1000);
  });

  it('AS runs the auto-combo while it connects', () => {
    const m = ready();
    run(m, press(FB.AS), 60);
    expect(10000 - m.w(B, FF.Hp)).toBeGreaterThan(300);
  });

  it('L+H is a throw in range and a Check out of range', () => {
    const near = ready();
    run(near, press(FB.LP | FB.HP));
    expect(near.w(A, FF.State)).toBe(St.Throw);
    const far = ready(-2500, 2500);
    run(far, press(FB.LP | FB.HP));
    expect(far.w(A, FF.State)).toBe(St.Check);
  });

  it('HY spends 3,000 Hype when it can, else 2,000, else nothing happens', () => {
    for (const [have, left] of [[3000, 0], [2500, 500]] as const) {
      const m = ready();
      m.buf[(FIGHTER_BASE[0] as number) + FF.Hype] = have;
      run(m, press(FB.HY));
      expect(m.w(A, FF.Hype), `from ${have}`).toBe(left);
    }
    const none = ready();
    none.buf[(FIGHTER_BASE[0] as number) + FF.Hype] = 1999;
    run(none, press(FB.HY));
    expect(none.w(A, FF.State)).toBe(St.Idle);
  });
});

describe('the second pad drives slot 1 (FC5.6)', () => {
  it('slot 1 follows ctx.input.frame(1) and slot 0 stays still', () => {
    const ctx = fakeCtx();
    fighterSim.enter(ctx, { params: { kind: 'versus', p2: 'human', fighters: ['player', 'player'] }, origin: { kind: 'menu' }, seed: 5 }, null);
    const s = activeSession();
    if (!s?.match) throw new Error('no match');
    const m = s.match;
    let t = 0;
    for (; t < 600 && m.phase !== Phase.Fight; t++) { ctx.setTick(t); fighterSim.tick(ctx); }
    const x0 = m.w(A, FF.X), x1 = m.w(B, FF.X);
    ctx.frames[1] = frameOf(FB.Left);
    for (const end = t + 40; t < end; t++) { ctx.setTick(t); fighterSim.tick(ctx); }
    expect(m.w(A, FF.X)).toBe(x0);
    expect(m.w(B, FF.X)).not.toBe(x1);
    fighterSim.exit(ctx, 'quit');
  });
});
