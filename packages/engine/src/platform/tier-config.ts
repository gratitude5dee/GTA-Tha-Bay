import {
  buildQualityTiers,
  validateTierConfig,
  type QualityTier,
  type QualityTierId,
  type TierConfigFile,
} from '@dv/shared';
import budgetsJson from '../../../../config/tier-budgets.json';
import flagsJson from '../../../../config/platform-flags.json';

/** Device-spike gates (config/platform-flags.json). */
export interface PlatformFlags {
  /** True only after the M01c iPhone WebGPU run passed (AC-14). */
  readonly 'webgpu.mobile': boolean;
  /** M02b1 (DL-698): skyline cards on the tiers that draw them. Default true. */
  readonly 'world.cards': boolean;
  /** M02b1 (DL-698): the far massing boxes on the desktop tiers. Default true; set false to ship the ring and cards only (Effort fallback). */
  readonly 'world.massing': boolean;
  /** M02e (DL-704): the look pass (TSL materials, post stack, shadows). Default true; false is the full rollback to the M02b1/M02b2 look. */
  readonly 'world.look': boolean;
  /** M02h3: the ground cover (yards, lots, scrub, driveways from the bake's section 21). Default true; false meshes the GROUND classes alone. */
  readonly 'world.cover': boolean;
  /** M02h4: the five street-tree forms in the vegetation pools. Default true; false draws M02b1's cone as one pool. */
  readonly 'world.treeForms': boolean;
}

export const PLATFORM_FLAGS: PlatformFlags = {
  'webgpu.mobile': flagsJson['webgpu.mobile'] === true,
  'world.cards': (flagsJson as Record<string, unknown>)['world.cards'] !== false,
  'world.massing': (flagsJson as Record<string, unknown>)['world.massing'] !== false,
  'world.look': (flagsJson as Record<string, unknown>)['world.look'] !== false,
  'world.cover': (flagsJson as Record<string, unknown>)['world.cover'] !== false,
  'world.treeForms': (flagsJson as Record<string, unknown>)['world.treeForms'] !== false,
};

const problems = validateTierConfig(budgetsJson);
if (problems.length > 0) throw new Error(`config/tier-budgets.json is invalid: ${problems.join('; ')}`);

/** The six tiers, built once from config/tier-budgets.json. */
export const TIERS: Readonly<Record<QualityTierId, QualityTier>> = buildQualityTiers(budgetsJson as unknown as TierConfigFile);

export function tierOf(id: QualityTierId): QualityTier {
  return TIERS[id];
}
