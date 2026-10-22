import type { Fixture } from '../base.ts';
import { baseMission } from '../base.ts';

/** A line id that lines.en.json does not hold. */
export default {
  code: 'E_REF_LINE',
  pointer: '/stages/0/onEnter/0/line',
  build: () => {
    const m = baseMission();
    return { ...m, stages: [{ ...m.stages[0]!, onEnter: [{ op: 'say', speaker: 'pal', line: 'line.t.missing' }] }, m.stages[1]!], lines: ['line.t.missing'] };
  },
} satisfies Fixture;
