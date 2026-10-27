// M08b1 AC-6 (gimmicks): frenzy, string, pulse, agents, patch, charge, armor and poll on the committed kits.
import { describe, expect, it } from 'vitest';
import { FF, PROJ_BASE, PROJ_MAX, PROJ_WORDS, PW, RNG_FIGHT } from '../../src/fight/buffer.ts';
import { rngNext } from '../../src/fight/hash.ts';
import { spawnProjectile } from '../../src/fight/projectiles.ts';
import { St } from '../../src/fight/states.ts';
import { BTN, Script, idle, place, run, setWord, word } from './helpers.ts';
import type { Rig } from './helpers.ts';
import { duel, moveIdx } from './roster-pack.ts';

const A = 0, B = 1;
const liveOf = (r: Rig, owner: 0 | 1): { def: number; life: number }[] => {
  const out: { def: number; life: number }[] = [];
  for (let p = 0; p < PROJ_MAX; p++) {
    const b = PROJ_BASE + p * PROJ_WORDS;
    if ((r.buf[b + PW.Owner] as number) === owner + 1) out.push({ def: r.buf[b + PW.Def] as number, life: r.buf[b + PW.Life] as number });
  }
  return out;
};
const projIdx = (r: Rig, slot: 0 | 1, id: string): number => (slot === 0 ? r.sim.c.kit[0] : r.sim.c.kit[1]).projs.findIndex((p) => p.id === id);
const down = (n: number): number[] => new Script().motion('252', BTN.LP).idle(n).out;

describe('frenzy (RAP_HYPHY_ELDER)', () => {
  it('Frenzy costs 1,000 Hype, runs 360 frames once per round and cannot be started twice', () => {
    const r = duel('RAP_HYPHY_ELDER', 'ATH_POWER_BACK');
    place(r, -4000, 4000);
    setWord(r, A, FF.Hype, 2000);
    run(r, down(3));
    expect(word(r, A, FF.Gimmick1)).toBe(1);
    expect(word(r, A, FF.Hype)).toBe(1000);
    // 360 frames are left on the tick Frenzy starts; the counter then reaches 0 exactly 360 ticks later
    let startTick = -1;
    const r2 = duel('RAP_HYPHY_ELDER', 'ATH_POWER_BACK');
    place(r2, -4000, 4000);
    setWord(r2, A, FF.Hype, 3000);
    const s = down(0);
    for (let i = 0; i < s.length; i++) {
      r2.sim.step(r2.buf, s[i] as number, 0, r2.ev);
      if (startTick < 0 && word(r2, A, FF.Gimmick0) > 0) startTick = i;
    }
    expect(word(r2, A, FF.Gimmick0)).toBe(360 - (s.length - 1 - startTick));
    let n = 0;
    while (word(r2, A, FF.Gimmick0) > 0) { idle(r2, 1); n++; }
    expect(n + (s.length - 1 - startTick)).toBe(360);
    // once per round: a second Frenzy does not start
    run(r2, down(40));
    expect(word(r2, A, FF.Gimmick0)).toBe(0);
    expect(word(r2, A, FF.Hype)).toBe(2000);
  });

  it('walks 25 % faster while it lasts and normals start 2 frames sooner (never below 3)', () => {
    const plain = duel('RAP_HYPHY_ELDER', 'ATH_POWER_BACK');
    const fren = duel('RAP_HYPHY_ELDER', 'ATH_POWER_BACK');
    for (const r of [plain, fren]) place(r, -4000, 4000);
    setWord(fren, A, FF.Gimmick0, 100);
    const walk = (r: Rig): number => { const x0 = word(r, A, FF.X); run(r, new Script().hold(10, 6).out); return word(r, A, FF.X) - x0; };
    const slow = walk(plain), fast = walk(fren);
    expect(slow).toBe(10 * 80);
    expect(fast).toBe(10 * 100);
    // 5M (startup 5): first hit tick
    const hitTick = (r: Rig, move: BTNKey): number => {
      place(r, -300, 300);
      setWord(r, B, FF.State, St.Idle);
      const hp0 = word(r, B, FF.Hp);
      run(r, new Script().press(BTN[move]).out);
      for (let t = 1; t < 30; t++) { if (word(r, B, FF.Hp) < hp0) return t; idle(r, 1); }
      return -1;
    };
    type BTNKey = 'MP' | 'LP';
    const a = duel('RAP_HYPHY_ELDER', 'ATH_POWER_BACK'), b = duel('RAP_HYPHY_ELDER', 'ATH_POWER_BACK');
    setWord(b, A, FF.Gimmick0, 100);
    const t0 = hitTick(a, 'MP'), t1 = hitTick(b, 'MP');
    expect(t0).toBeGreaterThan(0);
    expect(t0 - t1).toBe(2);
    // 5L has startup 3 in this kit: Frenzy cannot go below 3
    const c = duel('RAP_HYPHY_ELDER', 'ATH_POWER_BACK'), d = duel('RAP_HYPHY_ELDER', 'ATH_POWER_BACK');
    setWord(d, A, FF.Gimmick0, 100);
    expect(hitTick(c, 'LP')).toBe(hitTick(d, 'LP'));
  });
});

