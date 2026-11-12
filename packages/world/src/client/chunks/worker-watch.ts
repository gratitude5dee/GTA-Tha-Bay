/**
 * Whether asset.worker is still answering the landmark layer (BD-FIX-LANDMARK-PREPARE-01). The layer asks the worker questions
 * (`held`); while at least one is out, every frame in which nothing at all was heard from the worker adds the frame's length to
 * `silentMs`, at most `SILENT_FRAME_CAP_MS` per frame, and anything heard (or no question out) sets it back to 0.
 *
 * Why frames, capped: a page whose frames take seconds (software GL linking programs, a starved core) handles the worker's messages
 * late, because they wait on this thread behind those frames (the next frame can even run before them); wall-clock time between two
 * frames then says nothing about the worker. A worker whose event loop is blocked, or that is gone, answers nothing however many frames
 * run, so its silence still grows: at 60 frames a second the limit is wall-clock time, and a page that draws a frame every few seconds
 * needs `limit / SILENT_FRAME_CAP_MS` frames without a word. The same rule as `SimHost`'s stall timer (BD-REPAIR-M10d1-03).
 */

/** One frame adds at most this much silence. */
export const SILENT_FRAME_CAP_MS = 250;

export interface WorkerLine {
  /** Asks the worker about requests sent before; settles when the answer is handled on this thread, rejects when it cannot be asked. */
  held(jobs: readonly number[]): Promise<readonly (number | null)[]>;
  /** Messages handled from the worker so far. */
  heard(): number;
}

export class WorkerWatch {
  private readonly line: WorkerLine;
  private out = 0;
  private silent = 0;
  private lastHeard = -1;
  private lastFrame = -1;

  constructor(line: WorkerLine) {
    this.line = line;
  }

  /** Sends a question; its silence counts from the next frame until something is heard. */
  ask(jobs: readonly number[]): Promise<readonly (number | null)[]> {
    this.out++;
    const p = this.line.held(jobs);
    const done = (): void => void this.out--;
    p.then(done, done);
    return p;
  }

  /** Once per frame, before the layer reads `silentMs`. `now` is the layer's clock. */
  frame(now: number): void {
    const heard = this.line.heard();
    const gap = this.lastFrame < 0 ? 0 : Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    if (this.out === 0 || heard !== this.lastHeard) {
      this.silent = 0;
      this.lastHeard = heard;
      return;
    }
    this.silent += Math.min(gap, SILENT_FRAME_CAP_MS);
  }

  /** How long the worker has said nothing while a question was out (frames capped). */
  get silentMs(): number {
    return this.silent;
  }

  /** Questions out. */
  get asking(): number {
    return this.out;
  }
}
