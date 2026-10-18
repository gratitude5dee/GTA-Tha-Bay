import type { SimConfig } from '@dv/shared';
import { Health, Transform } from '../src/sim/ecs/components.ts';
import type { PrefabDef } from '../src/sim/ecs/world.ts';

export function testConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    seed: 0xc0ffee,
    profile: 'canonical',
    physicsBuild: 'deterministic-compat',
    tier: 'mobile-low',
    worldBake: 'test',
    hashEvery: 0,
    ...overrides,
  };
}

/** A plain spawnable unit: Transform plus Health(100). */
export const UNIT_PREFAB: PrefabDef = {
  id: 'unit',
  components: [{ def: Transform }, { def: Health, init: { hp: 100, max: 100 } }],
};
