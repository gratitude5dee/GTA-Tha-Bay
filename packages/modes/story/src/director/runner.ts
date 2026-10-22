/**
 * The DirectorScript runner (M05a2; 03-story-cutscenes.md D6.1). A script is data: marks, actors, shots, timed actions and cues.
 *
 *  - `arm` puts the actors on their start marks and publishes the first shot on that tick;
 *  - each `step` runs the actions whose time has come (they drive the actors' NPC tasks), patches `hud.subtitle` from the cues,
 *    and moves on to the next shot at its `atSec` (an `auto` shot hands the camera to the auto-director for its span);
 *  - `finish(true)` puts the actors on their end marks.
 *
 * Its only randomness is the stream `cutscene:<scriptId>` (the start angle of an orbit), so the mission's own stream is untouched.
 * Comfort: in XR there are no cuts, the viewer is placed at `xrVantage` with 300 ms fades; with reduced motion shots are at least
 * 2 s apart and a change is a fade. Sim code under the C02 lint.
 */
import type { CameraDirective, CinematicShot } from '@dv/shared';
import type { DirectorScript, DirectorShot } from '@dv/shared/contracts/c09-cutscene';
import { PI } from '@dv/shared';
import { AutoDirector } from './auto.ts';
import { fixedInFront, fovOf, headOf, kindOfPreset, poseOfKind, pushSpline, twoShot, FIXED_DISTANCE_M, type Pose } from './presets.ts';
import {
  ALTERNATES, RayBudget, alternatePose, occluded,
} from './validate.ts';
import {
  REDUCED_FADE_SEC, REDUCED_MOTION_MIN_CUT_TICKS, TICKS_PER_SEC, XR_FADE_SEC, type Comfort, type DirEvent, type DirWorld, type Publish, type Vec3,
} from './types.ts';

type Mark = DirectorScript['marks'][string];
type Action = DirectorScript['actions'][number];

export interface RunnerEnv {
  world: DirWorld;
  comfort: () => Comfort;
  publish: Publish;
  /** A mark's position in ENU metres, or null when it cannot be resolved (a landmark that is not loaded). */
  markPos(at: Mark['at']): Vec3 | null;
  /** Puts an actor on a spot, heading `yaw` radians, and stops it. */
  place(who: string, pos: Vec3, yaw: number): void;
  /** Starts a timed action of an actor; `mark` is the resolved target of `moveTo`, `runTo`, `driveTo` and `look`. */
  act(a: Action, mark: Vec3 | null): void;
  /** Patches `hud.subtitle`; null clears it. `line` is the line key (the UI resolves the text). */
  subtitle(v: { speaker: string; line: string; startMs: number; endMs: number } | null): void;
  /** The stream `cutscene:<scriptId>`. */
  rng: { nextU32(): number };
  reason?: CameraDirective['reason'];
  log?: DirEvent[];
}

const toRad = (deg: number): number => (deg * PI) / 180;

export class DirectorRunner {
  readonly budget: RayBudget;
  private startTick = 0;
  private armed = false;
  private finished = false;
  private nextAction = 0;
  private shotIndex = -1;
  private lastShotTick = -1_000_000;
  private auto: AutoDirector | null = null;
  private cueShown: number = -1;
  readonly shots: DirectorShot[];
  readonly actions: Action[];

  constructor(readonly script: DirectorScript, private readonly env: RunnerEnv) {
    this.budget = new RayBudget(env.world);
    this.shots = [...script.shots].sort((a, b) => a.atSec - b.atSec);
    this.actions = [...script.actions].sort((a, b) => a.atSec - b.atSec);
  }

  get done(): boolean {
    return this.armed && (this.finished || this.elapsed(this.lastTick) >= this.script.durationSec * TICKS_PER_SEC);
  }

  private lastTick = 0;
  private elapsed(tick: number): number {
    return tick - this.startTick;
  }

  private log(tick: number, t: DirEvent['t'], detail: string): void {
    this.env.log?.push({ tick, t, detail });
  }

