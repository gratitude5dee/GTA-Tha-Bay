/**
 * The input-line recorder (QA builds, debug panel; M03a1). It sees the `InputFrame` of every tick while recording and keeps the
 * quantized fields as a run-length list. `toLine` turns the list into a `LineFile`. Not bundled into production builds.
 */
import type { InputFrame, SimProfile } from '@dv/shared';
import { encodeRuns, lineInputOf, LINE_VERSION, type LineFile, type LineInput } from './format.ts';

export interface RecorderStart {
  scenario: string;
  seed: number;
  profile: SimProfile;
  pos: [number, number, number];
  yaw: number;
  prefab?: string;
  speed?: number;
}

export class LineRecorder {
  private frames: LineInput[] = [];
  private active = false;
  private start: RecorderStart | null = null;

  get recording(): boolean {
    return this.active;
  }

  get length(): number {
    return this.frames.length;
  }

  begin(start: RecorderStart): void {
    this.frames = [];
    this.start = start;
    this.active = true;
  }

  /** Call once per tick, in tick order, with the frame the sim is about to read. */
  record(frame: InputFrame): void {
    if (this.active) this.frames.push(lineInputOf(frame));
  }

  /** Stops recording and returns the line (ticks counted from the first recorded frame). */
  end(): LineFile {
    this.active = false;
    const s = this.start;
    if (!s) throw new Error('LineRecorder.end: begin() was not called');
    return {
      v: LINE_VERSION,
      scenario: s.scenario,
      seed: s.seed,
      profile: s.profile,
      start: { pos: [...s.pos], yaw: s.yaw, ...(s.prefab !== undefined ? { prefab: s.prefab } : {}), ...(s.speed !== undefined ? { speed: s.speed } : {}) },
      frames: encodeRuns(this.frames),
    };
  }
}
