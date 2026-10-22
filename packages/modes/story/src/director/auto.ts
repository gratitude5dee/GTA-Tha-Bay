/**
 * The auto-director (M05a2; 03-story-cutscenes.md D6.2). It picks a shot for a subject from a fixed vocabulary, holds it for a fixed
 * time, keeps the subject in view and cuts when the view stays blocked. Used for `auto` shots of a DirectorScript, for the `camera`
 * op of a mission and for race replays. The vocabulary and the durations are data ported from the gta-sa-earth pattern, not code
 * [research/repos-world.md section 3.4, P15]:
 *
 *  - on foot: shoulder, shoulder, wide, shoulder, heli;
 *  - in a vehicle: chase, chase, flyby, flyby, side, front, heli, rearlow, enemy (only while a pursuer exists), chase;
 *  - flyby 3.8 s, front 3.2 s, every other shot 4.2 s + a random 0 to 2.6 s, the random part a hash of (seed, shot index).
 *
 * Comfort: with reduced motion no two cuts are closer than 2 s and every cut is a fade; in XR the auto-director publishes nothing
 * (the viewer keeps the rig; a script's fixed vantage is the runner's). Sim code under the C02 lint.
 */
import type { CameraDirective, CinematicShot, ShotKind } from '@dv/shared';
import { hash32 } from '../vm/util.ts';
import { poseOfKind, type Pose } from './presets.ts';
import {
  ALTERNATES, OcclusionTracker, RayBudget, adjustKind, alternatePose, occluded, type Alternate,
} from './validate.ts';
import {
  REDUCED_FADE_SEC, REDUCED_MOTION_MIN_CUT_TICKS, TICKS_PER_SEC, type Comfort, type DirEvent, type DirWorld, type Publish,
} from './types.ts';

export const ON_FOOT_VOCAB: readonly ShotKind[] = ['shoulder', 'shoulder', 'wide', 'shoulder', 'heli'];
export const VEHICLE_VOCAB: readonly ShotKind[] = ['chase', 'chase', 'flyby', 'flyby', 'side', 'front', 'heli', 'rearlow', 'enemy', 'chase'];

/** Seconds a shot of `kind` holds: flyby 3.8, front 3.2, else 4.2 + hash(seed, index) x 2.6. */
export function shotSeconds(kind: ShotKind, seed: number, index: number): number {
  if (kind === 'flyby') return 3.8;
  if (kind === 'front') return 3.2;
  const rand = (hash32(seed, index, 'dur') % 1000) / 1000;
  return 4.2 + rand * 2.6;
}

/** The kind of shot `index`: a hash of (seed, index) into the vocabulary; `enemy` is skipped while no pursuer exists. */
export function pickKind(vocab: readonly ShotKind[], seed: number, index: number, hasPursuer: boolean): ShotKind {
  let i = hash32(seed, index) % vocab.length;
  for (let n = 0; n < vocab.length; n++) {
    const k = vocab[i] as ShotKind;
    if (k !== 'enemy' || hasPursuer) return k;
    i = (i + 1) % vocab.length;
  }
  return vocab[0] as ShotKind;
}

export interface AutoOptions {
  world: DirWorld;
  comfort: () => Comfort;
  /** `player`, a cast name or `soul:<id>`. */
  subject: string;
  seed: number;
  publish: Publish;
  letterbox?: boolean;
  reason?: CameraDirective['reason'];
  log?: DirEvent[];
}

export class AutoDirector {
  readonly budget: RayBudget;
  readonly occlusion = new OcclusionTracker();
  index = -1;
  kind: ShotKind = 'wide';
  private pose: Pose | null = null;
  private fixedPose = false;
  private endTick = 0;
  private lastCut = -1_000_000;
  private cursor = 0;
  private active = false;

  constructor(private readonly o: AutoOptions) {
    this.budget = new RayBudget(o.world);
  }

  get running(): boolean {
    return this.active;
  }

  private log(tick: number, t: DirEvent['t'], detail: string): void {
    this.o.log?.push({ tick, t, detail });
  }

  start(tick: number): void {
    this.active = true;
    this.index = -1;
    this.budget.begin(tick);
    this.nextShot(tick, false);
  }

  stop(): void {
    this.active = false;
  }

