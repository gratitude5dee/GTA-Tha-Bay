import { describe, expect, it } from 'vitest';
import type { DialogueEvent, NPCDialogueRequest } from '@dv/shared/contracts/c10-npc';
import { DialogueClient, OFFLINE_CODES } from '../src/client/dialogue-client.ts';
import { SseParser, toDialogueEvent } from '../src/client/sse.ts';
import { auth, bytes, context, errorResponse, goodTurn, LINE, splitAt, sseText, streamResponse } from './helpers.ts';

// M06a3 AC-10 (client part): chunk-split SSE, a mid-stream drop and every offline ApiError code.
const req = (over: Partial<NPCDialogueRequest> = {}): NPCDialogueRequest => ({ npcId: 'npc_test', soulVersion: 1, turn: { intent: 'greet' }, context: context(), maxTokens: 512, ...over });
const client = (fetchImpl: typeof fetch, over: { auth?: () => Promise<{ Authorization: string } | null> } = {}): DialogueClient => new DialogueClient({ auth: over.auth ?? auth, fetch: fetchImpl, now: () => 0 });

/** The text a viewer sees after an event: the concatenation of the line.delta texts. */
function visibleTexts(events: readonly DialogueEvent[]): string[] {
  let text = '';
  const out: string[] = [];
  for (const e of events) {
    if (e.event === 'line.delta' && typeof e.data.text === 'string') text += e.data.text;
    out.push(text);
  }
  return out;
}

describe('SseParser', () => {
  it('cuts frames only at a blank line, whatever the chunking', () => {
    const text = sseText(goodTurn());
    const all = new SseParser().feed(text);
    expect(all.map((f) => f.event)).toEqual(goodTurn().map((e) => e.event));
    for (let step = 1; step <= 5; step++) {
      const p = new SseParser();
      const got = [];
      for (let i = 0; i < text.length; i += step) got.push(...p.feed(text.slice(i, i + step)));
      expect(got).toEqual(all);
      expect(p.pending()).toBe(0);
    }
  });

  it('reads CRLF framing, comments and multi-line data', () => {
    const frames = new SseParser().feed(': keep-alive\r\n\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n');
    expect(frames).toEqual([{ event: 'x', data: 'a\nb' }]);
  });

  it('drops event names the contract does not have and bodies that are not JSON', () => {
    expect(toDialogueEvent({ event: 'weird', data: '{}' })).toBeNull();
    expect(toDialogueEvent({ event: 'meta', data: '{oops' })).toBeNull();
    expect(toDialogueEvent({ event: 'done', data: '{"costMicros":1,"turnsLeft":0,"closed":false}' })).toEqual({ event: 'done', data: { costMicros: 1, turnsLeft: 0, closed: false } });
  });
});

describe('DialogueClient over chunk-split streams', () => {
  const data = bytes(sseText(goodTurn()));

  it('shows a line prefix after every event, at every split point, and the whole line at the end', async () => {
    // two chunks cut at every byte offset (this also cuts inside the multi-byte characters), then one byte at a time
    const cuts = [...Array.from({ length: data.length - 1 }, (_, i) => [i + 1]), Array.from({ length: data.length - 1 }, (_, i) => i + 1)];
    for (const offsets of cuts) {
      const seen: DialogueEvent[] = [];
      const end = await client(() => Promise.resolve(streamResponse(splitAt(data, offsets)))).talk('npc_test', req(), (e) => seen.push(e));
      expect(end).toMatchObject({ kind: 'done', closed: false, turnsLeft: 5, model: 'haiku', encounterId: '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000' });
      expect(seen.map((e) => e.event)).toEqual(goodTurn().map((e) => e.event));
      for (const t of visibleTexts(seen)) expect(LINE.startsWith(t)).toBe(true);
      expect(visibleTexts(seen).at(-1)).toBe(LINE);
      expect((seen.find((e) => e.event === 'line.done') as Extract<DialogueEvent, { event: 'line.done' }>).data.text).toBe(LINE);
    }
  });

  it('reads CRLF framing', async () => {
    const seen: DialogueEvent[] = [];
    const end = await client(() => Promise.resolve(streamResponse([bytes(sseText(goodTurn(), '\r\n'))]))).talk('npc_test', req(), (e) => seen.push(e));
    expect(end.kind).toBe('done');
    expect(visibleTexts(seen).at(-1)).toBe(LINE);
  });

  it('measures the time to the first text', async () => {
    let t = 0;
    const c = new DialogueClient({
      auth,
      now: () => t,
      fetch: () => {
        t = 100;
        return Promise.resolve(streamResponse([bytes(sseText(goodTurn().slice(0, 1))), bytes(sseText(goodTurn().slice(1)))]));
      },
    });
    // the clock moves when the first chunk is read: first line.delta lands at t = 100 minus the start (0)
    const end = await c.talk('npc_test', req(), () => undefined);
    expect(end).toMatchObject({ kind: 'done', ttftMs: 100 });
  });
});

