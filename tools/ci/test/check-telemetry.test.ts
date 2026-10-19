import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTelemetry, emitCallSites, ownerMap, registeredNames } from '../check-telemetry.ts';
import { repoRoot } from '../run.ts';

const fx = (name: string): string => path.join(repoRoot, 'tools', 'ci', 'fixtures', 'telemetry', name);

describe('check:telemetry over the repository (AC-14)', () => {
  const r = checkTelemetry(repoRoot);

  it('exits 0 (no failures)', () => {
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('warns once per registered name with neither a call site nor a schema, with its owner milestone', () => {
    expect(r.warnings.length).toBeGreaterThan(0);
    for (const w of r.warnings) expect(w).toMatch(/^[a-z0-9_.]+ \(owner M\d{2}[a-z]?\d?\)$/);
    expect(new Set(r.warnings.map((w) => w.split(' ')[0])).size).toBe(r.warnings.length);
  });

  it('every emitted name in the sources is registered and has a schema', () => {
    const reg = new Set(r.registered);
    for (const name of emitCallSites(repoRoot).keys()) expect(reg.has(name), name).toBe(true);
  });

  it('pending.json owners agree with the milestone files (re-derivable)', () => {
    const names = r.warnings.map((w) => w.split(' ')[0] as string);
    const owners = ownerMap(repoRoot, names);
    for (const w of r.warnings) {
      const [name, owner] = [w.split(' ')[0] as string, /owner (\S+)\)/.exec(w)?.[1]];
      expect(owner, name).toBe(owners[name]);
    }
  });
});

describe('check:telemetry fixtures (AC-14)', () => {
  it('the ok fixture passes with one warning for the unemitted, unschemaed server name', () => {
    const r = checkTelemetry(fx('ok'));
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual(['genai.cost (owner M10b)']);
  });

  it('a schema with a profileId prop fails, naming it', () => {
    const r = checkTelemetry(fx('profile-prop'));
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.kind)).toEqual(['forbidden-prop']);
    expect(r.failures[0]?.message).toContain('profileId');
  });

  it('an emit of an unregistered name fails, naming it', () => {
    const r = checkTelemetry(fx('unregistered-emit'));
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.kind)).toEqual(['unregistered-name']);
    expect(r.failures[0]?.message).toContain('bogus.name');
  });

  it('an emitted name without a schema fails, naming it', () => {
    const r = checkTelemetry(fx('no-schema'));
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.kind)).toEqual(['missing-schema']);
    expect(r.failures[0]?.message).toContain('tier.decision');
  });

  it('reads the registered names from both const arrays', () => {
    expect(registeredNames("export const CLIENT_TELEMETRY_NAMES = ['a.b', 'c.d'] as const;\nexport const SERVER_ONLY_TELEMETRY_NAMES = ['e.f'] as const;")).toEqual(['a.b', 'c.d', 'e.f']);
  });
});
