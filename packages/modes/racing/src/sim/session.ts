/**
 * One race, end to end (M07a1): the director, the referee, nitro, damage and the HUD, driving a car through a `RaceWorldPort`.
 * The mode (`mode.ts`, production) and the headless QA scenario (`qa/scenario.ts`, Node and WebKit) both build one of these, so
 * the rules are the same in both. Sim code under the C02 lint: no clock, no timers, no random but the seeded streams.
 *
 * Per tick (`step`): find the car (or place it once the colliders are ready), read it, run the director, apply the rules' events
 * to the world (respawns, nitro bonus), step nitro and damage, write the driving command, then publish the events, the HUD view
 * model and the telemetry.
 */
import {
  datan2, dsqrt, gatePose, newDamage, routePoint, SimButton,
  type DamageState, type Difficulty, type HandlingProfile, type InputFrame, type RaceDef, type SimEvent,
} from '@dv/shared';
import type { RacingConfig } from '../config.ts';
import { applyRaceImpact } from './damage-system.ts';
import { RaceDirector, type DirectorEvent, type DirectorTick, type RacePhase } from './director.ts';
import { buildHud, type RaceHudVm } from './hud-vm.ts';
import { addCharge, newNitro, nitro01, NO_SOURCES, perfectStartBonus, stepNitro, type NitroState } from './nitro.ts';
import type { CarReadout, RaceWorldPort } from './port.ts';
import { finishProps, medalsFor, startProps, type Props } from './telemetry.ts';

export interface SessionSinks {
  /** A sim event (`race.*`, `veh.*`); the mode sends it through `ModeContext.events`, the QA scenario keeps it. */
  event(e: SimEvent): void;
  /** The HUD view model of this tick. */
  hud(vm: RaceHudVm): void;
}

export interface SessionTelemetry {
  emit(name: 'racing.start' | 'racing.finish', props: Props): void;
}

export interface SessionDeps {
  def: RaceDef;
  cfg: RacingConfig;
  profile: HandlingProfile;
  /** Prefab id of the player's car, for example `vehicle.aurelian-sorrel`. */
  vehicleDef: string;
  port: RaceWorldPort;
  sinks: SessionSinks;
  telemetry: SessionTelemetry;
  seed: number;
  difficulty?: Difficulty;
  simProfile: 'local' | 'canonical';
  unit?: 'kph' | 'mph';
  /** Time limit of a timed event, milliseconds. */
  timeLimitMs?: number | null;
}

/** Commands the shell or the QA bridge can give a running session. */
export type SessionCommand = 'ready' | 'retry' | 'exit';

export interface SessionState {
  phase: RacePhase;
  attempt: number;
  tick: number;
  gate: number;
  gates: number;
  lap: number;
  s: number;
  speedMps: number;
  timerMs: number;
  penaltyMs: number;
  finishMs: number | null;
  outcome: 'finish' | 'dnf' | null;
  nitro: number;
  nitroOn: boolean;
  damage: DamageState;
  car: CarReadout | null;
  spawned: boolean;
  gateTicks: number[];
}

const bit = (f: InputFrame, b: number): boolean => (f.buttons & (1 << b)) !== 0;

export class RaceSession {
  readonly director: RaceDirector;
  readonly nitro: NitroState = newNitro();
  damage: DamageState = newDamage();
  readonly gateTicks: number[] = [];
  /** Every `race.*` and `veh.*` event of the session, newest last (QA reads it; capped). */
  readonly log: SimEvent[] = [];
  private spawned = false;
  private startNow = false;
  private retryNow = false;
  private exitNow = false;
  private grid = { x: 0, y: 0, z: 0, yaw: 0 };
  private car: CarReadout | null = null;
  private lastHud: RaceHudVm | null = null;
  private lastTick = 0;
  private finishReported = false;
  private split: { gate: number; deltaMs: number } | null = null;
  private exited = false;

