import { afterEach, describe, expect, it } from 'vitest';
import { find, names, quotaUsage, request, talkSetup, type Talk } from './talk-helpers.ts';

// M06a3 AC-2: the 4 s first-token rule under the mocked clock; the aborted turn leaves no pair in the history.
let t: Talk;
afterEach(() => t.dispose());

describe('the 4 s rule', () => {
  it('answers fallback{timeout} at 4.0 s when the first text comes at 5 s, then done, and the history gains no pair', async () => {
    t = await talkSetup({ fixture: 'slow-first-text' });
    t.recordCalls();
    const { frames } = await t.say(request());
    expect(names(frames)).toEqual(['meta', 'fallback', 'done']);
    const fb = find(frames, 'fallback')!;
    expect(fb.data).toEqual({ reason: 'timeout', knot: 'greeting' });
    expect(Math.abs(fb.at - 4000)).toBeLessThanOrEqual(200);
    expect(find(frames, 'done')!.data).toMatchObject({ costMicros: 0, closed: false });

    // The encounter dropped the turn: the next turn starts with an empty history, as turn 0 again.
    const encounterId = (find(frames, 'meta')!.data as { encounterId: string }).encounterId;
    t.h.clock.t += 2000;
    await t.say(request({ encounterId }));
    expect(t.calls).toHaveLength(2);
    const second = t.calls[1]!.call.body['messages'] as { role: string }[];
    expect(second).toHaveLength(1);
    expect(second[0]!.role).toBe('user');
  });

  it('streams normally when the first text comes at 3 s', async () => {
    t = await talkSetup({ fixture: 'slow-3s' });
    const { frames } = await t.say(request());
    expect(names(frames).at(-1)).toBe('done');
    expect(names(frames)).toContain('line.done');
    expect(names(frames)).not.toContain('fallback');
    const first = frames.find((f) => f.event === 'line.delta')!;
    expect(first.at).toBeGreaterThanOrEqual(3000);
    expect(first.at).toBeLessThan(3400);
  });

  it('settles a timed-out turn at zero cost and leaves the quota counting the attempt', async () => {
    t = await talkSetup({ fixture: 'slow-first-text' });
    await t.say(request());
    const usage = await quotaUsage(t.pid);
    expect(usage['turn']).toBe(1);
    expect(usage['cost_micros']).toBe(0);
  });
});
