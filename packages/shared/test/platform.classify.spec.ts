import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  C13_VERSION,
  FLAT_LADDER,
  FLAT_TIER_OF,
  TIER_IDS,
  buildQualityTiers,
  classifyDevice,
  parseTierDecision,
  provisionalTier,
  stepDownTier,
  validateTierConfig,
  type DeviceSignals,
  type QualityTierId,
  type TierConfigFile,
} from '../src/index.ts';

const root = (p: string): URL => new URL(`../../../${p}`, import.meta.url);

interface UaFixture {
  synthetic: boolean;
  signals: DeviceSignals;
  expect: { class: string; headset: string | null; provisionalTier: QualityTierId };
}

const fixtureDir = fileURLToPath(root('tools/ci/fixtures/ua'));
const fixtures = readdirSync(fixtureDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ name: f.replace(/\.json$/, ''), fx: JSON.parse(readFileSync(`${fixtureDir}/${f}`, 'utf8')) as UaFixture }));

describe('classifyDevice (AC-2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('covers the five device fixtures', () => {
    expect(fixtures.map((f) => f.name)).toEqual(['desktop-chrome', 'desktop-safari', 'iphone-safari', 'quest-browser', 'visionpro-safari']);
  });

  for (const { name, fx } of fixtures) {
    it(`${name}: class, headset and provisional tier equal the expectation without window or navigator`, () => {
      vi.stubGlobal('window', undefined);
      vi.stubGlobal('navigator', undefined);
      const p = classifyDevice(fx.signals);
      expect(p.class).toBe(fx.expect.class);
      expect(p.xrHeadset).toBe(fx.expect.headset);
      expect(p.xrCapable).toBe(fx.expect.headset !== null);
      expect(provisionalTier(p)).toBe(fx.expect.provisionalTier);
      expect(p.uaHash).toMatch(/^[0-9a-f]{16}$/);
      expect(p.adapterHash).toMatch(/^[0-9a-f]{16}$/);
      expect(p.signals).toBe(fx.signals);
    });
  }

  it('every FLAT_TIER_OF value is on FLAT_LADDER', () => {
    for (const v of Object.values(FLAT_TIER_OF)) expect(FLAT_LADDER as readonly string[]).toContain(v);
  });

  it('reads the browser, display mode and texture family', () => {
    const by = (n: string): ReturnType<typeof classifyDevice> => classifyDevice(fixtures.find((f) => f.name === n)!.fx.signals);
    expect(by('desktop-chrome').browser).toBe('chrome');
    expect(by('desktop-chrome').textureFamily).toBe('bc');
    expect(by('desktop-safari').browser).toBe('safari');
    expect(by('iphone-safari').browser).toBe('safari');
    expect(by('iphone-safari').displayMode).toBe('standalone');
    expect(by('iphone-safari').textureFamily).toBe('astc');
    expect(by('iphone-safari').touch).toBe(true);
    expect(by('quest-browser').browser).toBe('quest-browser');
    expect(by('quest-browser').textureFamily).toBe('none');
  });

  it('lowMemoryHint follows deviceMemory and core count', () => {
    const base = fixtures.find((f) => f.name === 'iphone-safari')!.fx.signals;
    expect(classifyDevice(base).lowMemoryHint).toBe(false);
    expect(classifyDevice({ ...base, hardwareConcurrency: 4 }).lowMemoryHint).toBe(true);
    expect(classifyDevice({ ...base, deviceMemoryGB: 4 }).lowMemoryHint).toBe(true);
    expect(classifyDevice({ ...base, deviceMemoryGB: 8 }).lowMemoryHint).toBe(false);
    expect(provisionalTier(classifyDevice({ ...base, hardwareConcurrency: 4 }))).toBe('mobile-low');
  });

  it('separates iPhone from iPad by screen size and keeps touch laptops desktop', () => {
    const phone = fixtures.find((f) => f.name === 'iphone-safari')!.fx.signals;
    const ipad = classifyDevice({
      ...phone,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      screen: { w: 820, h: 1180, dpr: 2 },
    });
    expect(ipad.class).toBe('ipad');
    const chrome = fixtures.find((f) => f.name === 'desktop-chrome')!.fx.signals;
    expect(classifyDevice({ ...chrome, maxTouchPoints: 10 }).class).toBe('desktop');
    expect(classifyDevice({ ...chrome, maxTouchPoints: 5, userAgent: `${chrome.userAgent} Mobile`, platform: 'Linux armv81' }).class).toBe('android');
  });

  it('the hashes change with the user agent and the adapter', () => {
    const s = fixtures.find((f) => f.name === 'desktop-chrome')!.fx.signals;
    const a = classifyDevice(s);
    const b = classifyDevice({ ...s, userAgent: `${s.userAgent} x` });
    const c = classifyDevice({ ...s, adapter: null });
    expect(b.uaHash).not.toBe(a.uaHash);
    expect(b.adapterHash).toBe(a.adapterHash);
    expect(c.adapterHash).not.toBe(a.adapterHash);
  });
});

