/**
 * The replay recorder (06-racing.md 2.11; M07a2). It sees every tick of one attempt from the moment the director enters Grid:
 * the quantized input word (steer, throttle, brake, five buttons and the `ready` command) and, every `stride` ticks, the pose of
 * the car for the ghost track. On the finish it builds the `ReplayHeaderV1`, encodes the replay and checks the size caps: inputs
 * over 12,288 B are dropped (the replay then plays as a track only), a track over 16,384 B is thinned by doubling the stride.
 * Sim code under the C02 lint.
 */
import {
  encodeInputs, encodeReplay, encodeTrack, normalizeAngle, packReplayFrame, replayWithinLimits, REPLAY_BUTTON, REPLAY_LIMITS, REPLAY_TRACK_FIELDS, REPLAY_TRACK_STRIDE, TWO_PI,
  type InputFrame, type ReplayHeaderV1, SimButton,
} from '@dv/shared';

export interface RecordedRun {
  bytes: Uint8Array;
  header: ReplayHeaderV1;
  /** The inputs fit the cap and are in the bytes. */
  hasInputs: boolean;
  ticks: number;
  trackStride: number;
}

export type ReplayHeaderBase = Omit<ReplayHeaderV1, 'startTick' | 'finishTick' | 'gateTicks' | 'endHash' | 'trackEvery' | 'trackLead'>;

const bit = (f: InputFrame, b: number): boolean => (f.buttons & (1 << b)) !== 0;

export class ReplayRecorder {
  private words: number[] = [];
  private samples: number[] = [];
  private start = -1;
  private active = false;

  /** A new attempt: the director entered Grid at `tick`. */
  begin(tick: number): void {
    this.words = [];
    this.samples = [];
    this.start = tick;
    this.active = true;
  }

  /** The tick of frame 0. */
  get startTick(): number {
    return this.start;
  }

  get recording(): boolean {
    return this.active;
  }

  get tickCount(): number {
    return this.words.length;
  }

  /** Bytes the inputs section would take now (QA and the size tests). */
  inputBytes(): number {
    return encodeInputs(this.words).length;
  }

  /** One tick: the input frame, whether the player pressed ready this tick, and the car pose (null while there is none). */
  record(f: InputFrame, ready: boolean, pose: { x: number; y: number; z: number; yaw: number; speedMps: number } | null): void {
    if (!this.active) return;
    const buttons =
      (bit(f, SimButton.Handbrake) ? REPLAY_BUTTON.handbrake : 0) | (bit(f, SimButton.Nitro) ? REPLAY_BUTTON.nitro : 0) |
      (bit(f, SimButton.Interact) ? REPLAY_BUTTON.reset : 0) | (ready ? REPLAY_BUTTON.ready : 0);
    this.words.push(packReplayFrame(f.steer, f.throttle, f.brake, buttons));
    // the track keeps every tick at the finest stride; `finish` thins it to the cap
    if (pose) {
      const turns = normalizeAngle(pose.yaw) / TWO_PI;
      const yaw = Math.round((turns < 0 ? turns + 1 : turns) * 65536) & 0xffff;
      this.samples.push(Math.round(pose.x * 50), Math.round(pose.z * 50), Math.round(pose.y * 25), yaw, Math.round(pose.speedMps * 3.6 * 0.5));
    } else {
      const n = this.samples.length;
      if (n >= REPLAY_TRACK_FIELDS) for (let k = 0; k < REPLAY_TRACK_FIELDS; k++) this.samples.push(this.samples[n - REPLAY_TRACK_FIELDS + k] as number);
      else this.samples.push(0, 0, 0, 0, 0);
    }
  }

  /** Ends the attempt and encodes it. `finishTick` is null for a DNF (then there is no leaderboard replay, only a track). */
  finish(base: ReplayHeaderBase, finishTick: number | null, gateTicks: readonly number[], endHash: string, lead = 0): RecordedRun {
    this.active = false;
    const all = Int32Array.from(this.samples);
    const total = this.words.length;
    let stride = REPLAY_TRACK_STRIDE;
    let track = thin(all, stride);
    let inputs: readonly number[] | null = this.words;
    if (encodeInputs(this.words).length > REPLAY_LIMITS.maxInputsBytes || total / 60 > REPLAY_LIMITS.maxDurationSec) inputs = null;
    while (encodeTrack(track, stride).length > REPLAY_LIMITS.maxTrackBytes && stride < 48) {
      stride *= 2;
      track = thin(all, stride);
    }
    const header: ReplayHeaderV1 = { ...base, startTick: this.start, finishTick, gateTicks: [...gateTicks], endHash, trackEvery: stride, trackLead: lead };
    const bytes = encodeReplay(header, inputs, track);
    return { bytes, header, hasInputs: inputs !== null, ticks: total, trackStride: stride };
  }
}

/** Every `stride`-th tick of the per-tick samples (five values each). */
function thin(all: Int32Array, stride: number): Int32Array {
  const n = Math.floor(all.length / REPLAY_TRACK_FIELDS);
  const keep: number[] = [];
  for (let i = 0; i < n; i += stride) for (let k = 0; k < REPLAY_TRACK_FIELDS; k++) keep.push(all[i * REPLAY_TRACK_FIELDS + k] as number);
  return Int32Array.from(keep);
}

export { replayWithinLimits };
