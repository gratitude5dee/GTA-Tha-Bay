/**
 * M05b2 AC-7 (the `beat` op with a cutscene ref: `cut.request`, armed fallback, identical mission state after the video path and the
 * fallback path) and AC-3 (a beat edited without a rev bump fails `missions:build`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DirectorScript, CutsceneRef } from '@dv/shared/contracts/c09-cutscene';
import type { SimEvent } from '@dv/shared';
import { Transform } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import { at, beat, circle, defineMission, npc, setFlag, stage, waitFor } from '../src/authoring/index.ts';
import { BEATS_LOCK_SCHEMA, beatDigest, beatRev, checkBeatsLock, updateBeatsLock, type BeatsLock } from '../src/cutscene/beat.ts';
import { CUT_ANSWER_TICKS, doneEvent, parseStateEvent, refsOfRequest, requestEvent, transition } from '../src/cutscene/protocol.ts';
import { ll, makeHarness, type Harness } from './harness.ts';

const SCRIPT: DirectorScript = {
  schema: 'director/1', id: 'd.cut', durationSec: 2, seed: 1,
  marks: { start: { at: { local: [5, 0, 5] }, yawDeg: 0 }, end: { at: { local: [30, 0, 40] }, yawDeg: 90 } },
  actors: [{ who: 'pal', start: 'start', end: 'end' }],
  shots: [{ atSec: 0, preset: 'establish', subject: 'player', lens: 'wide' }],
  actions: [], cues: [], xrVantage: { mark: 'start', yawDeg: 0 }, letterbox: true,
};

function mission() {
  return defineMission({
    id: 'm.t.cut',
    version: 1,
    district: 'd1',
    cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(10, 10)) }) },
    zones: { z: circle(...ll(50, 0), 5) },
    stages: [stage('a', [waitFor(600, { id: 'long' })])],
    threads: { b: [waitFor0(), beat({ cutscene: 'cut.story.t.cut' }), setFlag({ 't.after_beat': 1 })] },
  });
}
function waitFor0() {
  return setFlag({ 't.before_beat': 1 });
}

function rig(flags: { beats?: 'instant' } = {}): { h: Harness; events: SimEvent[] } {
  const h = makeHarness({
    directors: new Map([[SCRIPT.id, SCRIPT]]),
    cutscenes: new Map([['cut.story.t.cut', { fallback: SCRIPT.id }]]),
    flags,
  });
  const events: SimEvent[] = [];
  h.bus.on('*', (e) => void events.push(e));
  h.start(mission());
  return { h, events };
}

const answer = (h: Harness, msg: { playId: string; state: string; item?: number; trigger?: string }): void => {
  h.emit({ t: 'cutscene.state', tick: h.tickNo.n, s: JSON.stringify(msg) });
};
const palX = (h: Harness): number => {
  const e = h.rt.actors.handleOf('pal');
  const id = e === null ? null : h.ecs.resolve(e);
  return id === null ? NaN : (h.ecs.store(Transform).px[id] as number);
};
/** Steps until the beat has started (the thread runs on the first ticks). */
function untilBeat(h: Harness): void {
  for (let i = 0; i < 20 && !h.rt.beating; i++) h.step();
}
const flag = (h: Harness, k: string): unknown => h.story.flags[k];

