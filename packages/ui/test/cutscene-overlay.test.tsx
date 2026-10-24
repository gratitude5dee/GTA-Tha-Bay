import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UiCommand } from '@dv/shared';
import { overlayView, SkipController, type OverlayShow, type PointerLike, type SkipSource } from '../src/cutscene/CutsceneOverlay.tsx';
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

  it('a tap is a press that began on the overlay while it showed and ends there; an earlier press let go over it is not (BD-FU-B03)', () => {
    const sent: UiCommand[] = [];
    const sources: SkipSource[] = [];
    const c = new SkipController((cmd) => sent.push(cmd), (s) => sources.push(s));
    const up = (pointerId: number, over: Partial<PointerLike> = {}): PointerLike => ({ type: 'pointerup', pointerType: 'mouse', isTrusted: true, pointerId, ...over });
    const down = (pointerId: number, over: Partial<PointerLike> = {}): PointerLike => ({ type: 'pointerdown', pointerType: 'mouse', isTrusted: true, pointerId, button: 0, ...over });

    // a press from before the showing (the click that started the game, a finger on the touch stick) is let go over the overlay
    c.pointerDown(down(1));
    c.reset();
    c.pointerUp(up(1));
    // a release with no press at all, another pointer's release, a cancelled press, a secondary button, and script-made events
    c.pointerUp(up(2));
    c.pointerDown(down(3));
    c.pointerUp(up(4));
    c.pointerCancel({ type: 'pointercancel', pointerId: 3 });
    c.pointerUp(up(3));
    c.pointerDown(down(5, { button: 2 }));
    c.pointerUp(up(5));
    c.pointerDown(down(6, { isTrusted: false }));
    c.pointerUp(up(6));
    c.pointerDown(down(7));
    c.pointerUp(up(7, { isTrusted: false }));
    expect(sent).toHaveLength(0);

    // a whole tap on the overlay skips, once
    c.reset();
    c.pointerDown(down(8, { pointerType: 'touch' }));
    c.pointerUp(up(8, { pointerType: 'touch' }));
    c.pointerDown(down(9));
    c.pointerUp(up(9));
    expect(sent).toEqual([{ t: 'cutscene.skip' }]);
    expect(sources).toEqual([{ input: 'tap', event: 'pointerup', pointerType: 'touch', trusted: true, pointerId: 8 }]);
  });

  it('Escape skips on a fresh, trusted press only, and every skip names its input', () => {
    const sent: UiCommand[] = [];
    const sources: SkipSource[] = [];
    const c = new SkipController((cmd) => sent.push(cmd), (s) => sources.push(s));
    c.reset();
    c.key({ key: 'Escape', repeat: true, isTrusted: true });
    c.key({ key: 'Escape', isTrusted: false });
    expect(sent).toHaveLength(0);
    c.key({ key: 'Escape', repeat: false, isTrusted: true });
    expect(sources).toEqual([{ input: 'key', event: 'keydown', trusted: true }]);
    c.reset();
    c.pad([false, false]);
    c.pad([false, true]);
    c.reset();
    c.button({ event: 'click', trusted: true });
    expect(sources.map((s) => s.input)).toEqual(['key', 'pad', 'button']);
    expect(sent).toHaveLength(3);
  });
});
