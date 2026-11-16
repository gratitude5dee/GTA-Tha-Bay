import { describe, expect, it } from 'vitest';
import type { NpcRuntime } from '../src/client/runtime.ts';
import { SUBTITLE_RECORD_MAX, installNpcBridge, subtitleRecorder, type DebugSubtitleCue } from '../src/debug/overlay.ts';

/**
 * The QA bridge's record of `hud.subtitle` cues (BD-FIX-DIALOGUE-SUBTITLE-01). A cue is on screen for max(1.5 s, 60 ms per character)
 * only, so the dialogue e2e reads `__dvBridge.npc.subtitles()` (every value the key took) instead of racing the clear with a poll.
 */
function key() {
  let listener: ((v: unknown) => void) | null = null;
  return {
    subscribe: (cb: (v: unknown) => void): (() => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    set: (v: unknown): void => listener?.(v),
    subscribed: (): boolean => listener !== null,
  };
}

const cue = (text: string, startMs = 0): DebugSubtitleCue => ({ speaker: 'Tester Nine', text, startMs, endMs: startMs + Math.max(1500, 60 * text.length) });

describe('subtitleRecorder', () => {
  it('keeps every cue as it was set, oldest first, and leaves the clears out', () => {
    const k = key();
    const rec = subtitleRecorder(k.subscribe);
    expect(k.subscribed()).toBe(true);
    k.set(cue('First line.', 10));
    k.set(undefined); // the store deletes the key: listeners hear undefined
    k.set(null);
    k.set(cue('Second line.', 20));
    expect(rec.cues()).toEqual([cue('First line.', 10), cue('Second line.', 20)]);
  });

  it('keeps a copy, so a cue that is cleared or changed later is still in the record as it was', () => {
    const k = key();
    const rec = subtitleRecorder(k.subscribe);
    const value = cue('Welcome to the lot.');
    k.set(value);
    value.text = 'changed';
    k.set(undefined);
    expect(rec.cues()).toEqual([cue('Welcome to the lot.')]);
  });

  it('keeps the newest cues only', () => {
    const k = key();
    const rec = subtitleRecorder(k.subscribe, 3);
    for (let i = 0; i < 5; i++) k.set(cue(`Line ${i}.`, i));
    expect(rec.cues().map((c) => c.text)).toEqual(['Line 2.', 'Line 3.', 'Line 4.']);
    expect(SUBTITLE_RECORD_MAX).toBe(100);
  });

  it('stops listening on stop()', () => {
    const k = key();
    const rec = subtitleRecorder(k.subscribe);
    rec.stop();
    expect(k.subscribed()).toBe(false);
    k.set(cue('Too late.'));
    expect(rec.cues()).toEqual([]);
  });
});

describe('installNpcBridge subtitles()', () => {
  const runtime = {} as NpcRuntime;

  it('hands out the page record', () => {
    const k = key();
    const rec = subtitleRecorder(k.subscribe);
    const target: { __dvBridge?: Record<string, unknown> } = {};
    const bridge = installNpcBridge(runtime, { subtitles: rec.cues }, target);
    k.set(cue('Welcome to the lot.'));
    expect(bridge.subtitles()).toEqual([cue('Welcome to the lot.')]);
    expect((target.__dvBridge?.['npc'] as typeof bridge).subtitles()).toEqual([cue('Welcome to the lot.')]);
  });

  it('is empty where the page has no view model', () => {
    const bridge = installNpcBridge(runtime, {}, {});
    expect(bridge.subtitles()).toEqual([]);
  });
});
