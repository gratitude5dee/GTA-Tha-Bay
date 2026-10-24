/**
 * Mutant 2 of `racing` (M07a1): the referee accepts any gate ahead of the next one, so a skipped gate is counted when the car
 * crosses a later gate (the order rule is gone).
 */
import { crossedGate, refereeStep, type RaceEvent } from '../../../../packages/shared/src/index.ts';
import type { RacingDeps } from '../harness.ts';

export const description = 'gates counted in any order';

export function patch(deps: RacingDeps): RacingDeps {
  return {
    ...deps,
    referee(def, st, prev, cur, speed, tick, rules) {
      // a later gate crossed before the next one: move the pointer up to it, then let the real referee count it
      for (let k = st.gate + 1; k < def.gates.length; k++) {
        if (crossedGate(def.gates[k]!, prev, cur)) {
          st.gate = k;
          break;
        }
      }
      return refereeStep(def, st, prev, cur, speed, tick, rules) as RaceEvent[];
    },
  };
}
