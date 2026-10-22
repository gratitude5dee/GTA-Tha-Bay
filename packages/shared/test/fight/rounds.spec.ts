import { describe, expect, it } from 'vitest';
import type { FightRules } from '../../src/fight/buffer.ts';
import { FF, FM, Phase, RF } from '../../src/fight/buffer.ts';
import { FightCore } from '../../src/fight/step.ts';
import { St } from '../../src/fight/states.ts';
import { BTN, LINEUP, PACK, RULES, Events, Script, head, idle, place, rig, run, setWord, word } from './helpers.ts';
import type { Rig } from './helpers.ts';

const A = 0, B = 1;

function fresh(rules: Partial<FightRules> = {}): Rig {
  const sim = new FightCore();
  const buf = sim.init(PACK, { ...RULES, ...rules }, 3, LINEUP);
  return { sim, buf, ev: new Events() };
}
function step(r: Rig, a = 0, b = 0): void { r.sim.step(r.buf, a, b, r.ev); }
const phase = (r: Rig): number => head(r, FM.Phase);
function stepUntil(r: Rig, pred: () => boolean, max: number, a = 0, b = 0): number {
  let n = 0;
  while (!pred() && n < max) { step(r, a, b); n++; }
  return n;
}
/** Fight rig at 800 apart where fighter A can kill B with one 5L. */
function killSetup(rules: Partial<FightRules>): Rig {
  const r = rig({ rules });
  place(r, -400, 400);
  setWord(r, B, FF.Hp, 300);
  return r;
}
function killB(r: Rig): void { run(r, new Script().press(BTN.LP).idle(3).out); }

describe('round flow', () => {
  it('Ready lasts 60 frames, positions reset, then Fight', () => {
    const r = fresh();
    expect(phase(r)).toBe(Phase.Ready);
    expect(word(r, A, FF.X)).toBe(-1500);
    expect(word(r, B, FF.X)).toBe(1500);
    for (let i = 0; i < 59; i++) step(r);
    expect(phase(r)).toBe(Phase.Ready);
    step(r);
    expect(phase(r)).toBe(Phase.Fight);
  });
  it('input is locked in Ready: nothing starts', () => {
    const r = fresh();
    for (let i = 0; i < 30; i++) step(r, BTN.LP, 0);
    expect(word(r, A, FF.State)).toBe(St.Idle);
  });
  it('best of three: two round wins end the match', () => {
    const r = killSetup({ roundsToWin: 2 });
    killB(r);
    expect(head(r, FM.RoundsWon0)).toBe(1);
    expect(head(r, FM.Winner)).toBe(-1);
    stepUntil(r, () => phase(r) === Phase.Fight && head(r, FM.Round) === 2, 600);
    expect(head(r, FM.Round)).toBe(2);
    expect(word(r, B, FF.Hp)).toBe(10000);
    place(r, -400, 400);
    setWord(r, B, FF.Hp, 300);
    killB(r);
    stepUntil(r, () => phase(r) === Phase.MatchEnd, 800);
    expect(head(r, FM.Winner)).toBe(0);
    expect([head(r, FM.RoundsWon0), head(r, FM.RoundsWon1)]).toEqual([2, 0]);
    expect(word(r, A, FF.State)).toBe(St.Victory);
    expect(word(r, B, FF.State)).toBe(St.Defeat);
  });
});

describe('time-out and sudden round', () => {
  it('equal health at time-out scores both and starts a 1,800-frame sudden round at 1,000 health', () => {
    const r = rig({ rules: { roundsToWin: 1, timerFrames: 100 } });
    idle(r, 99);
    expect(phase(r)).toBe(Phase.Fight);
    idle(r, 1);
    expect(phase(r)).toBe(Phase.TimeUp);
    expect([head(r, FM.RoundsWon0), head(r, FM.RoundsWon1)]).toEqual([1, 1]);
    expect(head(r, FM.Winner)).toBe(-1);
    expect((head(r, FM.RulesFlags) & RF.SuddenNext) !== 0).toBe(true);
    const n = stepUntil(r, () => phase(r) === Phase.Ready, 400);
    expect(n).toBe(60 + 120);
    expect(head(r, FM.Round)).toBe(2);
    expect(word(r, A, FF.Hp)).toBe(1000);
    expect(word(r, B, FF.Hp)).toBe(1000);
    expect(head(r, FM.Timer)).toBe(1800);
    stepUntil(r, () => phase(r) === Phase.Fight, 100);
    expect(phase(r)).toBe(Phase.Fight);
  });
  it('the sudden round ends on the first hit', () => {
    const r = rig({ rules: { roundsToWin: 1, timerFrames: 100 } });
    idle(r, 100);
    stepUntil(r, () => phase(r) === Phase.Fight && head(r, FM.Round) === 2, 400);
    place(r, -400, 400);
    run(r, new Script().press(BTN.LP).idle(3).out);
    expect(phase(r)).toBe(Phase.Ko);
    expect(head(r, FM.Winner)).toBe(0);
    stepUntil(r, () => phase(r) === Phase.MatchEnd, 600);
    expect(head(r, FM.Winner)).toBe(0);
  });
  it('a sudden-round time-out falls back to Hype, then slot 0', () => {
    const r = rig({ rules: { roundsToWin: 1, timerFrames: 50 } });
    idle(r, 50);
    stepUntil(r, () => phase(r) === Phase.Fight && head(r, FM.Round) === 2, 400);
    setWord(r, B, FF.Hype, 500);
    stepUntil(r, () => phase(r) !== Phase.Fight, 2000);
    expect(phase(r)).toBe(Phase.TimeUp);
    expect(head(r, FM.Winner)).toBe(1);   // more Hype wins
  });
  it('unequal health at time-out scores only the leader', () => {
    const r = rig({ rules: { roundsToWin: 2, timerFrames: 60 } });
    setWord(r, B, FF.Hp, 9000);
    idle(r, 60);
    expect([head(r, FM.RoundsWon0), head(r, FM.RoundsWon1)]).toEqual([1, 0]);
  });
});