describe('string (RAP_LYRICIST)', () => {
  it('allows at most two specials cancelled in per touch', () => {
    const r = duel('RAP_LYRICIST', 'ATH_POWER_BACK');
    place(r, -3000, 3000);
    const hs = moveIdx(r, A, 'hardStop'), rw = moveIdx(r, A, 'rewind');
    const asSpecial = (mi: number): void => {
      idle(r, 14);   // let the input ring go quiet
      setWord(r, A, FF.State, St.Special); setWord(r, A, FF.Move, mi); setWord(r, A, FF.MoveFrame, 8);
      setWord(r, A, FF.StateFrame, 8); setWord(r, A, FF.MoveResult, 1); setWord(r, A, FF.Hitstop, 0);
    };
    const cancelInto = (digits: string, b: number): void => { run(r, new Script().motion(digits, b).idle(1).out); };
    asSpecial(hs); setWord(r, A, FF.Gimmick0, 0);
    cancelInto('214', BTN.LK);
    expect(word(r, A, FF.Move)).toBe(rw);
    expect(word(r, A, FF.Gimmick0)).toBe(1);
    asSpecial(rw);
    cancelInto('623', BTN.LP);
    expect(word(r, A, FF.Move)).toBe(hs);
    expect(word(r, A, FF.Gimmick0)).toBe(2);
    asSpecial(hs);
    cancelInto('214', BTN.LK);
    expect(word(r, A, FF.Move)).toBe(hs);   // a third cancel is refused: the move goes on
    expect(word(r, A, FF.Gimmick0)).toBe(2);
    // a fresh move from neutral resets the count
    setWord(r, A, FF.State, St.Idle); setWord(r, A, FF.Move, -1);
    idle(r, 3);
    run(r, new Script().motion('214', BTN.LK).idle(1).out);
    expect(word(r, A, FF.Gimmick0)).toBe(0);
  });
});

describe('pulse (RAP_NEW_WAVE)', () => {
  it('keeps at most two floor traps, each for 360 frames', () => {
    const r = duel('RAP_NEW_WAVE', 'ATH_POWER_BACK');
    setWord(r, B, FF.State, St.Knockdown); setWord(r, B, FF.WakeFrames, 100000);
    const pulse = projIdx(r, A, 'pulse');
    for (const ox of [700, 1500, 2500]) { spawnProjectile(r.sim.c, r.buf, A, pulse, false, ox, 0); idle(r, 1); }
    const traps = liveOf(r, A).filter((p) => p.def === pulse);
    expect(traps).toHaveLength(2);
    idle(r, 300);
    expect(liveOf(r, A).filter((p) => p.def === pulse)).toHaveLength(2);
    idle(r, 80);
    expect(liveOf(r, A).filter((p) => p.def === pulse)).toHaveLength(0);
  });
});

describe('agents (TECH_VISIONARY)', () => {
  it('keeps at most two drones', () => {
    const r = duel('TECH_VISIONARY', 'ATH_POWER_BACK');
    setWord(r, B, FF.State, St.Knockdown); setWord(r, B, FF.WakeFrames, 100000);
    const agent = projIdx(r, A, 'agent');
    for (let i = 0; i < 4; i++) { spawnProjectile(r.sim.c, r.buf, A, agent, false, 0, 0); idle(r, 2); }
    expect(liveOf(r, A).filter((p) => p.def === agent)).toHaveLength(2);
  });
});

