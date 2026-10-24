import type { Fixture } from '../base.ts';
import { baseMission } from '../base.ts';

/** A zone in Nevada. */
export default {
  code: 'E_OUT_OF_BOUNDS',
  pointer: '/zones/far/at',
  build: () => ({ ...baseMission(), zones: { ...baseMission().zones, far: { k: 'circle', at: [39.5, -119.8], r: 10 } } }),
} satisfies Fixture;
