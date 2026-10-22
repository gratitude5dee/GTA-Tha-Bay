import { atlasCell, cueAt, shapeFromEnvelope, type Viseme, type VisemeCue } from '@dv/shared/npc';
import { JAW_OPEN } from './atlas.ts';

/**
 * LipSyncDriver (04-npc.md section 5.7, M06a4), main thread. It chooses a Rhubarb mouth shape per hold interval for each speaking NPC and
 * hands it to a `LipSyncTarget` (the face decal's UV offset and, for a rig with `extras.bones.jaw`, the jaw bone).
 *
 *  - t1 speaks without timestamps: `envelope` reads the RMS of an `AnalyserNode` tapped from the voice line; `shapeFromEnvelope` maps it to
 *    X/A/B/C/D and alternates the open shapes with E/F for vowel-heavy text.
 *  - t2 alignment and baked Rhubarb files give `cues`; the shape at the audio clock time is used.
 *  - The shape is recomputed only when a new hold interval starts (60 ms, counted from the start of the speaker), so the cell never flickers
 *    faster than the hold. Time is the `AudioContext` clock in seconds, so lip and sound stay together whatever the frame rate.
 *  - At most two NPCs lip-sync at once (the encounter partner and one cutscene or bark speaker); a third `start` is refused and that NPC idles.
 *  - The jaw moves only for a speaker whose rig has the jaw bone. No blend shapes in v1 (NPC-R8).
 * One uniform update per frame per speaker at most.
 */
export interface LipSyncTarget {
  /** The atlas cell of the shape: column and row from the top left. */
  setCell(col: number, row: number, shape: Viseme): void;
  /** Jaw opening 0..1. Called only when the speaker was started with `hasJaw`. */
  setJaw(open: number): void;
}

export type LipSyncSource =
  | { kind: 'envelope'; read(): number; vowelDensity: number }
  | { kind: 'cues'; cues: readonly VisemeCue[]; /** Audio-clock second at which the cues' time zero plays. */ offsetS: number };

export interface LipSyncOptions {
  /** `AudioContext.currentTime`. */
  clock(): number;
  holdMs?: number;
  maxSpeakers?: number;
}

interface Speaker {
  target: LipSyncTarget;
  hasJaw: boolean;
  source: LipSyncSource;
  /** Absolute-time cues (cue time + offset), sorted. */
  cues: VisemeCue[];
  t0: number;
  lastStep: number;
  shape: Viseme;
}

export const HOLD_MS = 60;
export const MAX_SPEAKERS = 2;

export class LipSyncDriver {
  private readonly speakers = new Map<string, Speaker>();
  private readonly holdS: number;
  private readonly max: number;
  /** Starts refused because two NPCs were already speaking (a test and QA counter). */
  refused = 0;

  constructor(private readonly opts: LipSyncOptions) {
    this.holdS = (opts.holdMs ?? HOLD_MS) / 1000;
    this.max = opts.maxSpeakers ?? MAX_SPEAKERS;
  }

  /** Begins lip-sync for `npcId`. False (and nothing changes) when two other NPCs are speaking. An NPC that is already speaking is replaced. */
  start(npcId: string, target: LipSyncTarget, spec: { hasJaw: boolean; source: LipSyncSource }): boolean {
    if (!this.speakers.has(npcId) && this.speakers.size >= this.max) {
      this.refused++;
      return false;
    }
    const cues = spec.source.kind === 'cues' ? shifted(spec.source.cues, spec.source.offsetS) : [];
    this.speakers.set(npcId, { target, hasJaw: spec.hasJaw, source: spec.source, cues, t0: this.opts.clock(), lastStep: -1, shape: 'X' });
    return true;
  }

  /** Adds the cues of a later sentence to a speaker that runs on cues. */
  addCues(npcId: string, cues: readonly VisemeCue[], offsetS: number): void {
    const s = this.speakers.get(npcId);
    if (s === undefined || s.source.kind !== 'cues') return;
    s.cues = [...s.cues, ...shifted(cues, offsetS)].sort((a, b) => a.start - b.start);
  }

  /** Ends a speaker and closes its mouth. */
  stop(npcId: string): void {
    const s = this.speakers.get(npcId);
    if (s === undefined) return;
    this.speakers.delete(npcId);
    apply(s, 'X', true);
  }

  speaking(): string[] {
    return [...this.speakers.keys()];
  }

  /** Once per frame. A speaker's mouth changes only when its hold interval has advanced. */
  update(): void {
    const now = this.opts.clock();
    for (const s of this.speakers.values()) {
      const step = Math.floor((now - s.t0 + 1e-9) / this.holdS);
      if (step === s.lastStep || step < 0) continue;
      s.lastStep = step;
      const shape = s.source.kind === 'envelope' ? shapeFromEnvelope(s.source.read(), s.source.vowelDensity, step) : cueAt(s.cues, now);
      if (shape !== s.shape) apply(s, shape, false);
    }
  }
}

function shifted(cues: readonly VisemeCue[], offsetS: number): VisemeCue[] {
  return cues.map((c) => ({ start: c.start + offsetS, end: c.end + offsetS, shape: c.shape }));
}

function apply(s: Speaker, shape: Viseme, close: boolean): void {
  s.shape = shape;
  const { col, row } = atlasCell(shape);
  s.target.setCell(col, row, shape);
  if (s.hasJaw) s.target.setJaw(close ? 0 : JAW_OPEN[shape]);
}
