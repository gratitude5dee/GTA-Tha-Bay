import type { Fixture } from '../base.ts';
import { baseMission } from '../base.ts';

/** A mode objective whose hook the mission does not declare. */
export default {
  code: 'E_HOOK_STUB',
  pointer: '/stages/1/objectives/1/hook',
  build: () => {
    const m = baseMission();
    const second = m.stages[1]!;
    return { ...m, stages: [m.stages[0]!, { ...second, objectives: [second.objectives[0]!, { k: 'mode', id: 'race', text: 'mission.m.t.base.obj.wait', hook: 'race1' }] }] };
  },
} satisfies Fixture;