  constructor(private readonly d: SessionDeps) {
    this.director = new RaceDirector(d.def, { cfg: d.cfg.race, seed: d.seed, ...(d.timeLimitMs !== undefined ? { timeLimitMs: d.timeLimitMs } : {}) });
    const g = d.def.grid[0];
    const p = routePoint(d.def, g ? g.s : 0);
    // 06-racing-data 4.2: lanes are 3.2 m apart; the first slot sits on the line
    const lane = g ? g.offsetM : 0;
    this.grid = { x: p.x + -p.tz * lane, y: p.y, z: p.z + p.tx * lane, yaw: yawOf(p.tx, p.tz) };
  }

  command(c: SessionCommand): void {
    if (c === 'ready') this.startNow = true;
    else if (c === 'retry') this.retryNow = true;
    else this.exitNow = true;
  }

  get exitRequested(): boolean {
    return this.exitNow;
  }

  /** True once the player left Results (the mode ends itself). */
  get finished(): boolean {
    return this.exited;
  }

  state(): SessionState {
    const r = this.director.ref;
    const res = this.director.result;
    return {
      phase: this.director.phase,
      attempt: this.director.attempt,
      tick: this.lastTick,
      gate: r.gate,
      gates: this.d.def.gates.length,
      lap: r.lap,
      s: r.s,
      speedMps: this.car ? this.car.speedMps : 0,
      timerMs: this.director.timerMs(this.lastTick),
      penaltyMs: this.director.penaltyMs,
      finishMs: res && res.outcome === 'finish' ? res.ms : null,
      outcome: res ? res.outcome : null,
      nitro: this.nitro.charge,
      nitroOn: this.nitro.on,
      damage: this.damage,
      car: this.car,
      spawned: this.spawned,
      gateTicks: this.gateTicks,
    };
  }

  /** The most recent HUD view model (QA). */
  hud(): RaceHudVm | null {
    return this.lastHud;
  }

  /** Hashed into the sim state (resource `racing.session`): everything that decides what the next tick does. */
  hashInto(h: { u8(v: number): unknown; u32(v: number): unknown; f32(v: number): unknown }): void {
    const r = this.director.ref;
    h.u8(PHASE_ID[this.director.phase]);
    h.u32(this.director.attempt);
    h.u32(r.gate);
    h.u8(r.lap);
    h.u32(this.director.penaltyMs);
    h.u32(this.director.goTick < 0 ? 0 : this.director.goTick);
    h.f32(this.nitro.charge);
    h.u8(this.nitro.on ? 1 : 0);
    h.f32(this.damage.body);
    h.u32(r.wrongWayTicks);
    h.u32(this.gateTicks.length);
    for (let i = 0; i < this.gateTicks.length; i++) h.u32(this.gateTicks[i] as number);
  }

