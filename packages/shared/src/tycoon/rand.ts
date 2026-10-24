/**
 * Counter-based draws of Business Tycoon (08-tycoon-events.md section 3). No generator state exists: every draw is a pure function
 * of `(seed, stream, counter)`, so adding content never shifts another draw and nothing needs saving.
 * Streams used by the core: `climate`, `hire:<week>:<n>`, `hireo:<candidateId>`, `attr:<week>:<employeeId>`, `board:<week>:<seat>`.
 */
import { ctrFloat } from '../events/rng.ts';

export { ctrFloat };

/** Normal-ish: the sum of 12 `ctrFloat` draws minus 6 (mean 0, sd 1), then scaled. Uses counters `counter .. counter + 11`. */
export function ctrNormal(seed: number, stream: string, counter: number, mean = 0, sd = 1): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += ctrFloat(seed, stream, counter + i);
  return mean + sd * (s - 6);
}
