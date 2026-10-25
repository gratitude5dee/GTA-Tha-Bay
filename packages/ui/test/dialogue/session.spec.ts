/**
 * M06a5: the session adapter. NpcRuntime events become the view of the bubble: speaker, revealed and full text, choices, the AI badge, the
 * fallback flag, the close. The offline paths show no error state. Typed self-harm text brings the safety card (AC-6).
 */
import type { DialogueEvent } from '@dv/shared/contracts/c10-npc';
import { describe, expect, it } from 'vitest';
import { DIALOGUE_OPEN_KEY, DialogueSession, TEXT_MAX, bindDialogueOpen, dialogueBack, setDialogueSession, type SubtitleCue } from '../../src/dialogue/session.ts';
import { FakeRuntime, META, ctxOf, happyTurn, inkTurn, makeSession } from './helpers.ts';

describe('opening and closing', () => {
  it('opens with the speaker name, the AI badge and the six intents (ask_mission only with an offered mission)', () => {
    const { session } = makeSession();
    session.open('npc_test');
    const v = session.state();
    expect(v).toMatchObject({ open: true, npcId: 'npc_test', speaker: 'Tester Nine', badge: true, card: null, busy: false, fallback: false });
    expect(v.choices.map((c) => c.intent)).toEqual(['greet', 'smalltalk', 'trade', 'compliment', 'farewell']);

    const offered = makeSession({ context: () => ctxOf({ offers: { missionIds: ['m.a1.02'], raceIds: [], dealIds: [] } }) }).session;
    offered.open('npc_test');
    expect(offered.state().choices.map((c) => c.intent)).toEqual(['greet', 'smalltalk', 'ask_mission', 'trade', 'compliment', 'farewell']);
  });

  it('streams a greeting into the view, keeps the badge, files the turn reference and patches the subtitle', async () => {
    const cues: (SubtitleCue | null)[] = [];
    const { session, runtime } = makeSession({ subtitle: (c) => cues.push(c) }, new FakeRuntime(() => happyTurn('Good day. Please confirm the lot is clear.')));
    session.open('npc_test');
    const r = await session.choose('greet');
    expect(r).toMatchObject({ encounterId: 'E', source: 'llm' });
    expect(runtime.calls[0]?.turn).toEqual({ intent: 'greet' });
    const v = session.state();
    expect(v.full).toBe('Good day. Please confirm the lot is clear.');
    expect(v.shown).toBe(v.full);
    expect(v.revealing).toBe(false);
    expect(v.badge).toBe(true);
    expect(v.turn).toEqual({ npcId: 'npc_test', encounterId: 'E', turnIndex: 0 });
    expect(cues[0]).toMatchObject({ speaker: 'Tester Nine', text: 'Good day. Please confirm the lot is clear.', startMs: 1000 });
  });

  it('a subtitle cue stays at least max(1.5 s, 0.06 s per character) and clears after that', async () => {
    const cues: (SubtitleCue | null)[] = [];
    const long = 'x'.repeat(50).replace(/(.{5})/g, '$1 ').trim(); // 59 characters: 3.54 s
    const { session, timers } = makeSession({ subtitle: (c) => cues.push(c) }, new FakeRuntime((_t, n) => (n === 1 ? happyTurn('Hi.') : happyTurn(long))));
    session.open('npc_test');
    await session.choose('greet');
    const short = cues[0] as SubtitleCue;
    expect(short.endMs - short.startMs).toBe(1500);
    timers.advance(1499);
    expect(cues.at(-1)).not.toBeNull();
    timers.advance(2);
    expect(cues.at(-1)).toBeNull();
    await session.choose('smalltalk');
    const second = cues.filter((c): c is SubtitleCue => c !== null).at(-1) as SubtitleCue;
    expect(second.endMs - second.startMs).toBe(Math.round(0.06 * long.length * 1000));
  });

  it('closes after done {closed: true}, once the line has had its reading time; Esc/UiBack and Close close at once', async () => {
    const closed: string[] = [];
    const { session, timers, runtime } = makeSession({ onClosed: (id) => closed.push(id) }, new FakeRuntime(() => happyTurn('Checklist complete. Good day.', { closed: true })));
    session.open('npc_test');
    await session.choose('greet');
    expect(session.state()).toMatchObject({ open: true, closing: true });
    timers.advance(1000);
    expect(session.state().open).toBe(true);
    timers.advance(1000);
    expect(session.state().open).toBe(false);
    expect(closed).toEqual(['npc_test']);
    expect(runtime.ended).toEqual(['npc_test']);

    session.open('npc_test');
    setDialogueSession(session);
    expect(dialogueBack()).toBe(true);
    expect(session.state().open).toBe(false);
    expect(dialogueBack()).toBe(false);
    setDialogueSession(null);
  });

  it('a farewell intent closes the panel too, even when the runtime did not say closed', async () => {
    const { session, timers } = makeSession();
    session.open('npc_test');
    await session.choose('farewell');
    expect(session.state().closing).toBe(true);
    timers.advance(3000);
    expect(session.state().open).toBe(false);
  });

  it('a new request for the same NPC with a new id starts over; a repeat of the same id is ignored', () => {
    const closed: string[] = [];
    const { session } = makeSession({ onClosed: (id) => closed.push(id) });
    session.open('npc_test', { id: 1 });
    session.open('npc_test', { id: 1 });
    expect(session.state().open).toBe(true);
    session.open('npc_test', { id: 2 });
    expect(session.state().open).toBe(true);
    expect(closed).toEqual([]); // the replaced conversation does not clear the new request
  });
});

