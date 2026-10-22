import { describe, expect, it } from 'vitest';
import { FB, fromInputFrame } from '@dv/shared/fight';
import { createScriptDriver, scriptFrames } from '../src/qa/script-driver.ts';

describe('fighter.script driver', () => {
  it('seed 7 produces the same 600 InputFrames twice, on the bot device', () => {
    const a = createScriptDriver({ seed: 7 }), b = createScriptDriver({ seed: 7 });
    expect(a.device).toBe('bot');
    const fa = Array.from({ length: 600 }, (_, t) => a.frame(t)), fb = Array.from({ length: 600 }, (_, t) => b.frame(t));
    expect(fa).toEqual(fb);
    for (const f of fa) { expect(f.device).toBe(7); expect(f.context).toBe(2); }
  });
  it('a different seed gives a different stream, and the stream is not trivial', () => {
    const a = scriptFrames(7, 600), b = scriptFrames(8, 600);
    expect(a).not.toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(10);
    expect(a.some((w) => (w & FB.LP) !== 0)).toBe(true);
  });
  it('fromInputFrame gives back the scripted word', () => {
    const d = createScriptDriver({ seed: 7, length: 600 });
    for (let t = 0; t < 600; t++) expect(fromInputFrame(d.frame(t))).toBe(d.word(t) & ~((d.word(t) & FB.Left) !== 0 && (d.word(t) & FB.Right) !== 0 ? FB.Left | FB.Right : 0));
  });
  it('an explicit script plays back and ends neutral', () => {
    const d = createScriptDriver({ seed: 0, script: [FB.LP, FB.Right, 0] });
    expect(fromInputFrame(d.frame(0))).toBe(FB.LP);
    expect(fromInputFrame(d.frame(1))).toBe(FB.Right);
    expect(fromInputFrame(d.frame(2))).toBe(0);
    expect(fromInputFrame(d.frame(500))).toBe(0);
    expect(d.length).toBe(3);
  });
  it('mirrors the generated motions for a bot on the right', () => {
    const l = scriptFrames(7, 600, 1), r = scriptFrames(7, 600, -1);
    expect(l).not.toEqual(r);
    const swap = (w: number): number => (w & ~(FB.Left | FB.Right)) | ((w & FB.Left) !== 0 ? FB.Right : 0) | ((w & FB.Right) !== 0 ? FB.Left : 0);
    expect(r.map((w) => swap(w))).toEqual(l);
  });
});
