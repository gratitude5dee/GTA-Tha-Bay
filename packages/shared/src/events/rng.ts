/**
 * Counter-based draws of the event engine (08-tycoon-events.md section 3). `ctrU32` is the C02 1.1 primitive; a draw is a pure
 * function of `(seed, stream, counter)`, so adding or reordering defs never shifts another def's rolls.
 * Streams: `ev:<id>` (counter = week), `evd:<iid>:<k>` (distribution draws), `evf:<iid>:<k>` (follow-up p and delay).
 */
import { ctrU32 } from '../rng.ts';

export { ctrU32 };
const INV_2_32 = 1 / 4294967296;

/** Uniform in [0, 1). */
export function ctrFloat(seed: number, stream: string, counter: number): number {
  return ctrU32(seed, stream, counter) * INV_2_32;
}
