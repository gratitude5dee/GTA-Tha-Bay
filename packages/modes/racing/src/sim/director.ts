/**
 * The race director (06-racing.md 2.8; M07a1): the state machine of one race and the rules around the referee.
 *
 *     Loading -> Grid -> Countdown (180 ticks) -> Running -> Finished | Failed -> Results -> Grid | exit
 *
 *  - Loading holds until the colliders under the grid are ready; no countdown starts before that.
 *  - Grid waits for the player (`startNow`) or 5 s, then the countdown runs exactly `countdownTicks` ticks to `race.go`.
 *  - Jump start: more than 0.5 m off the grid at GO costs 3 s. Perfect start: the first throttle press within 0.25 s of GO adds 10
 *    nitro (the `perfectStart` event; the caller fills the tank).
 *  - Running: the referee (gates in order, wrong way, clock), the reset rules (held reset, flipped, stuck: back to the last gate
 *    with a 5 s penalty) and the DNF when the car is totaled.
 *  - Results: `retry` returns to Grid with the next seed stream (`seedFor(attempt)`), `exit` ends the mode.
 *
 * Pure: it reads a `DirectorTick` and returns events; it touches no world. Sim code under the C02 lint.
 */
import {
  newRefereeState, refereeStep, resetToGate, SIM_DT, splitmix32,
  type RaceDef, type RaceEvent, type RefereeRules, type RefereeState,
} from '@dv/shared';
import type { RacingConfig } from '../config.ts';

export type RacePhase = 'Loading' | 'Grid' | 'Countdown' | 'Running' | 'Finished' | 'Failed' | 'Results';

export interface DirectorTick {
  tick: number;
  /** The working set under the grid is loaded and the car stands on it. */
  ready: boolean;
  /** The player pressed ready on the grid. */
  startNow: boolean;
  /** Front-axle position this tick. */
  front: readonly [number, number, number];
  speedMps: number;
  /** Y component of the car's up vector (1 upright, below 0.3 flipped). */
  upY: number;
  /** Throttle 0..1. */
  throttle: number;
  /** The reset control is held. */
  resetHeld: boolean;
  /** In Results: go again. */
  retry: boolean;
  /** In Results: leave the mode. */
  exit: boolean;
  /** Distance of the car from its grid slot, metres. */
  movedFromGridM: number;
  /** The damage model took the body to 0 this tick. */
  totaled: boolean;
  /**
   * The car has been in the air for 2 s out of the world (02-world-maps.md 4.1 d: under the play box floor or more than 3 m under the
   * lowest resident surface). While the race runs the director resets it to the last gate itself (BD-FIX-SPAWN-07). Absent: false.
   */
  fell?: boolean;
}

export type DirectorEvent =
  | RaceEvent
  | { t: 'race.countdown'; tick: number }
  | { t: 'race.go'; tick: number }
  | { t: 'race.jumpstart'; penaltyMs: number }
  | { t: 'race.perfectstart'; pct: number }
  | { t: 'race.reset'; reason: 'held' | 'flipped' | 'stuck' | 'fell'; at: number; penaltyMs: number }
  | { t: 'race.results'; outcome: 'finish' | 'dnf'; ms: number; reason?: string }
  | { t: 'race.grid'; attempt: number };

export interface DirectorOptions {
  cfg: RacingConfig['race'];
  /** Time limit of a timed event in milliseconds, or null. */
  timeLimitMs?: number | null;
  /** The session seed; `seedFor(attempt)` derives the stream seed of each attempt. */
  seed: number;
  /**
   * A pursuit event (M07a2): there is no route to follow, so the referee does not run (no gates, no wrong way, no finish line);
   * the event ends through `endExternal` when the police director says evade, survive or bust. The reset rules still apply.
   */
  freeRoam?: boolean;
}

export interface RaceResult { outcome: 'finish' | 'dnf'; ms: number; reason?: string; place: number; of: number }

const MS_PER_TICK = SIM_DT * 1000;

