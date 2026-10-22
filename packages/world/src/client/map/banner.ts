/**
 * The neighbourhood banner (M02c2; 02-world-maps.md section 2.4): when `nhoodAt` changes, the HUD area banner shows the text key
 * `nhood.<slug>`, at most once per 3 s. A change that happens inside the quiet period is held and shown when it ends if the player is
 * still in that neighbourhood, so a path that crosses three neighbourhoods and comes back inside 3 s shows at most the last one.
 * Pure: the caller passes the sim tick (60 per second) and the index `nhoodAt` answered.
 */

/** 3 s at the 60 Hz sim. */
export const BANNER_GAP_TICKS = 180;
export const NHOOD_NONE = 255;

export interface AreaBannerPatch {
  /** Text key of the neighbourhood name, `nhood.<slug>`. */
  key: string;
  slug: string;
  index: number;
  tick: number;
}

export class AreaBannerTracker {
  private emitted = NHOOD_NONE;
  private lastEmitTick = -Infinity;
  private count = 0;

  /**
   * @param slugs neighbourhood slugs by index (the `data/district-grid.v1` table)
   * @param gapTicks minimum ticks between two banners (default 180)
   */
  constructor(private readonly slugs: readonly string[], private readonly gapTicks = BANNER_GAP_TICKS) {}

  /** Banners emitted so far. */
  get emittedCount(): number {
    return this.count;
  }

  /** The neighbourhood index of the banner shown last (255 before the first). */
  get current(): number {
    return this.emitted;
  }

  /** Feed the neighbourhood the player is in now; returns the patch to publish as `hud.area`, or null. */
  update(tick: number, index: number): AreaBannerPatch | null {
    if (index === NHOOD_NONE || index === this.emitted) return null;
    const slug = this.slugs[index];
    if (slug === undefined) return null;
    if (tick - this.lastEmitTick < this.gapTicks) return null;
    this.emitted = index;
    this.lastEmitTick = tick;
    this.count++;
    return { key: `nhood.${slug}`, slug, index, tick };
  }

  reset(): void {
    this.emitted = NHOOD_NONE;
    this.lastEmitTick = -Infinity;
    this.count = 0;
  }
}
