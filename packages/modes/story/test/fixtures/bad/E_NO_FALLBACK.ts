import type { Fixture } from '../base.ts';
import { baseMission } from '../base.ts';

/** A beat that names a cutscene which has no in-engine fallback. */
export default {
  code: 'E_NO_FALLBACK',
  pointer: '/stages/0/onEnter/1/ref/cutscene',
  build: () => {
    const m = baseMission();
    const first = m.stages[0]!;
    return { ...m, stages: [{ ...first, onEnter: [...(first.onEnter ?? []), { op: 'beat', ref: { cutscene: 'cut.story.nofb' } }] }, m.stages[1]!] };
  },
} satisfies Fixture;
