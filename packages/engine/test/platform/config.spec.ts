import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { C13_VERSION, FLAT_LADDER, TIER_IDS, VARIANT_FALLBACK, type QualityTierId } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { classifyDevice } from '@dv/shared';
import { DEFAULT_SETTINGS, createMemoryStore, normalizeSettings } from '../../src/platform/platform-store.ts';
import { NO_QA_FLAGS, parseLimits, parseQaFlags } from '../../src/platform/qa-flags.ts';
import { QualityServiceImpl } from '../../src/platform/quality-service.ts';
import { PLATFORM_FLAGS, TIERS } from '../../src/platform/tier-config.ts';
import { uaFixture } from './fakes.ts';

const root = (p: string): string => fileURLToPath(new URL(`../../../../${p}`, import.meta.url));
const json = <T>(p: string): T => JSON.parse(readFileSync(root(p), 'utf8')) as T;

describe('config/tier-budgets.json', () => {
  it('builds six full QualityTiers', () => {
    expect(Object.keys(TIERS).sort()).toEqual([...TIER_IDS].sort());
    for (const id of TIER_IDS) {
      const t = TIERS[id];
      expect(t.id).toBe(id);
      expect(t.features.shadows.mode).toBeDefined();
      expect(t.backend.gate).toMatch(/^(stable|device-spike-gated)$/);
      expect(t.dynamic.floor.renderScale).toBe(0.5);
      expect(t.dynamic.floor.postLevel).toBe(0);
      expect(t.dynamic.floor.targetFps).toBe(t.budget.frame.minFps);
      expect(t.dynamic.ceil.renderScale).toBe(1);
      expect(t.dynamic.ceil.targetFps).toBe(t.budget.frame.targetFps);
    }
  });

  it('xr is set on the XR tiers only', () => {
    expect(TIERS['xr-quest'].xr?.headset).toBe('quest');
    expect(TIERS['xr-visionpro'].xr?.headset).toBe('visionpro');
    for (const id of FLAT_LADDER) expect(TIERS[id].xr).toBeNull();
  });

  it('follows the backend policy table of 11-platform.md section 4.3', () => {
    expect(TIERS['xr-quest'].backend).toMatchObject({ preferred: 'webgl2', forceWebGl: true, gate: 'stable' });
    expect(TIERS['xr-visionpro'].backend).toMatchObject({ preferred: 'webgpu', forceWebGl: false, gate: 'stable' });
    expect(TIERS['desktop-ultra'].backend.requireRealAdapter).toBe(true);
    expect(TIERS.mobile.backend.gate).toBe('device-spike-gated');
    expect(TIERS['mobile-low'].backend.gate).toBe('device-spike-gated');
    expect(TIERS.desktop.backend.gate).toBe('stable');
  });

  it('the budget table keeps its normative frame and render numbers', () => {
    const r = (id: QualityTierId): [number, number, number] => [TIERS[id].budget.render.maxRenderObjects, TIERS[id].budget.render.maxGpuDrawCmds, TIERS[id].budget.render.maxTriangles];
    expect(r('desktop-ultra')).toEqual([900, 3500, 6_000_000]);
    expect(r('desktop')).toEqual([600, 2500, 4_000_000]);
    expect(r('mobile')).toEqual([150, 500, 1_000_000]);
    expect(r('mobile-low')).toEqual([100, 300, 600_000]);
    expect(TIERS['mobile-low'].budget.frame.targetFps).toBe(30);
    expect(TIERS['xr-quest'].budget.frame.targetFps).toBe(72);
    expect(TIERS['xr-visionpro'].budget.render.viewPasses).toBe(2);
  });

  it('every tier resolves an asset variant against a one-variant manifest (C07)', () => {
    for (const id of TIER_IDS) {
      const svc = new QualityServiceImpl({ profile: classifyDevice(uaFixture('desktop-chrome')), backend: 'webgl2', initial: id });
      expect(svc.assetVariant(['mobile-low'])).toBe('mobile-low');
      expect(VARIANT_FALLBACK[id].length).toBeGreaterThan(0);
    }
  });
});

describe('config/platform-flags.json', () => {
  it('webgpu.mobile is false until the M01c iPhone run passes (AC-14)', () => {
    expect(json<Record<string, unknown>>('config/platform-flags.json')['webgpu.mobile']).toBe(false);
    expect(PLATFORM_FLAGS['webgpu.mobile']).toBe(false);
  });
});

describe('tier-decision.v1 schema', () => {
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(json('packages/shared/schemas/tier-decision.v1.json'));
  const good = { v: 1, tier: 'mobile', source: 'auto-benchmark', decidedAt: 1, build: 'b', uaHash: 'a', adapterHash: 'b', c13: C13_VERSION };
  it('accepts a decision and rejects v: 2, an unknown tier and a 2.x contract', () => {
    expect(validate(good)).toBe(true);
    expect(validate({ ...good, v: 2 })).toBe(false);
    expect(validate({ ...good, tier: 'ultra' })).toBe(false);
    expect(validate({ ...good, c13: '2.0.0' })).toBe(false);
    expect(validate({ ...good, decidedAt: 1.5 })).toBe(false);
  });
});

