/**
 * AC-7 (FC10): the CPU decides on even ticks only, reads no raw opponent buttons, and punishes an unsafe move by level. The
 * scenario is fifty seeded blocked Uplifts (advantage on block -25) per level: the CPU blocks the first hit, and from the moment
 * its blockstun begins it plays on its own. A punish is a hit that the CPU lands before the opponent is free again.
 */
import { FF, FIGHTER_BASE, FM, Phase, RING_BASE, St, isActionable, isMoveState } from '@dv/shared/fight';
import { describe, expect, it } from 'vitest';
import { CpuDriver, kitInfo } from '../src/sim/cpu/index.ts';
import { dirBits } from '../src/sim/cpu/moves.ts';
import { FB, PLAYER, newMatch, pack } from './helpers.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const kits = pack.kits;
const kitP = kitInfo(kits.PLAYER_FIGHTER, pack.tuning);

/** Slot 1 throws a 623 + LP (Uplift) at 800 apart; slot 0 holds back until it is blocking, then the CPU takes over. Returns whether the CPU landed a hit before slot 1 was free. */
function blockedUplift(level: 0 | 1 | 2 | 3, seed: number): { punished: boolean; attacked: boolean } {
  const m = newMatch({ cpuLevel: [level, null] }, [PLAYER, { ...PLAYER, fighterId: 'player' }]);
  // put slot 0 against the stage wall so holding back still blocks: edit the start positions (the scenario, not the sim, is under test)
  m.buf[(FIGHTER_BASE[0] as number) + FF.X] = -5900;
  m.buf[(FIGHTER_BASE[1] as number) + FF.X] = -5450;
  const cpu = new CpuDriver({ slot: 0, level, seed, kit: kitP, oppKit: kitP });
  const back = dirBits(4, 1);
  const inputs1: number[] = [];
  const uplift = [dirBits(6, -1), dirBits(2, -1), dirBits(3, -1) | FB.LP];   // 6 2 3 + LP for a fighter facing left
  let handed = false;
  let startTick = -1;
  let hitByCpu = false;
  let attacked = false;
  let free1At = -1;
  for (let t = 0; t < 400; t++) {
    const tick = m.tick;
    cpu.perception.push(m.buf, tick);
    // slot 1: idle through Ready, then the motion
    let w1 = 0;
    if (m.phase === Phase.Fight) {
      if (startTick < 0) startTick = tick;
      const k = tick - startTick;
      if (k >= 2 && k < 2 + uplift.length) w1 = uplift[k - 2] as number;
    }
    inputs1.push(w1);
    let w0 = 0;
    if (!handed) {
      w0 = m.phase === Phase.Fight ? back : 0;
      if (m.w(0, FF.State) === St.BlockStand && m.w(0, FF.Blockstun) > 0) handed = true;
    }
    if (handed) w0 = cpu.input(m.buf, tick);
    m.step(w0, w1);
    for (let i = 0; i < m.events.n; i++) if (m.events.kind[i] === 0 && m.events.slot[i] === 0 && handed) hitByCpu = true;
    if (handed && isMoveState(m.w(0, FF.State)) && m.w(0, FF.Move) >= 0) attacked = true;
    if (handed && free1At < 0 && isActionable(m.w(1, FF.State)) && m.w(1, FF.Hitstop) === 0) free1At = tick;
    if (free1At >= 0 || hitByCpu) break;
  }
  return { punished: hitByCpu, attacked };
}

describe('the CPU punishes an unsafe move by level (AC-7)', () => {
  const runs = (level: 0 | 1 | 2 | 3): number => {
    let n = 0;
    for (let seed = 1; seed <= 50; seed++) if (blockedUplift(level, seed * 7919).punished) n++;
    return n;
  };

  it('Hard punishes at least 90 % of fifty blocked Uplifts and Easy fewer', () => {
    const easy = runs(0);
    const hard = runs(2);
    console.log(`blocked Uplift punished: easy ${easy}/50, hard ${hard}/50`);
    expect(hard).toBeGreaterThanOrEqual(45);
    expect(easy).toBeLessThan(hard);
  });
});