describe('double KO and the KO phase', () => {
  it('a double KO scores both', () => {
    const r = rig({ rules: { roundsToWin: 2 } });
    place(r, -400, 400);
    setWord(r, A, FF.Hp, 300); setWord(r, B, FF.Hp, 300);
    run(r, new Script().press(BTN.LP).idle(3).out, new Script(-1).press(BTN.LP).idle(3).out);
    expect(phase(r)).toBe(Phase.Ko);
    expect([head(r, FM.RoundsWon0), head(r, FM.RoundsWon1)]).toEqual([1, 1]);
    const q = rig({ rules: { roundsToWin: 1 } });
    place(q, -400, 400);
    setWord(q, A, FF.Hp, 300); setWord(q, B, FF.Hp, 300);
    run(q, new Script().press(BTN.LP).idle(3).out, new Script(-1).press(BTN.LP).idle(3).out);
    expect((head(q, FM.RulesFlags) & RF.SuddenNext) !== 0).toBe(true);
    expect(head(q, FM.Winner)).toBe(-1);
  });
  it('the KO phase steps every third tick for 30 frames', () => {
    const r = killSetup({ roundsToWin: 2 });
    killB(r);
    expect(phase(r)).toBe(Phase.Ko);
    expect(head(r, FM.SlowDiv)).toBe(3);
    let ticks = 0, steps = 0, last = head(r, FM.PhaseFrame);
    while (phase(r) === Phase.Ko) {
      step(r); ticks++;
      if (head(r, FM.PhaseFrame) !== last) { steps++; last = head(r, FM.PhaseFrame); }
    }
    expect(steps).toBeGreaterThanOrEqual(29);   // the 30th step moves the match to RoundEnd
    expect(ticks).toBeGreaterThanOrEqual(88);
    expect(ticks).toBeLessThanOrEqual(90);
    expect(phase(r)).toBe(Phase.RoundEnd);
  });
});

describe('Shutdown and Cinematic', () => {
  const shut = { roundsToWin: 1 as const, shutdowns: true };
  function toShutdown(rules: Partial<FightRules>): Rig {
    const r = killSetup({ ...shut, ...rules });
    killB(r);
    stepUntil(r, () => phase(r) !== Phase.Ko, 200);
    return r;
  }
  it('opens for 90 frames after a final non-chip KO, then the match ends', () => {
    const r = toShutdown({});
    expect(phase(r)).toBe(Phase.Shutdown);
    expect(word(r, B, FF.State)).toBe(St.Slumped);
    const n = stepUntil(r, () => phase(r) !== Phase.Shutdown, 200);
    expect(n).toBe(90);
    expect(phase(r)).toBe(Phase.MatchEnd);
  });
  it('the winner taps HY inside the window to run the 170-frame finisher', () => {
    const r = toShutdown({});
    idle(r, 5);
    step(r, BTN.HY, 0);
    expect(head(r, FM.ShutdownWho)).toBe(1);
    expect(word(r, A, FF.State)).toBe(St.Shutdown);
    const n = stepUntil(r, () => phase(r) !== Phase.Shutdown, 400);
    expect(n).toBe(170);   // frame 1 ran on the tap tick, the phase flips on the tick after frame 170
    expect(phase(r)).toBe(Phase.MatchEnd);
    expect(word(r, A, FF.State)).toBe(St.Victory);
  });
  it('does not open without the rule, on a non-final KO, or after a chip KO', () => {
    const off = killSetup({ roundsToWin: 1, shutdowns: false });
    killB(off);
    stepUntil(off, () => phase(off) !== Phase.Ko, 200);
    expect(phase(off)).toBe(Phase.RoundEnd);
    const early = killSetup({ roundsToWin: 2, shutdowns: true });
    killB(early);
    stepUntil(early, () => phase(early) !== Phase.Ko, 200);
    expect(phase(early)).toBe(Phase.RoundEnd);
    const chip = killSetup({ roundsToWin: 1, shutdowns: true });
    setWord(chip, B, FF.Hp, 20); setWord(chip, B, FF.Rattled, 1); setWord(chip, B, FF.Composure, 0);
    run(chip, new Script().press(BTN.LP).idle(3).out, new Script(-1).hold(4, 4).out);
    expect(phase(chip)).toBe(Phase.Ko);
    stepUntil(chip, () => phase(chip) !== Phase.Ko, 200);
    expect(phase(chip)).toBe(Phase.RoundEnd);
  });
  it('Cinematic lasts exactly 300 frames unless an attack input skips it', () => {
    const r = toShutdown({ cinematics: 'always' });
    idle(r, 3);
    step(r, BTN.HY, 0);
    expect(phase(r)).toBe(Phase.Cinematic);
    expect(head(r, FM.CinematicLeft)).toBe(300);
    const n = stepUntil(r, () => phase(r) !== Phase.Cinematic, 400);
    expect(n).toBe(300);
    expect(phase(r)).toBe(Phase.Shutdown);
    expect(head(r, FM.ShutdownWho)).toBe(1);

    const q = toShutdown({ cinematics: 'always' });
    step(q, BTN.HY, 0);
    expect(phase(q)).toBe(Phase.Cinematic);
    idle(q, 9);
    step(q, 0, BTN.LP);
    expect(phase(q)).toBe(Phase.Shutdown);
  });
});
