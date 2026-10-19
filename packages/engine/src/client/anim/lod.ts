import type { QualityTierId } from '@dv/shared';
import tiersJson from '../../../../../config/engine-tiers.json';
import type { AnimLodBands } from './types.ts';

/** `config/engine-tiers.json` (schema: config/schemas/engine-tiers.schema.json). */
export interface EngineTierRow {
  animBands: AnimLodBands;
  audioVoices: number;
  ragdollCap: number;
  footIk: boolean;
}
export const ENGINE_TIERS = (tiersJson as unknown as { tiers: Record<QualityTierId, EngineTierRow> }).tiers;

/** Update rate of a mixer: full every frame, half every second frame, quarter every fourth, frozen never (01-engine.md 2.8). */
export type AnimBand = 'full' | 'half' | 'quarter' | 'frozen';

export function bandFor(distanceM: number, bands: AnimLodBands): AnimBand {
  if (distanceM <= bands.fullHzWithinM) return 'full';
  if (distanceM <= bands.halfHzWithinM) return 'half';
  if (distanceM <= bands.quarterHzWithinM) return 'quarter';
  return 'frozen';
}

/** Whether a mixer in `band` runs on render frame `frame`. Offset by a per-mixer `phase` so that the half and quarter bands spread over frames. */
export function shouldUpdate(band: AnimBand, frame: number, phase = 0): boolean {
  switch (band) {
    case 'full': return true;
    case 'half': return (frame + phase) % 2 === 0;
    case 'quarter': return (frame + phase) % 4 === 0;
    default: return false;
  }
}

/** The bands of a tier. */
export function animBandsFor(tier: QualityTierId): AnimLodBands {
  return ENGINE_TIERS[tier].animBands;
}

/**
 * Decides, per mixer, whether to update it this frame. The caller passes the time elapsed since that mixer's last update
 * back to `AnimationMixer.update`, so a half-rate mixer still plays at real speed.
 */
export class AnimLod {
  private frame = 0;

  constructor(private bands: AnimLodBands) {}

  setBands(b: AnimLodBands): void {
    this.bands = b;
  }

  /** Call once per render frame. */
  nextFrame(): void {
    this.frame++;
  }

  band(distanceM: number): AnimBand {
    return bandFor(distanceM, this.bands);
  }

  /** True when a mixer at `distanceM` (with the given per-mixer phase) is updated on the current frame. */
  update(distanceM: number, phase = 0): boolean {
    return shouldUpdate(this.band(distanceM), this.frame, phase);
  }
}
