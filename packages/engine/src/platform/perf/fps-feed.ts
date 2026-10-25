import { PerfProbe } from './probe.ts';

export interface FpsSample {
  fps: number;
}

/**
 * The frame rate the player sees (FPS chip, shell signal). Fed the rAF timestamp of every frame, it keeps the last 120 intervals and
 * reports `round(1000 / median)` at most once per `periodMs` of fed time. The median shrugs off one long frame; the number is whole.
 */
export class FpsFeed {
  private readonly probe = new PerfProbe(120);
  private last = Number.NaN;
  private lastEmit = Number.NaN;

  constructor(
    private readonly emit: (s: FpsSample) => void,
    private readonly periodMs = 1000,
  ) {}

  before(time: number): void {
    if (Number.isFinite(this.last)) this.probe.push(time - this.last);
    this.last = time;
    if (this.probe.count === 0) return;
    if (Number.isFinite(this.lastEmit) && time - this.lastEmit < this.periodMs) return;
    const median = this.probe.percentile(0.5);
    if (!(median > 0)) return;
    this.lastEmit = time;
    this.emit({ fps: Math.round(1000 / median) });
  }

  reset(): void {
    this.probe.reset();
    this.last = Number.NaN;
    this.lastEmit = Number.NaN;
  }
}
