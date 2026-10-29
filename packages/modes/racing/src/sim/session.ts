/**
 * One race, end to end (M07a1, M07a2): the director, the referee, nitro, damage and the HUD, driving a car through a
 * `RaceWorldPort`. The mode (`mode.ts`, production) and the headless QA scenario (`qa/scenario.ts`, Node and WebKit) both build
 * one of these, so the rules are the same in both. Sim code under the C02 lint: no clock, no timers, no random but the seeded
 * streams.
 *
 * Per tick (`step`): find the car (or place it once the colliders are ready), read it, run the director, apply the rules' events
 * to the world (respawns, nitro bonus), run the rivals and the pursuit, step nitro and damage, write the driving command, record
 * the tick for the replay, then publish the events, the HUD view model and the telemetry.
 *
 * M07a2 adds: the rivals (`RivalField`, M2 point masses drawn as puppets), the ghost of the best run, the replay recorder and the
 * `endHash`, the pursuit binder of a pursuit event, and the run record the mode folds into `RacingSlice`.
 */
import {
  DEFAULT_ASSIST, dsqrt, Fnv64, gatePose, newDamage, routePoint, SimButton,
  type DamageState, type Difficulty, type GhostEntry, type HandlingProfile, type InputFrame, type RaceDef, type SimEvent,
} from '@dv/shared';
import type { RacingConfig } from '../config.ts';
import { RivalField, type PlayerRef, type RivalSpec } from './ai-driver.ts';
import { applyRaceImpact } from './damage-system.ts';
import { RaceDirector, type DirectorEvent, type DirectorTick, type RacePhase } from './director.ts';
import { betterGhost, ghostFromRun, GhostPlayer, GhostRunner } from './ghosts.ts';
import { buildHud, type RaceHudVm } from './hud-vm.ts';
import { addCharge, newNitro, nitro01, NO_SOURCES, perfectStartBonus, stepNitro, type NitroState } from './nitro.ts';
import { yawOf } from './pose.ts';
import type { CarReadout, RaceWorldPort } from './port.ts';
import { ghostPrefabOf, rivalPrefabOf } from '../prefabs.ts';
import type { PursuitBinder } from './pursuit-binder.ts';
import { ReplayRecorder, type RecordedRun } from './recorder.ts';
import { computeRewards, type RaceRewards } from './results.ts';
import { finishProps, medalsFor, pursuitEndProps, startProps, type Props } from './telemetry.ts';

export { yawOf };

export interface SessionSinks {
  /** A sim event (`race.*`, `veh.*`); the mode sends it through `ModeContext.events`, the QA scenario keeps it. */
  event(e: SimEvent): void;
  /** The HUD view model of this tick. */
  hud(vm: RaceHudVm): void;
}

export interface SessionTelemetry {
  emit(name: 'racing.start' | 'racing.finish' | 'racing.pursuit_end', props: Props): void;
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
  /** M07a2: the rivals of the event (the event's opponents with their cars); none for a time trial or a pursuit. */
  rivals?: readonly RivalSpec[];
  /** M07a2: the ghost shown beside the run (the best run of the event), if the settings ask for it. */
  ghost?: GhostEntry | null;
  /** M07a2: the police binder of a pursuit event. */
  pursuit?: PursuitBinder | null;
  /** M07a2: an embedded run (story): no records, no ghosts saved, no purse (the mission pays). */
  embedded?: boolean;
  /** The best medal already won on this event (the first-time bonus). */
  prevMedals?: 0 | 1 | 2 | 3;
  /** Build id for the replay header. */
  buildId?: string;
  /** Base price of the player's car in cents, for the 5 % bust repair fee of a pursuit. */
  vehiclePriceCents?: number;
  /** Wall clock for `GhostEntry.savedAt`, supplied by the host (the sim has no clock). */
  nowMs?: () => number;
  /** Record the replay (default true). */
  record?: boolean;
  /**
   * Seed of the first attempt's AI stream when it is not `seedFor(0)`; a replay viewer sets it to the recorded header's `seed` so
   * the rivals replay as they raced.
   */
  aiSeed?: number;
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
  place: number;
  of: number;
  rivals: { driverId: string; s: number; lap: number; v: number; finishTick: number }[];
  ghostRunning: boolean;
  /** Entities the session made besides the player's car (rivals and the ghost). */
  puppets: number;
  endHash: string | null;
  /** M07a2: the police director's heat in a pursuit event, else null. */
  pursuit: { level: number; phase: string; cooldown01: number } | null;
}