describe('QaFlags', () => {
  it('parses the M01c platform flags in QA builds', () => {
    const f = parseQaFlags('?gpu=1&perf=1&governor=off&limits=maxBufferSize:1048576,bad,maxTextureDimension2D:2048&scenario=graybox-walk&tier=mobile-low&gl=1', true);
    expect(f).toMatchObject({ enabled: true, gpu: true, perf: true, governor: 'off', scenario: 'graybox-walk', tier: 'mobile-low', gl: true });
    expect(f.limits).toEqual({ maxBufferSize: 1_048_576, maxTextureDimension2D: 2048 });
  });

  it('?net= (M02f1, C13 1.2) is accepted only for a profile id and only in a QA build', () => {
    expect(parseQaFlags('?net=cell', true).net).toBe('cell');
    expect(parseQaFlags('?net=lag&tier=mobile', true).net).toBe('lag');
    expect(parseQaFlags('?net=nope', true).net).toBeNull();
    expect(parseQaFlags('?tier=mobile', true).net).toBeNull();
    expect(parseQaFlags('?net=cell', false)).toBe(NO_QA_FLAGS);
    expect(NO_QA_FLAGS.net).toBeNull();
  });

  it('parses nothing in a production build', () => {
    expect(parseQaFlags('?gpu=1&perf=1&tier=mobile&gl=1', false)).toBe(NO_QA_FLAGS);
    expect(NO_QA_FLAGS.limits).toEqual({});
  });

  it('rejects malformed limits and scenario ids', () => {
    expect(parseLimits('a:b,:3,x y:4,ok:5')).toEqual({ ok: 5 });
    expect(parseQaFlags('?scenario=../../etc', true).scenario).toBeNull();
    expect(parseQaFlags('?tier=nope', true).tier).toBeNull();
  });
});

describe('platform store', () => {
  it('returns defaults, round-trips settings and ignores a record with the wrong version', async () => {
    const s = createMemoryStore();
    expect(await s.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.telemetryConsent).toEqual({ diagnostics: true, analytics: true });
    await s.putSettings({ ...DEFAULT_SETTINGS, fpsCap: 30 });
    expect((await s.getSettings()).fpsCap).toBe(30);
    expect(normalizeSettings({ v: 2, fpsCap: 30 })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ v: 1, telemetryConsent: { diagnostics: false } }).telemetryConsent).toEqual({ diagnostics: false, analytics: true });
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS);
  });
});

describe('QualityService (C13 4.2)', () => {
  const profile = classifyDevice(uaFixture('iphone-safari'));

  it('exposes the tier, its dynamic state and its budgets', () => {
    const q = new QualityServiceImpl({ profile, backend: 'webgl2', initial: 'mobile' });
    expect(q.tier.id).toBe('mobile');
    expect(q.dynamic).toEqual(TIERS.mobile.dynamic.ceil);
    expect(q.budgetOf().render.maxRenderObjects).toBe(150);
    expect(q.budgetOf('desktop').render.maxRenderObjects).toBe(600);
    expect(q.backend).toBe('webgl2');
    expect(q.profile).toBe(profile);
  });

  it('applies a tier change at a safe point and notifies listeners', async () => {
    const applied: string[] = [];
    const q = new QualityServiceImpl({ profile, backend: 'webgl2', initial: 'mobile', apply: (n, p, r) => void applied.push(`${p.id}>${n.id}:${r}`) });
    const seen: string[] = [];
    q.onTierChange((n, p) => seen.push(`${p.id}>${n.id}`));
    await q.setTier('mobile-low', 'user-override');
    expect(q.tier.id).toBe('mobile-low');
    expect(applied).toEqual(['mobile>mobile-low:user-override']);
    expect(seen).toEqual(['mobile>mobile-low']);
    expect(q.dynamic.targetFps).toBe(30);
  });

  it('queues outside a safe point and applies in order when one opens', async () => {
    const applied: string[] = [];
    const q = new QualityServiceImpl({ profile, backend: 'webgl2', initial: 'mobile', safeAtStart: false, apply: (n) => void applied.push(n.id) });
    const a = q.setTier('mobile-low', 'user-override');
    const b = q.setTier('desktop', 'user-override');
    await Promise.resolve();
    expect(q.tier.id).toBe('mobile');
    expect(q.queued).toBe(2);
    expect(applied).toEqual([]);
    q.setSafePoint(true);
    await Promise.all([a, b]);
    expect(applied).toEqual(['mobile-low', 'desktop']);
    expect(q.tier.id).toBe('desktop');
    expect(q.queued).toBe(0);
  });

  it('rejects the request when apply throws, and keeps going', async () => {
    let n = 0;
    const q = new QualityServiceImpl({
      profile,
      backend: 'webgl2',
      initial: 'mobile',
      apply: () => {
        n += 1;
        if (n === 1) throw new Error('resize failed');
      },
    });
    await expect(q.setTier('mobile-low', 'user-override')).rejects.toThrow('resize failed');
    await q.setTier('desktop', 'user-override');
    expect(q.tier.id).toBe('desktop');
  });

  it('a request for the current tier is a no-op', async () => {
    let calls = 0;
    const q = new QualityServiceImpl({ profile, backend: 'webgl2', initial: 'mobile', apply: () => void (calls += 1) });
    await q.setTier('mobile', 'user-override');
    expect(calls).toBe(0);
  });

  it('delivers memory pressure to listeners and supports unsubscribe', () => {
    const q = new QualityServiceImpl({ profile, backend: 'webgl2', initial: 'mobile' });
    const levels: string[] = [];
    const off = q.onMemoryPressure((l) => levels.push(l));
    q.emitMemoryPressure('soft');
    off();
    q.emitMemoryPressure('hard');
    expect(levels).toEqual(['soft']);
  });
});
