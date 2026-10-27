import { describe, expect, it } from 'vitest';
import type { SimModuleContext } from '@dv/engine/sim';
import { createRacingModule } from '../src/sim/module.ts';
import { getRacingHost } from '../src/sim/host.ts';

/**
 * M07a2 (BD-M07a2-09): the engine boot sets `racing: true` for every session, including the gray-box test worlds whose sim has no
 * vehicle module (`services.vehicleCtx` unset). The racing module stays inert there instead of throwing in `onInit`, which killed the
 * engine boot (`__dvBridge.engine` never appeared).
 */
describe('racing module without a vehicle module', () => {
  it('onInit returns inert: no throw, no racing host', () => {
    const mod = createRacingModule();
    const ctx = { boot: { config: { racing: true } }, sim: { services: {} }, cfg: { profile: 'local', seed: 1 } } as unknown as SimModuleContext;
    expect(() => mod.onInit?.(ctx)).not.toThrow();
    expect(getRacingHost()).toBeNull();
  });
});