describe('the offline paths (R-NPC-05)', () => {
  it('a fallback drops the partial line and the ink line stands, with the badge, and no error of any kind', async () => {
    const events: DialogueEvent[] = [
      META(),
      { event: 'line.delta', data: { seq: 0, text: 'I will not' } },
      { event: 'fallback', data: { reason: 'refusal', knot: 'deflect' } },
      ...inkTurn(['That is outside the script. Next line of the checklist.']),
    ];
    const { session } = makeSession({}, new FakeRuntime(() => events));
    session.open('npc_test');
    await session.choose('smalltalk');
    const v = session.state();
    expect(v.fallback).toBe(true);
    expect(v.full).toBe('That is outside the script. Next line of the checklist.');
    expect(v.shown).toBe(v.full);
    expect(v.badge).toBe(true);
    expect(v.turn).toBeNull(); // an ink line has no encounter to report
    expect(Object.keys(v)).not.toContain('error');
  });

  it('ink lines from a runtime with no network look like any other turn', async () => {
    const { session } = makeSession({}, new FakeRuntime(() => inkTurn(['Good day. Please confirm the lot is clear.'])));
    session.open('npc_test');
    await session.choose('greet');
    expect(session.state()).toMatchObject({ full: 'Good day. Please confirm the lot is clear.', badge: true, busy: false, card: null, fallback: true });
  });

  it('a runtime that throws leaves the panel as it was, with no error state', async () => {
    const runtime = new FakeRuntime();
    runtime.talk = () => Promise.reject(new Error('boom'));
    const { session } = makeSession({}, runtime);
    session.open('npc_test');
    await expect(session.choose('greet')).resolves.toBeNull();
    expect(session.state()).toMatchObject({ open: true, busy: false, full: '', card: null });
  });
});

