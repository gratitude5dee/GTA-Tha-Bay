import type { Fixture } from '../base.ts';
import { baseMission } from '../base.ts';

/** An objective that collects a cast entry the mission does not have. */
export default {
  code: 'E_REF_CAST',
  pointer: '/stages/1/objectives/0/cast',
  build: () => {
    const m = baseMission();
    const second = m.stages[1]!;
    return { ...m, stages: [m.stages[0]!, { ...second, objectives: [{ ...second.objectives[0]!, cast: 'ghost' } as never, second.objectives[1]!] }] };
  },
} satisfies Fixture;
