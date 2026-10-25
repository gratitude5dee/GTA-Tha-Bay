import type { PlatformSettings } from '@dv/shared';

/**
 * The scale multiplied onto the tier's resolution caps (`pixelRatioFor`). `'auto'` plays at full size and lets the backdrop
 * (title and menus) run softer; a fixed value `s` is what the player chose: it applies in play, and the backdrop never exceeds it.
 * The tier's `dprCap`, `maxPixelsMP` and the 0.25 floor still apply after this, so the setting can only lower the cost (M04b5).
 */
export function effectiveRenderScale(setting: PlatformSettings['renderScale'], playing: boolean, backdrop: number): number {
  if (setting === 'auto') return playing ? 1 : backdrop;
  return playing ? setting : Math.min(setting, backdrop);
}
