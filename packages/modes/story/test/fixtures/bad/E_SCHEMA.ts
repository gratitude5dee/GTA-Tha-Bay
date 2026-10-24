import type { Fixture } from '../base.ts';
import { baseMission } from '../base.ts';

/** A raw display string where a LocKey belongs. */
export default {
  code: 'E_SCHEMA',
  pointer: '/title',
  build: () => ({ ...baseMission(), title: 'Pick Up The Fare' }),
} satisfies Fixture;
