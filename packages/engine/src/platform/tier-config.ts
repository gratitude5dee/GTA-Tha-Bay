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
}

export const PLATFORM_FLAGS: PlatformFlags = { 'webgpu.mobile': flagsJson['webgpu.mobile'] === true };

const problems = validateTierConfig(budgetsJson);
if (problems.length > 0) throw new Error(`config/tier-budgets.json is invalid: ${problems.join('; ')}`);

/** The six tiers, built once from config/tier-budgets.json. */
export const TIERS: Readonly<Record<QualityTierId, QualityTier>> = buildQualityTiers(budgetsJson as unknown as TierConfigFile);

export function tierOf(id: QualityTierId): QualityTier {
  return TIERS[id];
}
