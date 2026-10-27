/**
 * Ghosts (06-racing.md 2.11, D-S06-05; M07a2). A ghost is a kinematic puppet that plays a recorded transform track beside a live
 * run. It owns no physics body and never touches the live car, so the run's hash is the same with and without it (U-RAC-3).
 *
 *  - `ghostFromRun` turns a recorded run into the slice's `GhostEntry`: `trackB64` is the track section (stride and lead
 *    included), `inputsB64` the replay with its inputs and no track (null when the inputs did not fit the cap).
 *  - `GhostPlayer` reads the track: positions and speed are linear between samples, the yaw takes the short way round.
 *  - `GhostRunner` moves a puppet from the `PuppetPort`; the session calls it once a tick.
 *
 * Sim code under the C02 lint.
 */
import {
  decodeReplay, decodeTrack, encodeReplay, encodeTrack, fromBase64, PI, REPLAY_TRACK_FIELDS, toBase64, TWO_PI,
  type GhostEntry, type ReplayHeaderV1,
} from '@dv/shared';
import type { Pose } from './pose.ts';
import type { PuppetPort } from './port.ts';
import type { RecordedRun } from './recorder.ts';

export function ghostFromRun(run: RecordedRun, ms: number, savedAt: number): GhostEntry {
  const full = decodeReplay(run.bytes);
  const h = full.h;
  const trackBytes = full.track ? encodeTrack(full.track, h.trackEvery ?? 3, h.trackLead ?? 0) : new Uint8Array(0);
  const inputsOnly = full.inputs ? encodeReplay({ ...h }, Array.from(full.inputs), null) : null;
  return {
    vehicleDef: h.vehicleDef,
    ms,
    profile: h.profile,
    buildId: h.buildId,
    worldBake: h.worldBake,
    inputsB64: inputsOnly ? toBase64(inputsOnly) : null,
    trackB64: toBase64(trackBytes),
    savedAt,
  };
}

/** The header of a ghost's replay (needs the inputs), or null. */
export function ghostHeader(g: GhostEntry): ReplayHeaderV1 | null {
  if (!g.inputsB64) return null;
  try {
    return decodeReplay(fromBase64(g.inputsB64)).h;
  } catch {
    return null;
  }
}

/** The better of two ghosts of one event (lower time wins; the incumbent keeps a tie). */
export function betterGhost(old: GhostEntry | undefined, next: GhostEntry): GhostEntry {
  return old && old.ms <= next.ms ? old : next;
}

export interface GhostSample extends Pose { speedMps: number }

export class GhostPlayer {
  readonly track: Int32Array;
  readonly stride: number;
  readonly lead: number;
  readonly samples: number;

  constructor(readonly entry: GhostEntry) {
    const d = decodeTrack(fromBase64(entry.trackB64));
    this.track = d.track;
    this.stride = d.stride > 0 ? d.stride : 3;
    this.lead = d.lead;
    this.samples = Math.floor(d.track.length / REPLAY_TRACK_FIELDS);
  }

  get vehicleDef(): string {
    return this.entry.vehicleDef;
  }

  /** Ticks the track covers from the start of the attempt. */
  get durationTicks(): number {
    return Math.max(0, (this.samples - 1) * this.stride);
  }

  /** The recorded sample `i` (exactly as stored, in metres and radians). */
  sample(i: number): GhostSample {
    const k = Math.max(0, Math.min(this.samples - 1, i)) * REPLAY_TRACK_FIELDS;
    const t = this.track;
    return { x: (t[k] as number) / 50, z: (t[k + 1] as number) / 50, y: (t[k + 2] as number) / 25, yaw: yawOfTurns(t[k + 3] as number), speedMps: ((t[k + 4] as number) * 2) / 3.6 };
  }

  /** The pose `ticksSinceGo` ticks after GO (negative before it: the first sample). */
  poseAt(ticksSinceGo: number): GhostSample | null {
    if (this.samples === 0) return null;
    const f = (ticksSinceGo + this.lead) / this.stride;
    if (f <= 0) return this.sample(0);
    if (f >= this.samples - 1) return this.sample(this.samples - 1);
    const i = Math.floor(f);
    const u = f - i;
    const a = this.sample(i);
    const b = this.sample(i + 1);
    let dy = b.yaw - a.yaw;
    if (dy > PI) dy -= TWO_PI;
    else if (dy < -PI) dy += TWO_PI;
    return {
      x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, yaw: a.yaw + dy * u, speedMps: a.speedMps + (b.speedMps - a.speedMps) * u,
    };
  }
}

/** Radians in (-pi, pi] of a yaw stored as a u16 turn fraction. */
export function yawOfTurns(u16: number): number {
  const turns = (u16 & 0xffff) / 65536;
  return (turns > 0.5 ? turns - 1 : turns) * TWO_PI;
}

/** Plays one ghost through the puppet port. */
export class GhostRunner {
  private id = 0;

  constructor(readonly player: GhostPlayer, private readonly puppets: PuppetPort, private readonly prefab: string, private readonly key: string) {}

  get spawned(): boolean {
    return this.id !== 0;
  }

  /** `sinceGo` is the tick count since GO, or a negative number on the grid and in the countdown. */
  step(sinceGo: number): void {
    const p = this.player.poseAt(sinceGo);
    if (!p) return;
    if (this.id === 0) {
      this.id = this.puppets.spawn(this.prefab, this.key, p);
      return;
    }
    this.puppets.move(this.id, p);
  }

  despawn(): void {
    if (this.id !== 0) this.puppets.remove(this.id);
    this.id = 0;
  }
}
