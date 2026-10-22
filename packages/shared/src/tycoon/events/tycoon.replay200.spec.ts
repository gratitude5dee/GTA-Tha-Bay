/** AC-6: 200 random seeded runs with events replay from (setup, choices) to the same RunResult and the same final hashCompany. */
import { describe, expect, it } from 'vitest';
import { splitmix32 } from '../../rng.ts';
import { ctrFloat } from '../rand.ts';
import { testContent } from '../__fixtures__/content.ts';
import { applyCommand } from '../commands.ts';
import { hashCompany } from '../company.ts';
import { policyView, replay } from '../replay.ts';
import { setupFromSeed, newRun } from '../setup.ts';
import { stepWeek } from '../step.ts';
import type { ChoiceRecord, Command, CompanyState, TycoonContent } from '../types.ts';

const content: TycoonContent = testContent();
const RUNS = 200;
const MAX_WEEKS = 160;

/** A throwaway random player: not the balance bot, just enough variety to move every code path (events, raises, hires, exits). */
function play(seed: number, auto: boolean): { setup: ReturnType<typeof setupFromSeed>; choices: ChoiceRecord[]; state: CompanyState; events: number; hashes: string[] } {
  const setup = setupFromSeed(seed, auto ? { autoResolveEvents: true } : undefined, content);
  const s = newRun(setup, content);
  const choices: ChoiceRecord[] = [];
  let n = 0;
  let seq = 0;
  let seqWeek = -1;
  let events = 0;
  const hashes: string[] = [];
  const r = (): number => ctrFloat(seed, 'test:player', n++);
  const issue = (cmd: Command): void => {
    const ok = applyCommand(s, cmd, content).ok;
    if (!ok) return;
    if (s.week !== seqWeek) {
      seqWeek = s.week;
      seq = 0;
    }
    choices.push({ week: s.week, seq: seq++, cmd });
  };
  const ended = (): boolean => s.phase === 'ended';
  while (!ended() && s.week < MAX_WEEKS) {
    for (let pass = 0; pass < 6 && !ended(); pass++) {
      const v = policyView(s, content);
      const before = choices.length;
      if (s.phase === 'idea') issue({ t: 'setAllocation', features: 60, refactor: 25, infra: 15 });
      for (const i of auto ? [] : v.inbox) {
        const allowed = i.choices.filter((c) => c.allowed);
        issue({ t: 'resolveEvent', iid: i.iid, choiceId: (allowed[Math.floor(r() * allowed.length)] ?? { id: i.defaultChoiceId }).id });
      }
      if (v.awaiting === 'board') issue({ t: 'boardVote', motion: r() < 0.5 ? 'approveBudget' : 'ignore' });
      if (v.awaiting === 'bridge') issue({ t: 'bridge', accept: r() < 0.7 });
      if (v.awaiting === 'meeting' && v.meeting) issue(r() < 0.8 ? { t: 'accept', meetingId: v.meeting.id } : { t: 'walk', meetingId: v.meeting.id });
      if (v.awaiting === null) {
        if (v.phase === 'launched' && r() < 0.1) issue({ t: 'setMarketing', perWeek: Math.floor(r() * 200_000) });
        const c = v.market[Math.floor(r() * v.market.length)];
        if (c && r() < 0.1) issue({ t: 'hireOffer', candidateId: c.id, salaryYr: c.askYr, optionBp: 30 });
        if (v.raise === null && v.raiseSpacingOk && v.phase !== 'idea' && r() < 0.08) issue({ t: 'startRaise', kind: v.safes === 0 && v.closedRounds.length === 0 ? 'safe' : 'seed', targetCents: v.safes === 0 ? 15_000_000 : 150_000_000 });
        if (v.raise !== null && v.meeting === null && !v.closing && r() < 0.5) {
          const vc = v.raise.vcPool[Math.floor(r() * v.raise.vcPool.length)];
          if (vc) issue({ t: 'scheduleMeeting', vcId: vc });
        }
        if (v.canSell && r() < 0.05) issue({ t: 'exploreSale' });
        if (r() < 0.02) issue({ t: 'setFocus', focus: r() < 0.5 ? 'rest' : 'product' });
      }
      if (choices.length === before) break;
    }
    if (ended()) break;
    if (s.awaiting !== null) break; // a random player may leave a hold unanswered; the run stops there and the replay stops at the same place
    events += stepWeek(s, content).events.length;
    hashes.push(hashCompany(s));
  }
  return { setup, choices, state: s, events, hashes };
}

describe('tycoon replay with events (200 runs)', () => {
  const rows = Array.from({ length: RUNS }, (_, i) => {
    const seed = splitmix32(1000 + i);
    const live = play(seed, i % 4 === 3);
    return { i, seed, live };
  });

  it('every run replays to the same final hash, week and result', () => {
    let withEvents = 0;
    let ended = 0;
    for (const { i, live } of rows) {
      const weekly: string[] = [];
      const out = replay(live.setup, live.choices, content, live.state.week, (st) => weekly.push(hashCompany(st)));
      const firstBad = weekly.findIndex((h, w) => h !== live.hashes[w]);
      expect(firstBad < live.hashes.length ? firstBad : -1, `run ${i}: first week whose hash differs`).toBe(-1);
      expect(out.hash, `run ${i}`).toBe(hashCompany(live.state));
      expect(out.state.week, `run ${i}`).toBe(live.state.week);
      expect(JSON.stringify(out.result), `run ${i}`).toBe(JSON.stringify(live.state.result));
      if (live.events > 0) withEvents++;
      if (live.state.result) ended++;
    }
    expect(withEvents).toBeGreaterThan(150); // events fired in most runs
    expect(ended).toBeGreaterThan(20); // and a good share of the runs reached an end
  });

  it('both event modes are covered: the clock held for the player and defaults taken at the deadline', () => {
    const held = rows.filter((r) => r.live.setup.autoResolveEvents !== true && r.live.choices.some((c) => c.cmd.t === 'resolveEvent'));
    const auto = rows.filter((r) => r.live.setup.autoResolveEvents === true && r.live.events > 0);
    expect(held.length).toBeGreaterThan(50);
    expect(auto.length).toBeGreaterThan(10);
    for (const r of auto) expect(r.live.choices.some((c) => c.cmd.t === 'resolveEvent')).toBe(false);
  });

  it('a choice event that is not in the inbox is refused and leaves the state untouched', () => {
    const s = newRun(setupFromSeed(5, undefined, content), content);
    const h = hashCompany(s);
    const r = applyCommand(s, { t: 'resolveEvent', iid: 99, choiceId: 'x' }, content);
    expect(r.ok).toBe(false);
    expect(hashCompany(s)).toBe(h);
  });
});
