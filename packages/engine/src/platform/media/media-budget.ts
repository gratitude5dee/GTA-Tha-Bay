/**
 * The media budget (11-platform-pwa.md section 7): at most one clip decoding and one pre-rolled. A third `prepare` is refused with
 * the C09 fallback trigger `budget`. The accounted media bytes (the sum of the renditions' `bytes`) go to a sink, which is the
 * MemoryBudget `media` counter on mobile tiers (64 MB line); `maxMediaMB` is that line, or null where the tier has none.
 */

export type BudgetSlot = 'decoding' | 'preroll';
export type BudgetResult = { ok: true; slot: BudgetSlot } | { ok: false; reason: 'budget' };

export interface MediaBudgetOptions {
  maxMediaMB: number | null;
  /** Receives the accounted media MB after every change. */
  sink?: (mediaMB: number) => void;
}

const MB = 1024 * 1024;

export class MediaBudget {
  private decoding: { id: string; bytes: number } | null = null;
  private preroll: { id: string; bytes: number } | null = null;

  constructor(private readonly opts: MediaBudgetOptions) {}

  /** The media line in MB (64 on the mobile tiers), null where the tier has none. */
  get limitMB(): number | null {
    return this.opts.maxMediaMB;
  }

  /** Reserves a slot for a clip of `bytes`: decoding first, then pre-roll; refused when both are taken or the line would be crossed. */
  prepare(id: string, bytes: number): BudgetResult {
    if (this.decoding?.id === id || this.preroll?.id === id) return { ok: true, slot: this.decoding?.id === id ? 'decoding' : 'preroll' };
    const slot: BudgetSlot | null = this.decoding === null ? 'decoding' : this.preroll === null ? 'preroll' : null;
    if (slot === null) return { ok: false, reason: 'budget' };
    if (this.opts.maxMediaMB !== null && (this.bytes() + bytes) / MB > this.opts.maxMediaMB) return { ok: false, reason: 'budget' };
    if (slot === 'decoding') this.decoding = { id, bytes };
    else this.preroll = { id, bytes };
    this.report();
    return { ok: true, slot };
  }

  /** Frees the clip's slot; a pre-rolled clip becomes the decoding one. */
  release(id: string): void {
    if (this.decoding?.id === id) {
      this.decoding = this.preroll;
      this.preroll = null;
    } else if (this.preroll?.id === id) this.preroll = null;
    else return;
    this.report();
  }

  /** Accounted bytes of the reserved clips. */
  bytes(): number {
    return (this.decoding?.bytes ?? 0) + (this.preroll?.bytes ?? 0);
  }

  mediaMB(): number {
    return this.bytes() / MB;
  }

  held(): string[] {
    return [this.decoding?.id, this.preroll?.id].filter((x): x is string => x !== undefined);
  }

  private report(): void {
    this.opts.sink?.(this.mediaMB());
  }
}
