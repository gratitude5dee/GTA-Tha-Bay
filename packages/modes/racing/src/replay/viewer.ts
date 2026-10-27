/**
 * The replay viewer (06-racing.md 2.11; M07a2). It opens a replay and decides how to show it:
 *
 *  - `exact`: the header names this build's `handlingRev`, `buildId` and `worldBake`, the replay is canonical and its inputs fit the
 *    cap, so the run is re-simulated from the inputs (`replayFrames` in `qa/headless.ts` is the frame source of a headless
 *    re-simulation; the game feeds the same frames to a viewer session). `verify` then checks the result against the header.
 *  - `track`: anything else. The recorded transform track plays like a ghost and `racing.verify_fail {reason}` says why.
 *
 * Telemetry: `racing.replay_view {mode}` once on open; `racing.verify_fail` with the first reason when the replay cannot be
 * trusted (a client emits it; C16 lists the name as server-only, so the ingest drops it from a client batch: the validator of
 * M12e is the party that counts). Sim code under the C02 lint is not needed here: this runs on the page or in Node.
 */
import {
  decodeReplay, encodeTrack, REPLAY_TRACK_STRIDE, replayMismatch, toBase64, type DecodedReplay, type GhostEntry, type ReplayContext, type ReplayMismatch,
} from '@dv/shared';
import { GhostPlayer } from '../sim/ghosts.ts';
import { replayViewProps, verifyFailProps, type Props } from '../sim/telemetry.ts';

export interface ViewerTelemetry {
  emit(name: 'racing.replay_view' | 'racing.verify_fail', props: Props): void;
}

export type VerifyFailure = ReplayMismatch | 'endHash' | 'finishTick' | 'gateTicks' | 'format';

export interface ResimResult {
  finishTick: number | null;
  gateTicks: readonly number[];
  endHash: string;
}

export class ReplayViewer {
  readonly decoded: DecodedReplay | null;
  readonly mismatch: ReplayMismatch[];
  private current: 'exact' | 'track';
  private failure: VerifyFailure | null = null;

  /** `opts.mismatch` replaces the header check (the mutant suites; nothing else sets it). */
  constructor(bytes: Uint8Array, cur: ReplayContext, private readonly tel: ViewerTelemetry, opts: { mismatch?: typeof replayMismatch } = {}) {
    let d: DecodedReplay | null = null;
    try {
      d = decodeReplay(bytes);
    } catch {
      d = null;
    }
    this.decoded = d;
    this.mismatch = d ? (opts.mismatch ?? replayMismatch)(d.h, cur) : [];
    const exact = d !== null && this.mismatch.length === 0 && d.inputs !== null && d.h.profile === 'canonical';
    this.current = exact ? 'exact' : 'track';
    if (d === null) this.fail('format');
    else if (this.mismatch.length > 0) this.fail(this.mismatch[0] as ReplayMismatch);
    tel.emit('racing.replay_view', replayViewProps(this.current));
  }

  /** How the replay plays now: it falls back to `track` when a check fails. */
  get mode(): 'exact' | 'track' {
    return this.current;
  }

  get reason(): VerifyFailure | null {
    return this.failure;
  }

  private fail(reason: VerifyFailure): void {
    if (this.failure === null) {
      this.failure = reason;
      this.tel.emit('racing.verify_fail', verifyFailProps(reason));
    }
    this.current = 'track';
  }

  /** Compares a finished re-simulation with the header. False (and `mode` is `track`) on any difference. */
  verify(r: ResimResult): boolean {
    const d = this.decoded;
    if (!d) return false;
    if (r.finishTick !== d.h.finishTick) this.fail('finishTick');
    else if (r.gateTicks.length !== d.h.gateTicks.length || r.gateTicks.some((t, i) => t !== d.h.gateTicks[i])) this.fail('gateTicks');
    else if (r.endHash !== d.h.endHash) this.fail('endHash');
    return this.current === 'exact';
  }

  /** The track as a ghost entry, for the fallback playback; null when the replay has no track. */
  trackGhost(): GhostPlayer | null {
    const d = this.decoded;
    if (!d || !d.track) return null;
    const entry: GhostEntry = {
      vehicleDef: d.h.vehicleDef, ms: 0, profile: d.h.profile, buildId: d.h.buildId, worldBake: d.h.worldBake, inputsB64: null,
      trackB64: toBase64(encodeTrack(d.track, d.h.trackEvery ?? REPLAY_TRACK_STRIDE, d.h.trackLead ?? 0)), savedAt: 0,
    };
    return new GhostPlayer(entry);
  }
}
