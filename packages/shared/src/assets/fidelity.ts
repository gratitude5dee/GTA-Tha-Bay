/** Build-side fidelity map, spec/domains/05-assets.md section 4.2 (not part of C07). */
import type { QualityTierId } from '../platform/c13.ts';

export type Fidelity = 'hi' | 'mid' | 'lo';
export const TIER_FIDELITY: Readonly<Record<QualityTierId, Fidelity>> =
  { 'desktop-ultra': 'hi', desktop: 'hi', 'xr-visionpro': 'hi', mobile: 'mid', 'xr-quest': 'mid', 'mobile-low': 'lo' };
export const FIDELITY_VARIANT: Readonly<Record<Fidelity, QualityTierId>> = { hi: 'desktop', mid: 'mobile', lo: 'mobile-low' };
