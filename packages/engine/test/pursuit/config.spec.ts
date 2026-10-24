/** M03c AC-1: config/pursuit.json validates against the schema, equals the design table, and defects are rejected with their JSON path. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PURSUIT_CONFIG, parsePursuitConfig, validatePursuitConfig } from '../../src/sim/pursuit/config.ts';

const root = (p: string): string => fileURLToPath(new URL(`../../../../${p}`, import.meta.url));
const json = (p: string): unknown => JSON.parse(readFileSync(root(p), 'utf8'));

describe('pursuit config (AC-1)', () => {
  it('validates against pursuit.schema.json', () => {
    const v = new Ajv2020({ allErrors: true, strict: true }).compile(json('packages/shared/schemas/pursuit.schema.json') as object);
    const ok = v(json('config/pursuit.json'));
    expect(v.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('equals the design table: points, search radius, cooldown', () => {
    const c = DEFAULT_PURSUIT_CONFIG;
    expect(c.levels.slice(0, 6).map((l) => l.points)).toEqual([0, 100, 300, 700, 1500, 3000]);
    expect(c.levels.slice(1, 6).map((l) => l.searchRadiusM)).toEqual([150, 250, 400, 600, 900]);
    expect(c.levels.slice(1, 6).map((l) => l.cooldownSec)).toEqual([10, 20, 35, 50, 75]);
    expect(c.infractionPoints).toMatchObject({ speedingSeen: 5, redLightSeen: 10, hitCivilianVehicle: 20, hitPoliceVehicle: 60, assault: 80, evasion: 15 });
    expect(c.witness).toEqual({ robotaxiDelaySec: 2, pedDelaySec: [3, 6], pedReports: true });
    expect(c.search).toEqual({ losLostSec: 2, growMps: 5, hidingMultiplier: 2, losChecksPerTick: 16 });
    expect(c.bust).toEqual({ speedMps: 2, units: 2, radiusM: 8, sec: 3, onFootGrappleSec: 2 });
    expect(c.fines).toEqual({ minCents: 25000, cashPct: 5, perHeatCents: 50000 });
    expect(c.impoundStrikes).toBe(3);
  });

  it('the shipped level tables hold SUVs and the helicopter where the design says', () => {
    const c = DEFAULT_PURSUIT_CONFIG;
    expect(c.levels.map((l) => l.heli)).toEqual([false, false, false, false, true, true, true]);
    expect(c.levels[3]?.suv).toBeGreaterThan(0);
    expect(c.levels[2]?.suv).toBe(0);
    expect(c.levels[5]?.tactics).toContain('portalSeal');
    expect(c.levels[4]?.tactics).not.toContain('portalSeal');
  });

  const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(json('config/pursuit.json'))) as Record<string, unknown>;

  it('a missing level is rejected with its path', () => {
    const c = clone();
    (c['levels'] as unknown[]).splice(3, 1);
    const r = validatePursuitConfig(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain('levels');
    const d = clone();
    (d['levels'] as unknown[])[3] = null;
    const r2 = validatePursuitConfig(d);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.issues.map((i) => i.path)).toContain('levels[3]');
  });

  it('a missing field and a negative value are rejected with their paths', () => {
    const c = clone();
    delete ((c['levels'] as Record<string, unknown>[])[2] as Record<string, unknown>)['cooldownSec'];
    ((c['levels'] as Record<string, unknown>[])[4] as Record<string, unknown>)['searchRadiusM'] = -1;
    (c['fines'] as Record<string, unknown>)['minCents'] = -5;
    const r = validatePursuitConfig(c);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.issues.map((i) => i.path);
      expect(paths).toContain('levels[2].cooldownSec');
      expect(paths).toContain('levels[4].searchRadiusM');
      expect(paths).toContain('fines.minCents');
    }
    expect(() => parsePursuitConfig(c)).toThrow(/levels\[4\]\.searchRadiusM/);
  });

  it('the schema rejects the same defects', () => {
    const v = new Ajv2020({ allErrors: true, strict: true }).compile(json('packages/shared/schemas/pursuit.schema.json') as object);
    const c = clone();
    ((c['levels'] as Record<string, unknown>[])[4] as Record<string, unknown>)['searchRadiusM'] = -1;
    expect(v(c)).toBe(false);
    expect((v.errors ?? []).some((e) => e.instancePath === '/levels/4/searchRadiusM')).toBe(true);
  });
});
