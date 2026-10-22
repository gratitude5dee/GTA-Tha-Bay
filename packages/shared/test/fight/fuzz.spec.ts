import { describe, expect, it } from 'vitest';
import { BUFFER_WORDS, FF, FIGHTER_BASE, FM, NULL_SINK, Phase } from '../../src/fight/buffer.ts';
import type { FighterLoadout } from '../../src/fight/buffer.ts';
import { STATE_COUNT } from '../../src/fight/states.ts';
import { FightCore } from '../../src/fight/step.ts';
import { hashBuffer } from '../../src/fight/hash.ts';
import { KIT, LINEUP, PACK, RULES, TUNING, randomBot } from './helpers.ts';

function check(buf: Int32Array, label: string): void {
  expect(buf.length).toBe(BUFFER_WORDS);
  for (let i = 0; i < 2; i++) {
    const o = FIGHTER_BASE[i] as number;
    const w = (k: number): number => buf[o + k] as number;
    expect(Math.abs(w(FF.X)), `${label} x`).toBeLessThanOrEqual(TUNING.STAGE_HALF_WIDTH);
    expect(w(FF.Y), `${label} y`).toBeGreaterThanOrEqual(0);
    expect(w(FF.Hp), `${label} hp`).toBeGreaterThanOrEqual(0);
    expect(w(FF.Hp), `${label} hp max`).toBeLessThanOrEqual(10500);
    expect(w(FF.Hype), `${label} hype`).toBeGreaterThanOrEqual(0);
    expect(w(FF.Hype), `${label} hype max`).toBeLessThanOrEqual(TUNING.HYPE_MAX);
    expect(w(FF.Composure), `${label} composure`).toBeGreaterThanOrEqual(0);
    expect(w(FF.Composure), `${label} composure max`).toBeLessThanOrEqual(TUNING.COMPOSURE_MAX);
    expect(w(FF.State), `${label} state`).toBeGreaterThanOrEqual(0);
    expect(w(FF.State), `${label} state max`).toBeLessThan(STATE_COUNT);
    expect(w(FF.Move), `${label} move`).toBeGreaterThanOrEqual(-1);
    expect(w(FF.Move), `${label} move max`).toBeLessThan(KIT.moves.length);
    expect(Math.abs(w(FF.Facing))).toBe(1);
    expect(w(FF.ComboHits)).toBeGreaterThanOrEqual(0);
    expect(w(FF.Hitstop)).toBeGreaterThanOrEqual(0);
  }
  expect(buf[FM.Phase]).toBeLessThanOrEqual(Phase.MatchEnd);
}

function play(seed: number, lineup: [FighterLoadout, FighterLoadout], rules: Partial<typeof RULES>, ticks: number): { sim: FightCore; buf: Int32Array } {
  const sim = new FightCore();
  const buf = sim.init(PACK, { ...RULES, ...rules }, seed, lineup);
  const a = randomBot(seed * 2 + 1, ticks, 1), b = randomBot(seed * 2 + 2, ticks, -1);
  for (let t = 0; t < ticks; t++) {
    sim.step(buf, a[t] as number, b[t] as number, NULL_SINK);
    if (t % 97 === 0) check(buf, `seed ${seed} tick ${t}`);
  }
  check(buf, `seed ${seed} end`);
  return { sim, buf };
}

describe('fuzz: random bots keep the invariants and stay deterministic', () => {
  const schemes: ['classic' | 'simple' | 'pose', 'classic' | 'simple' | 'pose'][] = [['classic', 'classic'], ['simple', 'classic'], ['classic', 'simple'], ['pose', 'simple']];
  for (let seed = 1; seed <= 12; seed++) {
    it(`seed ${seed}`, () => {
      const [s0, s1] = schemes[seed % schemes.length] as [ 'classic' | 'simple' | 'pose', 'classic' | 'simple' | 'pose'];
      const lineup: [FighterLoadout, FighterLoadout] = [{ ...LINEUP[0], scheme: s0 }, { ...LINEUP[1], scheme: s1, autoBlock: seed % 5 === 0 }];
      const rules = { roundsToWin: ((seed % 3) + 1) as 1 | 2 | 3, timerFrames: seed % 2 === 0 ? 900 : 0, shutdowns: seed % 3 === 0, cinematics: (seed % 4 === 0 ? 'always' : 'off') as 'always' | 'off', leniencyX100: seed % 2 === 0 ? 150 : 100 };
      const one = play(seed, lineup, rules, 3500);
      const two = play(seed, lineup, rules, 3500);
      expect(hashBuffer(one.buf)).toEqual(hashBuffer(two.buf));
    });
  }
  it('a training match never ends', () => {
    const { buf } = play(77, LINEUP, { training: true, timerFrames: 0 }, 4000);
    expect(buf[FM.Phase]).toBe(Phase.Fight);
    expect(buf[(FIGHTER_BASE[0] as number) + FF.Hp]).toBeGreaterThanOrEqual(1);
  });
});
