/**
 * The director as the mission runtime uses it (M05a2; 03-story-cutscenes.md D6): the glue between a `ModeContext` and the pure
 * runner and auto-director. It builds the read-only `DirWorld` from the ECS and physics queries, turns the runner's actor and
 * action calls into `Actors` moves and NPC tasks, patches `hud.subtitle`, and publishes the directives through `ctx.camera.direct`.
 * One `DirectorScript` runs at a time (the beat), and one auto-director can run beside the mission (the `camera` op). It steps
 * once per mission tick, in `SimStage.Script` (the story mode's tick runs there). Sim code under the C02 lint.
 */
import { datan2, type CameraDirective, type EntityHandle, type ModeContext, type Rng } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import type { Actors } from '../vm/actors.ts';
import { stepToward } from '../vm/tasks.ts';
import type { TaskRunner } from '../vm/tasks.ts';
import { AutoDirector } from './auto.ts';
import { DirectorRunner, type RunnerEnv } from './runner.ts';
import type { Comfort, DirEvent, DirWorld, Vec3 } from './types.ts';

export interface SystemHost {
  ctx(): ModeContext;
  actors: Actors;
  tasks: TaskRunner;
  /** A mark's ENU position, or null. */
  markPos(at: DirectorScript['marks'][string]['at']): Vec3 | null;
  comfort(): Comfort;
  /** The cast name that plays the soul `<id>`, or null. */
  castOfSoul(soul: string): string | null;
  /** Records a mission event (`dir.action` ...) on the timeline. */
  note(name: string, data: Record<string, string | number | boolean>): void;
  /** Lets a task name a director mark as a zone (`dir:<mark>`). */
  defineMarkZone(zone: string, pos: Vec3): void;
  clearMarkZones(): void;
}

const PLAYER_WALK_MPS = 1.4;
const PLAYER_RUN_MPS = 4.5;
const PLAYER_DRIVE_MPS = 8;

function soft<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && e.name === 'NotYetAvailable') return undefined;
    throw e;
  }
}

export class DirectorSystem {
  runner: DirectorRunner | null = null;
  auto: AutoDirector | null = null;
  /** The director's log (shots, cuts, alternates) for the debugger and the tests. */
  readonly events: DirEvent[] = [];
  private playerMove: { to: Vec3; mps: number } | null = null;

  constructor(private readonly host: SystemHost) {}

  /** The view of the world the director reads. */
  world(): DirWorld {
    const h = this.host;
    const handleOf = (who: string): EntityHandle | null => {
      if (who.startsWith('soul:')) {
        const cast = h.castOfSoul(who.slice(5));
        return cast === null ? null : h.actors.cast(cast);
      }
      return h.actors.handleOf(who);
    };
    return {
      pos: (who) => {
        const e = handleOf(who);
        return e === null ? null : h.actors.posOf(e);
      },
      yaw: (who) => {
        const e = handleOf(who);
        return e === null ? 0 : h.actors.yawOf(e);
      },
      up: () => [0, 1, 0],
      handle: (who) => handleOf(who) ?? 0,
      inVehicle: (who) => (who === 'player' ? h.actors.playerVehicle() !== null : h.actors.inVehicle(who)),
      hasPursuer: () => {
        const s = soft(() => h.ctx().pursuit.state());
        return s !== undefined && s.phase !== 'clear';
      },
      castRay: (from, dir, maxM) => {
        const hit = h.ctx().physics.castRay(from, dir, maxM);
        return hit ? hit.toi : null;
      },
    };
  }

  private publish = (d: CameraDirective): void => {
    soft(() => this.host.ctx().camera.direct(d));
  };

  /** Starts a script (a beat). The first shot is published on this tick. */
  arm(script: DirectorScript, reason: CameraDirective['reason'], rng: Rng): DirectorRunner {
    this.disarm(false);
    const h = this.host;
    const env: RunnerEnv = {
      world: this.world(),
      comfort: () => h.comfort(),
      publish: this.publish,
      markPos: (at) => h.markPos(at),
      place: (who, pos, yaw) => {
        const e = who.startsWith('soul:') ? this.world().handle(who) : (h.actors.handleOf(who) ?? 0);
        if (e !== 0) {
          const gy = soft(() => h.ctx().physics.groundY(pos[0], pos[2]));
          h.actors.place(e as EntityHandle, [pos[0], gy ?? pos[1], pos[2]], yaw);
        }
      },
      act: (a, mark) => this.act(script, a, mark),
      subtitle: (v) => {
        const t0 = Math.round((h.ctx().tick * 1000) / 60);
        h.ctx().ui.patch('hud.subtitle', v ? { speaker: v.speaker, text: v.line, startMs: t0, endMs: t0 + (v.endMs - v.startMs) } : null);
      },
      rng,
      reason,
      log: this.events,
    };
    const r = new DirectorRunner(script, env);
    this.runner = r;
    r.arm(h.ctx().tick);
    return r;
  }

