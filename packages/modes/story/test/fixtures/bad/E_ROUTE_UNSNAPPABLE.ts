import type { Fixture } from '../base.ts';
import { baseEnv, baseMission, NEAR } from '../base.ts';

/** A route zone the road graph cannot carry (the compile-time check says no). */
export default {
  code: 'E_ROUTE_UNSNAPPABLE',
  pointer: '/zones/lane',
  build: () => ({
    ...baseMission(),
    zones: { ...baseMission().zones, lane: { k: 'route', via: [[NEAR.a[0], NEAR.a[1]], [NEAR.b[0], NEAR.b[1]]], widthM: 8 } },
  }),
  env: () => baseEnv({ routable: () => false }),
} satisfies Fixture;
