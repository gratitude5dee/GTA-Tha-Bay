import type { DynamicQuality, QualityTierId } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { DEMOTE_AFTER_MS, QualityGovernor, type GovernorChange } from '../../src/platform/governor/governor.ts';
import { KNOB_ORDER, allAtFloor, nextDown, nextUp, type KnobContext } from '../../src/platform/governor/knobs.ts';
import { FrameSignals } from '../../src/platform/governor/signals.ts';
import { QualityServiceImpl } from '../../src/platform/quality-service.ts';
import { TIERS } from '../../src/platform/tier-config.ts';
import { uaFixture } from './fakes.ts';
import { classifyDevice } from '@dv/shared';

/** The governor over a real QualityService; `frames(ms, seconds)` feeds a constant series and records every change. */
function rig(tier: QualityTierId = 'desktop', o: { xr?: boolean; pinned?: boolean; fpsCap?: number | null; safe?: boolean; postCap?: number } = {}) {
  const profile = classifyDevice(uaFixture('desktop-chrome'));
  const applied: string[] = [];
  const quality = new QualityServiceImpl({
    profile,
    backend: 'webgl2',
    initial: tier,
    safeAtStart: o.safe ?? true,
    apply: (next, prev, reason) => {
      applied.push(`${prev.id}>${next.id}:${reason}`);
    },
  });
  const changes: GovernorChange[] = [];
  const gov = new QualityGovernor({ quality, ...(o.postCap !== undefined ? { postLevelCap: o.postCap } : {}) });
  const origSet = quality.setDynamic.bind(quality);
  quality.setDynamic = (q: DynamicQuality) => {
    origSet(q);
    const c = gov.state().lastChange;
    if (c && changes[changes.length - 1] !== c) changes.push(c);
  };
  if (o.xr) gov.setXr(true);
  if (o.pinned) gov.setRenderScalePinned(true);
  if (o.fpsCap !== undefined) gov.setFpsCap(o.fpsCap);
  /** Feeds `ms` frames for `seconds` of governor time. */
  const feed = (ms: number, seconds: number): void => {
    const n = Math.round((seconds * 1000) / ms);
    for (let i = 0; i < n; i++) gov.frame(ms);
  };
  return { quality, gov, changes, applied, feed };
}

