import type { Fixture } from '../base.ts';
import { baseMission } from '../base.ts';

/** A landmark zone for a landmark the world does not have. */
export default {
  code: 'E_REF_LANDMARK',
  pointer: '/zones/pier/id',
  build: () => ({ ...baseMission(), zones: { ...baseMission().zones, pier: { k: 'landmark', id: 'lm.no-such-place' } } }),
} satisfies Fixture;