  /** Places the actors on their start marks and publishes the first shot, on this tick. */
  arm(tick: number): void {
    this.armed = true;
    this.startTick = tick;
    this.lastTick = tick;
    this.budget.begin(tick);
    for (const a of this.script.actors) {
      const m = this.script.marks[a.start];
      const p = m ? this.env.markPos(m.at) : null;
      if (m && p) this.env.place(a.who, p, toRad(m.yawDeg));
    }
    const c = this.env.comfort();
    if (c.xr) {
      this.publishVantage(tick, 0);
      return;
    }
    this.advanceShot(tick);
  }

  step(tick: number): void {
    if (!this.armed || this.finished) return;
    this.lastTick = tick;
    this.budget.begin(tick);
    const el = this.elapsed(tick);
    while (this.nextAction < this.actions.length && (this.actions[this.nextAction] as Action).atSec * TICKS_PER_SEC <= el) {
      const a = this.actions[this.nextAction++] as Action;
      const target = a.do === 'moveTo' || a.do === 'runTo' || a.do === 'driveTo' || a.do === 'look' ? this.markOfArg(a.arg) : null;
      this.env.act(a, target);
    }
    this.cues(el);
    if (this.env.comfort().xr) return;
    if (this.auto?.running) this.auto.step(tick);
    // the next shot whose time has come; with reduced motion no sooner than 2 s after the last change
    let due = this.shotIndex;
    while (due + 1 < this.shots.length && (this.shots[due + 1] as DirectorShot).atSec * TICKS_PER_SEC <= el) due++;
    if (due > this.shotIndex) {
      if (this.env.comfort().reducedMotion && tick - this.lastShotTick < REDUCED_MOTION_MIN_CUT_TICKS) return;
      this.shotIndex = due - 1;
      this.advanceShot(tick);
    }
  }

  /** Ends the run: actors go to their end marks when it ran to its end, the subtitle clears, an XR viewer fades out. */
  finish(completed: boolean, tick: number): void {
    if (!this.armed || this.finished) return;
    this.finished = true;
    this.auto?.stop();
    this.env.subtitle(null);
    if (completed) {
      for (const a of this.script.actors) {
        const m = this.script.marks[a.end];
        const p = m ? this.env.markPos(m.at) : null;
        if (m && p) this.env.place(a.who, p, toRad(m.yawDeg));
      }
    }
    if (this.env.comfort().xr) this.publishVantage(tick, 1);
  }

  private markOfArg(arg: string): Vec3 | null {
    const m = this.script.marks[arg];
    return m ? this.env.markPos(m.at) : null;
  }

  private cues(el: number): void {
    // el ticks = el x 1000 / 60 ms; compare as el x 1000 >= ms x 60 to stay in integers
    let active = -1;
    for (let i = 0; i < this.script.cues.length; i++) {
      const c = this.script.cues[i];
      if (c && el * 1000 >= c.startMs * TICKS_PER_SEC && el * 1000 < c.endMs * TICKS_PER_SEC) {
        active = i;
        break;
      }
    }
    if (active === this.cueShown) return;
    this.cueShown = active;
    const c = active >= 0 ? this.script.cues[active] : undefined;
    this.env.subtitle(c ? { speaker: c.speaker ?? '', line: c.line, startMs: c.startMs, endMs: c.endMs } : null);
  }

  private publishVantage(tick: number, fadeTo: 0 | 1): void {
    const v = this.script.xrVantage;
    const m = this.script.marks[v.mark];
    const pos = m ? this.env.markPos(m.at) : null;
    const d: CameraDirective = {
      mode: 'xr',
      xr: {
        origin: 'seat',
        ...(pos ? { vantage: { pos, yaw: toRad(v.yawDeg) } } : {}),
        turn: { snapDeg: 30, smooth: false },
        vignette: 0,
        seated: true,
        heightCalibM: 0,
        session: 'immersive-vr',
      },
      fade: { to: fadeTo, sec: XR_FADE_SEC },
      letterbox: false,
      lockPlayerToggle: true,
      reason: this.env.reason ?? 'mission',
    };
    this.log(tick, 'fade', `xr vantage fade to ${fadeTo} in ${XR_FADE_SEC} s`);
    this.env.publish(d);
  }

