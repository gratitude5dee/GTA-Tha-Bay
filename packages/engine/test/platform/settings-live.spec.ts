import { describe, expect, it } from 'vitest';
import { RendererHost, pixelRatioFor } from '../../src/platform/renderer-host.ts';
import { FpsFeed } from '../../src/platform/perf/fps-feed.ts';
import { effectiveRenderScale } from '../../src/platform/render-scale.ts';
import { DEFAULT_SETTINGS, createMemoryStore, normalizeSettings } from '../../src/platform/platform-store.ts';
import { TIERS } from '../../src/platform/tier-config.ts';
import { fakeFactory, type FakeRenderer } from './fakes.ts';

describe('effectiveRenderScale (M04b5 AC-1)', () => {
  it('auto plays at full size and lets the backdrop run softer', () => {
    expect(effectiveRenderScale('auto', true, 0.6)).toBe(1);
    expect(effectiveRenderScale('auto', false, 0.6)).toBe(0.6);
  });
  it('a fixed value applies in play, and the backdrop never exceeds it', () => {
    expect(effectiveRenderScale(0.5, true, 0.6)).toBe(0.5);
    expect(effectiveRenderScale(0.8, false, 0.6)).toBe(0.6);
    expect(effectiveRenderScale(0.5, false, 0.6)).toBe(0.5);
    expect(effectiveRenderScale(1, true, 0.6)).toBe(1);
  });
});

describe('RendererHost.resize with a render scale (M04b5 AC-1)', () => {
  it('sets the pixel ratio to pixelRatioFor under the tier caps, and never above them', async () => {
    const factory = fakeFactory();
    const canvas = { clientWidth: 1200, clientHeight: 800, width: 1200, height: 800 } as unknown as HTMLCanvasElement;
    const h = new RendererHost({
      canvas,
      createRenderer: factory.create,
      cloneCanvas: (c) => c,
      events: { gpuError: () => undefined, unsupported: () => undefined, reloadPrompt: () => undefined },
    });
    const tier = TIERS['mobile-low'];
    await h.init(tier);
    h.tier = tier;
    const ratios: number[] = [];
    const renderer = factory.state.renderers[0] as FakeRenderer;
    (renderer as unknown as { setPixelRatio(r: number): void }).setPixelRatio = (r: number) => void ratios.push(r);
    const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    h.resize(1200, 800, 0.5);
    h.resize(1200, 800, 1);
    expect(ratios[0]).toBeCloseTo(pixelRatioFor(tier, 1200, 800, dpr, 0.5), 9);
    expect(ratios[1]).toBeCloseTo(pixelRatioFor(tier, 1200, 800, dpr, 1), 9);
    expect(ratios[0] as number).toBeLessThanOrEqual(ratios[1] as number);
    // The scale multiplies the tier cap: at a 3x display the full-scale ratio is capped by the tier, the half scale is half of that.
    expect(pixelRatioFor(tier, 400, 800, 3, 0.5)).toBeCloseTo(0.625, 6);
    expect(pixelRatioFor(tier, 400, 800, 3, 1)).toBeCloseTo(1.25, 6);
  });
});

describe('FpsFeed (M04b5 AC-1)', () => {
  it('reports about 60 fps for 16.7 ms frames, at most once per 1000 ms of fed time', () => {
    const out: Array<{ at: number; fps: number }> = [];
    let at = 0;
    const feed = new FpsFeed((s) => out.push({ at, fps: s.fps }));
    for (at = 0; at <= 3500; at += 16.7) feed.before(at);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(4);
    for (const s of out) expect(s.fps).toBe(60);
    for (let i = 1; i < out.length; i++) expect((out[i] as { at: number }).at - (out[i - 1] as { at: number }).at).toBeGreaterThanOrEqual(1000);
  });
  it('is not thrown by one long frame (the median) and reports whole numbers', () => {
    const out: number[] = [];
    const feed = new FpsFeed((s) => out.push(s.fps));
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += i === 50 ? 400 : 20;
      feed.before(t);
    }
    expect(out.length).toBeGreaterThan(0);
    for (const f of out) {
      expect(Number.isInteger(f)).toBe(true);
      expect(f).toBe(50);
    }
  });
  it('says nothing before it has an interval', () => {
    const out: number[] = [];
    const feed = new FpsFeed((s) => out.push(s.fps));
    feed.before(100);
    expect(out).toEqual([]);
  });
});

describe('PlatformSettings keep unknown fields (M04b5 AC-9)', () => {
  it('a field a newer build wrote survives normalize, a change of one known field and a store round-trip', async () => {
    const raw = { ...DEFAULT_SETTINGS, futureKnob: 3 };
    const n = normalizeSettings(raw) as unknown as Record<string, unknown>;
    expect(n['futureKnob']).toBe(3);
    const changed = { ...n, renderScale: 0.5 };
    const store = createMemoryStore();
    await store.putSettings(changed as never);
    const back = (await store.getSettings()) as unknown as Record<string, unknown>;
    expect(back['futureKnob']).toBe(3);
    expect(back['renderScale']).toBe(0.5);
  });
  it('a record with another version reads as the defaults', () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, v: 2, futureKnob: 3 })).toEqual(DEFAULT_SETTINGS);
  });
});