  step(f: InputFrame, tick: number): void {
    this.lastTick = tick;
    const { d } = this;
    const port = d.port;
    const dir = this.director;

    // the car: placed once the colliders under the grid are ready
    if (!this.spawned) {
      if (port.collidersReady(this.grid.x, this.grid.z)) {
        const gy = port.groundY(this.grid.x, this.grid.z);
        const y = (gy ?? this.grid.y) + d.profile.cgHeightM + 0.45;
        this.spawned = port.spawnCar(d.vehicleDef, [this.grid.x, y, this.grid.z], this.grid.yaw);
      }
      if (!this.spawned) {
        dir.tick(this.idleTick(tick, f, false));
        this.publish(tick, f);
        return;
      }
    }
    const car = port.read();
    this.car = car;
    if (!car) {
      this.publish(tick, f);
      return;
    }

    // contacts since the last tick feed the damage model
    let totaled = false;
    for (const imp of port.takeImpacts()) {
      const r = applyRaceImpact(d.cfg.damage, d.profile, this.damage, { kind: 'static', vNormal: imp.vNormal, vTangent: 0, local: [0, 0, imp.frontal ? -2 : 2], otherMassKg: 0 }, d.difficulty ?? 'normal');
      this.damage = r.state;
      if (r.loss > 0) this.emit({ t: 'veh.impact', tick, n: Math.round(imp.vNormal * 10) });
      if (r.totaled) {
        totaled = true;
        this.emit({ t: 'veh.totaled', tick });
      }
    }
    if (totaled || this.damage.body <= 0) totaled = dir.phase === 'Running';
    port.setDamage(this.damage);

    const gp = this.grid;
    const moved = dist2(car.pos[0] - gp.x, car.pos[2] - gp.z);
    const dtick: DirectorTick = {
      tick,
      ready: true,
      startNow: this.startNow,
      front: car.front,
      speedMps: car.speedMps < 0 ? -car.speedMps : car.speedMps,
      upY: car.upY,
      throttle: f.throttle / 127,
      resetHeld: bit(f, SimButton.Interact),
      retry: this.retryNow,
      exit: this.exitNow,
      movedFromGridM: moved,
      totaled,
    };
    this.startNow = false;
    this.retryNow = false;
    const phaseBefore = dir.phase;
    const events = dir.tick(dtick);
    if (dir.phase === 'Results' && this.exitNow && !this.exited) {
      this.exited = true;
    }

    // rules' events to the world
    for (const e of events) this.apply(e, tick, car);
    if (phaseBefore !== 'Grid' && dir.phase === 'Grid') this.toGrid();

    // the driving command and nitro
    const phase = dir.phase;
    const driving = phase === 'Running' || phase === 'Countdown';
    if (driving) {
      port.drive({ throttle: f.throttle, brake: f.brake, steer: f.steer, handbrake: bit(f, SimButton.Handbrake) });
    } else if (phase === 'Grid' || phase === 'Loading') {
      port.drive({ throttle: 0, brake: 0, steer: 0, handbrake: true });
    } else {
      port.drive({ throttle: 0, brake: 90, steer: 0, handbrake: false });
    }
    const wantNitro = phase === 'Running' && bit(f, SimButton.Nitro) && this.damage.body > 0;
    const was = this.nitro.on;
    stepNitro(d.profile, this.nitro, wantNitro, { ...NO_SOURCES, airborne: car.airTicks > 15, drifting: dir.phase === 'Running' && (car.slipDeg < 0 ? -car.slipDeg : car.slipDeg) > d.cfg.drift.minAngleDeg && car.speedMps > 8 }, 1);
    if (phase !== 'Running') this.nitro.on = false;
    port.setNitro(this.nitro.on, this.nitro.charge);
    if (was !== this.nitro.on) this.emit({ t: 'veh.nitro', tick, n: this.nitro.on ? 1 : 0 });

    this.publish(tick, f);
  }

  // ------------------------------------------------------------------ internals

  private idleTick(tick: number, f: InputFrame, ready: boolean): DirectorTick {
    return {
      tick, ready, startNow: false, front: [this.grid.x, this.grid.y, this.grid.z], speedMps: 0, upY: 1, throttle: f.throttle / 127,
      resetHeld: false, retry: false, exit: false, movedFromGridM: 0, totaled: false,
    };
  }

  private toGrid(): void {
    this.d.port.place([this.grid.x, this.gridY(), this.grid.z], this.grid.yaw);
    this.director.placed();
    this.nitro.charge = 0;
    this.nitro.on = false;
    this.damage = newDamage();
    this.gateTicks.length = 0;
    this.finishReported = false;
    this.split = null;
  }

  private gridY(): number {
    const gy = this.d.port.groundY(this.grid.x, this.grid.z);
    return (gy ?? this.grid.y) + this.d.profile.cgHeightM + 0.45;
  }

  private emit(e: SimEvent): void {
    this.log.push(e);
    if (this.log.length > 256) this.log.shift();
    this.d.sinks.event(e);
  }