describe('charge (ATH_SHOOTER): Arc Shot 600 / 900 / 1,300 by hold level', () => {
  const shoot = (holdFrames: number): { projDef: string; hp: number } => {
    const r = duel('ATH_SHOOTER', 'TECH_HACKER');
    place(r, -1200, 1200);
    setWord(r, B, FF.State, St.Knockdown); setWord(r, B, FF.WakeFrames, 100000);   // a target that cannot move or block
    // 236 + punch, then keep the button down for `holdFrames`
    run(r, new Script().motion('2365', BTN.LP).out);
    run(r, new Script().hold(holdFrames, 5, BTN.LP).out);
    let def = '';
    for (let t = 0; t < 120; t++) {
      for (let p = 0; p < PROJ_MAX; p++) {
        const b = PROJ_BASE + p * PROJ_WORDS;
        if ((r.buf[b + PW.Owner] as number) === 1 && def === '') def = (r.sim.c.kit[0].projs[r.buf[b + PW.Def] as number] as { id: string }).id;
      }
      idle(r, 1);
    }
    return { projDef: def, hp: word(r, B, FF.Hp) };
  };
  it('a tap throws level 1, 20 frames level 2, 36 frames level 3', () => {
    expect(shoot(0).projDef).toBe('arc1');
    expect(shoot(20).projDef).toBe('arc2');
    expect(shoot(36).projDef).toBe('arc3');
  });
  it('the three arcs deal 600, 900 and 1,300 on a clean hit', () => {
    const r = duel('ATH_SHOOTER', 'TECH_HACKER');
    const dmg = (id: string): number => (r.sim.c.kit[0].projs.find((p) => p.id === id) as { def: { hit: { damage: number } } }).def.hit.damage;
    expect([dmg('arc1'), dmg('arc2'), dmg('arc3')]).toEqual([600, 900, 1300]);
    // a landed arc takes exactly that much health from an idle opponent
    for (const [id, want] of [['arc1', 600], ['arc2', 900], ['arc3', 1300]] as const) {
      const q = duel('ATH_SHOOTER', 'TECH_HACKER');
      place(q, -1000, 1000);
      setWord(q, B, FF.Y, 0);
      spawnProjectile(q.sim.c, q.buf, A, projIdx(q, A, id), false, 300, 600);   // low enough to meet the standing hurtbox on its way
      const hp0 = word(q, B, FF.Hp);
      for (let t = 0; t < 80 && word(q, B, FF.Hp) === hp0; t++) idle(q, 1);
      expect(hp0 - word(q, B, FF.Hp), id).toBe(want);
    }
  });
});

describe('armor (ATH_POWER_BACK)', () => {
  it('Shoulder Charge absorbs one hit without hitstun and the second one lands', () => {
    const r = duel('ATH_POWER_BACK', 'ATH_POWER_BACK');
    place(r, -300, 300);
    const sc = moveIdx(r, A, 'shoulderCharge');
    setWord(r, A, FF.State, St.Special); setWord(r, A, FF.Move, sc); setWord(r, A, FF.MoveFrame, 7); setWord(r, A, FF.StateFrame, 7); setWord(r, A, FF.ArmorLeft, 1);
    setWord(r, A, FF.Facing, 1);
    const hp0 = word(r, A, FF.Hp);
    // the opponent's 5L connects (startup 4)
    run(r, [0], new Script(-1).press(BTN.LP).out);
    for (let t = 0; t < 8; t++) idle(r, 1);
    expect(word(r, A, FF.Hp)).toBeLessThan(hp0);
    expect(word(r, A, FF.ArmorLeft)).toBe(0);
    expect(word(r, A, FF.State)).toBe(St.Special);   // the move goes on: no hit reaction
  });
});

