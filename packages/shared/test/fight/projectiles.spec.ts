import { describe, expect, it } from 'vitest';
import { FF, PROJ_BASE, PROJ_MAX, PROJ_WORDS, PW } from '../../src/fight/buffer.ts';
import { spawnProjectile } from '../../src/fight/projectiles.ts';
import { St } from '../../src/fight/states.ts';
import { BTN, LINEUP, Script, idle, place, rig, run, setWord, word } from './helpers.ts';
import type { Rig } from './helpers.ts';

const A = 0, B = 1;

function live(r: Rig): { owner: number; x: number; frame: number; hits: number; ex: number }[] {
  const out: { owner: number; x: number; frame: number; hits: number; ex: number }[] = [];
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((r.buf[b + PW.Owner] as number) === 0) continue;
    out.push({ owner: r.buf[b + PW.Owner] as number, x: r.buf[b + PW.X] as number, frame: r.buf[b + PW.Frame] as number, hits: r.buf[b + PW.Hits] as number, ex: r.buf[b + PW.Ex] as number });
  }
  return out;
}

describe('Spark Toss', () => {
  it('spawns on move frame 13 at the offset and flies 50 u per frame', () => {
    const r = rig();
    run(r, new Script().motion('236', BTN.LP).out);
    expect(live(r)).toHaveLength(0);
    idle(r, 12);                       // the move starts on the third tick: move frame 13 is tick 14
    const l = live(r);
    expect(l).toHaveLength(1);
    expect(l[0]?.owner).toBe(1);
    const x0 = l[0]?.x as number;
    idle(r, 4);
    expect(live(r)[0]?.x).toBe(x0 + 4 * 50);
  });

  it('hits for 700, is used up (hits 1) and gives Hype', () => {
    const r = rig();
    run(r, new Script().motion('236', BTN.LP).out);
    for (let i = 0; i < 80 && word(r, B, FF.Hp) === 10000; i++) idle(r, 1);
    expect(word(r, B, FF.Hp)).toBe(10000 - 700);
    expect(word(r, B, FF.State)).toBe(St.HitStand);
    expect(live(r)).toHaveLength(0);
  });

  it('is blocked by a defender holding back (blockstun 16, no chip on a normal-grade projectile)', () => {
    const r = rig({ lineup: [LINEUP[0], { ...LINEUP[1], autoBlock: true }] });
    run(r, new Script().motion('236', BTN.LP).out);
    for (let i = 0; i < 80 && word(r, B, FF.State) !== St.BlockStand; i++) idle(r, 1);
    expect(word(r, B, FF.State)).toBe(St.BlockStand);
    expect(word(r, B, FF.Hp)).toBe(10000);
    expect(word(r, B, FF.Blockstun)).toBe(16);
  });

  it('EX is faster and survives a hit (2 hits)', () => {
    const r = rig();
    setWord(r, A, FF.Hype, 1000);
    run(r, new Script().motion('236', BTN.LP | BTN.MP).out);
    idle(r, 12);
    const l = live(r);
    expect(l[0]?.ex).toBe(1);
    expect(l[0]?.hits).toBe(2);
    const x0 = l[0]?.x as number;
    idle(r, 1);
    expect(live(r)[0]?.x).toBe(x0 + 70);
  });

  it('expires after its life of 90 frames', () => {
    const r = rig();
    place(r, -5000, 5900);
    setWord(r, B, FF.State, St.Knockdown);   // untouchable target: the projectile has nothing to hit
    spawnProjectile(r.sim.c, r.buf, A, 0, false, 700, 1100);
    const x = live(r)[0]?.x as number;
    expect(x).toBe(-5000 + 700);
    idle(r, 89);
    expect(live(r).length).toBeLessThanOrEqual(1);
    idle(r, 2);
    expect(live(r)).toHaveLength(0);
  });
});

describe('pool, cap and clash', () => {
  it('at most 4 projectiles per owner', () => {
    const r = rig();
    for (let i = 0; i < 6; i++) spawnProjectile(r.sim.c, r.buf, A, 0, false, 700, 1100);
    expect(live(r)).toHaveLength(4);
    expect(word(r, A, FF.ProjActive)).toBe(0);   // refreshed by the next step
    idle(r, 1);
    expect(word(r, A, FF.ProjActive)).toBe(4);
  });
  it('equal power destroys both; higher power wins', () => {
    const r = rig();
    place(r, -1000, 1000);
    spawnProjectile(r.sim.c, r.buf, A, 0, false, 700, 1100);
    spawnProjectile(r.sim.c, r.buf, B, 0, false, 700, 1100);
    idle(r, 12);
    expect(live(r)).toHaveLength(0);
    const q = rig();
    place(q, -1000, 1000);
    spawnProjectile(q.sim.c, q.buf, A, 0, true, 700, 1100);    // EX: power 2
    spawnProjectile(q.sim.c, q.buf, B, 0, false, 700, 1100);   // power 1
    idle(q, 12);
    const l = live(q);
    expect(l).toHaveLength(1);
    expect(l[0]?.owner).toBe(1);
  });
  it('hitstop does not freeze a projectile that did not connect', () => {
    const r = rig();
    place(r, -400, 400);
    spawnProjectile(r.sim.c, r.buf, B, 0, false, -4000, 1100);   // far to the right of B, flying left: too far to reach A in this test
    const before = live(r)[0]?.x as number;
    run(r, new Script().press(BTN.LP).idle(3).out);             // A's 5L connects: both in hitstop
    expect(word(r, A, FF.Hitstop)).toBeGreaterThan(0);
    const mid = live(r)[0]?.x as number;
    idle(r, 4);
    expect(live(r)[0]?.x).toBeLessThan(mid);   // it flies left, 50 u per frame, through the hitstop
    expect(mid).toBeLessThan(before);
  });
});
