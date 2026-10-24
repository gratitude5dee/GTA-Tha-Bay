import { describe, expect, it } from 'vitest';
import type { CompiledSoulPublic, DialogueEvent } from '@dv/shared/contracts/c10-npc';
import { createNpcRuntime, type NpcRuntimeOptions } from '../src/client/runtime.ts';
import { auth, bytes, context, errorResponse, goodTurn, LINE, npcTestInk, sseText, streamResponse } from './helpers.ts';

// M06a3 AC-10 (runtime part): every failure continues in the NPC's ink from the right knot, with no error and no throw. Also the flag poll,
// the settings switch and the telemetry of a turn.
type Emit = [string, Record<string, string | number | boolean>];

function setup(over: Partial<NpcRuntimeOptions> = {}, fetchImpl?: typeof fetch): { rt: ReturnType<typeof createNpcRuntime>; emitted: Emit[]; requests: { url: string; init?: RequestInit }[] } {
  const emitted: Emit[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  const f: typeof fetch = (input, init) => {
    requests.push({ url: String(input), ...(init === undefined ? {} : { init }) });
    return (fetchImpl ?? (() => Promise.resolve(streamResponse([bytes(sseText(goodTurn()))]))))(input, init);
  };
  const rt = createNpcRuntime({
    auth,
    fetch: f,
    soulVersionOf: (id) => (id === 'npc_test' ? 1 : null),
    loadInk: () => Promise.resolve(npcTestInk()),
    telemetry: { emit: (name, props) => emitted.push([name, props]) },
    now: () => 0,
    ...over,
  });
  return { rt, emitted, requests };
}

const run = async (rt: ReturnType<typeof createNpcRuntime>, turn: Parameters<typeof rt.talk>[1] = { intent: 'greet' }, ctx = context()): Promise<{ source: string; events: DialogueEvent[]; lines: string[] }> => {
  const events: DialogueEvent[] = [];
  const r = await rt.talk('npc_test', turn, ctx, (e) => events.push(e));
  return { source: r.source, events, lines: events.filter((e): e is Extract<DialogueEvent, { event: 'line.done' }> => e.event === 'line.done').map((e) => e.data.text) };
};

const INK = { greeting: 'Good day. Please confirm the lot is clear.', smalltalk: 'Noted. The forecast on the clipboard says clear.', busy: 'Noted. I am in the middle of item four.', deflect: 'That is outside the script. Next line of the checklist.', farewell: 'Checklist complete. Good day.' };

describe('talk', () => {
  it('streams the model line and records a turn event', async () => {
    const { rt, emitted } = setup();
    const r = await run(rt);
    expect(r.source).toBe('llm');
    expect(r.lines).toEqual([LINE]);
    expect(emitted).toEqual([['npc.turn.client', { ttftMs: 0, fallback: false }]]);
  });

  it.each([
    ['quota_exhausted', 429],
    ['budget_offline', 503],
    ['kill_switched', 410],
    ['upstream_unavailable', 503],
  ])('continues in ink on %s with the knot of the intent and no error', async (code, status) => {
    const { rt, emitted } = setup({}, () => Promise.resolve(errorResponse(code, status)));
    const greet = await run(rt, { intent: 'greet' });
    expect(greet).toMatchObject({ source: 'ink', lines: [INK.greeting] });
    expect(greet.events.map((e) => e.event)).toEqual(['line.delta', 'line.done', 'effects', 'done']);
    expect((await run(rt, { text: 'nice day', intent: 'smalltalk' })).lines).toEqual([INK.smalltalk]);
    expect((await run(rt, { intent: 'farewell' })).lines).toEqual([INK.farewell]);
    expect(emitted[0]).toEqual(['npc.turn.client', { ttftMs: 0, fallback: true, reason: 'offline' }]);
  });

  it('continues in ink from the knot the server names on a fallback event, after dropping the partial line', async () => {
    const fb: DialogueEvent[] = [
      goodTurn()[0]!,
      { event: 'line.delta', data: { seq: 0, text: 'I will not' } },
      { event: 'fallback', data: { reason: 'refusal', knot: 'deflect' } },
      { event: 'done', data: { costMicros: 0, turnsLeft: 5, closed: false } },
    ];
    const { rt, emitted } = setup({}, () => Promise.resolve(streamResponse([bytes(sseText(fb))])));
    const r = await run(rt);
    expect(r.source).toBe('ink');
    expect(r.events.map((e) => e.event)).toEqual(['meta', 'line.delta', 'fallback', 'done', 'line.delta', 'line.done', 'effects', 'done']);
    expect(r.lines).toEqual([INK.deflect]);
    expect(emitted[0]).toMatchObject(['npc.turn.client', { fallback: true, reason: 'refusal' }]);
  });

  it('continues in ink after a mid-stream network drop', async () => {
    const { rt } = setup({}, () => Promise.resolve(streamResponse([bytes(sseText(goodTurn().slice(0, 3))), new Error('reset')])));
    const r = await run(rt, { text: 'hi', intent: 'smalltalk' });
    expect(r).toMatchObject({ source: 'ink', lines: [INK.smalltalk] });
  });

  it('continues in ink when fetch throws, and records the reason as network', async () => {
    const { rt, emitted } = setup({}, () => Promise.reject(new TypeError('Failed to fetch')));
    expect((await run(rt)).lines).toEqual([INK.greeting]);
    expect(emitted[0]).toMatchObject(['npc.turn.client', { reason: 'network' }]);
  });

  it('goes straight to ink, with no request, without a play token and with the setting off', async () => {
    const none = setup({ auth: () => Promise.resolve(null) });
    expect((await run(none.rt)).lines).toEqual([INK.greeting]);
    expect(none.requests).toHaveLength(0);
    const off = setup({ settings: () => ({ aiDialogue: false, voice: 'all' }) });
    expect((await run(off.rt)).lines).toEqual([INK.greeting]);
    expect(off.requests).toHaveLength(0);
    expect(off.emitted[0]).toMatchObject(['npc.turn.client', { reason: 'setting_off' }]);
  });

  it('uses the mission knot of a mission intent, and falls back to smalltalk when the story has none', async () => {
    const { rt } = setup({ auth: () => Promise.resolve(null) });
    const r = await run(rt, { intent: 'ask_mission' }, context({ missionId: 'mis.act1.first-job', missionStep: 'talk-boss' }));
    expect(r.lines).toEqual([INK.smalltalk]);
  });

  it('answers busy for a rate limit and deflect for a blocked word', async () => {
    expect((await run(setup({}, () => Promise.resolve(errorResponse('rate_limited', 429))).rt)).lines).toEqual([INK.busy]);
    expect((await run(setup({}, () => Promise.resolve(errorResponse('moderation_blocked', 422))).rt)).lines).toEqual([INK.deflect]);
  });

  it('opens a new encounter once when the server says the old one is over', async () => {
    let n = 0;
    const { rt, requests } = setup({}, () => (++n === 2 ? Promise.resolve(errorResponse('conflict', 409, { reason: 'turn_cap' })) : Promise.resolve(streamResponse([bytes(sseText(goodTurn()))]))));
    await run(rt); // turn 1 opens the encounter
    const second = await run(rt, { text: 'again', intent: 'smalltalk' }); // the server says it is over; the retry opens a new one
    expect(second.source).toBe('llm');
    expect(requests).toHaveLength(3);
    expect(JSON.parse(String(requests[1]!.init?.body))).toHaveProperty('encounterId');
    expect(JSON.parse(String(requests[2]!.init?.body))).not.toHaveProperty('encounterId');
  });

  it('sends the encounter id of the first turn on the second, the soul version and the play token', async () => {
    const { rt, requests } = setup();
    await run(rt);
    await run(rt, { text: 'again', intent: 'smalltalk' });
    const second = JSON.parse(String(requests[1]!.init?.body)) as { encounterId: string; soulVersion: number; maxTokens: number };
    expect(second).toMatchObject({ encounterId: '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000', soulVersion: 1, maxTokens: 512 });
    expect((requests[1]!.init?.headers as Record<string, string>)['Authorization']).toBe('PlayToken test');
    expect(requests[1]!.url).toBe('/api/v1/npc/npc_test/talk');
  });

  it('counts the encounter on endEncounter', async () => {
    const { rt, emitted } = setup();
    await run(rt);
    await run(rt, { text: 'again', intent: 'smalltalk' });
    rt.endEncounter('npc_test');
    expect(emitted.at(-1)).toEqual(['npc.encounter.client', { turns: 2, fallbacks: 0, voiceTier: 'text', model: 'haiku' }]);
    rt.endEncounter('npc_test'); // nothing left: no second event
    expect(emitted.filter((e) => e[0] === 'npc.encounter.client')).toHaveLength(1);
  });

  it('plays a knot with no network', async () => {
    const { rt, requests } = setup();
    const lines: string[] = [];
    for await (const l of rt.playKnot('npc_test', 'farewell')) lines.push(l.text);
    expect(lines).toEqual([INK.farewell]);
    expect(requests).toHaveLength(0);
  });

  it('says nothing, and does not throw, when the ink cannot be loaded', async () => {
    const { rt } = setup({ loadInk: () => Promise.reject(new Error('missing')), auth: () => Promise.resolve(null) });
    const r = await run(rt);
    expect(r.source).toBe('ink');
    expect(r.events.map((e) => e.event)).toEqual(['effects', 'done']);
  });
});

describe('flags', () => {
  const soul = (id: string): CompiledSoulPublic => ({ id, soulVersion: 1 }) as unknown as CompiledSoulPublic;

  it('reads route 30 with its ETag, keeps the flags on a 304 and removes a killed NPC from the roster', async () => {
    const seen: (string | null)[] = [];
    const flags = { etag: 'e1', killed: { npc_b: { scope: ['all'], standIn: 'character/standin_rapper' } }, updatedAt: 1 };
    const f = (_url: unknown, init?: RequestInit): Promise<Response> => {
      seen.push(new Headers(init?.headers).get('If-None-Match'));
      return Promise.resolve(seen.length === 1 ? new Response(JSON.stringify(flags), { status: 200 }) : new Response(null, { status: 304 }));
    };
    const { rt } = setup({ souls: () => [soul('npc_a'), soul('npc_b'), soul('npc_c')] }, f as typeof fetch);
    expect([...rt.roster().keys()]).toEqual(['npc_a', 'npc_b', 'npc_c']);
    expect((await rt.refreshFlags()).etag).toBe('e1');
    expect([...rt.roster().keys()]).toEqual(['npc_a', 'npc_c']);
    expect((await rt.refreshFlags()).etag).toBe('e1'); // 304
    expect(seen).toEqual(['"0"', '"e1"']);
  });

  it('keeps the last flags when the read fails', async () => {
    const { rt } = setup({}, () => Promise.reject(new TypeError('offline')));
    expect((await rt.refreshFlags()).etag).toBe('0');
  });

  it('refreshes after kill_switched', async () => {
    const calls: string[] = [];
    const { rt } = setup({}, (url) => {
      calls.push(String(url));
      return Promise.resolve(String(url).endsWith('/roster') ? new Response(JSON.stringify({ etag: 'k', killed: {}, updatedAt: 2 }), { status: 200 }) : errorResponse('kill_switched', 410));
    });
    await run(rt);
    expect(calls).toEqual(['/api/v1/npc/npc_test/talk', '/api/v1/roster']);
  });

  it('polls on start and every 30 s while visible, and again on return to visible', async () => {
    let tick: () => void = () => undefined;
    let visible = true;
    let onChange: () => void = () => undefined;
    const reads: string[] = [];
    const { rt } = setup(
      {
        timers: { setInterval: (fn) => ((tick = fn), 1), clearInterval: () => undefined },
        visibility: { visible: () => visible, onChange: (fn) => ((onChange = fn), () => undefined) },
      },
      (url) => (reads.push(String(url)), Promise.resolve(new Response(null, { status: 304 }))),
    );
    rt.start();
    tick();
    visible = false;
    tick(); // hidden: no read
    visible = true;
    onChange();
    rt.onModeEnter();
    await new Promise((r) => setTimeout(r, 0));
    expect(reads).toHaveLength(4);
    rt.stop();
  });

  it('reports the voice setting', () => {
    expect(setup().rt.voiceSetting()).toBe('all');
    expect(setup({ settings: () => ({ aiDialogue: true, voice: 'off' }) }).rt.voiceSetting()).toBe('off');
  });
});
