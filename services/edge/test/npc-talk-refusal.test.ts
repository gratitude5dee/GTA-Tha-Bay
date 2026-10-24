import { afterEach, describe, expect, it } from 'vitest';
import { find, names, quotaUsage, request, talkSetup, textOf, type Talk } from './talk-helpers.ts';

// M06a3 AC-3 (refusal): stop_reason refusal discards the partial line, answers the deflect knot, is not retried and is not stored.
let t: Talk;
afterEach(() => t.dispose());

describe('a refusal', () => {
  it('ends with fallback{refusal, deflect} and done, once upstream, and drops the turn', async () => {
    t = await talkSetup({ fixture: 'refusal' });
    t.recordCalls();
    const { frames } = await t.say(request());
    const order = names(frames);
    expect(order[0]).toBe('meta');
    expect(order.at(-2)).toBe('fallback');
    expect(order.at(-1)).toBe('done');
    expect(order).not.toContain('line.done');
    expect(order).not.toContain('effects');
    expect(find(frames, 'fallback')!.data).toEqual({ reason: 'refusal', knot: 'deflect' });
    // the partial text that streamed before the refusal was seen; the client replaces it on the fallback
    expect(textOf(frames).length).toBeGreaterThan(0);
    expect(t.calls).toHaveLength(1);

    // not stored: the next turn of the encounter starts from an empty history
    const encounterId = (find(frames, 'meta')!.data as { encounterId: string }).encounterId;
    t.h.clock.t += 2000;
    await t.say(request({ encounterId }));
    expect(t.calls).toHaveLength(2);
    expect((t.calls[1]!.call.body['messages'] as unknown[]).length).toBe(1);
  });

  it('charges the tokens the refused response used', async () => {
    t = await talkSetup({ fixture: 'refusal' });
    await t.say(request());
    // 180 input at $0.10 + 1,500 to the 1 h cache at $0.20 + 8 output at $0.50 per million: 18 + 300 + 4
    expect((await quotaUsage(t.pid))['cost_micros']).toBe(322);
  });
});
