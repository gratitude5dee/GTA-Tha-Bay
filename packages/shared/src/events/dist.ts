/** Distributions of effect values (08-tycoon-events.md section 3). Only `+ - * /`, clamps and `detmath.exp`. */
import { detmath } from '../detmath.ts';
import { ctrFloat } from './rng.ts';
import type { Dist } from './types.ts';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Irwin-Hall(12): the sum of 12 uniform draws minus 6 (mean 0, sd 1). Uses counters `counter .. counter + 11`. */
export function irwinHall(seed: number, stream: string, counter: number): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += ctrFloat(seed, stream, counter + i);
  return s - 6;
}

/** One sample. `uniform` uses counter 0, `normal` and `lognormal` counters 0..11 of the stream. */
export function sampleDist(d: Dist, seed: number, stream: string): number {
  switch (d.k) {
    case 'fixed':
      return d.v;
    case 'uniform':
      return d.lo + (d.hi - d.lo) * ctrFloat(seed, stream, 0);
    case 'normal':
      return clamp(d.mu + d.sigma * irwinHall(seed, stream, 0), d.clamp[0], d.clamp[1]);
    case 'lognormal':
      return clamp(detmath.exp(d.mu + d.sigma * irwinHall(seed, stream, 0)), d.clamp[0], d.clamp[1]);
  }
}

/** Smallest and largest value a distribution can give (used by the validator). */
export function distBounds(d: Dist): [number, number] {
  switch (d.k) {
    case 'fixed':
      return [d.v, d.v];
    case 'uniform':
      return [d.lo, d.hi];
    case 'normal':
    case 'lognormal':
      return [d.clamp[0], d.clamp[1]];
  }
}
