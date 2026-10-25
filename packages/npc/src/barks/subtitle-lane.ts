/**
 * The NPC layer's use of `hud.subtitle` (C06 1.1 view-model key, `{speaker, text, startMs, endMs}` as the story VM patches it). Barks and
 * ink exchanges show their text there. A line is cleared when its time is up, but only when nothing else has patched the key since: a
 * mission subtitle that arrived in the meantime stays. Sim code; C02 lint applies.
 */
import type { JsonValue } from '@dv/shared';

export interface SubtitleUi {
  patch(k: 'hud.subtitle', v: JsonValue | null): void;
  /** The last value anyone patched for the key, when the bridge can say (the sim's `SimUiBridge.peek`). */
  peek?(k: 'hud.subtitle'): JsonValue | null | undefined;
}

const KEY = 'hud.subtitle' as const;
const msOf = (tick: number): number => Math.round((tick * 1000) / 60);

export class SubtitleLane {
  private ours: { text: string; endTick: number } | null = null;
  /** Subtitles shown so far (QA and tests). */
  shown = 0;

  constructor(private readonly ui: SubtitleUi) {}

  /** Patches a line for `[tick, endTick)`. A newer line replaces an older one. */
  show(speaker: string, text: string, tick: number, endTick: number): void {
    this.ours = { text, endTick };
    this.shown++;
    this.ui.patch(KEY, { speaker, text, startMs: msOf(tick), endMs: msOf(endTick) });
  }

  /** Clears our line when it has run out and is still the one on screen. */
  update(tick: number): void {
    const o = this.ours;
    if (!o || tick < o.endTick) return;
    this.ours = null;
    const now = this.ui.peek?.(KEY);
    if (now !== undefined && now !== null && (now as { text?: unknown }).text !== o.text) return;
    this.ui.patch(KEY, null);
  }

  get active(): boolean {
    return this.ours !== null;
  }
}
