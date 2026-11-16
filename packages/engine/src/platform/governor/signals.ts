/**
 * The governor's frame-time signals (11-platform.md section 5.5): an exponential moving average of the frame time (alpha 0.06) and
 * the p90 over the last 120 rendered frames. Pure; the caller supplies the frame times in milliseconds.
 */
export const EMA_ALPHA = 0.06;
export const P90_WINDOW = 120;

export class FrameSignals {
  private readonly ring = new Float64Array(P90_WINDOW);
  private n = 0;
  private head = 0;
  private ema_ = 0;
  private seeded = false;
  private readonly scratch = new Float64Array(P90_WINDOW);

  /** Frames in the window (at most 120). */
  get count(): number {
    return this.n;
  }

  /** The moving average of the frame time, 0 before the first frame. */
  get ema(): number {
    return this.ema_;
  }

  push(ms: number): void {
    this.ring[this.head] = ms;
    this.head = (this.head + 1) % P90_WINDOW;
    if (this.n < P90_WINDOW) this.n += 1;
    this.ema_ = this.seeded ? this.ema_ + EMA_ALPHA * (ms - this.ema_) : ms;
    this.seeded = true;
  }

  /** The nearest-rank 90th percentile of the window, 0 while it is empty. */
  p90(): number {
    if (this.n === 0) return 0;
    const a = this.scratch.subarray(0, this.n);
    a.set(this.ring.subarray(0, this.n));
    a.sort();
    return a[Math.ceil(0.9 * this.n) - 1] as number;
  }

  /** Forgets the window (after a change, a stall or a tier switch); the average stays. */
  clearWindow(): void {
    this.n = 0;
    this.head = 0;
  }

  reset(): void {
    this.clearWindow();
    this.ema_ = 0;
    this.seeded = false;
  }
}
