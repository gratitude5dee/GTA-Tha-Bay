import { fnv32 } from '@dv/shared';

/** The spec's `hash32(a, b, c)`: FNV-1a over the parts joined with `|`, so the same parts always give the same seed. */
export const hash32 = (...parts: (string | number)[]): number => fnv32(parts.join('|'));

/** Ticks of the sim clock per second. */
export const TICKS_PER_SEC = 60;

/** A total order on strings (C01 rule 4: every sort in sim code passes a comparator). */
export const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