/** What one finished attempt left: the mode folds it into the slice once. */
export interface AttemptRecord {
  attempt: number;
  outcome: 'finish' | 'dnf';
  reason: string | null;
  ms: number;
  place: number;
  of: number;
  rewards: RaceRewards;
  /** The replay of the attempt (null when recording is off). */
  run: RecordedRun | null;
  endHash: string;
  gateTicks: number[];
  finishTick: number | null;
  ghost: GhostEntry | null;
  pursuit: { outcome: 'evade' | 'survive' | 'bust' | null; heatMax: number; points: number; bountyCents: number; seconds: number; takedowns: number; repairCents: number } | null;
  distanceM: number;
}

const bit = (f: InputFrame, b: number): boolean => (f.buttons & (1 << b)) !== 0;
/** A car out of the world counts as fallen after this many ticks in the air: the engine net's `FALL_RECOVER_TICKS` (2 s, DL-734). */
const FALL_AIR_TICKS = 120;
/** A puppet's origin is the body centre: a car's centre of gravity above the road. */
const PUPPET_LIFT_M = 0.6;

export class RaceSession {
  readonly director: RaceDirector;
  readonly nitro: NitroState = newNitro();
  damage: DamageState = newDamage();
  readonly gateTicks: number[] = [];
  /** Every `race.*` and `veh.*` event of the session, newest last (QA reads it; capped). */
  readonly log: SimEvent[] = [];
  readonly field: RivalField | null;
  readonly recorder: ReplayRecorder | null;
  /** The finished attempts not yet taken by the mode. */
  private readonly records: AttemptRecord[] = [];
  lastAttempt: AttemptRecord | null = null;
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
  private puppetIds: number[] = [];
  private puppetsReady = false;
  private ghostRunner: GhostRunner | null = null;
  private ghostPlaced: GhostEntry | null = null;
  /** The keys of ghost entities alternate, so a replacement never meets the key of the entity just removed. */
  private ghostSerial = 0;
  private place = 1;
  private finishedPlace = 0;
  private finishTick = -1;
  private distanceM = 0;
  private prevPos: [number, number, number] | null = null;
  private pursuitReported = false;
  private ghostBest: GhostEntry | null;
  private endHashHex: string | null = null;
  private cachedResults: RaceHudVm['results'] = null;
  private reason: string | null = null;

  constructor(private readonly d: SessionDeps) {
    const free = d.def.kind === 'pursuit';
    this.director = new RaceDirector(d.def, { cfg: d.cfg.race, seed: d.seed, freeRoam: free, ...(d.timeLimitMs !== undefined ? { timeLimitMs: d.timeLimitMs } : {}) });
    const g = d.def.grid[0];
    const p = routePoint(d.def, g ? g.s : 0);
    // 06-racing-data 4.2: lanes are 3.2 m apart; the first slot sits on the line
    const lane = g ? g.offsetM : 0;
    this.grid = { x: p.x + -p.tz * lane, y: p.y, z: p.z + p.tx * lane, yaw: yawOf(p.tx, p.tz) };
    this.field = d.rivals && d.rivals.length > 0 && !free
      ? new RivalField({ def: d.def, cfg: d.cfg, specs: d.rivals, difficulty: d.difficulty ?? 'normal', seed: d.aiSeed ?? this.director.seedFor(0), engineHasM1: false })
      : null;
    this.recorder = d.record === false ? null : new ReplayRecorder();
    this.ghostBest = d.ghost ?? null;
  }

  command(c: SessionCommand): void {
    if (c === 'ready') this.startNow = true;
    else if (c === 'retry') this.retryNow = true;
    else this.exitNow = true;
  }

  /** QA only (`racing.fill`): puts charge into the tank, as a drift or a perfect start would. */
  qaFillNitro(amount: number): void {
    addCharge(this.d.profile, this.nitro, amount);
  }

  get exitRequested(): boolean {
    return this.exitNow;
  }

  /** True once the player left Results (the mode ends itself). */
  get finished(): boolean {
    return this.exited;
  }

  /** The attempts finished since the last call, oldest first; the mode folds each into the slice. */
  takeRecords(): AttemptRecord[] {
    return this.records.splice(0, this.records.length);
  }

