/**
 * Self-test fixture (must trip B11): a bot that answers every offer with a counter far above the envelope, then accepts.
 * The harness counts a counter outside the envelope as a bot offer out of band, whether or not the core accepts the command.
 */
import type { Command } from '../../../../packages/shared/src/tycoon/index.ts';
import type { Policy } from '../policies.ts';

export const policy: Policy = {
  id: 'offer-out-of-band',
  decide(v): Command[] {
    if (v.phase === 'ended') return [];
    if (v.awaiting === 'event') return v.inbox.map((i) => ({ t: 'resolveEvent', iid: i.iid, choiceId: i.defaultChoiceId }));
    if (v.awaiting === 'board') return [{ t: 'boardVote', motion: 'approveBudget' }];
    if (v.awaiting === 'bridge') return [{ t: 'bridge', accept: true }];
    if (v.awaiting === 'meeting' && v.meeting) {
      const env = v.meeting.envelope;
      const hi = env ? env.preMoney[1] : v.meeting.preMoney;
      return [
        { t: 'counter', meetingId: v.meeting.id, terms: { amount: v.meeting.amount * 3, preMoney: hi * 3, poolTargetBp: 0, boardSeat: false, liq: { multiple: 1, participating: false } } },
        { t: 'accept', meetingId: v.meeting.id },
      ];
    }
    if (v.phase === 'idea') return [{ t: 'setAllocation', features: 60, refactor: 25, infra: 15 }];
    if (v.raise !== null && v.meeting === null && !v.closing) {
      const vc = v.raise.vcPool[0];
      return vc ? [{ t: 'scheduleMeeting', vcId: vc }] : [];
    }
    if (v.raise === null && v.raiseSpacingOk && v.safes === 0) return [{ t: 'startRaise', kind: 'safe', targetCents: 15_000_000 }];
    return [];
  },
};
