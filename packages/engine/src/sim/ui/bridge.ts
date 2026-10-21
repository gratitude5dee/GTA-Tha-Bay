import type { JsonValue, ToastKind, UiBridge, VmKey, VmPatch } from '@dv/shared';
import { PatchCoalescer } from './coalesce.ts';

/** What one flush of the sim-side bridge hands to the page (the `ui` envelope of the event ring). */
export interface UiOut {
  patches: VmPatch[];
  toasts: { id: string; kind: ToastKind; text: string; params?: Record<string, string | number> }[];
  /** `open:<app>` and `close` in call order. */
  ops: string[];
}

/** Toasts and ops are small; a tick that raises more than this many keeps the newest. */
const MAX_TOASTS = 16;
const MAX_OPS = 16;

/**
 * Sim side of `ModeContext.ui` (C06 1.1). Calls only queue; `flushTick` runs once per tick (in `SimStage.Rules`, after the systems
 * that patch) and moves what is allowed into the outbox. The runtime sends the outbox to the page once per frame group.
 */
export class SimUiBridge implements UiBridge {
  private readonly coalescer = new PatchCoalescer();
  private patches: VmPatch[] = [];
  private toasts: UiOut['toasts'] = [];
  private ops: string[] = [];
  /** Totals, for the bridge QA. */
  sent = { patches: 0, toasts: 0 };

  patch(k: VmKey, v: JsonValue | null): void {
    this.coalescer.push(k, v);
  }

  toast(t: { id: string; kind: ToastKind; text: string; params?: Record<string, string | number> }): void {
    if (this.toasts.length >= MAX_TOASTS) this.toasts.shift();
    this.toasts.push(t);
  }

  openApp(app: string): void {
    if (this.ops.length < MAX_OPS) this.ops.push(`open:${app}`);
  }

  closeOverlay(): void {
    if (this.ops.length < MAX_OPS) this.ops.push('close');
  }

  /** Patches still waiting for a later tick. */
  get backlog(): number {
    return this.coalescer.pending;
  }

  get oversized(): number {
    return this.coalescer.oversized;
  }

  /** Moves this tick's allowance of patches to the outbox. Returns how many left. */
  flushTick(): number {
    const out = this.coalescer.flush();
    for (const p of out) this.patches.push(p);
    this.sent.patches += out.length;
    return out.length;
  }

  /** Takes what has gathered since the last call; null when there is nothing. */
  takeOutbox(): UiOut | null {
    if (this.patches.length === 0 && this.toasts.length === 0 && this.ops.length === 0) return null;
    const out: UiOut = { patches: this.patches, toasts: this.toasts, ops: this.ops };
    this.sent.toasts += this.toasts.length;
    this.patches = [];
    this.toasts = [];
    this.ops = [];
    return out;
  }
}
