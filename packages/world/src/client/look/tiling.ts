/**
 * Tiling nodes for the surface textures (M10d0; TSL only). A tiled texture shows its repeat from the air and along a long street, so the
 * `full` profile samples it hex-tiled (Mikkelsen's stochastic tiling: three taps, one per corner of the triangle grid cell, each at a
 * random offset, blended by contrast-preserving weights), `lite` blends two taps at two scales under a slow noise, and `min` takes one.
 * `legacy` and the XR tiers add nothing: they never reach these functions.
 *
 * The caller owns the sampling: `sample(uv, log2Scale)` returns the texel at `uv` (tile units) and is called once per tap, so the tap count
 * of a mode is a property of this file (`tapsOf`) that a unit test can read without a GPU. `log2Scale` is the change of texel density
 * that the tap's own scale brings, for the caller's explicit mip level.
 */
import { float, floor, fract, mix, select, smoothstep, vec2, type L } from '../sky/tsl.ts';
import { hash21, vnoise } from './noise.ts';

/** The sampling a texture mode asks for; `off` samples nothing. */
export type TilingMode = 'stochastic' | 'single' | 'albedo' | 'off';

export type TileSampler = (uv: L, log2Scale: number) => L;

/** Taps per sample: 3 hex-tiled, 2 blended, 1 plain, 0 none. */
export function tapsOf(mode: TilingMode): 0 | 1 | 2 | 3 {
  switch (mode) {
    case 'stochastic':
      return 3;
    case 'single':
      return 2;
    case 'albedo':
      return 1;
    default:
      return 0;
  }
}

const TWO_SQRT3 = 3.4641016151377544;

export interface HexCell {
  /** The three blend weights, summing to 1. */
  w: readonly [L, L, L];
  /** The three random offsets in tile units. */
  off: readonly [L, L, L];
}

/** The triangle-grid cell of `uv` (tile units): weights of its three corners and each corner's random offset. */
export function hexCell(uv: L): HexCell {
  const st = uv.mul(TWO_SQRT3);
  // Skew into the simplex grid: (x, -x / sqrt(3) + 2 y / sqrt(3)).
  const skew = vec2(st.x, st.y.mul(1.1547005383792515).sub(st.x.mul(0.5773502691896258)));
  const base = floor(skew);
  const f = fract(skew);
  const z = float(1).sub(f.x).sub(f.y);
  const up = z.greaterThan(0);
  const v1 = select(up, base, base.add(vec2(1, 1)));
  const v2 = select(up, base.add(vec2(0, 1)), base.add(vec2(1, 0)));
  const v3 = select(up, base.add(vec2(1, 0)), base.add(vec2(0, 1)));
  const w1 = select(up, z, z.negate());
  const w2 = select(up, f.y, float(1).sub(f.y));
  const w3 = select(up, f.x, float(1).sub(f.x));
  // A high power narrows the blend zones, so the tap's own detail survives inside a hex.
  const p1 = w1.pow(7);
  const p2 = w2.pow(7);
  const p3 = w3.pow(7);
  const sum = p1.add(p2).add(p3).max(1e-5);
  const off = (v: L): L => vec2(hash21(v), hash21(v.add(vec2(37.17, 11.31))));
  return { w: [p1.div(sum), p2.div(sum), p3.div(sum)], off: [off(v1), off(v2), off(v3)] };
}

/**
 * `sample` blended by `mode` at `uv` (tile units): hex-tiled with three taps, two taps at two scales under a slow noise, or one tap.
 * The result has the shape the sampler returns (a vec3 or a vec4).
 */
export function tiledSample(sample: TileSampler, uv: L, mode: Exclude<TilingMode, 'off'>): L {
  if (mode === 'albedo') return sample(uv, 0);
  if (mode === 'single') {
    const a = sample(uv, 0);
    // The second tap runs at 0.43 of the scale and a fixed offset: the repeat of one reads as a different piece of the other.
    const b = sample(uv.mul(0.43).add(vec2(0.37, 0.71)), Math.log2(0.43));
    const w = smoothstep(0.35, 0.65, vnoise(uv.mul(0.17))).mul(0.5);
    return mix(a, b, w);
  }
  const c = hexCell(uv);
  const s1 = sample(uv.add(c.off[0]), 0);
  const s2 = sample(uv.add(c.off[1]), 0);
  const s3 = sample(uv.add(c.off[2]), 0);
  return s1.mul(c.w[0]).add(s2.mul(c.w[1])).add(s3.mul(c.w[2]));
}