  state(): SessionState {
    const r = this.director.ref;
    const res = this.director.result;
    const field = this.field;
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
      place: this.finishedPlace > 0 ? this.finishedPlace : this.place,
      of: 1 + (field ? field.size : 0),
      rivals: field ? field.rivals.map((v) => ({ driverId: v.driverId, s: v.totalM, lap: v.lap, v: v.v, finishTick: v.finishTick })) : [],
      ghostRunning: this.ghostRunner !== null && this.ghostRunner.spawned,
      puppets: this.puppetIds.length + (this.ghostRunner?.spawned ? 1 : 0),
      endHash: this.endHashHex,
      pursuit: this.d.pursuit && this.d.pursuit.running ? this.d.pursuit.snapshot() : null,
    };
  }

  /** The most recent HUD view model (QA). */
  hud(): RaceHudVm | null {
    return this.lastHud;
  }

  /** The hash of the end state: the player's car components, the rivals, and the gate ticks (C02 rule 7 order). */
  endHash(): string {
    const h = new Fnv64();
    this.d.port.hashCar?.(h);
    this.field?.hashInto(h);
    h.u32(this.gateTicks.length);
    for (let i = 0; i < this.gateTicks.length; i++) h.u32(this.gateTicks[i] as number);
    return h.hex();
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
    this.field?.hashInto(h);
  }

  /** Despawns the puppets and stops the pursuit binder (the mode left, or the headless run ended). */
  dispose(): void {
    this.ghostRunner?.despawn();
    const pp = this.d.port.puppets;
    if (pp) for (const id of this.puppetIds) pp.remove(id);
    this.puppetIds = [];
    this.puppetsReady = false;
    this.d.pursuit?.stop();
  }

  step(f: InputFrame, tick: number): void {
    this.lastTick = tick;
    const { d } = this;
    const port = d.port;
    const dir = this.director;
    // what the recorder sees this tick is what the step consumes: the phase and the ready command as they stand on entry
    const phaseIn = dir.phase;
    const readyIn = this.startNow;

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
    if (!this.puppetsReady) this.spawnPuppets();
    if (phaseIn !== 'Loading' && this.recorder?.recording === true && dir.phase !== 'Results') {
      this.recorder.record(f, readyIn, { x: car.pos[0], y: car.pos[1], z: car.pos[2], yaw: car.yaw, speedMps: car.speedMps });
    }
    if (this.prevPos) this.distanceM += dist2(car.pos[0] - this.prevPos[0], car.pos[2] - this.prevPos[2]);
    this.prevPos = [car.pos[0], car.pos[1], car.pos[2]];

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
      // DL-734's below-the-world rule, which the engine's net leaves to the race while it runs (`EngineServices.vehicleFallClaim`)
      fell: car.airTicks >= FALL_AIR_TICKS && port.outOfWorld?.(car.pos[0], car.pos[1], car.pos[2]) === true,
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
    if (phaseBefore !== 'Grid' && dir.phase === 'Grid') this.toGrid(tick);

    // the pursuit of a pursuit event, and its end
    if (d.pursuit && dir.phase === 'Running') {
      d.pursuit.step(tick);
      if (d.pursuit.outcome !== null && !this.pursuitReported) {
        this.pursuitReported = true;
        const o = d.pursuit.outcome;
        const end = o === 'bust' ? dir.endExternal('dnf', tick, 'busted') : dir.endExternal('finish', tick);
        for (const e of end) this.apply(e, tick, car);
      }
    }

    // the rivals and the ghost
    this.stepField(tick, car);

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

  private toGrid(tick: number): void {
    this.d.port.place([this.grid.x, this.gridY(), this.grid.z], this.grid.yaw);
    this.director.placed();
    this.nitro.charge = 0;
    this.nitro.on = false;
    this.damage = newDamage();
    this.gateTicks.length = 0;
    this.finishReported = false;
    this.split = null;
    this.place = 1;
    this.finishedPlace = 0;
    this.finishTick = -1;
    this.distanceM = 0;
    this.prevPos = null;
    this.pursuitReported = false;
    this.cachedResults = null;
    this.reason = null;
    this.endHashHex = null;
    // a new attempt: a new stream for the rivals, the rivals back on the grid, the recorder from the next tick on
    this.field?.reset(this.director.seedFor(this.director.attempt));
    this.recorder?.begin(tick + 1);
    this.d.pursuit?.stop();
    this.moveRivals();
    if (this.puppetsReady) this.placeGhost();
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

  /** Rival puppets and the ghost, made once the player's car stands. */
  private spawnPuppets(): void {
    this.puppetsReady = true;
    const pp = this.d.port.puppets;
    if (!pp) return;
    const field = this.field;
    if (field) {
      field.rivals.forEach((r, i) => {
        const id = pp.spawn(rivalPrefabOf(r.vehicleDef), `veh:race.r${i}`, { ...r.pose, y: r.pose.y + PUPPET_LIFT_M });
        if (id !== 0) this.puppetIds[i] = id;
      });
    }
    this.placeGhost();
  }

  /** One ghost entity for the best run so far: replaces the one of the last attempt (a retry shows the run just made if it was better). */
  private placeGhost(): void {
    const pp = this.d.port.puppets;
    if (!pp) return;
    const g = this.ghostBest;
    // the same ghost as before: back to the grid, no new entity
    if (this.ghostRunner && this.ghostPlaced === g) {
      this.ghostRunner.step(-1);
      return;
    }
    this.ghostRunner?.despawn();
    this.ghostRunner = null;
    this.ghostPlaced = null;
    if (g && g.trackB64.length > 0 && !this.d.embedded) {
      try {
        this.ghostRunner = new GhostRunner(new GhostPlayer(g), pp, ghostPrefabOf(g.vehicleDef), `veh:race.g${this.ghostSerial++ % 2}`);
        this.ghostRunner.step(-1);
        this.ghostPlaced = g;
      } catch {
        this.ghostRunner = null;
      }
    }
  }

  private moveRivals(): void {
    const pp = this.d.port.puppets;
    const field = this.field;
    if (!pp || !field) return;
    field.rivals.forEach((r, i) => {
      const id = this.puppetIds[i];
      if (id) pp.move(id, { ...r.pose, y: r.pose.y + PUPPET_LIFT_M });
    });
  }

  private stepField(tick: number, car: CarReadout): void {
    const dir = this.director;
    const field = this.field;
    const ref = dir.ref;
    const laps = Math.max(1, this.d.def.laps ?? 1);
    if (field && dir.goTick >= 0) {
      const p = routePoint(this.d.def, ref.s);
      const lat = (car.pos[0] - p.x) * -p.tz + (car.pos[2] - p.z) * p.tx;
      const totalM = (ref.lap - 1) * this.d.def.routeLenM + ref.s;
      const pr: PlayerRef = { totalM, lat, speedMps: car.speedMps };
      if (dir.phase === 'Running' || (!field.allFinished() && tick - dir.goTick < 60 * 600)) field.step(tick, dir.goTick, pr);
      if (dir.phase === 'Running') this.place = field.placeOf(totalM, -1);
      this.moveRivals();
    }
    void laps;
    if (this.ghostRunner) this.ghostRunner.step(dir.goTick < 0 ? -1 : tick - dir.goTick);
  }

  private apply(e: DirectorEvent, tick: number, car: CarReadout): void {
    const { d } = this;
    switch (e.t) {
      case 'race.countdown':
        this.emit({ t: e.t, tick });
        break;
      case 'race.go':
        this.emit({ t: e.t, tick });
        d.telemetry.emit('racing.start', startProps(d.def, d.profile, d.simProfile));
        d.pursuit?.start(tick);
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
        this.finishTick = e.tick;
        this.emit({ t: 'race.finish', tick, n: e.ms });
        break;
      case 'race.dnf':
        this.reason = e.reason;
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
      case 'race.results':
        this.results(e, tick);
        break;
      case 'race.grid':
        this.emit({ t: 'race.grid', tick, n: e.attempt });
        break;
    }
    void car;
  }

  /** The end of an attempt: place, rewards, the replay, telemetry, and the record the mode takes. */
  private results(e: Extract<DirectorEvent, { t: 'race.results' }>, tick: number): void {
    if (this.finishReported) return;
    this.finishReported = true;
    const { d } = this;
    const outcome = e.outcome;
    const dir = this.director;
    const field = this.field;
    const ref = dir.ref;
    const totalM = (ref.lap - 1) * d.def.routeLenM + ref.s;
    const place = field ? (outcome === 'finish' ? field.placeOf(totalM, this.finishTick >= 0 ? this.finishTick : tick) : field.placeOf(totalM, -1)) : 1;
    const of = 1 + (field ? field.size : 0);
    this.finishedPlace = place;
    const medals = outcome === 'finish' && d.def.kind !== 'pursuit' ? medalsFor(d.def, e.ms) : 0;
    const bin = d.pursuit ?? null;
    const evaded = bin !== null && (bin.outcome === 'evade' || bin.outcome === 'survive');
    const bountyCents = bin ? bin.bountyCents() : 0;
    const rewards = computeRewards({
      def: d.def, cfg: d.cfg.progression, outcome, ms: e.ms, place, prevMedals: d.prevMedals ?? 0, embedded: d.embedded === true, evaded, bountyCents,
    });
    if (dir.result) dir.result.place = place;
    if (dir.result) dir.result.of = of;
    const hash = this.endHash();
    this.endHashHex = hash;
    const finishTick = outcome === 'finish' ? (this.finishTick >= 0 ? this.finishTick : tick) : null;
    const rec = this.recorder;
    const run = rec && rec.recording
      ? rec.finish(
        {
          v: 1, raceId: d.def.id, raceVersion: d.def.version, worldBake: d.def.worldBake, buildId: d.buildId ?? 'dev', profile: d.simProfile,
          seed: dir.seedFor(dir.attempt), vehicleDef: d.vehicleDef, handlingRev: d.profile.rev, upgrades: {}, assists: { ...DEFAULT_ASSIST },
          difficulty: d.difficulty ?? 'normal', hour: d.def.hour ?? 12, weather: d.def.weather ?? 'clear',
        },
        finishTick, this.gateTicks, hash, dir.goTick >= 0 ? Math.max(0, dir.goTick - rec.startTick) : 0,
      )
      : null;
    const canGhost = outcome === 'finish' && run !== null && d.def.kind !== 'pursuit' && d.embedded !== true;
    const entry = canGhost && run ? ghostFromRun(run, e.ms, d.nowMs ? d.nowMs() : 0) : null;
    if (entry) this.ghostBest = betterGhost(this.ghostBest ?? undefined, entry);
    const rec2: AttemptRecord = {
      attempt: dir.attempt, outcome, reason: this.reason ?? e.reason ?? null, ms: e.ms, place, of, rewards, run, endHash: hash,
      gateTicks: [...this.gateTicks], finishTick, ghost: entry,
      pursuit: bin
        ? {
          outcome: bin.outcome, heatMax: bin.maxHeat, points: Math.round(bin.points), bountyCents, seconds: bin.seconds(tick), takedowns: bin.takedowns,
          repairCents: bin.outcome === 'bust' ? Math.round((d.cfg.damage.bustRepairPct / 100) * (this.priceCents())) : 0,
        }
        : null,
      distanceM: this.distanceM,
    };
    this.records.push(rec2);
    this.lastAttempt = rec2;
    this.cachedResults = {
      outcome, place, of, ms: e.ms, medals, newBest: false, cashCents: rewards.cashCents, rep: rewards.rep, reason: rec2.reason,
    };
    d.telemetry.emit('racing.finish', finishProps(d.def, outcome, e.ms, place, medals));
    if (bin) {
      d.telemetry.emit('racing.pursuit_end', pursuitEndProps(bin.maxHeat, bin.outcome ?? (this.reason === 'totaled' ? 'totaled' : 'quit'), e.ms));
      bin.stop();
    }
    this.emit({ t: 'race.results', tick, n: e.ms, s: outcome });
  }

  private priceCents(): number {
    return this.d.vehiclePriceCents ?? 0;
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
    const bin = d.pursuit ?? null;
    const heat = bin && bin.running ? { level: bin.maxHeat, phase: bin.outcome ?? 'pursuit', cooldown01: 0, bounty: Math.round(bin.points) } : null;
    const vm = buildHud({
      speedMps: car ? (car.speedMps < 0 ? -car.speedMps : car.speedMps) : 0,
      unit: d.unit ?? 'kph',
      rpm: car ? car.rpm : 0,
      redlineRpm: d.profile.engine.redlineRpm,
      gear: car ? car.gear : 0,
      nitro01: nitro01(d.profile, this.nitro),
      place: this.finishedPlace > 0 ? this.finishedPlace : this.place,
      of: 1 + (this.field ? this.field.size : 0),
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
      heat,
      results: dir.phase === 'Results' || dir.phase === 'Finished' || dir.phase === 'Failed' ? this.cachedResults : null,
      ghost: this.ghostRunner !== null && this.ghostRunner.spawned,
    });
    this.lastHud = vm;
    d.sinks.hud(vm);
  }

  /** Marks the stored record of the attempt with whether it set the event's best (the mode knows the slice). */
  markNewBest(v: boolean): void {
    if (this.cachedResults) this.cachedResults = { ...this.cachedResults, newBest: v };
  }
}

const PHASE_ID: Record<RacePhase, number> = { Loading: 0, Grid: 1, Countdown: 2, Running: 3, Finished: 4, Failed: 5, Results: 6 };

function dist2(dx: number, dz: number): number {
  return dsqrt(dx * dx + dz * dz);
}

