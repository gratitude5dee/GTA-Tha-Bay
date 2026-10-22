import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UiCommand } from '@dv/shared';
import { overlayView, SkipController, type OverlayShow } from '../src/cutscene/CutsceneOverlay.tsx';
import { activeCue, cueHoldMs, cueLeavesAtMs, parseVtt } from '../src/cutscene/subtitles.ts';

const repo = path.resolve(import.meta.dirname, '../../..');
const vtt = readFileSync(path.join(repo, 'tests/fixtures/cutscenes/fixture-a/subs.en.vtt'), 'utf8');

describe('subtitles (AC-4)', () => {
  const cues = parseVtt(vtt);

  it('parses the two cues of the fixture', () => {
    expect(cues).toEqual([
      { startMs: 500, endMs: 3500, text: 'Fixture A, first cue.' },
      { startMs: 4000, endMs: 7500, text: 'Fixture A, second cue.' },
    ]);
  });

  it('holds a cue for at least max(1.5 s, 0.06 s x characters) and never shows it before its start', () => {
    expect(cueHoldMs('abc')).toBe(1500);
    expect(cueHoldMs('x'.repeat(50))).toBe(3000);
    const short = { startMs: 1000, endMs: 1200, text: 'Hi' };
    expect(activeCue([short], 999)).toBeNull();
    expect(activeCue([short], 1000)?.text).toBe('Hi');
    expect(activeCue([short], 2499)?.text).toBe('Hi');
    expect(activeCue([short], 2500)).toBeNull();
    const long = { startMs: 0, endMs: 100, text: 'x'.repeat(100) };
    expect(cueLeavesAtMs(long)).toBe(6000);
    // a cue whose own end is later than the minimum keeps its end
    expect(cueLeavesAtMs({ startMs: 0, endMs: 9000, text: 'ok' })).toBe(9000);
  });

  it('each fixture cue is visible for its whole listed time and nothing shows in the gap', () => {
    expect(activeCue(cues, 0)).toBeNull();
    expect(activeCue(cues, 1000)?.text).toBe('Fixture A, first cue.');
    expect(activeCue(cues, 3499)?.text).toBe('Fixture A, first cue.');
    expect(activeCue(cues, 3700)).toBeNull();
    expect(activeCue(cues, 4500)?.text).toBe('Fixture A, second cue.');
  });

  it('skips malformed blocks and strips tags', () => {
    expect(parseVtt('WEBVTT\n\nnot a cue\n\n00:00:01.000 --> 00:00:00.500\nbackwards\n\n1\n00:01.000 --> 00:02.000 align:start\n<v Bo>Hello</v>\n')).toEqual([
      { startMs: 1000, endMs: 2000, text: 'Hello' },
    ]);
  });
});

describe('CutsceneOverlay (AC-4)', () => {
  const cues = parseVtt(vtt);

  it('shows the AI chip for the whole clip when the manifest says aiGenerated, and none for a cue-only in-engine sequence', () => {
    const video: OverlayShow = { aiGenerated: true, cues };
    for (const t of [0, 1000, 5000, 7999, 8000]) expect(overlayView(video, t).chip).toBe(true);
    const inEngine: OverlayShow = { aiGenerated: false, cues };
    for (const t of [0, 1000, 5000]) expect(overlayView(inEngine, t).chip).toBe(false);
    expect(overlayView({ aiGenerated: false, credit: 'x', cues }, 0).credit).toBeNull();
    expect(overlayView({ aiGenerated: true, credit: 'credit', cues }, 0).credit).toBe('credit');
  });

  it('Escape, gamepad B and a tap each send exactly one cutscene.skip', () => {
    const sent: UiCommand[] = [];
    const c = new SkipController((cmd) => sent.push(cmd));
    c.reset();
    c.key({ key: 'Enter' });
    expect(sent).toHaveLength(0);
    c.key({ key: 'Escape' });
    c.key({ key: 'Escape' });
    c.tap();
    expect(sent).toEqual([{ t: 'cutscene.skip' }]);

    sent.length = 0;
    c.reset();
    c.pad([false, true]); // B held when the clip starts: not a press
    c.pad([false, false]);
    expect(sent).toHaveLength(0);
    c.pad([false, true]);
    c.pad([false, true]);
    c.pad([false, false]);
    c.pad([false, true]);
    expect(sent).toEqual([{ t: 'cutscene.skip' }]);

    sent.length = 0;
    c.reset();
    c.tap();
    c.tap();
    expect(sent).toEqual([{ t: 'cutscene.skip' }]);
  });
});
