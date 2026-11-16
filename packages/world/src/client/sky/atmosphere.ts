/**
 * The desktop-ultra atmosphere slot (02-world-living.md section 6; M02b2, M10d2). The takram atmosphere is isolated behind
 * `AtmosphereAdapter` and removable (`atmosphere-takram.ts`): it is built only on `desktop-ultra`, with the platform flag
 * `world.atmosphere` on (default false; QA builds also take `?atmosphere=1`) and the governor's `atmosphereLevel` at 2. Every other
 * case gets null and the M02e sky (`SkyMesh` + dome blend) stays.
 */
import type { Scene } from 'three/webgpu';
import type { QualityTierId, RenderBackend } from '@dv/shared';
import { TakramAtmosphere, type AtmosphereStatus, type TakramModule } from './atmosphere-takram.ts';
import type { AtmosphereAdapter } from './types.ts';

export type { AtmosphereAdapter } from './types.ts';

export interface AtmosphereAdapterOptions {
  enabled: boolean;
  level: 0 | 1 | 2;
  tier: QualityTierId;
  scene: Scene;
  backend: () => RenderBackend | null;
  load?: () => Promise<TakramModule>;
}

/** Builds the adapter for the tier, or null: anything but `desktop-ultra` with the flag on at level 2 never constructs it. */
export function createAtmosphereAdapter(opts: AtmosphereAdapterOptions): (AtmosphereAdapter & { status(): AtmosphereStatus }) | null {
  if (!opts.enabled || opts.level < 2 || opts.tier !== 'desktop-ultra') return null;
  return new TakramAtmosphere({ tier: opts.tier, scene: opts.scene, backend: opts.backend, ...(opts.load ? { load: opts.load } : {}) });
}