describe('the beat op with a cutscene ref (AC-7)', () => {
  it('emits cut.request with the ref id and the play counter, and arms the fallback on that tick', () => {
    const { h, events } = rig();
    h.calls.camera.length = 0;
    untilBeat(h);
    const req = events.find((e) => e.t === 'cut.request');
    expect(req).toMatchObject({ t: 'cut.request', s: 'cut.story.t.cut', n: 1 });
    expect(refsOfRequest(req as SimEvent)).toEqual(['cut.story.t.cut']);
    // armed: actors at their start marks, the first shot published, the clock stands still
    expect(palX(h)).toBeCloseTo(5, 5);
    expect(h.calls.camera).toContain('direct');
    const clock = h.rt.clock;
    h.step(60);
    expect(h.rt.clock).toBe(clock);
    expect(h.rt.beating).toBe(true);
  });

  it('video then done and fallback then done leave the same mission state', () => {
    const runs = [
      (h: Harness): number => {
        answer(h, { playId: '1', state: 'video' });
        h.step(30);
        const mid = h.rt.clock;
        answer(h, { playId: '1', state: 'done' });
        h.step(1);
        return mid;
      },
      (h: Harness): number => {
        answer(h, { playId: '1', state: 'fallback', trigger: 'not_ready' });
        h.step(60);
        const mid = h.rt.clock;
        h.step(70);
        answer(h, { playId: '1', state: 'done' });
        h.step(1);
        return mid;
      },
    ];
    const result = runs.map((run) => {
      const { h, events } = rig();
      untilBeat(h);
      const clockAtRequest = h.rt.clock;
      h.step(1);
      const mid = run(h);
      // the mission clock did not advance during the beat
      expect(mid).toBe(clockAtRequest);
      expect(h.rt.beating).toBe(false);
      expect(events.some((e) => e.t === 'cut.done' && e.n === 1)).toBe(true);
      // end marks applied, the thread went on
      expect(palX(h)).toBeCloseTo(30, 5);
      expect(flag(h, 't.after_beat')).toBe(1);
      // bring both runs to the same mission clock before comparing
      while (h.rt.clock < 200) h.step();
      return h.rt.stateHash();
    });
    expect(result[0]).toBe(result[1]);
  });

  it('with no answer the sim answers fallback itself after the deadline: the mission never waits on the main thread', () => {
    const { h, events } = rig();
    untilBeat(h);
    h.step(CUT_ANSWER_TICKS - 2);
    expect(h.rt.beating).toBe(true);
    h.step(4);
    expect(h.rt.eventLog.some((e) => e.t === 'cut.state' && e.data['state'] === 'fallback' && e.data['trigger'] === 'not_ready')).toBe(true);
    // the script (2 s) runs, then the beat ends by itself and the done event is emitted
    h.step(130);
    expect(h.rt.beating).toBe(false);
    expect(events.some((e) => e.t === 'cut.done' && e.n === 1)).toBe(true);
    expect(flag(h, 't.after_beat')).toBe(1);
    expect(palX(h)).toBeCloseTo(30, 5);
  });

  it('video stands the script still; a later fallback runs it from its start', () => {
    const { h } = rig();
    untilBeat(h);
    answer(h, { playId: '1', state: 'video' });
    h.step(300);
    expect(h.rt.beating).toBe(true);
    answer(h, { playId: '1', state: 'fallback', trigger: 'mid_stall' });
    h.step(100);
    expect(h.rt.beating).toBe(true);
    h.step(30);
    expect(h.rt.beating).toBe(false);
  });

  it('ignores a stale play id and answers that do not apply', () => {
    const { h } = rig();
    untilBeat(h);
    answer(h, { playId: '99', state: 'done' });
    h.step(1);
    expect(h.rt.beating).toBe(true);
    answer(h, { playId: '1', state: 'fallback' });
    h.step(1);
    answer(h, { playId: '1', state: 'video' }); // video after fallback does not apply
    h.step(1);
    expect(h.rt.eventLog.filter((e) => e.t === 'cut.state').map((e) => e.data['state'])).toEqual(['fallback', 'video']);
    h.step(125);
    expect(h.rt.beating).toBe(false);
  });

  it('?beats=instant completes the beat in one tick with end marks and no request', () => {
    const { h, events } = rig({ beats: 'instant' });
    h.step(3);
    expect(h.rt.beating).toBe(false);
    expect(events.some((e) => e.t === 'cut.request')).toBe(false);
    expect(palX(h)).toBeCloseTo(30, 5);
    expect(flag(h, 't.after_beat')).toBe(1);
  });

  it('a cutscene ref the runtime does not know plays as an instant beat (no fallback to arm)', () => {
    const h = makeHarness({ directors: new Map([[SCRIPT.id, SCRIPT]]) });
    const events: SimEvent[] = [];
    h.bus.on('*', (e) => void events.push(e));
    h.start(mission());
    h.step(3);
    expect(events.some((e) => e.t === 'cut.request')).toBe(false);
    expect(flag(h, 't.after_beat')).toBe(1);
  });
});

describe('protocol helpers', () => {
  it('encodes the request (empty field for a null item) and the done event', () => {
    expect(requestEvent(5, ['cut.a', null, 'cut.b'], 3)).toEqual({ t: 'cut.request', tick: 5, s: 'cut.a,,cut.b', n: 3 });
    expect(refsOfRequest({ s: 'cut.a,,cut.b' })).toEqual(['cut.a', null, 'cut.b']);
    expect(doneEvent(9, 3)).toEqual({ t: 'cut.done', tick: 9, n: 3 });
    expect(doneEvent(9, 3, 1)).toEqual({ t: 'cut.done', tick: 9, n: 3, s: '1' });
  });
  it('parses the cutscene.state event and rejects malformed ones', () => {
    expect(parseStateEvent({ t: 'cutscene.state', s: JSON.stringify({ playId: '4', item: 1, state: 'fallback', trigger: 'codec' }) })).toEqual({ playId: '4', item: 1, state: 'fallback', trigger: 'codec' });
    expect(parseStateEvent({ t: 'cutscene.state', s: 'nope' })).toBeNull();
    expect(parseStateEvent({ t: 'cutscene.state', s: JSON.stringify({ playId: 4, state: 'video' }) })).toBeNull();
    expect(parseStateEvent({ t: 'other', s: '{}' })).toBeNull();
  });
  it('transitions: video only from armed, fallback from armed or video, done always ends', () => {
    expect(transition('armed', 'video')).toBe('video');
    expect(transition('video', 'video')).toBeNull();
    expect(transition('fallback', 'video')).toBeNull();
    expect(transition('armed', 'fallback')).toBe('fallback');
    expect(transition('video', 'fallback')).toBe('fallback');
    expect(transition('fallback', 'fallback')).toBeNull();
    expect(transition('video', 'done')).toBe('ended');
    expect(transition('armed', 'done')).toBe('ended');
  });
});

