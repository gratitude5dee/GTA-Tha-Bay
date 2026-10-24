import { C13_VERSION, classifyDevice, type DeviceProfile, type QualityTierId } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/platform/platform-store.ts';
import { NO_QA_FLAGS, parseQaFlags, type QaFlags } from '../../src/platform/qa-flags.ts';
import { TierSelector, benchmarkPasses, type RunBenchmark } from '../../src/platform/tier-select.ts';
import { TIERS } from '../../src/platform/tier-config.ts';
import { fakeBenchmark, uaFixture } from './fakes.ts';

const desktop: DeviceProfile = classifyDevice(uaFixture('desktop-chrome'));
const iphone: DeviceProfile = classifyDevice(uaFixture('iphone-safari'));

function selector(o: {
  profile?: DeviceProfile;
  build?: string;
  qa?: Pick<QaFlags, 'enabled' | 'tier'>;
  store?: ReturnType<typeof createMemoryStore>;
  p90?: Partial<Record<QualityTierId, number>>;
  calls?: string[];
  backend?: 'webgpu' | 'webgl2' | null;
  override?: QualityTierId | 'auto';
  now?: number;
}): { sel: TierSelector; store: ReturnType<typeof createMemoryStore>; calls: string[] } {
  const store = o.store ?? createMemoryStore();
  const calls = o.calls ?? [];
  const bench = fakeBenchmark(o.p90 ?? {}, calls) as RunBenchmark;
  const sel = new TierSelector({
    profile: o.profile ?? desktop,
    build: o.build ?? 'b1',
    qa: o.qa ?? NO_QA_FLAGS,
    store,
    settings: { tierOverride: o.override ?? 'auto' },
    now: () => o.now ?? 1_800_000_000_000,
    benchmark: bench,
    backend: o.backend ?? 'webgl2',
  });
  return { sel, store, calls };
}

describe('TierSelector benchmark (AC-3)', () => {
  it('keeps desktop when p90 passes the budget', async () => {
    const { sel } = selector({ p90: { desktop: 12 } });
    const r = await sel.select();
    expect(r.decision.tier).toBe('desktop');
    expect(r.decision.source).toBe('auto-benchmark');
    expect(r.reused).toBe(false);
  });

  it('desktop at p90 20 ms becomes mobile', async () => {
    // 20 ms > 16.7 x 1.1 = 18.37; mobile has the same budget but fewer objects (benchmark p90 of the next run: 14 ms).
    const { sel, calls } = selector({ p90: { desktop: 20, mobile: 14 } });
    const r = await sel.select();
    expect(r.decision.tier).toBe('mobile');
    expect(calls).toEqual(['desktop', 'mobile']);
    expect(r.decision.benchmark?.settingsTier).toBe('mobile');
  });

  it('desktop at p90 40 ms becomes mobile-low and stops after two steps', async () => {
    const { sel, calls } = selector({ p90: { desktop: 40, mobile: 40, 'mobile-low': 40 } });
    const r = await sel.select();
    expect(r.decision.tier).toBe('mobile-low');
    expect(calls).toEqual(['desktop', 'mobile', 'mobile-low']);
  });

  it('never steps below mobile-low, and at most twice from the top of the ladder', async () => {
    const { sel, calls } = selector({ profile: iphone, p90: { mobile: 99, 'mobile-low': 99 } });
    const r = await sel.select();
    expect(r.decision.tier).toBe('mobile-low');
    expect(calls).toEqual(['mobile', 'mobile-low']);
  });

  it('iPhone-class profiles start at mobile', async () => {
    const { sel } = selector({ profile: iphone, p90: { mobile: 10 } });
    expect(sel.provisional()).toBe('mobile');
    expect((await sel.select()).decision.tier).toBe('mobile');
  });

  it('promotes to desktop-ultra only on a real WebGPU adapter at p90 <= 8.35 ms', async () => {
    const real = { ...desktop, signals: { ...desktop.signals, adapter: { ...desktop.signals.adapter!, isFallbackAdapter: false } } };
    const fallback = { ...desktop, signals: { ...desktop.signals, adapter: { ...desktop.signals.adapter!, isFallbackAdapter: true } } };
    expect((await selector({ profile: real, backend: 'webgpu', p90: { desktop: 8 } }).sel.select()).decision.tier).toBe('desktop-ultra');
    expect((await selector({ profile: real, backend: 'webgpu', p90: { desktop: 9 } }).sel.select()).decision.tier).toBe('desktop');
    expect((await selector({ profile: real, backend: 'webgl2', p90: { desktop: 8 } }).sel.select()).decision.tier).toBe('desktop');
    expect((await selector({ profile: fallback, backend: 'webgpu', p90: { desktop: 8 } }).sel.select()).decision.tier).toBe('desktop');
  });

  it('benchmarkPasses uses frameBudgetMs x 1.1', () => {
    expect(benchmarkPasses(TIERS.desktop, 18.3)).toBe(true);
    expect(benchmarkPasses(TIERS.desktop, 18.5)).toBe(false);
    expect(benchmarkPasses(TIERS['mobile-low'], 36.6)).toBe(true);
    expect(benchmarkPasses(TIERS['mobile-low'], 37)).toBe(false);
  });
});

