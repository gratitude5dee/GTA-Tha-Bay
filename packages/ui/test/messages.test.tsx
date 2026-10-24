/**
 * M05c2 AC-12: the Messages app. The `x_ramos` thread shows the line text of a `text` op the session delivered and the offer of an
 * available `m.a1.02` (giver `{phone: 'x_ramos'}`); activating the offer opens Jobs on that mission. The app is no longer a comingSoon tile.
 */
import { describe, expect, it } from 'vitest';
import { appScreen, missionRows, type MissionJob, type PhoneEnv } from '../src/phone/apps.ts';
import { buildThreads, focusJobRows, messagePress, messagesScreen, offersOf, senderName, threadRows, type PhoneMessage } from '../src/phone/messages.tsx';
import { appDef, visibleApps } from '../src/phone/registry.ts';
import type { ListRow, ScreenDef, Widget } from '../src/screen/types.ts';
import en from '../../../content/ui/i18n/en.json';
import { registerTexts } from '../src/i18n/index.ts';

registerTexts(en as Record<string, string>);

const messages: PhoneMessage[] = [
  { from: 'x_ramos', name: 'X Ramos', text: 'Dispatch here. A rider needs a ride, and the surge is on.', at: 120 },
  { from: 'odessa_calloway', name: 'Odessa Calloway', text: 'The tow truck is yours. Bring it back in one piece.', at: 40 },
];
const jobs: MissionJob[] = [
  { id: 'm.a1.01', title: 'Jump Start', state: 'passed', trigger: 'auto' },
  { id: 'm.a1.02', title: 'Surge Pricing', state: 'available', trigger: 'phone', giver: 'x_ramos', giverName: 'X Ramos' },
  { id: 'm.a1.03', title: 'Sideshow Sunday', state: 'locked', trigger: 'phone', giver: 'tavi_okafor', needs: 'Surge Pricing' },
  { id: 'm.a1.05', title: 'Ring Night', state: 'available', trigger: 'marker', giver: 'x_ramos' },
];

const lists = (s: ScreenDef): Extract<Widget, { k: 'list' }>[] => s.children.filter((w): w is Extract<Widget, { k: 'list' }> => w.k === 'list');
const env = (over: Partial<PhoneEnv> = {}): PhoneEnv => ({ mode: 'story', jobs: [], cashCents: 0, garage: [], ride: undefined, heat: 0, neverWanted: false, appRows: [], ...over });

describe('Messages app', () => {
  it('is an openable tile, not a comingSoon one', () => {
    expect(appDef('messages')?.comingSoon).toBeUndefined();
    expect(visibleApps({ mode: 'story' }).map((a) => a.id)).toContain('messages');
  });

  it('offers only an available mission with a phone trigger and a giver', () => {
    expect(offersOf(jobs).map((o) => [o.missionId, o.from, o.fromName])).toEqual([['m.a1.02', 'x_ramos', 'X Ramos']]);
  });

  it('groups lines per sender, latest conversation first, and adds the offer to the giver thread', () => {
    const threads = buildThreads(messages, jobs);
    expect(threads.map((t) => t.from)).toEqual(['x_ramos', 'odessa_calloway']);
    expect(threads[0]?.lines).toEqual([messages[0]?.text]);
    expect(threads[0]?.offers).toEqual([{ missionId: 'm.a1.02', title: 'Surge Pricing' }]);
    expect(threads[1]?.offers).toEqual([]);
    // a giver with an offer and no message still gets a thread, after those with messages
    const only = buildThreads([], jobs);
    expect(only.map((t) => t.from)).toEqual(['x_ramos']);
    expect(threadRows(only)[0]).toMatchObject({ id: 'thread:x_ramos', text: 'X Ramos', detail: 'Has a job for you', badge: '1 job offer' });
  });

  it('the x_ramos thread shows the line text and the offer; pressing the offer opens Jobs on m.a1.02', () => {
    const e = env({ messages, jobList: jobs, missions: missionRows(jobs), thread: 'x_ramos' });
    const s = appScreen('messages', e);
    const table = s.children.find((w) => w.k === 'table') as Extract<Widget, { k: 'table' }>;
    expect(table.rows).toEqual([[messages[0]?.text]]);
    const offers = lists(s).find((l) => l.id === 'phone-offers');
    expect(offers?.rows).toEqual([{ id: 'offer:m.a1.02', text: 'Surge Pricing', detail: 'Tap to see it in Jobs' }]);
    expect(offers?.onPress).toEqual({ call: 'phone.message.offer' });
    const press = messagePress('offer:m.a1.02');
    expect(press).toEqual({ kind: 'offer', missionId: 'm.a1.02' });
    // Jobs opened on the mission: its row is first and carries the offer badge, and it is still startable
    const jobsScreen = appScreen('jobs', env({ missions: missionRows(jobs), jobs: [], focusJob: 'm.a1.02' }));
    const rows = lists(jobsScreen).find((l) => l.id === 'phone-missions')?.rows as ListRow[];
    expect(rows[0]).toMatchObject({ id: 'mis:m.a1.02', text: 'Surge Pricing', badge: 'Offer' });
    expect(rows[0]?.disabled).not.toBe(true);
    expect(rows.map((r) => r.id)).toEqual(['mis:m.a1.02', 'mis:m.a1.01', 'mis:m.a1.03', 'mis:m.a1.05']);
  });

  it('shows the thread list without an open thread and an empty state without messages', () => {
    const list = appScreen('messages', env({ messages, jobList: jobs }));
    const rows = lists(list)[0]?.rows ?? [];
    expect(rows.map((r) => r.id)).toEqual(['thread:x_ramos', 'thread:odessa_calloway']);
    expect(lists(list)[0]?.onPress).toEqual({ call: 'phone.message.open' });
    const empty = appScreen('messages', env());
    expect(lists(empty)[0]?.rows).toEqual([]);
    // an unknown thread falls back to the list
    expect(messagesScreen(buildThreads(messages, jobs), 'nobody').id).toBe('app-messages');
  });

  it('reads a press and keeps the Jobs list as it is for an unknown mission', () => {
    expect(messagePress('thread:x_ramos')).toEqual({ kind: 'thread', from: 'x_ramos' });
    expect(messagePress('other')).toBeNull();
    const rows = missionRows(jobs);
    expect(focusJobRows(rows, 'm.zz')).toBe(rows);
    expect(focusJobRows(rows, null)).toBe(rows);
  });

  it('makes a readable name from a soul id when the cast table has none', () => {
    expect(senderName('x_ramos')).toBe('X Ramos');
    expect(senderName('imani_hart')).toBe('Imani Hart');
  });
});