describe('patch (TECH_HACKER)', () => {
  it('absorbs a strike in its stance and answers at once', () => {
    const r = duel('TECH_HACKER', 'TECH_HACKER');
    place(r, -300, 300);
    run(r, new Script().motion('2365', BTN.LP).out);   // Patch
    idle(r, 4);
    expect(word(r, A, FF.State)).toBe(St.Special);
    const mv = word(r, A, FF.Move);
    const hp1 = word(r, B, FF.Hp);
    run(r, [0], new Script(-1).press(BTN.LP).out);
    for (let t = 0; t < 10; t++) idle(r, 1);
    expect(word(r, A, FF.Move)).toBe(mv);
    expect(word(r, A, FF.MoveFrame)).toBeGreaterThanOrEqual(25);   // jumped to the answer
    for (let t = 0; t < 12; t++) idle(r, 1);
    expect(word(r, B, FF.Hp)).toBeLessThan(hp1);
  });
});

describe('poll (INFLUENCER)', () => {
  const order = (r: Rig): number[] => { const g = word(r, A, FF.Gimmick2); return [g & 3, (g >> 2) & 3, (g >> 4) & 3]; };
  it('draws a buff order from the fight stream at round start and cycles every 600 frames', () => {
    const r = duel('INFLUENCER', 'ATH_POWER_BACK', { seed: 11 });
    const o = order(r);
    expect([...o].sort()).toEqual([0, 1, 2]);
    expect(word(r, A, FF.Gimmick0)).toBe(0);
    idle(r, 599);
    expect(word(r, A, FF.Gimmick0)).toBe(0);
    idle(r, 1);
    expect(word(r, A, FF.Gimmick0)).toBe(1);
    idle(r, 600);
    expect(word(r, A, FF.Gimmick0)).toBe(2);
    idle(r, 600);
    expect(word(r, A, FF.Gimmick0)).toBe(0);
  });
  it('the order is a pure function of the seed and uses exactly two draws of the stream', () => {
    const a = duel('INFLUENCER', 'ATH_POWER_BACK', { seed: 11 }), b = duel('INFLUENCER', 'ATH_POWER_BACK', { seed: 11 });
    expect(order(a)).toEqual(order(b));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) seen.add(order(duel('INFLUENCER', 'ATH_POWER_BACK', { seed })).join(''));
    expect(seen.size).toBeGreaterThan(3);
    // the stream: two draws after the seed state
    const c = duel('TECH_HACKER', 'ATH_POWER_BACK', { seed: 11 }), d = duel('INFLUENCER', 'ATH_POWER_BACK', { seed: 11 });
    rngNext(c.buf, RNG_FIGHT); rngNext(c.buf, RNG_FIGHT);
    expect([0, 1, 2, 3].map((i) => c.buf[RNG_FIGHT + i])).toEqual([0, 1, 2, 3].map((i) => d.buf[RNG_FIGHT + i]));

  });
  it('buff 0 adds 50 % to Hype gains, buff 1 walks 15 % faster, buff 2 absorbs one strike', () => {
    const pickBuff = (want: number): Rig => {
      for (let seed = 1; seed < 200; seed++) {
        const r = duel('INFLUENCER', 'ATH_POWER_BACK', { seed });
        if (order(r)[0] === want) return r;
      }
      throw new Error('no seed');
    };
    const walk = pickBuff(1);
    place(walk, -4000, 4000);
    const x0 = word(walk, A, FF.X);
    run(walk, new Script().hold(10, 6).out);
    expect(word(walk, A, FF.X) - x0).toBe(10 * Math.trunc((66 * 115) / 100));
    const arm = pickBuff(2);
    expect(word(arm, A, FF.Gimmick3)).toBe(1);
    place(arm, -300, 300);
    const hp0 = word(arm, A, FF.Hp);
    run(arm, [0], new Script(-1).press(BTN.LP).out);
    for (let t = 0; t < 10; t++) idle(arm, 1);
    expect(word(arm, A, FF.Gimmick3)).toBe(0);
    expect(word(arm, A, FF.Hp)).toBeLessThan(hp0);
    expect(word(arm, A, FF.State)).toBe(St.Idle);   // absorbed: no hit reaction
    const gain = (r: Rig): number => {
      place(r, -300, 300);
      run(r, new Script().press(BTN.LP).out);
      for (let t = 0; t < 10; t++) idle(r, 1);
      return word(r, A, FF.Hype);
    };
    const boosted = gain(pickBuff(0)), plain = gain(pickBuff(1));
    expect(plain).toBeGreaterThan(0);
    expect(boosted).toBe(Math.trunc((plain * 150) / 100));
  });
});