describe('TierSelector persistence (AC-3)', () => {
  it('reuses a stored decision for the same build and re-benchmarks after a build change', async () => {
    const store = createMemoryStore();
    const first = selector({ store, build: 'b1', p90: { desktop: 12 } });
    expect((await first.sel.select()).reused).toBe(false);
    expect(first.calls).toEqual(['desktop']);

    const same = selector({ store, build: 'b1', p90: { desktop: 99 } });
    const r = await same.sel.select();
    expect(r.reused).toBe(true);
    expect(r.decision.tier).toBe('desktop');
    expect(same.calls).toEqual([]);

    const changed = selector({ store, build: 'b2', p90: { desktop: 12 } });
    expect((await changed.sel.select()).reused).toBe(false);
    expect(changed.calls).toEqual(['desktop']);
  });

  it('re-benchmarks when the uaHash or the adapterHash changes', async () => {
    const store = createMemoryStore();
    await selector({ store, p90: { desktop: 12 } }).sel.select();
    const otherUa = { ...desktop, uaHash: '0123456789abcdef' };
    const a = selector({ store, profile: otherUa, p90: { desktop: 12 } });
    expect((await a.sel.select()).reused).toBe(false);
    const otherAdapter = { ...desktop, adapterHash: 'fedcba9876543210' };
    const b = selector({ store, profile: otherAdapter, p90: { desktop: 12 } });
    expect((await b.sel.select()).reused).toBe(false);
  });

  it('ignores a stored record with v: 2 and one that fails the schema', async () => {
    const good = { v: 1, tier: 'mobile', source: 'auto-benchmark', decidedAt: 1, build: 'b1', uaHash: desktop.uaHash, adapterHash: desktop.adapterHash, c13: C13_VERSION };
    const v2 = createMemoryStore({ decision: { ...good, v: 2 } });
    const a = selector({ store: v2, p90: { desktop: 12 } });
    expect((await a.sel.select()).reused).toBe(false);
    expect(a.calls).toEqual(['desktop']);

    const badTier = createMemoryStore({ decision: { ...good, tier: 'ultra-max' } });
    expect((await selector({ store: badTier, p90: { desktop: 12 } }).sel.select()).reused).toBe(false);

    const ok = createMemoryStore({ decision: good });
    const r = await selector({ store: ok }).sel.select();
    expect(r.reused).toBe(true);
    expect(r.decision.tier).toBe('mobile');
  });
});

describe('overrides (AC-3)', () => {
  it('?tier= works in QA builds', async () => {
    const qa = parseQaFlags('?tier=mobile', true);
    const { sel, calls } = selector({ qa });
    const r = await sel.select();
    expect(r.decision.tier).toBe('mobile');
    expect(r.decision.source).toBe('url-override');
    expect(calls).toEqual([]);
  });

  it('?tier= is ignored unless the build is a QA build (VITE_DV_QA is "1")', async () => {
    const qa = parseQaFlags('?tier=mobile', false);
    expect(qa.tier).toBeNull();
    const { sel } = selector({ qa, p90: { desktop: 12 } });
    const r = await sel.select();
    expect(r.decision.tier).toBe('desktop');
    expect(r.decision.source).toBe('auto-benchmark');
    // The selector has a second guard: a flag object that carries a tier but is not enabled is ignored too.
    const forged = selector({ qa: { enabled: false, tier: 'mobile' }, p90: { desktop: 12 } });
    expect((await forged.sel.select()).decision.tier).toBe('desktop');
  });

  it('a Settings override beats a stored decision', async () => {
    const store = createMemoryStore();
    await selector({ store, p90: { desktop: 12 } }).sel.select();
    const r = await selector({ store, override: 'mobile-low' }).sel.select();
    expect(r.decision.tier).toBe('mobile-low');
    expect(r.decision.source).toBe('user-override');
  });

  it('without a renderer the provisional tier is returned and nothing is persisted', async () => {
    const store = createMemoryStore();
    const sel = new TierSelector({
      profile: iphone,
      build: 'b1',
      qa: NO_QA_FLAGS,
      store,
      settings: { tierOverride: 'auto' },
      now: () => 5,
      benchmark: null,
      backend: null,
    });
    const r = await sel.select();
    expect(r.decision.source).toBe('auto-provisional');
    expect(await store.getTierDecision()).toBeNull();
  });
});

describe('demotion', () => {
  it('steps one rung down and records the source; the floor and XR tiers return null', async () => {
    const store = createMemoryStore();
    const { sel } = selector({ store, profile: iphone });
    const d = await sel.demote('mobile');
    expect(d?.tier).toBe('mobile-low');
    expect(d?.source).toBe('abnormal-exit-demotion');
    expect((await store.getTierDecision())?.tier).toBe('mobile-low');
    expect(await sel.demote('mobile-low')).toBeNull();
    expect(await sel.demote('xr-quest')).toBeNull();
  });
});
