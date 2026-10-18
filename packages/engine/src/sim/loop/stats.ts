import type { LoopStats } from '@dv/shared';

/** LoopStats plus counters the contract does not carry. Assignable to LoopStats. */
export interface LoopStatsExt extends LoopStats {
  /** NaN values met while hashing (a bug signal: sim state should never hold NaN). */
  nanCount: number;
}

const WINDOW = 240; // about four seconds of ticks

/** Rolling tick-duration window, dropped-time and overrun counters. The host supplies timing; the sim has no clock. */
export class TickStats {
  private readonly samples = new Float64Array(WINDOW);
  private count = 0;
  private head = 0;
  droppedSec = 0;
  overruns = 0;
  ticksLastFrame = 0;
  nanCount = 0;

  recordTick(ms: number): void {
    this.samples[this.head] = ms;
    this.head = (this.head + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;
  }

  private percentile(sorted: Float64Array, p: number): number {
    if (sorted.length === 0) return 0;
    const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[i] as number;
  }

  snapshot(tick: number): LoopStatsExt {
    const sorted = this.samples.slice(0, this.count).sort((a, b) => a - b);
    return {
      tick,
      ticksLastFrame: this.ticksLastFrame,
      tickMsP50: this.percentile(sorted, 0.5),
      tickMsP99: this.percentile(sorted, 0.99),
      droppedSec: this.droppedSec,
      overruns: this.overruns,
      nanCount: this.nanCount,
    };
  }
}
