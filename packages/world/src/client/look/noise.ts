/**
 * TSL hash and value-noise helpers of the look pass (M02e). Every pattern of the look is computed: this milestone adds no image file
 * and no texture download. The hashes work on integer cell coordinates (the sine-free form), so they hold their precision at the
 * distances of a 10 km city.
 */
import { clamp, dot, float, floor, fract, fwidth, max, mix, select, smoothstep, vec2, vec3, type L } from '../sky/tsl.ts';

/** A hash of a 2D cell, in [0, 1). */
export const hash21 = (p: L): L => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const q = p3.add(dot(p3, vec3(p3.y, p3.x, p3.z).add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
};

/** A hash of a float, in [0, 1). */
export const hash11 = (x: L): L => {
  const p = fract(x.mul(0.1031));
  const q = p.mul(p.add(33.33));
  return fract(q.mul(q.add(p)));
};

/** Smooth value noise of a 2D point, in [0, 1). */
export const vnoise = (p: L): L => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};

/** Two octaves of value noise, in [0, 1). */
export const fbm2 = (p: L): L => vnoise(p).mul(0.65).add(vnoise(p.mul(2.17).add(vec2(11.3, 7.7))).mul(0.35));

/** Three octaves of value noise, in [0, 1). */
export const fbm3 = (p: L): L =>
  vnoise(p).mul(0.55).add(vnoise(p.mul(2.13).add(vec2(11.3, 7.7))).mul(0.28)).add(vnoise(p.mul(4.37).add(vec2(3.1, 19.9))).mul(0.17));

/** A noise factor around 1: `1 + (n - 0.5) * 2 * amount`. */
export const around1 = (n: L, amount: number): L => float(1).add(n.sub(0.5).mul(2 * amount));

/**
 * Pixel footprint in metres: how far the fragment's world position moves from one pixel to the next. The procedural patterns have no
 * mip chain, so they fade toward their average once a pixel covers more than a cell (the analytic form of texture filtering).
 */
export const pixelFootprint = (worldPos: L): L => fwidth(worldPos).length();

/** 1 while a band of `freq` cycles per metre is resolved by the pixel footprint `fp`, 0 once a pixel covers more than a cycle. */
export const bandFade = (fp: L, freq: number): L => float(1).sub(smoothstep(0.3, 1.1, fp.mul(freq)));

/** Value noise at `freq` cycles per metre that fades to its mean (0.5) when the pixel is larger than a cycle. */
export const vnoiseAA = (p: L, freq: number, fp: L): L => mix(float(0.5), vnoise(p.mul(freq)), bandFade(fp, freq));

/** `edgeLine` with a half width of at least one pixel, and fading out when a cell is smaller than a pixel. `cellM` is the cell size. */
export const edgeLineAA = (x: L, w: number, cellM: number, fp: L): L => {
  const px = fp.div(cellM);
  const f = fract(x);
  const d = f.min(float(1).sub(f));
  return float(1).sub(smoothstep(0, px.max(w), d)).mul(float(1).sub(smoothstep(0.35, 0.9, px)));
};

/** A thin line: 1 on the cell edge (`fract(x)` near 0 or 1), 0 inside, `w` the half width in cell units. */
export const edgeLine = (x: L, w: number): L => {
  const f = fract(x);
  return float(1).sub(smoothstep(0, w, f.min(float(1).sub(f))));
};

/**
 * Picks `values[i]` for the integer `index` (a float node that holds a whole number) by a chain of selects. A chain over a constant
 * table compiles to a few compares, which is cheaper than a texture or a storage buffer for these tiny tables.
 */
export const pickFloat = (index: L, values: readonly number[]): L => {
  let out: L = float(values[values.length - 1] as number);
  for (let i = values.length - 2; i >= 0; i--) out = select(index.lessThan(i + 0.5), float(values[i] as number), out);
  return out;
};

/** Same as `pickFloat` for linear RGB triples. */
export const pickColor = (index: L, values: readonly (readonly [number, number, number])[]): L => {
  const last = values[values.length - 1] as readonly [number, number, number];
  let out: L = vec3(last[0], last[1], last[2]);
  for (let i = values.length - 2; i >= 0; i--) {
    const v = values[i] as readonly [number, number, number];
    out = select(index.lessThan(i + 0.5), vec3(v[0], v[1], v[2]), out);
  }
  return out;
};

/** `a` clamped to 0..1. */
export const sat = (a: L): L => clamp(a, 0, 1);

export const luma = (c: L): L => dot(c, vec3(0.2126, 0.7152, 0.0722));

export { max };
