import type { Fixture } from '../base.ts';
import { baseMission } from '../base.ts';

/** 16 stages of 252 `emit` ops: more than the 4,000 op nodes a mission may hold. */
export default {
  code: 'E_BUDGET',
  pointer: '/',
  build: () => {
    const m = baseMission();
    const proto = m.stages[1]!;
    const stages = Array.from({ length: 16 }, (_, i) => ({
      ...proto,
      id: `s${i}`,
      onEnter: Array.from({ length: 252 }, () => ({ op: 'emit' as const, event: 'tick' })),
      objectives: [{ ...proto.objectives[1]!, id: `w${i}` }],
    }));
    return { ...m, stages };
  },
} satisfies Fixture;
