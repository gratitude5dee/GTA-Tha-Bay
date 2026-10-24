/**
 * M05c2: the sim side of the Messages app. A `text` op reaches `RuntimeOptions.onText`, and the story controller turns it into a row of
 * `mode.story.messages` (sender name from the cast table, text from the line table). The Jobs rows carry the giver's display name.
 */
import type { StorySlice } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { at, circle, defineMission, npc, phoneTrigger, stage, text, waitFor } from '../src/authoring/index.ts';
import { MissionStore, type CatalogPayload } from '../src/missions/store.ts';
import { StoryController } from '../src/mode.ts';
import { ll, makeHarness } from './harness.ts';

const ir = (id: string, giver?: string) =>
  defineMission({
    id,
    version: 1,
    district: 'd1',
    ...(giver ? { giver: { phone: giver }, start: phoneTrigger(giver) } : {}),
    cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)), spawnAt: 'manual' }) },
    zones: { z: circle(...ll(50, 0), 5) },
    stages: [stage('a', [waitFor(600, { id: 'long' })], { onEnter: [text('x_ramos', 'line.m.t.msg.1')] })],
  });

describe('text op to Messages', () => {
  it('calls onText with the sender, the line id and the tick', () => {
    const seen: [string, string, number][] = [];
    const h = makeHarness({ onText: (from, line, tick) => void seen.push([from, line, tick]) });
    h.start(ir('m.t.msg'));
    h.step(2);
    expect(seen).toEqual([['x_ramos', 'line.m.t.msg.1', expect.any(Number)]]);
  });

  it('the controller publishes mode.story.messages with the display name and the line text', () => {
    const h = makeHarness();
    const patches: [string, unknown][] = [];
    (h.ctx.ui as unknown as { patch: (k: string, v: unknown) => void }).patch = (k, v) => void patches.push([k, v]);
    const payload: CatalogPayload = {
      missions: [ir('m.t.msg', 'x_ramos')],
      directors: [],
      cutscenes: [],
      lines: { 'line.m.t.msg.1': 'Dispatch here. A rider needs a ride.', 'm.t.msg.title': 'Title' },
      names: { x_ramos: 'X Ramos' },
    };
    const c = new StoryController({ qa: false, bootConfig: () => ({ story: payload }) });
    c.attach(h.ctx, h.story as unknown as StorySlice);
    const add = (c as unknown as { addMessage(from: string, line: string, tick: number): void }).addMessage.bind(c);
    add('x_ramos', 'line.m.t.msg.1', 7);
    add('odessa_calloway', 'line.unknown', 9);
    const last = patches.filter(([k]) => k === 'mode.story.messages').pop()?.[1] as { from: string; name: string; text: string; at: number }[];
    expect(last).toEqual([
      { from: 'x_ramos', name: 'X Ramos', text: 'Dispatch here. A rider needs a ride.', at: 7 },
      { from: 'odessa_calloway', name: 'odessa_calloway', text: 'line.unknown', at: 9 },
    ]);
  });

  it('a Jobs row of a phone mission carries the giver and the display name', () => {
    const h = makeHarness();
    const store = new MissionStore({ missions: [ir('m.t.msg', 'x_ramos')], directors: [], cutscenes: [], lines: {}, names: { x_ramos: 'X Ramos' } });
    const rows = store.rows(h.story, h.ctx, null);
    expect(rows[0]).toMatchObject({ id: 'm.t.msg', giver: 'x_ramos', giverName: 'X Ramos', state: 'available', trigger: 'phone' });
  });
});
