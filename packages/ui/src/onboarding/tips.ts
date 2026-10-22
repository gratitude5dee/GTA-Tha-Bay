/**
 * Contextual tips (10-ui-hud-xr.md 2.11 rule 1). `content/ui/hints.json` holds the `HintDef`s. A tip shows once (twice at most), uses
 * the active device's text, disappears when its action is performed, never shows when `UiPrefs.showTips` is false or in XR, and its
 * dismissal is stored in `UiPrefs.dismissed` as `hint:<id>`; each display adds a `hint:<id>#<n>` marker so the count survives a reload.
 * Pure: the host feeds it triggers, actions and the clock.
 */
import hintsJson from '../../../../content/ui/hints.json';
import type { LocKey } from '../i18n/index.ts';

export type HintDevice = 'kbm' | 'gamepad' | 'touch';
export interface HintDef {
  id: string;
  /** `play` (the first moment of play), `after:<hintId>` (that tip is done), `prompt.interact`, `prompt.enter`. */
  trigger: string;
  devices: Record<HintDevice, LocKey>;
  maxShows: 1 | 2;
  /** The ActionId that dismisses the tip. */
  dismissOn: string;
}

export const HINTS: readonly HintDef[] = (hintsJson as { hints: HintDef[] }).hints;

export interface TipStore {
  dismissed(): readonly string[];
  /** Persists a new list (`UiPrefs.dismissed`). */
  save(next: string[]): void;
}

export interface TipOptions {
  enabled(): boolean;
  device(): string;
  /** Minimum time between two tips on screen, milliseconds. */
  gapMs?: number;
}

/** The text key for a device: gamepad and touch have their own, everything else reads as keyboard and mouse. */
export function hintKey(h: HintDef, device: string): LocKey {
  return h.devices[device === 'gamepad' ? 'gamepad' : device === 'touch' ? 'touch' : 'kbm'];
}

export class TipEngine {
  private readonly fired = new Set<string>();
  private active: HintDef | null = null;
  private lastEnd = -Infinity;
  private readonly gap: number;

  constructor(
    private readonly hints: readonly HintDef[],
    private readonly store: TipStore,
    private readonly opts: TipOptions,
  ) {
    this.gap = opts.gapMs ?? 1500;
  }

  private done(id: string): boolean {
    return this.store.dismissed().includes(`hint:${id}`);
  }

  private shows(id: string): number {
    return this.store.dismissed().filter((d) => d.startsWith(`hint:${id}#`)).length;
  }

  /** `play`, `prompt.enter`, `prompt.interact`, or `after:<id>` (the engine fires that one itself). */
  trigger(name: string): void {
    this.fired.add(name);
  }

  /** The tip on screen now, if any. `now` is milliseconds on any clock that only goes forward. */
  current(now: number): HintDef | null {
    if (!this.opts.enabled()) {
      this.active = null;
      return null;
    }
    if (this.active) return this.active;
    if (now - this.lastEnd < this.gap) return null;
    for (const h of this.hints) {
      if (this.done(h.id) || this.shows(h.id) >= h.maxShows) continue;
      const ready = this.fired.has(h.trigger) || (h.trigger.startsWith('after:') && this.afterDone(h.trigger.slice(6)));
      if (!ready) continue;
      this.active = h;
      this.store.save([...this.store.dismissed(), `hint:${h.id}#${this.shows(h.id) + 1}`]);
      return h;
    }
    return null;
  }

  private afterDone(id: string): boolean {
    return this.done(id) || this.shows(id) >= (this.hints.find((h) => h.id === id)?.maxShows ?? 1);
  }

  /** An action was performed: the tip waiting on it is done. Returns true when a tip was dismissed. */
  action(actionId: string, now: number): boolean {
    let hit = false;
    for (const h of this.hints) {
      if (h.dismissOn !== actionId || this.done(h.id)) continue;
      if (this.active?.id !== h.id) continue;
      this.store.save([...this.store.dismissed(), `hint:${h.id}`]);
      this.active = null;
      this.lastEnd = now;
      hit = true;
    }
    return hit;
  }

  /** The prompt went away: its tip goes with it (the tip may show again next time, up to `maxShows`). */
  release(trigger: string, now: number): void {
    this.fired.delete(trigger);
    if (this.active?.trigger === trigger) {
      this.active = null;
      this.lastEnd = now;
    }
  }
}