  private act(script: DirectorScript, a: DirectorScript['actions'][number], mark: Vec3 | null): void {
    const h = this.host;
    const tick = h.ctx().tick;
    h.note('dir.action', { who: a.who, do: a.do, arg: a.arg });
    const isCast = a.who !== 'player' && h.actors.cast(a.who) !== null;
    if (a.who === 'player') {
      if (mark && (a.do === 'moveTo' || a.do === 'runTo' || a.do === 'driveTo')) {
        this.playerMove = { to: mark, mps: a.do === 'moveTo' ? PLAYER_WALK_MPS : a.do === 'runTo' ? PLAYER_RUN_MPS : PLAYER_DRIVE_MPS };
      } else if (mark && a.do === 'look') {
        const p = h.actors.player();
        const here = p === null ? null : h.actors.posOf(p);
        if (p !== null && here) h.actors.place(p, here, datan2(-(mark[0] - here[0]), -(mark[2] - here[2])));
      }
      return;
    }
    if (!isCast) return;
    const zone = `dir:${script.id}:${a.arg}`;
    if (mark) h.defineMarkZone(zone, mark);
    switch (a.do) {
      case 'moveTo':
        h.tasks.assign(a.who, { t: 'goto', zone, mode: 'walk' }, tick);
        return;
      case 'runTo':
        h.tasks.assign(a.who, { t: 'goto', zone, mode: 'run' }, tick);
        return;
      case 'driveTo':
        h.tasks.assign(a.who, { t: 'driveTo', zone, style: 'normal' }, tick);
        return;
      case 'anim':
        h.tasks.assign(a.who, { t: 'anim', clip: a.arg }, tick);
        return;
      case 'look':
        if (mark) {
          const e = h.actors.cast(a.who);
          const here = e === null ? null : h.actors.posOf(e);
          if (e !== null && here) h.actors.place(e, here, datan2(-(mark[0] - here[0]), -(mark[2] - here[2])));
        } else h.tasks.assign(a.who, { t: 'look', who: a.arg }, tick);
        return;
      case 'enter':
        h.tasks.assign(a.who, { t: 'enterVehicle', vehicle: a.arg, seat: 0 }, tick);
        return;
      case 'exit':
        h.tasks.assign(a.who, { t: 'leaveVehicle' }, tick);
        return;
    }
  }

  /** One tick: the player's scripted walk, the runner, the auto-director. */
  step(tick: number): void {
    const h = this.host;
    if (this.playerMove) {
      const p = h.actors.player();
      const here = p === null ? null : h.actors.posOf(p);
      if (p !== null && here) {
        const r = stepToward(here, this.playerMove.to, this.playerMove.mps / 60);
        const gy = soft(() => h.ctx().physics.groundY(r.pos[0], r.pos[2]));
        h.actors.place(p, [r.pos[0], gy ?? r.pos[1], r.pos[2]], r.yaw);
        if (r.arrived) this.playerMove = null;
      } else this.playerMove = null;
    }
    this.runner?.step(tick);
    this.auto?.step(tick);
  }

  /** The script ran out of time or was skipped. */
  disarm(completed: boolean): void {
    const r = this.runner;
    if (r) {
      r.finish(completed, this.host.ctx().tick);
      this.host.ctx().ui.patch('hud.subtitle', null);
    }
    this.runner = null;
    this.playerMove = null;
    this.host.clearMarkZones();
  }

  /** The `camera` op: the auto-director on a subject for `sec` seconds (0 keeps it until `stopAuto`). */
  startAuto(subject: string, seed: number, reason: CameraDirective['reason'] = 'mission'): void {
    this.stopAuto();
    const a = new AutoDirector({ world: this.world(), comfort: () => this.host.comfort(), subject, seed, publish: this.publish, reason, log: this.events });
    this.auto = a;
    a.start(this.host.ctx().tick);
  }

  stopAuto(): void {
    this.auto?.stop();
    this.auto = null;
  }

  get active(): boolean {
    return this.runner !== null || this.auto !== null;
  }
}