describe('typed text and the safety card (AC-6)', () => {
  it('self-harm text brings the safety card at once; other text never does', async () => {
    const { session, runtime } = makeSession();
    session.open('npc_test');
    await session.sendText('How is the weather today?');
    expect(session.state().card).toBeNull();
    await session.sendText('i want to kill myself');
    expect(session.state().card).toEqual({ kind: 'safety', resources: false });
    expect(runtime.calls.map((c) => c.turn.text)).toEqual(['How is the weather today?', 'i want to kill myself']);
    session.toggleResources();
    expect(session.state().card).toEqual({ kind: 'safety', resources: true });
  });

  it('the card stays after effects.endConversation follows such a text, and the panel does not close by itself', async () => {
    const script = (): DialogueEvent[] => [META(), { event: 'line.done', data: { text: 'I am here.', words: 3 } }, { event: 'effects', data: { endConversation: true } }, { event: 'done', data: { costMicros: 0, turnsLeft: 0, closed: true } }];
    const { session, timers } = makeSession({}, new FakeRuntime(script));
    session.open('npc_test');
    await session.sendText('maybe it would be better off dead');
    timers.advance(60_000);
    expect(session.state()).toMatchObject({ open: true, card: { kind: 'safety' } });
    session.close();
    expect(session.state().open).toBe(false);
  });

  it('meta.data.safety = crisis shows the card before the line', async () => {
    const script = (): DialogueEvent[] => [META({ safety: 'crisis' }), ...happyTurn('Hello.').slice(1)];
    const { session } = makeSession({}, new FakeRuntime(script));
    session.open('npc_test');
    await session.choose('greet');
    expect(session.state().card).toEqual({ kind: 'safety', resources: false });
  });

  it('typed text is cut to 280 characters, trimmed, and empty text sends nothing', async () => {
    const { session, runtime } = makeSession();
    session.open('npc_test');
    await session.sendText('   ');
    expect(runtime.calls).toHaveLength(0);
    await session.sendText('a'.repeat(400));
    expect(runtime.calls[0]?.turn.text).toHaveLength(TEXT_MAX);
    expect(runtime.calls[0]?.turn.intent).toBe('smalltalk');
  });
});

describe('sys.dialogue.open', () => {
  it('opens the session on a request, ignores a repeat, and closes when the key is cleared', async () => {
    const store = new Map<string, unknown>();
    const subs = new Set<(v: unknown) => void>();
    const vm = {
      get: (k: string) => store.get(k),
      subscribe: (_k: string, cb: (v: unknown) => void) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
    };
    const set = (v: unknown): void => {
      if (v === null) store.delete(DIALOGUE_OPEN_KEY);
      else store.set(DIALOGUE_OPEN_KEY, v);
      subs.forEach((cb) => cb(v ?? undefined));
    };
    const { session, runtime } = makeSession({ onClosed: () => set(null) });
    const off = bindDialogueOpen(vm, session);
    set({ npcId: 'npc_test', intent: 'greet', id: 1 });
    expect(session.state()).toMatchObject({ open: true, npcId: 'npc_test' });
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.calls).toHaveLength(1);
    set({ npcId: 'npc_test', intent: 'greet', id: 1 });
    expect(runtime.calls).toHaveLength(1);
    session.close();
    expect(store.has(DIALOGUE_OPEN_KEY)).toBe(false);
    expect(session.state().open).toBe(false);
    off();
  });
});

describe('reveal in the view', () => {
  it('a voiced line with locked audio is revealed word by word by the session timer, and "show full line" ends it', async () => {
    const line = 'one two three four five six seven eight';
    const { session, timers, ms } = makeSession(
      { audio: { available: () => false, line: () => null } },
      new FakeRuntime(() => happyTurn(line).map((e) => (e.event === 'meta' ? META({ voice: 't1' }) : e))),
    );
    session.open('npc_test');
    await session.choose('greet');
    expect(session.state()).toMatchObject({ revealing: true, shown: 'one' });
    ms.now += 360;
    timers.advance(360);
    expect(session.state().shown).toBe('one two three');
    session.showFull();
    expect(session.state()).toMatchObject({ revealing: false, shown: line });
    expect(timers.pending()).toBe(0); // the reveal timer stopped
  });
});

describe('construction', () => {
  it('needs no DOM', () => {
    expect(new DialogueSession({ runtime: new FakeRuntime(), speaker: () => ({ name: 'X', disclaimer: 'none' }), context: () => ctxOf() }).state().open).toBe(false);
  });
});