export class RaceDirector {
  phase: RacePhase = 'Loading';
  attempt = 0;
  ref: RefereeState;
  /** Penalties added to the finish time, milliseconds. */
  penaltyMs = 0;
  countdownStart = -1;
  goTick = -1;
  result: RaceResult | null = null;
  private gridWait = 0;
  private flipTicks = 0;
  private stuckTicks = 0;
  private resetHeldTicks = 0;
  private firstThrottleTick = -1;
  private perfectChecked = false;
  private readonly rules: RefereeRules;

  constructor(readonly def: RaceDef, private readonly o: DirectorOptions) {
    this.ref = newRefereeState(def, 0, o.timeLimitMs ?? null);
    this.rules = {
      gateTolerantY: o.cfg.gateTolerantY,
      wrongWayWarnM: o.cfg.wrongWayWarnM,
      wrongWayRespawnTicks: Math.round(o.cfg.wrongWayRespawnSec / SIM_DT),
    };
  }

  /** The seed of the random stream of `attempt`: a retry gets a fresh one. */
  seedFor(attempt: number): number {
    return splitmix32((this.o.seed + Math.imul(attempt, 0x9e3779b1)) | 0);
  }

  /** Milliseconds on the race clock at `tick`, penalties included. */
  timerMs(tick: number): number {
    if (this.phase === 'Results' || this.phase === 'Finished' || this.phase === 'Failed') return this.result?.ms ?? 0;
    if (this.goTick < 0 || tick < this.goTick) return 0;
    return Math.round((tick - this.goTick) * MS_PER_TICK) + this.penaltyMs;
  }

  tick(i: DirectorTick): DirectorEvent[] {
    const out: DirectorEvent[] = [];
    switch (this.phase) {
      case 'Loading':
        if (i.ready) this.toGrid(out);
        break;
      case 'Grid':
        this.gridWait++;
        if (i.startNow || this.gridWait >= this.o.cfg.gridAutoTicks) {
          this.phase = 'Countdown';
          this.countdownStart = i.tick;
          this.firstThrottleTick = -1;
          this.perfectChecked = false;
          out.push({ t: 'race.countdown', tick: i.tick });
        }
        break;
      case 'Countdown':
        if (i.throttle > 0.1 && this.firstThrottleTick < 0) this.firstThrottleTick = i.tick;
        if (i.tick - this.countdownStart >= this.o.cfg.countdownTicks) this.go(i, out);
        break;
      case 'Running':
        this.running(i, out);
        break;
      case 'Finished':
      case 'Failed':
        this.phase = 'Results';
        break;
      case 'Results':
        if (i.exit) break;
        if (i.retry) this.retry(out);
        break;
    }
    return out;
  }

  private toGrid(out: DirectorEvent[]): void {
    this.phase = 'Grid';
    this.gridWait = 0;
    out.push({ t: 'race.grid', attempt: this.attempt });
  }

  private go(i: DirectorTick, out: DirectorEvent[]): void {
    this.phase = 'Running';
    this.goTick = i.tick;
    this.ref = newRefereeState(this.def, i.tick, this.o.timeLimitMs ?? null);
    this.penaltyMs = 0;
    out.push({ t: 'race.go', tick: i.tick });
    if (i.movedFromGridM > this.o.cfg.jumpStartM) {
      const ms = Math.round(this.o.cfg.jumpStartPenaltySec * 1000);
      this.penaltyMs += ms;
      out.push({ t: 'race.jumpstart', penaltyMs: ms });
    }
    this.flipTicks = 0;
    this.stuckTicks = 0;
    this.resetHeldTicks = 0;
  }

