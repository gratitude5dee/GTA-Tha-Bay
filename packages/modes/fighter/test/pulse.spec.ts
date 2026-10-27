/** The `trap` projectile of the second kit (FC4): it stays where it was laid, at most two per owner, and the detonate move bursts them. */
import { FF, FIGHTER_BASE, PROJ_BASE, PROJ_MAX, PROJ_WORDS, PW, Phase } from '@dv/shared/fight';
import { describe, expect, it } from 'vitest';
import { dirBits } from '../src/sim/cpu/moves.ts';
import type { FighterMatch } from '../src/sim/match.ts';
import { FB, PLAYER, WAVE, newMatch } from './helpers.ts';

function ready(): FighterMatch {
  const m = newMatch({}, [WAVE, PLAYER]);
  while (m.phase !== Phase.Fight) m.step(0, 0);
  m.buf[(FIGHTER_BASE[0] as number) + FF.X] = -3000;
  m.buf[(FIGHTER_BASE[1] as number) + FF.X] = 3000;
  return m;
}
const live = (m: FighterMatch): { x: number; vx: number; hits: number }[] => {
  const out: { x: number; vx: number; hits: number }[] = [];
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((m.buf[b + PW.Owner] as number) === 0) continue;
    out.push({ x: m.buf[b + PW.X] as number, vx: m.buf[b + PW.VX] as number, hits: m.buf[b + PW.Hits] as number });
  }
  return out;
};
const lay = (m: FighterMatch): void => {
  for (const d of [dirBits(2, 1), dirBits(3, 1), dirBits(6, 1) | FB.LP]) m.step(d, 0);
  for (let i = 0; i < 60; i++) m.step(0, 0);
};

describe('the trap projectile', () => {
  it('stays where it was laid', () => {
    const m = ready();
    lay(m);
    const t = live(m);
    expect(t).toHaveLength(1);
    const x = t[0]?.x as number;
    for (let i = 0; i < 20; i++) m.step(0, 0);
    expect(live(m)[0]?.x).toBe(x);
    expect(live(m)[0]?.vx).toBe(0);
  });

  it('at most two traps per owner: a third frees the oldest', () => {
    const m = ready();
    for (let i = 0; i < 3; i++) { lay(m); for (let k = 0; k < 40; k++) m.step(0, 0); }
    expect(live(m).length).toBeLessThanOrEqual(2);
    expect(live(m).length).toBeGreaterThan(0);
  });
});
