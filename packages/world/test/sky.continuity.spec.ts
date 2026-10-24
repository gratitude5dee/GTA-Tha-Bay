/**
 * AC-4: no uniform component jumps. Sampled every 60 game seconds over 24 hours for each preset, across a 30 game-second blend between
 * every pair of presets, and along the real clock (which blends over 8 game minutes at the sampling the frame loop uses).
 */
import { describe, expect, it } from 'vitest';
import { RngStreams } from '@dv/shared';
import { CLOCK_CONFIG, WorldClock, darkAt, nightAt } from '@dv/engine/sim';
import { SKY_KEYS, SKY_PRESET_IDS, UNIFORM_COMPONENTS, evaluateSky, flattenUniforms } from '../src/client/sky/sky-keys.ts';
import type { SkyInput, SkyPresetId } from '../src/client/sky/types.ts';

const MAX_STEP = 0.05;

const flat = (i: Partial<SkyInput>): number[] =>
  flattenUniforms(evaluateSky(SKY_KEYS, { hour: 13, night: 0, dark: 0, weather: 'clear', next: 'clear', blend: 0, fogBankM: 0, rain: 0, wet: 0, blackout: false, ...i }));

/** night and dark as the sim computes them. */
const sim = (hour: number): { night: number; dark: number } => ({ night: nightAt(hour), dark: darkAt(hour) });

/** Per component, the spread of the values the sky takes over all presets and hours (at least 1): the unit the steps are measured in. */
function spans(): number[] {
  const lo: number[] = new Array(UNIFORM_COMPONENTS.length).fill(Infinity);
  const hi: number[] = new Array(UNIFORM_COMPONENTS.length).fill(-Infinity);
  for (const p of SKY_PRESET_IDS) {
    for (let h = 0; h < 24; h += 0.25) {
      const v = flat({ hour: h, ...sim(h), weather: p, next: p });
      v.forEach((x, i) => {
        lo[i] = Math.min(lo[i] as number, x);
        hi[i] = Math.max(hi[i] as number, x);
      });
    }
  }
  // A component that spans less than one unit (a colour channel, a night factor) is measured against one.
  return lo.map((l, i) => Math.max((hi[i] as number) - l, 1));
}

const SPAN = spans();

function worst(a: number[], b: number[]): { name: string; step: number } {
  let best = { name: '', step: 0 };
  a.forEach((x, i) => {
    const step = Math.abs((b[i] as number) - x) / (SPAN[i] as number);
    if (step > best.step) best = { name: UNIFORM_COMPONENTS[i] as string, step };
  });
  return best;
}

describe('sky continuity (AC-4)', () => {
  it.each(SKY_PRESET_IDS)('%s: no component moves by more than 0.05 (normalized) per 60 game seconds over 24 hours', (preset) => {
    let prev = flat({ hour: 0, ...sim(0), weather: preset, next: preset });
    let max = { name: '', step: 0 };
    for (let s = 60; s <= 24 * 3600; s += 60) {
      const hour = (s % (24 * 3600)) / 3600;
      const cur = flat({ hour, ...sim(hour), weather: preset, next: preset });
      const w = worst(prev, cur);
      if (w.step > max.step) max = w;
      prev = cur;
    }
    expect(max.step, `${preset}: ${max.name}`).toBeLessThan(MAX_STEP);
  });

  it('the day wraps at midnight without a jump', () => {
    for (const p of SKY_PRESET_IDS) {
      const a = flat({ hour: 23.999, ...sim(23.999), weather: p, next: p });
      const b = flat({ hour: 0, ...sim(0), weather: p, next: p });
      expect(worst(a, b).step, p).toBeLessThan(0.01);
    }
  });

  const PAIRS: [SkyPresetId, SkyPresetId][] = SKY_PRESET_IDS.flatMap((a) => SKY_PRESET_IDS.filter((b) => b !== a).map((b): [SkyPresetId, SkyPresetId] => [a, b]));

  it.each([0, 6.5, 9, 13, 19.5, 21.5])('a 30 game-second blend (60 ticks) between any two presets at %s h moves no component by more than 0.05', (hour) => {
    const { night, dark } = sim(hour);
    let max = { name: '', step: 0, pair: '' };
    for (const [a, b] of PAIRS) {
      let prev = flat({ hour, night, dark, weather: a, next: b, blend: 0 });
      for (let tick = 1; tick <= 60; tick++) {
        const cur = flat({ hour, night, dark, weather: a, next: b, blend: Math.round((tick / 60) * 65_535) });
        const w = worst(prev, cur);
        if (w.step > max.step) max = { ...w, pair: `${a}>${b}` };
        prev = cur;
      }
    }
    expect(max.step, `${max.pair} ${max.name}`).toBeLessThan(MAX_STEP);
  });

  it('along the real clock, one frame (a tick) never moves a component by more than 0.05, through weather changes', () => {
    const c = new WorldClock(new RngStreams(0xc0ffee), { ...CLOCK_CONFIG, start: { hour: 0, weather: 'clear' } });
    const at = (): number[] => {
      const e = c.env();
      return flat({ hour: e.hour, night: e.night, dark: e.dark, weather: e.weather, next: e.next, blend: e.blend, fogBankM: e.fogBankM, rain: e.rain });
    };
    let prev = at();
    let max = { name: '', step: 0 };
    // Two game days at one tick per frame.
    for (let i = 0; i < 2 * 172_800; i++) {
      c.step();
      const cur = at();
      const w = worst(prev, cur);
      if (w.step > max.step) max = w;
      prev = cur;
    }
    expect(max.step, max.name).toBeLessThan(MAX_STEP);
  });
});
