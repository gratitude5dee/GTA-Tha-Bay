import type { Heartbeat } from './telemetry/heartbeat.ts';
import type { TelemetryClient } from './telemetry/client.ts';

/**
 * Minimal lifecycle (11-platform-pwa.md section 6; M01c scope): on `hidden` the sim pauses, the heartbeat is marked `hidden`
 * and telemetry flushes with `sendBeacon`; on `visible` the first `dt` is clamped and the heartbeat is `running` again.
 * On `pagehide` the heartbeat is `closed`, or `hidden` when the page may come back from the back-forward cache. Wake Lock,
 * audio and the save request are later milestones.
 */
export interface LifecycleTarget {
  readonly visibilityState: 'visible' | 'hidden' | string;
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}

export interface LifecycleDeps {
  doc: LifecycleTarget;
  win: Pick<LifecycleTarget, 'addEventListener' | 'removeEventListener'>;
  heartbeat: Pick<Heartbeat, 'markHidden' | 'markVisible' | 'markClosed' | 'note'>;
  telemetry: Pick<TelemetryClient, 'emit' | 'flush'>;
  /** Pause or resume the sim (the engine's `setPaused`). */
  setPaused: (paused: boolean) => void;
  /** Make the next frame's `dt` zero so the time spent hidden does not become one huge step. */
  clampNextDt: () => void;
}

export class LifecycleController {
  private hidden = false;
  private attached = false;

  constructor(private readonly d: LifecycleDeps) {}

  get isHidden(): boolean {
    return this.hidden;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.d.doc.addEventListener('visibilitychange', this.onVisibility);
    this.d.win.addEventListener('pagehide', this.onPageHide);
    this.d.win.addEventListener('pageshow', this.onPageShow);
    if (this.d.doc.visibilityState === 'hidden') this.goHidden();
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.d.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.d.win.removeEventListener('pagehide', this.onPageHide);
    this.d.win.removeEventListener('pageshow', this.onPageShow);
  }

  private readonly onVisibility = (): void => {
    if (this.d.doc.visibilityState === 'hidden') this.goHidden();
    else this.goVisible();
  };

  private readonly onPageHide = (e: Event): void => {
    const persisted = (e as PageTransitionEvent).persisted === true;
    this.d.setPaused(true);
    this.d.telemetry.flush('pagehide');
    if (persisted) this.d.heartbeat.markHidden();
    else this.d.heartbeat.markClosed();
  };

  private readonly onPageShow = (e: Event): void => {
    if ((e as PageTransitionEvent).persisted === true) this.goVisible();
  };

  private goHidden(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.d.setPaused(true);
    this.d.heartbeat.note('hidden');
    this.d.heartbeat.markHidden();
    this.d.telemetry.emit('app.hidden');
    this.d.telemetry.flush('hidden');
  }

  private goVisible(): void {
    if (!this.hidden) return;
    this.hidden = false;
    this.d.clampNextDt();
    this.d.heartbeat.note('visible');
    this.d.heartbeat.markVisible();
    this.d.setPaused(false);
  }
}
