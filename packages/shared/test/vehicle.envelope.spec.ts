/**
 * Class envelopes (M03a1, AC-2): mass, power and lateral mu of every preset lie inside its class; the table is the one of
 * 06-racing-content.md C.2.
 */
import { describe, expect, it } from 'vitest';
import { CLASS_ENVELOPE, CLASS_ORACLE, envelopeViolations } from '../src/vehicle/index.ts';
import { loadPresets } from './vehicle-presets.ts';

describe('class envelope', () => {
  it('holds the C.2 numbers', () => {
    expect(CLASS_ENVELOPE.D).toMatchObject({ massKg: [850, 3200], powerKw: [50, 160], muLat: [0.75, 0.95], topKph: [140, 185], zeroTo100Sec: [7.5, 12.0], piBand: [100, 399] });
    expect(CLASS_ENVELOPE.C).toMatchObject({ massKg: [1000, 2100], powerKw: [120, 260], muLat: [0.92, 1.08], topKph: [200, 245], zeroTo100Sec: [5.5, 7.5] });
    expect(CLASS_ENVELOPE.R).toMatchObject({ massKg: [1800, 2400], powerKw: [100, 200], muLat: [0.6, 0.8], topKph: [100, 200], piBand: [250, 350] });
    expect(CLASS_ENVELOPE.S.powerKw).toEqual([380, 900]);
    expect(Object.keys(CLASS_ENVELOPE)).toEqual(['D', 'C', 'B', 'A', 'S', 'R']);
    expect(CLASS_ORACLE.D).toEqual({ brakeM: 46, brakeG: 0.85, durability: 1.3 });
    expect(CLASS_ORACLE.R.brakeM).toBe(56);
  });

  it('the braking distance of each class follows from its brake g (v^2 / 2a from 100 kph)', () => {
    for (const [cls, o] of Object.entries(CLASS_ORACLE)) {
      const v = 100 / 3.6;
      const d = (v * v) / (2 * o.brakeG * 9.81);
      expect(Math.abs(d - o.brakeM) / o.brakeM, cls).toBeLessThan(0.2);
    }
  });

  it('mass, power and lateral mu of the ten presets are inside their class', () => {
    for (const { p } of loadPresets()) expect(envelopeViolations(p), p.id).toEqual([]);
  });

  it('reports each violated bound', () => {
    const base = loadPresets().find((x) => x.p.id === 'hp.sedan')?.p;
    expect(base).toBeDefined();
    if (!base) return;
    const bad = { ...base, massKg: 400, engine: { ...base.engine, powerKw: 900 }, tire: { ...base.tire, muLat: 1.4 } };
    expect(envelopeViolations(bad).map((v) => v.split(' ')[0])).toEqual(['massKg', 'powerKw', 'muLat']);
  });

  it('the police presets carry the C.1 numbers', () => {
    const by = Object.fromEntries(loadPresets().map((x) => [x.p.id, x.p]));
    expect(by['hp.police-cruiser']?.massKg).toBe(1950);
    expect(by['hp.police-suv']?.massKg).toBe(2300);
    expect(by['hp.police-suv']?.durability).toBe(1.6);
    expect(by['hp.robotaxi-ambient']?.class).toBe('R');
    expect(by['hp.robotaxi-ambient']?.quirks?.find((q) => q.k === 'speedGovernor')).toEqual({ k: 'speedGovernor', kph: 105, jailbreakItem: 'item.jailbreak-kit' });
    expect(by['hp.ondine-pico']?.class).toBe('D');
    expect(by['hp.ondine-pico']?.drive.type).toBe('FWD');
  });
});
