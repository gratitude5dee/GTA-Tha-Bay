/**
 * FramePacer (11-platform.md section 5.4, P-12). A `requestAnimationFrame` callback renders when
 * `elapsed >= 1000 / targetFps - 1 ms` since the frame it is measured from, so a 30 fps tier on a 60 Hz display renders every second
 * callback and on a 90 Hz display every third. The sim keeps its fixed 60 Hz step with interpolation: a skipped callback skips the
 * whole frame, and the next one hands the engine the longer delta, so it runs two ticks per rendered frame.
 *
 * The reference time advances by one interval per rendered frame (not to the callback's own time, unless that is earlier), so a display
 * whose rate is not a multiple of the target still averages the target; a gap of two intervals or more (a stall, the first frame) restarts it.
 * In XR the pacer is bypassed: the headset clock rules.
 */
export const PACER_SLACK_MS = 1;

export class FramePacer {
  private target = 60;
  private ref = Number.NaN;
  private bypass = false;
  /** Callbacks seen and callbacks rendered since the last `reset` (QA and tests). */
  seen = 0;
  rendered = 0;

  constructor(targetFps = 60) {
    this.setTarget(targetFps);
  }

  get targetFps(): number {
    return this.target;
  }

  /** The frame rate to hold: `min(the tier's targetFps, the player's fpsCap)` (DL-727); the caller passes the minimum. */
  setTarget(fps: number): void {
    if (Number.isFinite(fps) && fps > 0) this.target = fps;
  }

  /** True while an XR session presents: every callback renders. */
  setBypass(on: boolean): void {
    this.bypass = on;
    if (on) this.ref = Number.NaN;
  }

  get bypassed(): boolean {
    return this.bypass;
  }

  /** The interval between rendered frames, ms. */
  get intervalMs(): number {
    return 1000 / this.target;
  }

  /** Should the callback at `timeMs` render? */
  shouldRender(timeMs: number): boolean {
    this.seen += 1;
    if (this.bypass || !Number.isFinite(timeMs)) {
      this.rendered += 1;
      return true;
    }
    const interval = this.intervalMs;
    if (Number.isNaN(this.ref)) {
      this.ref = timeMs;
      this.rendered += 1;
      return true;
    }
    const elapsed = timeMs - this.ref;
    if (elapsed < interval - PACER_SLACK_MS) return false;
    // A late callback advances the reference by one interval (so the average holds); an early one, within the slack, takes its own time.
    this.ref = elapsed >= interval * 2 ? timeMs : Math.min(this.ref + interval, timeMs);
    this.rendered += 1;
    return true;
  }

  reset(): void {
    this.ref = Number.NaN;
    this.seen = 0;
    this.rendered = 0;
  }
}
