/**
 * M05c1: the talk panel's data side. The panel lists the outcomes with their labels, a gated outcome is off with its hint, and the number
 * keys pick only an enabled outcome. (The click path is the Playwright test `tests/e2e/story-talk.spec.ts`.)
 */
import { describe, expect, it } from 'vitest';
import { registerTexts } from '../src/i18n/index.ts';
import { hintText, pickByKey, talkButtons, type TalkView } from '../src/hud/TalkChoices.tsx';
import { missionRows } from '../src/phone/apps.ts';

registerTexts({
  'mission.m.t.talk.agree': 'Sure, lead the way',
  'mission.m.t.talk.charm': 'Charm your way in',
  'mission.m.t.talk.bribe': 'Slip them $300',
});

const talk: TalkView = {
  talkId: 'door',
  npc: 'door_host',
  intent: 'mission.m.t.talk.agree',
  open: 'Name is not on the list.',
  choices: [
    { id: 'bribe', label: 'mission.m.t.talk.bribe', enabled: false, hint: 'talk.gate.cost', hintParams: { cents: 30_000 } },
    { id: 'charm', label: 'mission.m.t.talk.charm', enabled: false, hint: 'talk.gate.mood', hintParams: { need: 20 } },
    { id: 'refuse', label: 'mission.m.t.talk.agree', enabled: true },
  ],
};

describe('talk panel data', () => {
  it('lists the outcomes in order with their labels; the gated ones are off with a hint', () => {
    const b = talkButtons(talk);
    expect(b.map((x) => [x.key, x.id, x.label, x.enabled])).toEqual([
      [1, 'bribe', 'Slip them $300', false],
      [2, 'charm', 'Charm your way in', false],
      [3, 'refuse', 'Sure, lead the way', true],
    ]);
    expect(b[0]?.hint).toBe('Costs $300.00');
    expect(b[1]?.hint).toBe('Not in the mood yet');
    expect(b[2]?.hint).toBe('');
    expect(hintText({ id: 'x', label: 'x', enabled: false, hint: 'talk.gate.trust', hintParams: { need: 5 } })).toBe('Needs more trust (5)');
  });

  it('number keys pick an enabled outcome only', () => {
    expect(pickByKey(talk, '3')).toBe('refuse');
    expect(pickByKey(talk, '1')).toBeNull();
    expect(pickByKey(talk, '2')).toBeNull();
    expect(pickByKey(talk, '4')).toBeNull();
    expect(pickByKey(talk, 'x')).toBeNull();
  });
});

describe('Jobs rows of the missions', () => {
  it('lists missions with their state; a locked one says what to finish first, an active one cannot be started again', () => {
    const rows = missionRows([
      { id: 'm.a1.01', title: 'Jump Start', state: 'passed', trigger: 'auto' },
      { id: 'm.a1.02', title: 'Surge Pricing', state: 'available', trigger: 'phone', giver: 'x_ramos' },
      { id: 'm.a1.03', title: 'Sideshow Sunday', state: 'active', trigger: 'marker' },
      { id: 'm.a1.04', title: 'Curb Appeal', state: 'locked', trigger: 'phone', needs: 'Surge Pricing' },
    ]);
    expect(rows.map((r) => [r.id, r.text, r.detail, r.disabled === true])).toEqual([
      ['mis:m.a1.01', 'Jump Start', 'Done', false],
      ['mis:m.a1.02', 'Surge Pricing', 'Ready', false],
      ['mis:m.a1.03', 'Sideshow Sunday', 'In progress', true],
      ['mis:m.a1.04', 'Curb Appeal', 'Locked', true],
    ]);
    expect(rows[3]?.hint).toBe('Finish Surge Pricing first');
  });

  it('a mission whose far start could not be reached keeps a Start action that sends mission.start again (DL-734)', () => {
    const rows = missionRows([
      { id: 'm.a1.01', title: 'Jump Start', state: 'available', trigger: 'auto', retry: true },
      { id: 'm.a1.02', title: 'Surge Pricing', state: 'available', trigger: 'phone' },
      { id: 'm.a1.03', title: 'Sideshow Sunday', state: 'locked', trigger: 'marker', retry: true },
    ]);
    expect(rows[0]).toMatchObject({ id: 'mis:m.a1.01', text: 'Jump Start', badge: 'Start', detail: 'Last time we could not get you to its starting point. Start tries again.' });
    expect(rows[0]?.disabled).toBeUndefined();
    expect(rows[1]?.badge).toBeUndefined();
    expect(rows[1]?.detail).toBe('Ready');
    // only an available mission offers it
    expect(rows[2]).toMatchObject({ disabled: true, detail: 'Locked' });
    expect(rows[2]?.badge).toBeUndefined();
  });
});