describe('a stream that fails', () => {
  const events = goodTurn();
  const half = bytes(sseText(events.slice(0, 3)));

  it('treats a network drop in the middle as a fallback and tells the UI to drop the partial line', async () => {
    const seen: DialogueEvent[] = [];
    const end = await client(() => Promise.resolve(streamResponse([half, new Error('network down')]))).talk('npc_test', req(), (e) => seen.push(e));
    expect(end).toMatchObject({ kind: 'fallback', reason: 'upstream', knot: 'greeting', midStream: true });
    expect(seen.at(-1)).toEqual({ event: 'fallback', data: { reason: 'upstream', knot: 'greeting' } });
  });

  it('treats a stream that ends with neither done nor fallback as a fallback', async () => {
    const seen: DialogueEvent[] = [];
    const end = await client(() => Promise.resolve(streamResponse([half]))).talk('npc_test', req({ turn: { text: 'hi', intent: 'smalltalk' } }), (e) => seen.push(e));
    expect(end).toMatchObject({ kind: 'fallback', reason: 'upstream', knot: 'smalltalk', midStream: true });
    expect(seen.at(-1)?.event).toBe('fallback');
  });

  it('passes a fallback event of the server through with its reason and knot', async () => {
    const fb: DialogueEvent[] = [goodTurn()[0]!, { event: 'fallback', data: { reason: 'timeout', knot: 'busy' } }, { event: 'done', data: { costMicros: 0, turnsLeft: 5, closed: false } }];
    const seen: DialogueEvent[] = [];
    const end = await client(() => Promise.resolve(streamResponse([bytes(sseText(fb))]))).talk('npc_test', req(), (e) => seen.push(e));
    expect(end).toMatchObject({ kind: 'fallback', reason: 'timeout', knot: 'busy', midStream: false });
    expect(seen.map((e) => e.event)).toEqual(['meta', 'fallback', 'done']);
  });

  it('returns a network refusal when fetch throws and aborted when the caller aborts', async () => {
    expect(await client(() => Promise.reject(new TypeError('offline'))).talk('npc_test', req(), () => undefined)).toEqual({ kind: 'refused', code: 'network', status: 0 });
    const ac = new AbortController();
    ac.abort();
    const abortFetch = (): Promise<Response> => Promise.reject(new DOMException('aborted', 'AbortError'));
    expect(await client(abortFetch).talk('npc_test', req(), () => undefined, ac.signal)).toEqual({ kind: 'aborted' });
  });

  it('does not call the network without a play token', async () => {
    let calls = 0;
    const end = await client(() => (calls++, Promise.resolve(streamResponse([]))), { auth: () => Promise.resolve(null) }).talk('npc_test', req(), () => undefined);
    expect(end).toEqual({ kind: 'refused', code: 'no_auth', status: 0 });
    expect(calls).toBe(0);
  });
});

describe('ApiError answers', () => {
  const cases: [string, number][] = [['quota_exhausted', 429], ['budget_offline', 503], ['kill_switched', 410], ['upstream_unavailable', 503]];

  it.each(cases)('maps %s (HTTP %i) to a refusal that the runtime takes offline', async (code, status) => {
    const end = await client(() => Promise.resolve(errorResponse(code, status))).talk('npc_test', req(), () => undefined);
    expect(end).toMatchObject({ kind: 'refused', code, status });
    expect(OFFLINE_CODES as readonly string[]).toContain(code);
  });

  it('keeps the details of a conflict and the retry hint', async () => {
    const end = await client(() => Promise.resolve(errorResponse('conflict', 409, { reason: 'turn_cap' }))).talk('npc_test', req(), () => undefined);
    expect(end).toMatchObject({ kind: 'refused', code: 'conflict', status: 409, details: { reason: 'turn_cap' } });
  });

  it('treats a non-JSON error page as the Worker being unavailable', async () => {
    const end = await client(() => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 }))).talk('npc_test', req(), () => undefined);
    expect(end).toMatchObject({ kind: 'refused', code: 'upstream_unavailable', status: 502 });
  });
});