describe('beats.lock (AC-3)', () => {
  const ref = (over: Partial<CutsceneRef> = {}): CutsceneRef => ({
    id: 'cut.story.x.one', hook: 'story.beat', template: 'story.beat@1', cast: [], stage: 'beat.cut.story.x.one@1', move: null,
    slots: { mood: 'calm' }, fallback: 'd', cues: [{ line: 'line.x.1', startMs: 0, endMs: 1000, kind: 'dialogue' }], audio: 'engine', prefetch: 'onTrigger', priority: 1, skippable: true, ...over,
  });
  const lockOf = (r: CutsceneRef): BeatsLock => ({ schema: BEATS_LOCK_SCHEMA, beats: { [r.id]: { rev: beatRev(r) as number, sha256: beatDigest(r) } } });

  it('passes when the lock matches', () => {
    expect(checkBeatsLock([ref()], lockOf(ref()))).toEqual([]);
  });
  it('a changed cue text without a rev bump fails and names the ref', () => {
    const lock = lockOf(ref());
    const edited = ref({ cues: [{ line: 'line.x.1', startMs: 0, endMs: 2000, kind: 'dialogue' }] });
    const problems = checkBeatsLock([edited], lock);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.ref).toBe('cut.story.x.one');
    expect(problems[0]?.message).toMatch(/without a rev bump/);
    expect(updateBeatsLock([edited], lock).problems[0]?.ref).toBe('cut.story.x.one');
  });
  it('a changed slot fails the same way; a rev bump needs a lock update; the update then passes', () => {
    const lock = lockOf(ref());
    const slot = ref({ slots: { mood: 'tense' } });
    expect(checkBeatsLock([slot], lock)[0]?.message).toMatch(/without a rev bump/);
    const bumped = ref({ slots: { mood: 'tense' }, stage: 'beat.cut.story.x.one@2' });
    expect(checkBeatsLock([bumped], lock)[0]?.message).toMatch(/not locked yet/);
    const up = updateBeatsLock([bumped], lock);
    expect(up.problems).toEqual([]);
    expect(checkBeatsLock([bumped], up.lock)).toEqual([]);
    expect(up.lock.beats['cut.story.x.one']?.rev).toBe(2);
  });
  it('a rev behind the lock, an unlocked ref, a stray lock entry and a stage that is not a beat stage all fail', () => {
    const lock = lockOf(ref({ stage: 'beat.cut.story.x.one@3' }));
    expect(checkBeatsLock([ref()], lock)[0]?.message).toMatch(/behind the lock/);
    expect(checkBeatsLock([ref()], { schema: BEATS_LOCK_SCHEMA, beats: {} })[0]?.message).toMatch(/not in content\/cutscenes\/beats.lock.json/);
    expect(checkBeatsLock([], lockOf(ref()))[0]?.message).toMatch(/no ref has this id/);
    expect(checkBeatsLock([ref({ stage: 'plain' })], lockOf(ref()))[0]?.message).toMatch(/stage must be beat\./);
    expect(beatRev(ref({ stage: 'beat.other@2' }))).toBeNull();
  });
  it('fight and race refs are not locked', () => {
    expect(checkBeatsLock([ref({ id: 'cut.fight.walkin.a.b', hook: 'fight.walkin', stage: 'stage.x@1' })], { schema: BEATS_LOCK_SCHEMA, beats: {} })).toEqual([]);
  });
  it('the lock file of the repository matches the shipped refs', async () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const lock = JSON.parse(readFileSync(path.join(root, 'content/cutscenes/beats.lock.json'), 'utf8')) as BeatsLock;
    const mod = (await import(path.join(root, 'content/story/dev/cutscene-refs.ts'))) as { default: CutsceneRef[] };
    expect(checkBeatsLock(mod.default, lock)).toEqual([]);
  });
});