  /** One tick: the shot timer, the view check, the alternates and the cut. */
  step(tick: number): void {
    if (!this.active) return;
    this.budget.begin(tick);
    const w = this.o.world;
    const p = w.pos(this.o.subject);
    if (!p || this.o.comfort().xr) return;
    if (tick >= this.endTick) {
      this.nextShot(tick, true);
      return;
    }
    const cur = this.fixedPose && this.pose ? this.pose : poseOfKind(this.kind, p, w.yaw(this.o.subject));
    const yaw = w.yaw(this.o.subject);
    const blocked = occluded(this.budget, cur);
    if (blocked === undefined) return;
    const t = this.occlusion.step(blocked);
    if (!blocked) {
      this.cursor = 0;
      return;
    }
    // the way is blocked: the alternates in order, as many as the tick's budget allows; the rest wait for the next tick
    while (this.budget.left > 0) {
      const alt = ALTERNATES[this.cursor] as Alternate;
      const pose = alternatePose(alt, cur, p, yaw);
      const bad = occluded(this.budget, pose);
      if (bad === undefined) break;
      this.log(tick, 'alt', `${alt} ${bad ? 'blocked' : 'clear'}`);
      this.cursor++;
      if (!bad) {
        this.useAlternate(tick, pose);
        this.cursor = 0;
        this.occlusion.reset();
        return;
      }
      if (this.cursor >= ALTERNATES.length) {
        this.cursor = 0;
        break;
      }
    }
    if (t.cut) {
      const reduced = this.o.comfort().reducedMotion;
      if (reduced && tick - this.lastCut < REDUCED_MOTION_MIN_CUT_TICKS) return;
      this.log(tick, 'cut', `blocked ${t.blocked} ticks`);
      this.nextShot(tick, true);
    }
  }

  private nextShot(tick: number, isCut: boolean): void {
    const w = this.o.world;
    const comfort = this.o.comfort();
    const p = w.pos(this.o.subject);
    this.index++;
    this.occlusion.reset();
    this.cursor = 0;
    this.fixedPose = false;
    if (comfort.xr) return;
    const inV = w.inVehicle(this.o.subject);
    const wanted = pickKind(inV ? VEHICLE_VOCAB : ON_FOOT_VOCAB, this.o.seed, this.index, w.hasPursuer());
    let kind = wanted;
    if (p) {
      const d = adjustKind(this.budget, w, this.o.subject, wanted, inV);
      kind = d.kind;
      if (d.why) this.log(tick, d.why.startsWith('hill') ? 'hill' : 'demote', `${wanted} -> ${kind} (${d.why})`);
    }
    this.kind = kind;
    let ticks = Math.round(shotSeconds(kind, this.o.seed, this.index) * TICKS_PER_SEC);
    if (comfort.reducedMotion) ticks = Math.max(ticks, REDUCED_MOTION_MIN_CUT_TICKS);
    this.endTick = tick + ticks;
    this.pose = p ? poseOfKind(kind, p, w.yaw(this.o.subject)) : null;
    if (isCut) this.lastCut = tick;
    this.log(tick, 'shot', `${this.index} ${kind} ${ticks}`);
    const shot: CinematicShot = { kind, subject: w.handle(this.o.subject), fovDeg: 60, damping: 1, durationTicks: ticks, seed: this.o.seed };
    this.publishShot(shot, isCut && comfort.reducedMotion);
  }

  private useAlternate(tick: number, pose: Pose): void {
    this.fixedPose = true;
    this.pose = pose;
    const shot: CinematicShot = {
      kind: 'fixed', subject: this.o.world.handle(this.o.subject), pos: pose.pos, lookAt: pose.lookAt, fovDeg: 60, damping: 1,
      durationTicks: Math.max(1, this.endTick - tick), seed: this.o.seed,
    };
    this.publishShot(shot, false);
  }

  private publishShot(shot: CinematicShot, fade: boolean): void {
    const d: CameraDirective = {
      mode: 'cinematic',
      shot,
      letterbox: this.o.letterbox ?? false,
      lockPlayerToggle: true,
      reason: this.o.reason ?? 'mission',
      ...(fade ? { fade: { to: 0 as const, sec: REDUCED_FADE_SEC } } : {}),
    };
    this.o.publish(d);
  }
}
