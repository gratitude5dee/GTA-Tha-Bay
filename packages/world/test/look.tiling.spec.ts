/**
 * AC-5 (M10d0): the tiling nodes build three taps on `stochastic`, two on `single`, one on `albedo` and none on `off` (the profiles `legacy`
 * and the XR tiers never reach them). The taps are counted through the sampler callback, so no GPU is needed; the graph itself is also
 * built, so a TSL error in `hexCell` shows here.
 */
import { describe, expect, it } from 'vitest';
import { float, vec2, type L } from '../src/client/sky/tsl.ts';
import { hexCell, tapsOf, tiledSample, type TilingMode } from '../src/client/look/tiling.ts';
import { textureModeFor } from '../src/client/textures/config.ts';
import { LOOK, TIER_IDS, lookProfileFor } from '../src/client/look/config.ts';

function count(mode: Exclude<TilingMode, 'off'>): { taps: number; shifts: number[] } {
  const shifts: number[] = [];
  const out = tiledSample((uv, shift) => {
    shifts.push(shift);
    return vec2(uv.x, uv.y);
  }, vec2(float(0.3), float(0.7)), mode);
  expect(out).toBeDefined();
  return { taps: shifts.length, shifts };
}

describe('look/tiling', () => {
  it('has 3 taps on stochastic, 2 on single, 1 on albedo and none off', () => {
    expect([tapsOf('stochastic'), tapsOf('single'), tapsOf('albedo'), tapsOf('off')]).toEqual([3, 2, 1, 0]);
  });

  it('calls the sampler once per tap: 3, 2 and 1 times', () => {
    expect(count('stochastic').taps).toBe(3);
    expect(count('single').taps).toBe(2);
    expect(count('albedo').taps).toBe(1);
  });

  it('keeps the texel density of the hex taps and gives the second single tap its own scale', () => {
    expect(count('stochastic').shifts).toEqual([0, 0, 0]);
    expect(count('albedo').shifts).toEqual([0]);
    const [first, second] = count('single').shifts;
    expect(first).toBe(0);
    expect(second).toBeCloseTo(Math.log2(0.43), 6);
  });

  it('builds the hex cell: three weights and three offsets', () => {
    const cell = hexCell(vec2(float(0.5), float(0.25)));
    expect(cell.w).toHaveLength(3);
    expect(cell.off).toHaveLength(3);
    for (const n of [...cell.w, ...cell.off]) expect(n as L).toBeDefined();
  });

  it('maps every tier to the taps its profile asks for: desktop 3, mobile 2, mobile-low 1, legacy and XR 0', () => {
    const taps = TIER_IDS.map((t) => tapsOf(textureModeFor(t, lookProfileFor(t, true, LOOK), true)));
    expect(taps).toEqual([3, 3, 2, 1, 0, 0]);
  });
});
