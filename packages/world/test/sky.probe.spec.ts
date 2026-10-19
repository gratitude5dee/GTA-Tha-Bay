/**
 * AC-5 (probe): the sky-derived probe re-bakes only after a sun move above 0.006 rad or a darkness change above 0.04, and never
 * twice within 200 ms.
 */
import { describe, expect, it } from 'vitest';
import { PROBE_DARK_STEP, PROBE_MIN_INTERVAL_MS, PROBE_SUN_MOVE_RAD, SkyProbe, angleBetween } from '../src/client/sky/probe.ts';
import { SKY_KEYS, evaluateSky, sunDirection } from '../src/client/sky/sky-keys.ts';
import type { SkyUniforms, Vec3 } from '../src/client/sky/types.ts';

const base = evaluateSky(SKY_KEYS, { hour: 13, night: 0, dark: 0, weather: 'clear', next: 'clear', blend: 0, fogBankM: 0, rain: 0, wet: 0, blackout: false });
const at = (sun: Vec3, dark = 0): SkyUniforms => ({ ...base, uSunDir: sun, uDark: dark });

/** The unit vector `rad` radians from `v` (rotation about y; exact for a `v` on the horizon). */
const rotated = (v: Vec3, rad: number): Vec3 => [v[0] * Math.cos(rad) + v[2] * Math.sin(rad), v[1], -v[0] * Math.sin(rad) + v[2] * Math.cos(rad)];

describe('SkyProbe (AC-5)', () => {
  it('constants are the spec values', () => {
    expect(PROBE_SUN_MOVE_RAD).toBe(0.006);
    expect(PROBE_DARK_STEP).toBe(0.04);
    expect(PROBE_MIN_INTERVAL_MS).toBe(200);
  });

  it('bakes on the first frame, then only after a 0.006 rad sun move or a 0.04 darkness change', () => {
    const baked: number[] = [];
    const p = new SkyProbe(() => void baked.push(1));
    const sun: Vec3 = [0, 0, 1];
    expect(p.update(at(sun), 0)).toBe(true);
    // Below the thresholds, however long we wait.
    expect(p.update(at(rotated(sun, 0.005)), 1000)).toBe(false);
    expect(p.update(at(sun, 0.039), 2000)).toBe(false);
    expect(p.update(at(rotated(sun, 0.0059), 0.0399), 3000)).toBe(false);
    // Above them.
    expect(p.update(at(rotated(sun, 0.0065)), 4000)).toBe(true);
    expect(p.bakes).toBe(2);
    expect(baked).toHaveLength(2);
    // Darkness counts from the last bake (0).
    expect(p.update(at(rotated(sun, 0.0065), 0.041), 5000)).toBe(true);
    expect(p.update(at(rotated(sun, 0.0065), 0.041 + 0.039), 6000)).toBe(false);
    expect(p.update(at(rotated(sun, 0.0065), 0.041 + 0.0401), 7000)).toBe(true);
  });

  it('never bakes twice within 200 ms, however far the sun jumps', () => {
    const p = new SkyProbe(() => undefined);
    const sun: Vec3 = [0, 0, 1];
    expect(p.update(at(sun), 1000)).toBe(true);
    expect(p.update(at(rotated(sun, 0.5)), 1100)).toBe(false);
    expect(p.update(at(rotated(sun, 0.5)), 1199)).toBe(false);
    expect(p.update(at(rotated(sun, 0.5)), 1200)).toBe(true);
    expect(p.update(at(rotated(sun, 1.0)), 1300)).toBe(false);
  });

  it('over a run at the game rate it re-bakes about every three seconds and never faster than every 200 ms', () => {
    // 30 game seconds per real second: the sun moves 0.00201 rad per real second near noon at 60 fps.
    const times: number[] = [];
    const p = new SkyProbe(() => undefined);
    let t = 0;
    for (let frame = 0; frame < 60 * 120; frame++, t += 1000 / 60) {
      const hour = 9 + (frame / 60) * (30 / 3600);
      if (p.update(at(sunDirection(hour)), t)) times.push(t);
    }
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(PROBE_MIN_INTERVAL_MS);
    expect(times.length).toBeGreaterThan(20);
    expect(times.length).toBeLessThan(80);
  });

  it('a weather change can force the next bake, still no sooner than 200 ms after the last', () => {
    const p = new SkyProbe(() => undefined);
    p.update(at([0, 1, 0]), 0);
    p.invalidate();
    expect(p.update(at([0, 1, 0]), 100)).toBe(false);
    expect(p.update(at([0, 1, 0]), 250)).toBe(true);
    expect(p.update(at([0, 1, 0]), 700)).toBe(false);
  });

  it('angleBetween is the angle of two unit vectors', () => {
    expect(angleBetween([1, 0, 0], [0, 1, 0])).toBeCloseTo(Math.PI / 2, 12);
    expect(angleBetween([0, 1, 0], [0, 1, 0])).toBe(0);
    expect(angleBetween([0, 1, 0], [0, -1, 0])).toBeCloseTo(Math.PI, 12);
  });
});
