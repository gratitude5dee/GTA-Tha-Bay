/** AC-4: the shipped catalog loads and validates; each bad fixture fails with its rule id. */
import { describe, expect, it } from 'vitest';
import { EVENT_FILES, LOCALE } from '../tycoon/__fixtures__/content.ts';
import { BOTH_SCOPE_IDS, CatalogError, loadCatalog, withScope } from '../tycoon/events/catalog.ts';
import { def } from './__fixtures__/host.ts';
import { eventKeys, validateEvents } from './validate.ts';
import type { EventDef } from './types.ts';

const has = (k: string): boolean => LOCALE[k] !== undefined;
const shipped = loadCatalog(EVENT_FILES, LOCALE);

describe('events content', () => {
  it('the shipped catalog has 37 defs: 30 rolled and enabled, 3 chain-only, 2 disabled, 2 system', () => {
    expect(shipped).toHaveLength(37);
    const rolled = shipped.filter((d) => d.mtthWeeks > 0 && d.disabled !== true);
    expect(rolled).toHaveLength(30);
    expect(shipped.filter((d) => d.disabled === true).map((d) => d.id)).toEqual(['pol.hardware_tariff', 'pol.permit_freeze']);
    expect(shipped.filter((d) => d.family === 'system').map((d) => d.id)).toEqual(['fin.bridge_offer', 'vc.retrade']);
    expect(shipped.filter((d) => d.mtthWeeks === 0 && d.disabled !== true && d.family !== 'system').map((d) => d.id).sort()).toEqual(['biz.price_war', 'biz.scaling_strain', 'cul.ai_hype_crash']);
    const families = new Set(shipped.map((d) => d.family));
    for (const f of ['business', 'political', 'natural', 'cultural', 'market', 'system']) expect(families.has(f as EventDef['family'])).toBe(true);
  });

  it('the shipped catalog validates with no error and every event has its LocKeys and art ref', () => {
    const v = validateEvents(shipped, { hasKey: has });
    expect(v.errors).toEqual([]);
    for (const d of shipped) {
      for (const k of eventKeys(d)) expect(has(k), k).toBe(true);
      expect(d.art).toBe(`ui/ty-card-${d.id}`);
    }
    // unresolved art is a warning, never an error, until M09b1
    const w = validateEvents(shipped, { hasKey: has, hasArt: () => false });
    expect(w.errors).toEqual([]);
    expect(w.warnings.length).toBe(shipped.length);
    expect(w.warnings.every((x) => x.rule === 'art-unresolved')).toBe(true);
  });

  it('the ids are ascending and unique, and the catalog is sorted by the loader', () => {
    const ids = shipped.map((d) => d.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the ten both-scope events exist and the scope helper keeps them for stories', () => {
    expect(BOTH_SCOPE_IDS).toHaveLength(10);
    expect(shipped.filter((d) => d.scope === 'both').map((d) => d.id).sort()).toEqual([...BOTH_SCOPE_IDS].sort());
    expect(withScope(shipped, 'business')).toHaveLength(10);
  });

  it('the quake is anchored at 1,226 weeks and every MTTH is positive for a rolled def', () => {
    expect(shipped.find((d) => d.id === 'nat.quake_major')?.mtthWeeks).toBe(1226);
    expect(shipped.find((d) => d.id === 'nat.blackout')?.mtthWeeks).toBe(150);
    for (const d of shipped.filter((x) => x.mtthWeeks > 0)) expect(d.mtthWeeks).toBeGreaterThanOrEqual(40);
  });

  it('bad fixture: an unknown follow-up id fails with unknown-followup', () => {
    const bad = def('b.one', { followUps: [{ eventId: 'b.ghost', delayWeeks: [1, 2], p: 0.5 }] });
    const rules = validateEvents([bad], { hasKey: () => true }).errors.map((e) => e.rule);
    expect(rules).toContain('unknown-followup');
  });

  it('bad fixture: a chain cycle without a cooldown fails with chain-cycle; with a cooldown it passes', () => {
    const a = def('b.a', { mtthWeeks: 0, followUps: [{ eventId: 'b.b', delayWeeks: [1, 1], p: 1 }] });
    const b = def('b.b', { mtthWeeks: 0, followUps: [{ eventId: 'b.a', delayWeeks: [1, 1], p: 1 }] });
    expect(validateEvents([a, b], { hasKey: () => true }).errors.map((e) => e.rule)).toContain('chain-cycle');
    expect(validateEvents([{ ...a, cooldownWeeks: 4 }, b], { hasKey: () => true }).errors).toEqual([]);
  });

  it('bad fixture: a missing LocKey fails with missing-lockey', () => {
    const d = def('b.text');
    const v = validateEvents([d], { hasKey: (k) => !k.endsWith('.body') });
    expect(v.errors.map((e) => e.rule)).toEqual(['missing-lockey']);
    expect(v.errors[0]?.detail).toContain('tycoon.events.b.text.body');
  });

  it('bad fixture: an onFire cash loss above EFFECT_LIMITS fails with cash-limit', () => {
    const d = def('b.loss', { onFire: [{ k: 'metric', metric: 'cash', op: 'add', dist: { k: 'uniform', lo: -90_000_000, hi: -1000 }, durationWeeks: 0, decay: 'none' }] });
    expect(validateEvents([d], { hasKey: () => true }).errors.map((e) => e.rule)).toEqual(['cash-limit']);
    const ok = def('b.fine', { onFire: [{ k: 'metric', metric: 'cash', op: 'add', dist: { k: 'fixed', v: -25_000_000 }, durationWeeks: 0, decay: 'none' }] });
    expect(validateEvents([ok], { hasKey: () => true }).errors).toEqual([]);
  });

  it('other rules: duplicate ids, a choice event without a valid default, a bad distribution, a bad predicate', () => {
    expect(validateEvents([def('b.dup'), def('b.dup')], { hasKey: () => true }).errors.map((e) => e.rule)).toContain('dup-id');
    const noDefault = def('b.choice', { choices: [{ id: 'x', effects: [] }] });
    expect(validateEvents([noDefault], { hasKey: () => true }).errors.map((e) => e.rule)).toContain('bad-default');
    const lockedDefault = def('b.locked', { choices: [{ id: 'x', effects: [], requires: [{ m: 'cash', op: '>', v: 1 }] }], defaultChoiceId: 'x' });
    expect(validateEvents([lockedDefault], { hasKey: () => true }).errors.map((e) => e.rule)).toContain('bad-default');
    const dist = def('b.dist', { onFire: [{ k: 'metric', metric: 'hype', op: 'add', dist: { k: 'uniform', lo: 5, hi: 1 }, durationWeeks: 0, decay: 'none' }] });
    expect(validateEvents([dist], { hasKey: () => true }).errors.map((e) => e.rule)).toContain('bad-dist');
    const pred = def('b.pred', { requires: [{ m: 'nonsense' as never, op: '>', v: 1 }] });
    expect(validateEvents([pred], { hasKey: () => true }).errors.map((e) => e.rule)).toContain('bad-predicate');
  });

  it('the loader refuses a catalog with an error and names the rule', () => {
    const bad = [{ schema: 'tycoon.events.v1', events: [def('b.one', { followUps: [{ eventId: 'b.ghost', delayWeeks: [1, 2], p: 0.5 }] })] }];
    expect(() => loadCatalog(bad)).toThrow(CatalogError);
    expect(() => loadCatalog(bad)).toThrow(/unknown-followup/);
    expect(() => loadCatalog({})).toThrow(/list of event files/);
  });
});
