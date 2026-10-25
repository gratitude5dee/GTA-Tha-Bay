/**
 * M06a5 AC-3: the reveal rule. Text never runs ahead of its audio; with voice off the whole line shows at once; the line is never held for good.
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIO_GRACE_MS, LineReveal, TIMER_WORD_MS, audioWords, firstWords, timerWords, wordCount, type AudioClockPort, type AudioLineClock,
} from '../../src/dialogue/reveal.ts';

const LINE_20 = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';

/** A fake audio side: a 2.0 s window that starts at 0, read at a clock the test moves. */
function fakeAudio(over: Partial<AudioLineClock> = {}): { port: AudioClockPort; clock: { nowS: number }; ended: { v: boolean }; locked: { v: boolean } } {
  const clock = { nowS: 0 };
  const ended = { v: false };
  const locked = { v: false };
  const port: AudioClockPort = {
    available: () => !locked.v,
    line: () => (ended.v ? null : { startS: 0, endS: 2, nowS: clock.nowS, complete: true, ...over }),
  };
  return { port, clock, ended, locked };
}

describe('words', () => {
  it('counts words, keeps spacing in a prefix, and has no trailing space', () => {
    expect(wordCount(LINE_20)).toBe(20);
    expect(wordCount('')).toBe(0);
    expect(firstWords('Hello  there, friend', 2)).toBe('Hello  there,');
    expect(firstWords('Hello there', 0)).toBe('');
    expect(firstWords('Hello there ', 9)).toBe('Hello there');
  });
});

describe('audio reveal (AC-3)', () => {
  it('a 20-word line over 2.0 s of audio: at most 30 % of the words at 0.5 s, all of them at 2.0 s', () => {
    const a = fakeAudio();
    let ms = 0;
    const r = new LineReveal({ npcId: 'n', nowMs: () => ms, audio: a.port });
    r.feed(LINE_20, true); // one delta carries the whole line
    a.clock.nowS = 0.5;
    const early = r.tick();
    expect(early.mode).toBe('audio');
    expect(early.revealed / early.total).toBeLessThanOrEqual(0.3);
    expect(early.caughtUp).toBe(false);
    a.clock.nowS = 1.0;
    expect(r.tick().revealed).toBe(10);
    a.clock.nowS = 2.0;
    const end = r.tick();
    expect(end.revealed).toBe(20);
    expect(end.shown).toBe(LINE_20);
    expect(end.caughtUp).toBe(true);
    ms += 10;
  });

  it('with voice off the whole line shows at once', () => {
    const a = fakeAudio();
    const r = new LineReveal({ npcId: 'n', nowMs: () => 0, audio: a.port });
    r.feed(LINE_20, false);
    const f = r.tick();
    expect(f.mode).toBe('instant');
    expect(f.shown).toBe(LINE_20);
  });

  it('while sentences are still arriving, the first one cannot reveal the rest (the window is at least a speaking-rate estimate)', () => {
    const clock: AudioLineClock = { startS: 0, endS: 0.8, nowS: 0.8, complete: false };
    // 20 words at 2.5 words/s need 8 s; 0.8 s of audio so far reveals 10 %
    expect(audioWords(20, clock)).toBe(2);
    expect(audioWords(20, { ...clock, complete: true })).toBe(20);
  });

  it('the count never shrinks when the audio window grows', () => {
    let window: AudioLineClock = { startS: 0, endS: 1, nowS: 1, complete: true };
    const port: AudioClockPort = { available: () => true, line: () => window };
    const r = new LineReveal({ npcId: 'n', nowMs: () => 0, audio: port });
    r.feed(LINE_20, true);
    const first = r.tick().revealed;
    expect(first).toBe(20);
    window = { startS: 0, endS: 10, nowS: 1, complete: false };
    expect(r.tick().revealed).toBe(20);
  });

  it('once the audio has played out the rest of the line shows', () => {
    const a = fakeAudio({ complete: false, endS: 1 });
    const r = new LineReveal({ npcId: 'n', nowMs: () => 0, audio: a.port });
    r.feed(LINE_20, true);
    a.clock.nowS = 0.1;
    expect(r.tick().caughtUp).toBe(false);
    a.ended.v = true; // TtsPlayer drops the line when it has finished
    expect(r.tick()).toMatchObject({ mode: 'instant', caughtUp: true });
  });

  it('"show full line" ends the wait', () => {
    const a = fakeAudio();
    const r = new LineReveal({ npcId: 'n', nowMs: () => 0, audio: a.port });
    r.feed(LINE_20, true);
    a.clock.nowS = 0.1;
    expect(r.tick().caughtUp).toBe(false);
    r.showAll();
    expect(r.tick()).toMatchObject({ revealed: 20, caughtUp: true });
  });
});

describe('text-speed fallback', () => {
  it('a voiced line with audio still locked reveals a word every 180 ms, first word at once', () => {
    const a = fakeAudio();
    a.locked.v = true;
    let ms = 0;
    const r = new LineReveal({ npcId: 'n', nowMs: () => ms, audio: a.port });
    r.feed(LINE_20, true);
    expect(r.tick()).toMatchObject({ mode: 'timer', revealed: 1 });
    ms = TIMER_WORD_MS * 4;
    expect(r.tick().revealed).toBe(5);
    ms = TIMER_WORD_MS * 40;
    expect(r.tick()).toMatchObject({ revealed: 20, caughtUp: true });
    expect(timerWords(20, 0)).toBe(1);
  });

  it('a voiced line waits for its first audio, then stops waiting: it is never hidden for good', () => {
    const port: AudioClockPort = { available: () => true, line: () => null };
    let ms = 0;
    const r = new LineReveal({ npcId: 'n', nowMs: () => ms, audio: port });
    r.feed(LINE_20, true);
    expect(r.tick()).toMatchObject({ mode: 'hold', revealed: 0 });
    ms = AUDIO_GRACE_MS + 1;
    expect(r.tick()).toMatchObject({ mode: 'timer', revealed: 1 });
  });

  it('no audio port at all behaves like locked audio for a voiced line, and like instant for a text line', () => {
    const r = new LineReveal({ npcId: 'n', nowMs: () => 0 });
    r.feed(LINE_20, true);
    expect(r.tick().mode).toBe('timer');
    const t = new LineReveal({ npcId: 'n', nowMs: () => 0 });
    t.feed(LINE_20, false);
    expect(t.tick().mode).toBe('instant');
  });
});

describe('streamed text', () => {
  it('shows text as it arrives when voice is off', () => {
    const r = new LineReveal({ npcId: 'n', nowMs: () => 0 });
    r.feed('Good', false);
    expect(r.tick().shown).toBe('Good');
    r.feed('Good day', false);
    expect(r.tick().shown).toBe('Good day');
  });
});
