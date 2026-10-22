import type { Fixture } from '../base.ts';
import { baseMission } from '../base.ts';

/** Stage 0 jumps over stage 1, and nothing else leads there. */
export default {
  code: 'E_UNREACHABLE_STAGE',
  pointer: '/stages/1',
  build: () => {
    const m = baseMission();
    const third = { ...m.stages[1]!, id: 'three', objectives: m.stages[1]!.objectives.map((o) => ({ ...o, id: `${o.id}_3` })) };
    return { ...m, stages: [{ ...m.stages[0]!, next: 'three' }, { ...m.stages[1]!, id: 'two' }, third] };
  },
} satisfies Fixture;
