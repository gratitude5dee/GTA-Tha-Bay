import { describe, expect, it } from 'vitest';
import type { AudioChunk, CompiledSoulPublic, DialogueEvent } from '@dv/shared/contracts/c10-npc';
import { createNpcRuntime, type VoiceSink } from '../src/client/runtime.ts';
import { auth, bytes, context, goodTurn, npcTestInk, sseText, streamResponse } from './helpers.ts';

// M06a4: the runtime sends `context.voice` from the profile setting, routes the audio of a voiced stream to the voice sink and leaves the text events alone.
const AUDIO: AudioChunk = { sentence: 0, codec: 'mp3', b64: 'AAAA', last: true };

function voicedTurn(): DialogueEvent[] {
  const events = goodTurn('Good day.');
  const meta = events[0] as Extract<DialogueEvent, { event: 'meta' }>;
  events[0] = { event: 'meta', data: { ...meta.data, voice: 't1' } };
  const doneAt = events.findIndex((e) => e.event === 'line.done');
  events.splice(doneAt, 0, { event: 'line.delta', data: { seq: 99, audio: AUDIO } });
  return events;
}

function setup(setting: 'all' | 'heroes' | 'off', hero = false, throwing = false): { rt: ReturnType<typeof createNpcRuntime>; calls: string[]; sent: { voice: string }[]; telemetry: [string, Record<string, unknown>][] } {
  const calls: string[] = [];
  const sent: { voice: string }[] = [];
  const telemetry: [string, Record<string, unknown>][] = [];
  const sink: VoiceSink = {
    beginLine: (id, tier) => calls.push(`begin ${id} ${tier}`),
    appendText: (_id, text) => calls.push(`text ${text.length > 0}`),
    push: (_id, chunk) => {
      if (throwing) throw new Error('audio broke');
      calls.push(`push ${chunk.sentence}${chunk.last ? ' last' : ''}`);
    },
    endLine: (id) => calls.push(`end ${id}`),
    stop: (id) => calls.push(`stop ${id}`),
  };
  const rt = createNpcRuntime({
    auth,
    fetch: (_input, init) => {
      sent.push({ voice: (JSON.parse(String(init?.body)) as { context: { voice: string } }).context.voice });
      return Promise.resolve(streamResponse([bytes(sseText(voicedTurn()))]));
    },
    soulVersionOf: (id) => (id === 'npc_test' ? 1 : null),
    souls: () => [{ id: 'npc_test', soulVersion: 1, roles: { hero } } as unknown as CompiledSoulPublic],
    loadInk: () => Promise.resolve(npcTestInk()),
    settings: () => ({ aiDialogue: true, voice: setting }),
    telemetry: { emit: (name, props) => telemetry.push([name, props]) },
    voice: sink,
    now: () => 0,
  });
  return { rt, calls, sent, telemetry };
}

const talk = async (rt: ReturnType<typeof createNpcRuntime>, ctxVoice: 'off' | 'auto' = 'auto'): Promise<DialogueEvent[]> => {
  const events: DialogueEvent[] = [];
  await rt.talk('npc_test', { intent: 'greet' }, context({ voice: ctxVoice }), (e) => events.push(e));
  return events;
};

describe('voice in the runtime', () => {
  it('sends voice auto for the setting all, and feeds the sink while every event reaches the panel', async () => {
    const { rt, calls, sent } = setup('all');
    const events = await talk(rt);
    expect(sent).toEqual([{ voice: 'auto' }]);
    expect(calls[0]).toBe('begin npc_test t1');
    expect(calls).toContain('push 0 last');
    expect(calls.at(-1)).toBe('end npc_test');
    // the audio delta is still among the events (the subtitles never depend on it)
    expect(events.map((e) => e.event)).toEqual(['meta', 'line.delta', 'line.delta', 'line.delta', 'line.done', 'effects', 'done']);
    expect(events.filter((e) => e.event === 'line.delta' && e.data.audio !== undefined)).toHaveLength(1);
    expect(events.find((e) => e.event === 'line.done')).toMatchObject({ data: { text: 'Good day.' } });
  });

  it.each([
    ['off', false, 'off'],
    ['heroes', false, 'off'],
    ['heroes', true, 'auto'],
  ] as const)('with the setting %s and hero %s the request says %s', async (setting, hero, expected) => {
    const { rt, sent } = setup(setting, hero);
    await talk(rt);
    expect(sent).toEqual([{ voice: expected }]);
  });

  it('keeps a caller that asked for off on off', async () => {
    const { rt, sent } = setup('all');
    await talk(rt, 'off');
    expect(sent).toEqual([{ voice: 'off' }]);
  });

  it('does not let a failing sink touch the dialogue', async () => {
    const { rt } = setup('all', false, true);
    const events = await talk(rt);
    expect(events.map((e) => e.event)).toContain('done');
  });

  it('records the highest voice tier of the encounter when it closes', async () => {
    const { rt, telemetry } = setup('all');
    await talk(rt);
    rt.endEncounter('npc_test');
    expect(telemetry.find(([n]) => n === 'npc.encounter.client')?.[1]).toMatchObject({ voiceTier: 't1', turns: 1 });
  });
});
