/**
 * The desktop-ultra atmosphere slot (02-world-living.md section 6; M02b2). The takram atmosphere is isolated behind
 * `AtmosphereAdapter` and removable: its WebGPU path is work in progress, so this milestone ships the interface only and
 * `desktop-ultra` uses the desktop dome until the adapter lands in M10d2 (art integration, DL-390). The platform flag
 * `world.atmosphere` (default false) is the switch; nothing here imports the library.
 */
import type { AtmosphereAdapter } from './types.ts';

export type { AtmosphereAdapter } from './types.ts';

/** Builds the adapter for the tier, or null when there is none (every tier today). */
export function createAtmosphereAdapter(opts: { enabled: boolean; level: 0 | 1 | 2 }): AtmosphereAdapter | null {
  if (!opts.enabled || opts.level < 2) return null;
  // The takram adapter arrives with M10d2. Until then the flag changes nothing: the dome is the sky on desktop-ultra too.
  return null;
}
