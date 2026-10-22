import type { Fixture } from '../base.ts';
import { baseMission, NEAR } from '../base.ts';

/** A prop from the weapon.* namespace. */
export default {
  code: 'E_DEPICTION',
  pointer: '/cast/gun/prefab',
  build: () => ({
    ...baseMission(),
    cast: { ...baseMission().cast, gun: { k: 'prop', prefab: 'weapon.pistol', spawn: { at: [NEAR.a[0], NEAR.a[1]], snap: 'ground' } } },
  }),
} satisfies Fixture;