  private running(i: DirectorTick, out: DirectorEvent[]): void {
    const cfg = this.o.cfg;
    // the perfect-start window closes 0.25 s after GO
    const window = Math.round(0.25 / SIM_DT);
    if (i.throttle > 0.1 && this.firstThrottleTick < 0) this.firstThrottleTick = i.tick;
    if (!this.perfectChecked && i.tick - this.goTick >= window) {
      this.perfectChecked = true;
      const t = this.firstThrottleTick;
      if (t >= 0 && t >= this.goTick - window && t <= this.goTick + window) out.push({ t: 'race.perfectstart', pct: 10 });
    }

    // the referee: gates, wrong way, clock
    const prev = this.prev ?? i.front;
    const evs = this.o.freeRoam ? [] : refereeStep(this.def, this.ref, prev, i.front, i.speedMps, i.tick, this.rules);
    this.prev = i.front;
    for (const e of evs) {
      if (e.t === 'race.finish') {
        const ms = e.ms + this.penaltyMs;
        out.push({ t: 'race.finish', ms, tick: e.tick });
        this.finish({ outcome: 'finish', ms, place: 1, of: 1 }, out);
      } else if (e.t === 'race.dnf') {
        out.push(e);
        this.finish({ outcome: 'dnf', ms: this.timerMs(i.tick), reason: e.reason, place: 1, of: 1 }, out);
      } else out.push(e);
    }
    if (this.phase !== 'Running') return;

    if (i.totaled) {
      out.push({ t: 'race.dnf', reason: 'totaled' });
      this.ref.dnf = true;
      this.finish({ outcome: 'dnf', ms: this.timerMs(i.tick), reason: 'totaled', place: 1, of: 1 }, out);
      return;
    }

    // reset rules: held reset, flipped, stuck
    this.resetHeldTicks = i.resetHeld ? this.resetHeldTicks + 1 : 0;
    this.flipTicks = i.upY < 0.3 ? this.flipTicks + 1 : 0;
    this.stuckTicks = i.speedMps < 1 && i.throttle > 0.5 ? this.stuckTicks + 1 : 0;
    let why: 'held' | 'flipped' | 'stuck' | 'fell' | null = null;
    // out of the world (a placement or collision gap, not the driver's doing): back to the last gate without a penalty
    if (i.fell === true) why = 'fell';
    else if (this.resetHeldTicks >= Math.round(cfg.resetHoldSec / SIM_DT)) why = 'held';
    else if (this.flipTicks >= Math.round(cfg.flipResetSec / SIM_DT)) why = 'flipped';
    else if (this.stuckTicks >= Math.round(cfg.stuckResetSec / SIM_DT)) why = 'stuck';
    if (why) {
      const ms = why === 'fell' ? 0 : Math.round(cfg.resetPenaltySec * 1000);
      this.penaltyMs += ms;
      if (this.ref.timeLeftMs !== null) this.ref.timeLeftMs = Math.max(0, this.ref.timeLeftMs - ms);
      const at = this.ref.lastGate < 0 ? 0 : this.ref.lastGate;
      resetToGate(this.def, this.ref, at);
      this.resetHeldTicks = 0;
      this.flipTicks = 0;
      this.stuckTicks = 0;
      this.prev = null;
      out.push({ t: 'race.reset', reason: why, at, penaltyMs: ms });
    }
    // a wrong-way respawn also restarts the segment test from the gate
    if (evs.some((e) => e.t === 'race.respawn')) this.prev = null;
  }

  private prev: readonly [number, number, number] | null = null;

  /** Ends a running event from outside the referee (a pursuit's evade, survive or bust); no-op outside Running. */
  endExternal(outcome: 'finish' | 'dnf', tick: number, reason?: 'time' | 'totaled' | 'busted' | 'abandon'): DirectorEvent[] {
    if (this.phase !== 'Running') return [];
    const out: DirectorEvent[] = [];
    const ms = this.timerMs(tick);
    if (outcome === 'finish') out.push({ t: 'race.finish', ms, tick });
    else out.push({ t: 'race.dnf', reason: reason ?? 'abandon' });
    this.finish({ outcome, ms, ...(reason !== undefined ? { reason } : {}), place: 1, of: 1 }, out);
    return out;
  }

  private finish(r: RaceResult, out: DirectorEvent[]): void {
    this.result = r;
    this.phase = r.outcome === 'finish' ? 'Finished' : 'Failed';
    out.push({ t: 'race.results', outcome: r.outcome, ms: r.ms, ...(r.reason !== undefined ? { reason: r.reason } : {}) });
  }

  private retry(out: DirectorEvent[]): void {
    this.attempt++;
    this.result = null;
    this.goTick = -1;
    this.countdownStart = -1;
    this.penaltyMs = 0;
    this.prev = null;
    this.ref = newRefereeState(this.def, 0, this.o.timeLimitMs ?? null);
    this.toGrid(out);
  }

  /** The caller placed the car back on the grid or a gate: the next segment test starts from there. */
  placed(): void {
    this.prev = null;
  }
}
