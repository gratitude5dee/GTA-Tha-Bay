/**
 * Ambient density (02-world-living.md sections 2.2, 2.3, 7; M03b1): how many of a cell's baked slots are live now.
 *
 *   active = activeSlots(capacity, tierFactor, hourFactor, weatherFactor, override)      (C08, pure)
 *
 * The factors come from `config/world/density.json`: the tier factor per kind, the hour curve of the cell's profile (linear
 * between the anchors, the last anchor wrapping to the first one 24 h later), the weather factor, and the `TrafficControl`
 * override. The `canonical` profile (C02) always reads the `mobile-low` row, so the world sim is the same on every device.
 * Pure; C02 lint applies.
 */
import { activeSlots, type QualityTierId, type SimProfile, type WeatherPreset } from '@dv/shared';
import densityJson from '../../../../../config/world/density.json';
import budgets from '../../../../../config/tier-budgets.json';

export type DensityTable = 'traffic' | 'ped' | 'parked';

interface Curve {
  traffic: readonly number[];
  ped: readonly number[];
}

export interface DensityFile {
  profiles: readonly { name: string; perKm: number }[];
  hourAnchors: readonly number[];
  hourCurves: Readonly<Record<string, Curve>>;
  tierFactors: Readonly<Record<DensityTable, Readonly<Record<QualityTierId, number>>>>;
  weatherFactors: Readonly<Record<'traffic' | 'ped', Readonly<Record<WeatherPreset, number>>>>;
}

export const DENSITY: DensityFile = densityJson as unknown as DensityFile;

/** The ambient radius `R_amb` per tier, metres (living part 2.2; design values to calibrate on devices). */
export const AMBIENT_RADIUS_M: Readonly<Record<QualityTierId, number>> = {
  'desktop-ultra': 600,
  desktop: 500,
  'xr-visionpro': 400,
  mobile: 350,
  'mobile-low': 250,
  'xr-quest': 250,
};

/** Near-level kinematic body caps and promoted-vehicle caps per tier (living part 2.3). */
export const NEAR_CAP: Readonly<Record<QualityTierId, number>> = {
  'desktop-ultra': 120,
  desktop: 120,
  'xr-visionpro': 60,
  mobile: 40,
  'mobile-low': 24,
  'xr-quest': 24,
};
export const PROMOTED_CAP: Readonly<Record<QualityTierId, number>> = {
  'desktop-ultra': 8,
  desktop: 8,
  'xr-visionpro': 4,
  mobile: 4,
  'mobile-low': 3,
  'xr-quest': 3,
};
/** Distance within which an agent is on the near level, metres. */
export const NEAR_RADIUS_M = 80;

/** The tier the density model reads: `canonical` is always `mobile-low`. */
export function densityTier(profile: SimProfile, tier: QualityTierId): QualityTierId {
  return profile === 'canonical' ? 'mobile-low' : tier;
}

/** The C13 traffic instance cap of a tier (cars: traffic and parked together). */
export function trafficCap(tier: QualityTierId): number {
  return (budgets as unknown as { tiers: Record<QualityTierId, { crowd: { maxTrafficInstances: number } }> }).tiers[tier].crowd.maxTrafficInstances;
}

/** Name of density profile `index` (the baked `densityProfile`); `none` for an index out of range. */
export function profileName(index: number): string {
  return DENSITY.profiles[index]?.name ?? 'none';
}

/**
 * The hour factor of a profile (a baked index) at `hour` (0 to 24): linear between the anchors, wrapping from the last anchor to
 * the first one. Parked cars ignore the hour curve (factor 1).
 */
export function hourFactor(profile: number, kind: DensityTable, hour: number, d: DensityFile = DENSITY): number {
  if (kind === 'parked') return 1;
  const name = d.profiles[profile]?.name ?? 'none';
  const curve = d.hourCurves[name]?.[kind];
  if (!curve) return 0;
  const anchors = d.hourAnchors;
  const n = anchors.length;
  let h = hour % 24;
  if (h < 0) h += 24;
  const last = anchors[n - 1] as number;
  if (h >= last) {
    const a = curve[n - 1] as number;
    const b = curve[0] as number;
    return a + ((b - a) * (h - last)) / (24 - last + (anchors[0] as number));
  }
  if (h < (anchors[0] as number)) {
    const a = curve[n - 1] as number;
    const b = curve[0] as number;
    const span = 24 - last + (anchors[0] as number);
    return a + ((b - a) * (h + 24 - last)) / span;
  }
  let i = 0;
  while (i + 1 < n && (anchors[i + 1] as number) <= h) i++;
  const h0 = anchors[i] as number;
  const h1 = anchors[i + 1] as number;
  const a = curve[i] as number;
  const b = curve[i + 1] as number;
  return a + ((b - a) * (h - h0)) / (h1 - h0);
}

export function tierFactor(tier: QualityTierId, kind: DensityTable, d: DensityFile = DENSITY): number {
  return d.tierFactors[kind][tier];
}

/** Weather factor; parked cars have none. */
export function weatherFactor(weather: WeatherPreset, kind: DensityTable, d: DensityFile = DENSITY): number {
  return kind === 'parked' ? 1 : d.weatherFactors[kind][weather];
}

export interface ActiveArgs {
  /** The cell's baked capacity of this kind (the desktop-ultra peak). */
  capacity: number;
  kind: DensityTable;
  tier: QualityTierId;
  profile: number;
  hour: number;
  weather: WeatherPreset;
  /** `TrafficControl.densityOf(kind)`: 0 to 1.5. */
  override: number;
}

/** How many slots of the kind's range (a prefix `0 ... n - 1`) are live now. */
export function activeFor(a: ActiveArgs, d: DensityFile = DENSITY): number {
  return activeSlots(
    a.capacity,
    tierFactor(a.tier, a.kind, d),
    hourFactor(a.profile, a.kind, a.hour, d),
    weatherFactor(a.weather, a.kind, d),
    a.override,
  );
}
