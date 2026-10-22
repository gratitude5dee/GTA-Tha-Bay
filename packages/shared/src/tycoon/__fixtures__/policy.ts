/**
 * A scripted founder used to record choice lists for the golden trace and the det suite. It plays a live run, so every command it
 * issues was accepted by `applyCommand`; the returned list replays to the same states. Not a balance bot (those arrive in M09a2).
 */
import { applyCommand } from '../commands.ts';
import { policyView } from '../replay.ts';
import { newRun } from '../setup.ts';
import { stepWeek } from '../step.ts';
import { hashCompany } from '../company.ts';
import type { ChoiceRecord, Command, CompanyState, RunSetup, TycoonContent } from '../types.ts';

export interface PolicyRun {
  choices: ChoiceRecord[];
  hashes: string[];
  state: CompanyState;
  /** What the script could not answer when it gave up, or null. */
  stuck: string | null;
}

/** Plays `weeks` weeks (or until the run ends). `hashes[w]` is the hash after week `w` completed (index 0 is the start). */
export function playPolicy(setup: RunSetup, content: TycoonContent, weeks: number, tweak?: (week: number, cmds: Command[]) => void): PolicyRun {
  const s = newRun(setup, content);
  const choices: ChoiceRecord[] = [];
  const hashes: string[] = [hashCompany(s)];
  let seq = 0;
  let lastWeek = -1;
  const issue = (cmd: Command): boolean => {
    if (s.week !== lastWeek) {
      lastWeek = s.week;
      seq = 0;
    }
    const r = applyCommand(s, cmd, content);
    if (r.ok) choices.push({ week: s.week, seq: seq++, cmd });
    return r.ok;
  };
  let triedVc = 0;
  let stuck: string | null = null;
  while (s.phase !== 'ended' && s.week < weeks) {
    const v = policyView(s, content);
    const cmds: Command[] = [];
    if (s.week === 0) cmds.push({ t: 'setAllocation', features: 70, refactor: 20, infra: 10 });
    if (s.awaiting === 'board') cmds.push({ t: 'boardVote', motion: 'approveBudget' });
    if (s.awaiting === 'bridge') cmds.push({ t: 'bridge', accept: true });
    const open = s.meetings.find((m) => m.phase === 'offer');
    if (s.awaiting === 'meeting' && open) cmds.push({ t: 'accept', meetingId: open.id });
    if (s.phase === 'launched' && s.marketing === 0 && s.week % 7 === 0) cmds.push({ t: 'setMarketing', perWeek: 20_000 });
    if (v.phase !== 'idea' && s.raise === null && v.runwayWeeks < 35 && s.capTable.safes.length < 4 && s.capTable.rounds.length === 0) {
      cmds.push({ t: 'startRaise', kind: 'safe', targetCents: 15_000_000 });
    }
    if (v.phase === 'launched' && s.raise === null && s.capTable.safes.length > 0 && s.capTable.rounds.length === 0 && v.runwayWeeks < 40 && s.week > 50) {
      cmds.push({ t: 'startRaise', kind: 'seed', targetCents: 30_000_000 });
    }
    if (s.raise !== null && !open && !s.meetings.some((m) => m.phase === 'closing')) {
      const W = s.raise.targetCents;
      const pool = s.raise.vcPool.filter((id) => {
        const d = content.archetypes.vcs.find((x) => x.id === id);
        return d !== undefined && d.checkMin <= W * 1.25 && d.checkMax >= W * 0.6;
      });
      const vc = pool.length > 0 ? pool[triedVc % pool.length] : undefined;
      if (vc) {
        triedVc++;
        cmds.push({ t: 'scheduleMeeting', vcId: vc });
      }
    }
    if (v.phase !== 'idea' && s.team.length < 1 && s.week % 5 === 0 && s.cash > 5_000_000) {
      const cand = [...s.market].filter((x) => x.role === 'eng' && !s.offers.some((o) => o.candidateId === x.id)).sort((a, b) => b.skill - a.skill)[0];
      if (cand) cmds.push({ t: 'hireOffer', candidateId: cand.id, salaryYr: cand.askYr, optionBp: 50 });
    }
    tweak?.(s.week, cmds);
    for (const cmd of cmds) issue(cmd);
    // A meeting opened this week is answered this week: take the midpoint.
    const offer = s.meetings.find((m) => m.phase === 'offer');
    if (s.awaiting === 'meeting' && offer && !issue({ t: 'accept', meetingId: offer.id })) issue({ t: 'walk', meetingId: offer.id });
    if (s.phase === 'ended') break;
    if (s.awaiting !== null) {
      // Stuck on something the script does not answer: quit so the list stays replayable.
      stuck = `${s.awaiting} at week ${s.week}`;
      issue({ t: 'endRun', reason: 'quit' });
      break;
    }
    stepWeek(s, content);
    hashes.push(hashCompany(s));
  }
  return { choices, hashes, state: s, stuck };
}