/** Lets the queued `setTier` promise chain run. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('FrameSignals', () => {
  it('keeps an EMA with alpha 0.06 and the nearest-rank p90 of the last 120 frames', () => {
    const s = new FrameSignals();
    s.push(10);
    expect(s.ema).toBe(10);
    s.push(20);
    expect(s.ema).toBeCloseTo(10 + 0.06 * 10, 10);
    s.reset();
    for (let i = 1; i <= 200; i++) s.push(i);
    // the last 120 frames are 81..200; rank ceil(0.9 x 120) = 108 -> 81 + 107
    expect(s.count).toBe(120);
    expect(s.p90()).toBe(188);
  });
});

describe('QualityGovernor (AC-1)', () => {
  it('lowers renderScale by one 10 % step after 2 s above budget x 1.15, and not before', () => {
    const { gov, feed } = rig();
    feed(20, 1.9);
    expect(gov.state().dynamic.renderScale).toBe(1);
    feed(20, 0.3);
    expect(gov.state().dynamic.renderScale).toBe(0.9);
    expect(gov.state().changes).toBe(1);
    expect(gov.state().lastChange).toMatchObject({ knob: 'renderScale', dir: 'down', from: 1, to: 0.9 });
  });

  it('does not react to a p90 at the budget, to a single spike, or to a frame of 500 ms or more', () => {
    const { gov, feed } = rig();
    feed(16.6, 5);
    for (let i = 0; i < 20; i++) {
      gov.frame(40);
      feed(16.6, 0.5);
    }
    gov.frame(900);
    expect(gov.state().changes).toBe(0);
  });

  it('upgrades only after 10 s below budget x 0.70, then waits 30 s for the next upgrade', () => {
    const { gov, feed } = rig();
    feed(20, 2.2); // one downgrade
    expect(gov.state().dynamic.renderScale).toBe(0.9);
    feed(20, 5.2); // second downgrade (5 s later)
    expect(gov.state().dynamic.renderScale).toBe(0.8);
    const t0 = gov.state().timeMs;
    feed(11, 9.5);
    expect(gov.state().dynamic.renderScale).toBe(0.8); // not yet: the window still held slow frames, then under for < 10 s
    feed(11, 3);
    expect(gov.state().dynamic.renderScale).toBe(0.9);
    const up1 = gov.state().lastChange as GovernorChange;
    expect(up1.dir).toBe('up');
    expect(up1.atMs - t0).toBeGreaterThanOrEqual(10_000);
    // the next upgrade is 30 s after this one, not 10 s
    feed(11, 20);
    expect(gov.state().dynamic.renderScale).toBe(0.9);
    feed(11, 11);
    expect(gov.state().dynamic.renderScale).toBe(1);
    const up2 = gov.state().lastChange as GovernorChange;
    expect(up2.atMs - up1.atMs).toBeGreaterThanOrEqual(30_000);
  });

  it('keeps 5 s between any two changes and 30 s between upgrades while the series oscillates every second', () => {
    const { feed, changes } = rig();
    feed(20, 8);
    for (let s = 0; s < 120; s++) feed(s % 2 === 0 ? 11 : 25, 1);
    feed(11, 60);
    const all = changes.length;
    expect(all).toBeGreaterThan(1);
    for (let i = 1; i < changes.length; i++) {
      const a = changes[i - 1] as GovernorChange;
      const b = changes[i] as GovernorChange;
      expect(b.atMs - a.atMs).toBeGreaterThanOrEqual(5000);
    }
    const ups = changes.filter((c) => c.dir === 'up');
    for (let i = 1; i < ups.length; i++) expect((ups[i] as GovernorChange).atMs - (ups[i - 1] as GovernorChange).atMs).toBeGreaterThanOrEqual(30_000);
  });

  it('moves the knobs in the 5.5 order, each to its floor, and publishes every change through onDynamicChange', () => {
    const { quality, gov, feed, changes } = rig('desktop');
    const seen: DynamicQuality[] = [];
    quality.onDynamicChange((q) => seen.push({ ...q }));
    feed(40, 155);
    const order = changes.filter((c) => c.dir === 'down').map((c) => KNOB_ORDER.indexOf(c.knob));
    expect(order.length).toBeGreaterThan(10);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const floor = TIERS.desktop.dynamic.floor;
    expect(gov.state().dynamic).toMatchObject({
      renderScale: floor.renderScale,
      shadowDistanceScale: floor.shadowDistanceScale,
      buildingDistanceScale: floor.buildingDistanceScale,
      lodBias: floor.lodBias,
      crowdDensity: floor.crowdDensity,
      postLevel: floor.postLevel,
      atmosphereLevel: floor.atmosphereLevel,
      textureMipBias: floor.textureMipBias,
      targetFps: floor.targetFps,
    });
    expect(seen.length).toBe(changes.length);
    // renderScale walked 1 -> 0.5 in tenths
    const rs = changes.filter((c) => c.knob === 'renderScale').map((c) => c.to);
    expect(rs).toEqual([0.9, 0.8, 0.7, 0.6, 0.5]);
  });

  it('restores in the reverse order when the frames recover', () => {
    const { gov, feed, changes } = rig('desktop');
    feed(40, 80); // down a few knobs
    const downs = changes.length;
    expect(downs).toBeGreaterThan(5);
    feed(8, 600);
    const ups = changes.filter((c) => c.dir === 'up');
    expect(ups.length).toBeGreaterThan(0);
    const downOrder = changes.filter((c) => c.dir === 'down').map((c) => KNOB_ORDER.indexOf(c.knob));
    const upOrder = ups.map((c) => KNOB_ORDER.indexOf(c.knob));
    expect(upOrder[0]).toBe(downOrder[downOrder.length - 1]);
    expect(gov.state().dynamic.renderScale).toBeLessThanOrEqual(1);
  });

  it('does nothing while disabled', () => {
    const { gov, feed } = rig();
    gov.setEnabled(false);
    feed(30, 20);
    expect(gov.state()).toMatchObject({ enabled: false, changes: 0 });
    expect(gov.state().dynamic.renderScale).toBe(1);
  });

  it('with xr never changes renderScale, records a next-entry framebuffer scale and works the other knobs', () => {
    const { gov, feed, changes } = rig('xr-quest', { xr: true });
    feed(20, 60);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.knob === 'renderScale')).toBe(false);
    expect(gov.state().dynamic.renderScale).toBe(1);
    const x = TIERS['xr-quest'].xr;
    expect(gov.state().nextEntryFramebufferScale).toBeLessThan(x?.framebufferScale ?? 0);
    expect(gov.state().nextEntryFramebufferScale).toBeGreaterThanOrEqual(x?.framebufferScaleNextEntryFloor ?? 1);
  });
});

describe('QualityGovernor tier demotion (AC-2)', () => {
  it('issues exactly one setTier(next, governor-demotion) after every knob sat at its floor for 20 s, at a safe point', async () => {
    const { quality, gov, feed, applied } = rig('desktop', { safe: false });
    for (let i = 0; i < 400 && gov.state().atFloorMs === 0; i++) feed(40, 1);
    expect(gov.state().atFloorMs).toBeGreaterThan(0);
    feed(40, DEMOTE_AFTER_MS / 1000 + 2);
    // no safe point yet: the governor holds the request
    expect(gov.state().demotionRequested).toBe(false);
    expect(applied).toEqual([]);
    quality.setSafePoint(true);
    feed(40, 4);
    await flush();
    expect(applied).toEqual(['desktop>mobile:governor-demotion']);
    expect(quality.tier.id).toBe('mobile');
    // the new tier starts at its ceiling and the series continues: exactly one request per tier
    feed(40, 4);
    expect(applied).toHaveLength(1);
  });

  it('follows FLAT_LADDER and never goes below mobile-low', async () => {
    const { quality, gov, feed, applied } = rig('mobile');
    feed(60, 200);
    await flush();
    expect(applied).toEqual(['mobile>mobile-low:governor-demotion']);
    feed(80, 200);
    await flush();
    expect(quality.tier.id).toBe('mobile-low');
    expect(applied).toHaveLength(1);
    expect(gov.state().demotionRequested).toBe(false);
  });

  it('does not demote while the frames are back under budget', async () => {
    const { feed, applied, gov } = rig('desktop');
    for (let i = 0; i < 400 && gov.state().atFloorMs === 0; i++) feed(40, 1);
    expect(gov.state().atFloorMs).toBeGreaterThan(0);
    feed(10, 40);
    await flush();
    expect(applied).toEqual([]);
  });

  it('never demotes an XR tier', async () => {
    const { feed, applied } = rig('xr-quest', { xr: true });
    feed(40, 300);
    await flush();
    expect(applied).toEqual([]);
  });
});

describe('QualityGovernor with player settings (AC-11)', () => {
  it('skips a pinned renderScale: the first downgrade moves the next knob in the 5.5 order', () => {
    const { gov, feed } = rig('desktop', { pinned: true });
    feed(25, 2.5);
    expect(gov.state().dynamic.renderScale).toBe(1);
    expect(gov.state().lastChange).toMatchObject({ knob: 'shadowDistanceScale', dir: 'down' });
    expect(gov.state().renderScalePinned).toBe(true);
  });

  it('with a pin and a 30 fps cap the budget is the cap\'s 33 ms: 25 ms frames are fine, 40 ms frames move shadowDistanceScale', () => {
    const { gov, feed } = rig('desktop', { pinned: true, fpsCap: 30 });
    feed(25, 5);
    expect(gov.state().changes).toBe(0);
    feed(40, 2.5);
    expect(gov.state().dynamic.renderScale).toBe(1);
    expect(gov.state().lastChange).toMatchObject({ knob: 'shadowDistanceScale', dir: 'down' });
  });

  it('holds targetFps under the cap: it is never raised, and the budget follows the cap', () => {
    const { gov, feed } = rig('desktop', { fpsCap: 30 });
    expect(gov.targetFps()).toBe(30);
    expect(gov.budgetMs()).toBeCloseTo(33.33, 1);
    // 25 ms frames are under the 33 ms budget of a 30 fps cap: nothing to do
    feed(25, 5);
    expect(gov.state().changes).toBe(0);
    expect(gov.state().dynamic.targetFps).toBe(60);
  });

  it('steps through postLevel only below the look cap', () => {
    const ceil = TIERS.desktop.dynamic.ceil;
    const ctx: KnobContext = { range: TIERS.desktop.dynamic, xr: false, renderScalePinned: true, fpsCap: null, postLevelCap: 2 };
    let q: DynamicQuality = { ...ceil, shadowDistanceScale: 0.5, buildingDistanceScale: 0.6, lodBias: 2, crowdDensity: 0.4 };
    const m = nextDown(q, ctx);
    expect(m).toMatchObject({ knob: 'postLevel', from: 3, to: 1 });
    q = { ...q, postLevel: 1 };
    expect(nextDown(q, ctx)).toMatchObject({ knob: 'postLevel', from: 1, to: 0 });
    expect(nextUp({ ...q, postLevel: 0 }, ctx)).toMatchObject({ knob: 'postLevel', to: 1 });
    expect(allAtFloor({ ...TIERS.desktop.dynamic.floor }, ctx)).toBe(true);
  });
});

describe('QualityGovernor live knobs (BD-M11a1-03)', () => {
  it('leaves a knob nothing consumes alone, keeps the order of the others, and floors without it', () => {
    const { gov, feed, changes } = rig('desktop');
    gov.setLiveKnobs(['renderScale', 'buildingDistanceScale', 'lodBias', 'crowdDensity', 'postLevel', 'atmosphereLevel', 'targetFps']);
    feed(40, 100);
    const knobs = [...new Set(changes.map((c) => c.knob))];
    expect(knobs).not.toContain('shadowDistanceScale');
    expect(knobs).not.toContain('textureMipBias');
    expect(knobs.slice(0, 3)).toEqual(['renderScale', 'buildingDistanceScale', 'lodBias']);
    expect(gov.state().dynamic.shadowDistanceScale).toBe(1);
    expect(gov.state().dynamic.textureMipBias).toBe(0);
  });
});
