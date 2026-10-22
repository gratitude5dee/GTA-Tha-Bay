import type { Fixture } from '../base.ts';
import { baseMission } from '../base.ts';

/** A goto to a zone that is not declared. */
export default {
  code: 'E_REF_ZONE',
  pointer: '/stages/0/objectives/0/zone',
  build: () => {
    const m = baseMission();
    const o = m.stages[0]!.objectives[0]!;
    return { ...m, stages: [{ ...m.stages[0]!, objectives: [{ ...o, zone: 'nowhere' } as never] }, m.stages[1]!] };
  },
} satisfies Fixture;
