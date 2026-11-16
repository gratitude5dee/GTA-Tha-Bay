import { describe, expect, it } from 'vitest';
import { FramePacer } from '../../src/platform/governor/frame-pacer.ts';

/** The rAF timestamps of a display at `hz` for `n` callbacks, starting at `t0`. */
const stamps = (hz: number, n: number, t0 = 1000): number[] => Array.from({ length: n }, (_, i) => t0 + (i * 1000) / hz);

/** Timestamps of the callbacks the pacer rendered. */
function renderedAt(p: FramePacer, ts: number[]): number[] {
  return ts.filter((t) => p.shouldRender(t));
}

describe('FramePacer (AC-4)', () => {
  it('renders every 2nd callback of a 60 Hz display at a 30 fps target, within 1 ms of 33.3 ms', () => {
    const p = new FramePacer(30);
    const ts = stamps(60, 120);
    const out = renderedAt(p, ts);
    expect(out).toHaveLength(60);
    for (let i = 1; i < out.length; i++) expect(Math.abs((out[i] as number) - (out[i - 1] as number) - 1000 / 30)).toBeLessThanOrEqual(1);
    expect(ts.indexOf(out[1] as number)).toBe(2);
  });

  it('renders every 3rd callback of a 90 Hz display at a 30 fps target', () => {
    const p = new FramePacer(30);
    const ts = stamps(90, 180);
    const out = renderedAt(p, ts);
    expect(out).toHaveLength(60);
    for (let i = 1; i < out.length; i++) expect(Math.abs((out[i] as number) - (out[i - 1] as number) - 1000 / 30)).toBeLessThanOrEqual(1);
    expect(ts.indexOf(out[1] as number)).toBe(3);
  });

  it('renders every callback of a 60 Hz display at a 60 fps target, also with 0.4 ms of jitter', () => {
    const p = new FramePacer(60);
    const jitter = stamps(60, 300).map((t, i) => t + (i % 2 === 0 ? 0.4 : -0.4));
    expect(renderedAt(p, jitter)).toHaveLength(300);
  });

  it('holds 60 fps on a 144 Hz display on average (not 48)', () => {
    const p = new FramePacer(60);
    const ts = stamps(144, 1440);
    const n = renderedAt(p, ts).length;
    expect(n).toBeGreaterThanOrEqual(595);
    expect(n).toBeLessThanOrEqual(605);
  });

  it('renders every callback while XR presents, and the same callbacks resume pacing afterwards', () => {
    const p = new FramePacer(30);
    p.setBypass(true);
    expect(renderedAt(p, stamps(90, 90))).toHaveLength(90);
    p.setBypass(false);
    expect(renderedAt(p, stamps(60, 60, 5000))).toHaveLength(30);
  });

  it('restarts after a stall instead of bursting', () => {
    const p = new FramePacer(30);
    expect(p.shouldRender(0)).toBe(true);
    expect(p.shouldRender(2000)).toBe(true); // a 2 s gap renders at once
    expect(p.shouldRender(2016.7)).toBe(false);
    expect(p.shouldRender(2033.3)).toBe(true);
  });

  it('follows a new target and ignores an invalid one', () => {
    const p = new FramePacer(60);
    p.setTarget(30);
    expect(p.targetFps).toBe(30);
    p.setTarget(0);
    p.setTarget(Number.NaN);
    expect(p.targetFps).toBe(30);
    expect(p.intervalMs).toBeCloseTo(33.33, 1);
  });

  it('an XR session (min of the tier target and the player cap is not applied) is the caller job: min(tier, cap) feeds setTarget', () => {
    const p = new FramePacer(Math.min(60, 30));
    expect(renderedAt(p, stamps(60, 60))).toHaveLength(30);
  });
});