  private apply(e: DirectorEvent, tick: number, car: CarReadout): void {
    const { d } = this;
    switch (e.t) {
      case 'race.countdown':
      case 'race.go':
        this.emit({ t: e.t, tick });
        if (e.t === 'race.go') d.telemetry.emit('racing.start', startProps(d.def, d.profile, d.simProfile));
        break;
      case 'race.gate': {
        this.gateTicks.push(e.tick);
        this.emit({ t: 'race.gate', tick, n: e.i });
        const par = d.def.parSec;
        const g = d.def.gates[e.i];
        if (g && d.def.routeLenM > 0) {
          const expectMs = (par * 1000 * g.s) / d.def.routeLenM;
          this.split = { gate: e.i, deltaMs: Math.round(this.director.timerMs(tick) - expectMs) };
        }
        break;
      }
      case 'race.lap':
        this.emit({ t: 'race.lap', tick, n: e.lap });
        break;
      case 'race.finish':
        this.emit({ t: 'race.finish', tick, n: e.ms });
        break;
      case 'race.dnf':
        this.emit({ t: 'race.dnf', tick, s: e.reason });
        break;
      case 'race.wrongway':
        this.emit({ t: 'race.wrongway', tick });
        break;
      case 'race.respawn':
        this.emit({ t: 'race.respawn', tick, n: e.at });
        this.respawn(e.at);
        break;
      case 'race.reset':
        this.emit({ t: 'race.respawn', tick, n: e.at });
        this.respawn(e.at);
        break;
      case 'race.jumpstart':
        this.emit({ t: 'race.jumpstart', tick, n: e.penaltyMs });
        break;
      case 'race.perfectstart':
        addCharge(d.profile, this.nitro, perfectStartBonus(d.profile, e.pct));
        this.emit({ t: 'race.perfectstart', tick });
        break;
      case 'race.results': {
        if (this.finishReported) break;
        this.finishReported = true;
        const outcome = e.outcome;
        const medals = outcome === 'finish' ? medalsFor(d.def, e.ms) : 0;
        d.telemetry.emit('racing.finish', finishProps(d.def, outcome, e.ms, 1, medals));
        this.emit({ t: 'race.results', tick, n: e.ms, s: outcome });
        break;
      }
      case 'race.grid':
        this.emit({ t: 'race.grid', tick, n: e.attempt });
        break;
    }
    void car;
  }

  private respawn(at: number): void {
    const p = gatePose(this.d.def, at);
    if (!p) return;
    const gy = this.d.port.groundY(p.x, p.z);
    const y = (gy ?? p.y) + this.d.profile.cgHeightM + 0.45;
    this.d.port.place([p.x, y, p.z], yawOf(p.tx, p.tz));
    this.director.placed();
    this.nitro.on = false;
  }

  private publish(tick: number, f: InputFrame): void {
    void f;
    const { d } = this;
    const dir = this.director;
    const car = this.car;
    const r = dir.ref;
    const tn = Math.max(0, d.def.gates.length - 1);
    const vm = buildHud({
      speedMps: car ? (car.speedMps < 0 ? -car.speedMps : car.speedMps) : 0,
      unit: d.unit ?? 'kph',
      rpm: car ? car.rpm : 0,
      redlineRpm: d.profile.engine.redlineRpm,
      gear: car ? car.gear : 0,
      nitro01: nitro01(d.profile, this.nitro),
      place: 1,
      of: 1,
      lap: r.lap,
      laps: r.laps,
      gate: Math.max(0, r.gate - 1),
      gates: tn,
      timerMs: dir.timerMs(tick),
      timeLeftMs: r.timeLeftMs,
      split: this.split,
      damage: this.damage,
      driftScore: null,
      wrongWay: r.wrongWayTicks > 0,
      prompt: r.wrongWayTicks > 0 ? 'race.wrongway' : null,
      phase: dir.phase,
      countdown: dir.phase === 'Countdown' ? Math.max(0, d.cfg.race.countdownTicks - (tick - dir.countdownStart)) : 0,
    });
    this.lastHud = vm;
    d.sinks.hud(vm);
  }
}

const PHASE_ID: Record<RacePhase, number> = { Loading: 0, Grid: 1, Countdown: 2, Running: 3, Finished: 4, Failed: 5, Results: 6 };

/** Engine yaw (0 faces -Z, positive turns left) of a travel direction in x, z. */
export function yawOf(tx: number, tz: number): number {
  // forward is (-sin yaw, -cos yaw) in x, z for the engine's quaternion convention (`fx = -2 (qx qz + qw qy)`)
  return datan2(-tx, -tz);
}

function dist2(dx: number, dz: number): number {
  return dsqrt(dx * dx + dz * dz);
}