describe('the CPU decision cadence and its eyes (FC10.1, FC10.2)', () => {
  function playMatch(level: 0 | 1 | 2 | 3, ticks: number): { cpu0: CpuDriver; cpu1: CpuDriver; m: ReturnType<typeof newMatch>; ringReads: number } {
    const m = newMatch({ cpuLevel: [level, level] });
    const cpu0 = new CpuDriver({ slot: 0, level, seed: 11, kit: kitP, oppKit: kitInfo(kits.RAP_NEW_WAVE, pack.tuning) });
    const cpu1 = new CpuDriver({ slot: 1, level, seed: 12, kit: kitInfo(kits.RAP_NEW_WAVE, pack.tuning), oppKit: kitP });
    // the CPU gets a view of the buffer that counts reads of the input rings (words 408 to 471): it must make none
    let ringReads = 0;
    const lo = RING_BASE[0] as number, hi = (RING_BASE[1] as number) + 32;
    const spy = new Proxy(m.buf, {
      get(target, prop, recv) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          const i = Number(prop);
          if (i >= lo && i < hi) ringReads++;
        }
        return Reflect.get(target, prop, target === recv ? target : recv) as unknown;
      },
    });
    for (let t = 0; t < ticks && m.phase !== Phase.MatchEnd; t++) {
      const tick = m.buf[FM.Tick] as number;
      const a = cpu0.input(spy, tick);
      const b = cpu1.input(spy, tick);
      m.step(a, b);
    }
    return { cpu0, cpu1, m, ringReads };
  }

  it('decisions fall on even ticks, at least four frames apart, and the CPU reads nothing of the opponent\'s input rings', () => {
    const { cpu0, cpu1, ringReads } = playMatch(2, 1500);
    for (const c of [cpu0, cpu1]) {
      expect(c.decisionTicks.length).toBeGreaterThan(20);
      expect(c.decisionTicks.every((t) => t % 2 === 0)).toBe(true);
      for (let i = 1; i < c.decisionTicks.length; i++) expect((c.decisionTicks[i] as number) - (c.decisionTicks[i - 1] as number)).toBeGreaterThanOrEqual(4);
    }
    expect(ringReads).toBe(0);
  });

  it('the perception and decision sources name no input-ring helper', () => {
    const dir = path.join(import.meta.dirname, '../src/sim/cpu');
    for (const f of ['perception.ts', 'decide.ts']) {
      const text = readFileSync(path.join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/RING_BASE|ringInput|ringDir|risingAt/);
    }
  });

  it('is deterministic: the same seed plays the same match', () => {
    const a = playMatch(1, 900);
    const b = playMatch(1, 900);
    expect(a.m.hash()).toEqual(b.m.hash());
    expect(a.m.in0).toEqual(b.m.in0);
  });

  it('a CPU match runs to its end and every level takes part in hits', () => {
    for (const level of [0, 1, 2, 3] as const) {
      const m = newMatch({ cpuLevel: [level, level], timerFrames: 3600 });
      const a = new CpuDriver({ slot: 0, level, seed: 3, kit: kitP, oppKit: kitP });
      const b = new CpuDriver({ slot: 1, level, seed: 4, kit: kitP, oppKit: kitP });
      let hits = 0;
      for (let t = 0; t < 60 * 60 * 4 && m.phase !== Phase.MatchEnd; t++) {
        m.step(a.input(m.buf, m.tick), b.input(m.buf, m.tick));
        for (let i = 0; i < m.events.n; i++) if (m.events.kind[i] === 0) hits++;
      }
      expect(m.phase, `level ${level} ends`).toBe(Phase.MatchEnd);
      expect(hits, `level ${level} lands hits`).toBeGreaterThan(5);
    }
  });
});
