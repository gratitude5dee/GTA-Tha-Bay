/**
 * The fighter descriptor for headless runs (M08a2): the missions runner steps the sim in a loop with no turns for promises, and the
 * mode host takes a child's sim half from `descriptor.sim().then(...)`. This descriptor answers with a thenable that calls back at
 * once, so the child is in place on the tick it is asked for. QA and tools only; the game loads the sim half lazily (`fighterDescriptor`).
 */
import type { GameModeDescriptor } from '@dv/shared';
import { fighterDescriptor } from '../index.ts';
import { fighterSim } from '../sim/mode.ts';

export function headlessFighterDescriptor(): GameModeDescriptor {
  const ready = { default: fighterSim };
  const now = {
    then(ok?: (v: typeof ready) => unknown): unknown {
      ok?.(ready);
      return now;
    },
  };
  return { ...fighterDescriptor(), sim: () => now as unknown as ReturnType<GameModeDescriptor['sim']> };
}