  private advanceShot(tick: number): void {
    this.shotIndex++;
    const shot = this.shots[this.shotIndex];
    if (!shot) return;
    const reduced = this.env.comfort().reducedMotion;
    const cut = this.lastShotTick > -1_000_000;
    this.lastShotTick = tick;
    this.auto?.stop();
    this.auto = null;
    const end = this.shots[this.shotIndex + 1]?.atSec ?? this.script.durationSec;
    const ticks = Math.max(1, Math.round((end - shot.atSec) * TICKS_PER_SEC));
    this.log(tick, 'shot', `${this.shotIndex} ${shot.preset} ${shot.subject}`);
    if (shot.preset === 'auto') {
      const auto = new AutoDirector({
        world: this.env.world,
        comfort: this.env.comfort,
        subject: shot.subject,
        seed: (this.script.seed + this.shotIndex) >>> 0,
        publish: this.env.publish,
        letterbox: this.script.letterbox,
        reason: this.env.reason ?? 'mission',
        ...(this.env.log ? { log: this.env.log } : {}),
      });
      this.auto = auto;
      auto.start(tick);
      return;
    }
    const cs = this.compile(shot, ticks, tick);
    this.env.publish({
      mode: 'cinematic',
      shot: cs,
      letterbox: this.script.letterbox,
      lockPlayerToggle: true,
      reason: this.env.reason ?? 'mission',
      ...(reduced && cut ? { fade: { to: 0 as const, sec: REDUCED_FADE_SEC } } : {}),
    });
  }

  /** The C04 shot of a preset. A fixed pose that is blocked tries the alternates in order, as far as the tick's ray budget goes. */
  private compile(shot: DirectorShot, ticks: number, tick: number): CinematicShot {
    const w = this.env.world;
    const p = w.pos(shot.subject) ?? ([0, 0, 0] as Vec3);
    const yaw = w.yaw(shot.subject);
    const base = { subject: w.handle(shot.subject), fovDeg: fovOf(shot.lens), damping: 1, durationTicks: ticks, seed: this.script.seed };
    const kind = kindOfPreset(shot.preset);
    let pose: Pose | null = null;
    switch (shot.preset) {
      case 'establish': {
        const from = shot.from ? this.markOfArg(shot.from) : null;
        pose = from ? { pos: [from[0], from[1] + 3, from[2]], lookAt: headOf(p) } : poseOfKind('wide', p, yaw);
        break;
      }
      case 'two-shot': {
        const q = shot.secondary ? w.pos(shot.secondary) : null;
        pose = q ? twoShot(p, q) : poseOfKind('wide', p, yaw);
        break;
      }
      case 'single':
      case 'insert':
      case 'reaction':
        pose = fixedInFront(p, yaw, FIXED_DISTANCE_M[shot.preset] ?? 2.2);
        break;
      case 'over-shoulder':
      case 'tracking':
        return { kind: kind ?? 'wide', ...base };
      case 'orbit':
        // the start angle of the orbit is drawn from the script's own stream (the rig reads it from `seed`)
        return { kind: 'heli', ...base, seed: (this.script.seed ^ (this.env.rng.nextU32() & 0xff)) >>> 0 };
      case 'auto':
        return { kind: 'wide', ...base };
    }
    pose = this.clearPose(pose as Pose, p, yaw, tick);
    const move = shot.move ?? (shot.preset === 'establish' ? 'push-in' : 'static');
    const sec = ticks / TICKS_PER_SEC;
    if (move === 'push-in' || move === 'pull-out') {
      return { kind: 'spline', ...base, pos: pose.pos, lookAt: pose.lookAt, spline: pushSpline(pose, sec, move === 'pull-out') };
    }
    return { kind: 'fixed', ...base, pos: pose.pos, lookAt: pose.lookAt };
  }

  private clearPose(pose: Pose, p: Vec3, yaw: number, tick: number): Pose {
    const blocked = occluded(this.budget, pose);
    if (blocked !== true) return pose;
    for (const alt of ALTERNATES) {
      const q = alternatePose(alt, pose, p, yaw);
      const bad = occluded(this.budget, q);
      this.log(tick, 'alt', `${alt} ${bad === undefined ? 'no budget' : bad ? 'blocked' : 'clear'}`);
      if (bad === undefined) break;
      if (!bad) return q;
    }
    return pose;
  }
}
