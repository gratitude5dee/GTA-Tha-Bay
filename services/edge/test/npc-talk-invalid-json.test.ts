import { afterEach, describe, expect, it } from 'vitest';
import { find, names, request, talkSetup, type Talk } from './talk-helpers.ts';

// M06a3 AC-3 (invalid output): schema-invalid JSON and a max_tokens cut both become fallback{invalid_output}; neither is retried upstream.
let t: Talk;
afterEach(() => t.dispose());

describe('invalid output', () => {
  it.each(['invalid-json', 'max-tokens'] as const)('%s ends with fallback{invalid_output} after one upstream call', async (fixture) => {
    t = await talkSetup({ fixture });
    t.recordCalls();
    const { frames } = await t.say(request());
    expect(names(frames).slice(-2)).toEqual(['fallback', 'done']);
    expect(names(frames)).not.toContain('line.done');
    expect(find(frames, 'fallback')!.data).toEqual({ reason: 'invalid_output', knot: 'greeting' });
    expect(t.calls).toHaveLength(1);
  });

  it('names the mission knot for a mission intent, farewell for farewell, smalltalk otherwise', async () => {
    t = await talkSetup({ fixture: 'invalid-json' });
    const ctx = { missionId: 'mis.act1.first-job', missionStep: 'talk-boss' } as const;
    const a = await t.say(request({ turn: { intent: 'ask_mission' }, context: { ...request().context, ...ctx } }));
    expect(find(a.frames, 'fallback')!.data).toEqual({ reason: 'invalid_output', knot: 'mission_mis_act1_first_job_talk_boss' });
    t.h.clock.t += 2000;
    const b = await t.say(request({ turn: { intent: 'farewell' } }));
    expect(find(b.frames, 'fallback')!.data).toMatchObject({ knot: 'farewell' });
    t.h.clock.t += 2000;
    const c = await t.say(request({ turn: { text: 'nice weather', intent: 'smalltalk' } }));
    expect(find(c.frames, 'fallback')!.data).toMatchObject({ knot: 'smalltalk' });
  });
});