describe('tier config', () => {
  const file = JSON.parse(readFileSync(fileURLToPath(root('config/tier-budgets.json')), 'utf8')) as TierConfigFile;

  it('validates and builds six full tiers', () => {
    expect(validateTierConfig(file)).toEqual([]);
    const tiers = buildQualityTiers(file);
    expect(Object.keys(tiers).sort()).toEqual([...TIER_IDS].sort());
    expect(file.c13).toBe(C13_VERSION);
    for (const id of TIER_IDS) {
      const t = tiers[id];
      expect(t.id).toBe(id);
      expect(t.dynamic.floor.renderScale).toBe(0.5);
      expect(t.dynamic.floor.postLevel).toBe(0);
      expect(t.dynamic.floor.targetFps).toBe(t.budget.frame.minFps);
      expect(t.dynamic.ceil.targetFps).toBe(t.budget.frame.targetFps);
      expect(t.xr !== null).toBe(t.family === 'xr');
    }
  });

  it('mobile tiers are device-spike-gated, XR tiers stable', () => {
    const tiers = buildQualityTiers(file);
    expect(tiers['mobile'].backend.gate).toBe('device-spike-gated');
    expect(tiers['mobile-low'].backend.gate).toBe('device-spike-gated');
    expect(tiers['xr-quest'].backend.forceWebGl).toBe(true);
    expect(tiers['xr-visionpro'].backend.preferred).toBe('webgpu');
    expect(tiers['desktop-ultra'].backend.requireRealAdapter).toBe(true);
  });

  it('rejects a broken file', () => {
    expect(validateTierConfig({ c13: '0.1.0', tiers: {} }).length).toBeGreaterThan(0);
    expect(validateTierConfig(null)).toEqual(['tier config is not an object']);
  });

  it('steps down the flat ladder and stops', () => {
    expect(stepDownTier('desktop-ultra')).toBe('desktop');
    expect(stepDownTier('desktop')).toBe('mobile');
    expect(stepDownTier('mobile')).toBe('mobile-low');
    expect(stepDownTier('mobile-low')).toBeNull();
    expect(stepDownTier('xr-quest')).toBeNull();
  });
});

describe('tier-decision.v1', () => {
  const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../schemas/tier-decision.v1.json', import.meta.url)), 'utf8')) as object;
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const ok = { v: 1, tier: 'mobile', source: 'auto-benchmark', decidedAt: 1_700_000_000_000, build: 'b1', uaHash: 'a', adapterHash: 'b', c13: C13_VERSION };

  it('the hand validator and the JSON Schema agree', () => {
    const cases: unknown[] = [
      ok,
      { ...ok, v: 2 },
      { ...ok, tier: 'ultra' },
      { ...ok, source: 'nope' },
      { ...ok, decidedAt: -1 },
      { ...ok, decidedAt: 1.5 },
      { ...ok, c13: '2.0.0' },
      { ...ok, build: 7 },
      { v: 1 },
      null,
    ];
    for (const c of cases) expect(parseTierDecision(c) !== null).toBe(validate(c));
    expect(parseTierDecision(ok)).toEqual(ok);
  });
});
