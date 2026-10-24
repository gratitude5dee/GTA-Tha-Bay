/**
 * `MissionRuntime` (C09 section C6): runs one mission on C06 `SimScheduler` threads. A stage's objectives are threads
 * (`mis:<id>:1.obj.<objective>`), its `onEnter` and `onComplete` ops are threads (`0.enter`, `0.complete`), and the mission's
 * `threads` are threads (`2.thr.<name>`); the engine runs them in `threadId` order after the mode host's tick. `tick` does the rest
 * of the work in order: queued commands, tasks, the beat, the mission clock, the end requested by `pass` or `fail`, objectives and
 * stage change, fail rules, then the view-model patches. Results of the threads of one tick are therefore seen at the start of the next.
 *
 * Time is the mission clock: it counts ticks while the phase is `stage` and no beat plays, so a cutscene and its fallback leave
 * every timer equal. The only RNG is the stream seeded for the attempt. Nothing reads wall time. Sim code under the C02 lint.
 */
import {
  Fnv64, Rng, type EntityHandle, type JsonObject, type JsonValue, type MissionCheckpointV1, type MissionIR, type MissionPhase, type ModeContext,
  type Op, type Pred, type SimEvent, type StableKey, type StageDef, type StorySlice, type TalkDef, type ThreadCtx, type ThreadYield, type UnlockEventId, type VehicleInstance, type WeatherPreset,
} from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import type { ResolvedMission } from '../compiler/resolve.ts';
import { Actors, type Vec3 } from './actors.ts';
import { captureCheckpoint, readCheckpoint, restoreCheckpoint, writeCheckpoint } from './checkpoint.ts';
import { BUDGET_STREAK_LIMIT, OPS_BUDGET, missionScope } from './constants.ts';
import { objectiveStep, objectiveTarget, startObjective } from './objectives.ts';
import { OpRunner, type OpHost, type WaitSpec } from './ops.ts';
import { evalPred, type Cost, type PredEnv } from './predicates.ts';
import { DirectorSystem } from '../director/system.ts';
import type { Comfort } from '../director/types.ts';
import { missionDeps } from './deps.ts';
import { Probes } from './probes.ts';
import { newGarageCar } from '../missions/garage-car.ts';
import { TaskRunner, type VehicleDriver } from './tasks.ts';
import {
  DEFAULT_FLAGS, type CastRt, type EndRequest, type ObjRt, type ObjState, type RuntimeFlags, type RuntimeOptions, type StartOptions, type StoryCommand,
} from './types.ts';
import { byStr, hash32 } from './util.ts';
import { CHILD_OUTCOMES } from './hooks.ts';
import { answerOverdue, doneEvent, parseStateEvent, playIdOf, requestEvent, transition, type CutBeat } from '../cutscene/protocol.ts';

const isMissing = (e: unknown): boolean => e instanceof Error && e.name === 'NotYetAvailable';
/** Calls a context service that a build may not have; a missing one is skipped. */
function soft<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    if (isMissing(e)) return undefined;
    throw e;
  }
}

const SAY_MIN_TICKS = 90;
const SAY_TICKS_PER_CHAR = 3.6;
const MARKER_UPDATE_EVERY = 4;
const EVENT_LOG_MAX = 50;

interface Beat {
  id: number;
  owner: string;
  script: DirectorScript | null;
  ticksLeft: number;
  instant: boolean;
  /** A generated-cutscene beat (M05b2): the request, its state and the answer wait. Absent for a plain director beat. */
  cut?: CutBeat;
}

export interface ThreadView {
  id: string;
  ptr: string;
  wait: string;
  ops: number;
}

export class MissionRuntime implements OpHost {
  phase: MissionPhase = 'available';
  ir!: MissionIR;
  rm!: ResolvedMission;
  ctx!: ModeContext;
  readonly actors: Actors;
  flagsCfg: RuntimeFlags;
  attempt = 1;
  seed = 0;
  rng = new Rng(1);
  clock = 0;
  stageIndex = -1;
  objectives = new Map<string, ObjRt>();
  doneIds = new Set<string>();
  talkResults: Record<string, string> = {};
  modeResults: Record<string, string> = {};
  activeHook: string | null = null;
  castRt = new Map<string, CastRt>();
  carriedSet = new Set<string>();
  touchedFlags = new Set<string>();
  walletDelta = 0;
  revokeGen = 0;
  readonly tasks: TaskRunner;
  /** The photo shutter and the drift score (M05a2): events the engine does not produce yet. */
  readonly probes = new Probes();
  /** The in-engine cinematic director (M05a2): the DirectorScript of a beat, and the auto-director of the `camera` op. */
  readonly director: DirectorSystem;
  private readonly dirZones = new Map<string, Vec3>();
  private camUntil: number | null = null;
  private camSerial = 0;
  /** Events of the mission, newest last (the debugger shows the last 50). */
  readonly eventLog: { tick: number; t: string; data: JsonObject }[] = [];

  private commands: StoryCommand[] = [];
  private pendingEnd: EndRequest | null = null;
  private pendingJump: string | null = null;
  private stageSince = 0;
  private completing = false;
  private beat: Beat | null = null;
  private beatSerial = 0;
  private playSerial = 0;
  private lastFailRetry: 'checkpoint' | 'start' = 'checkpoint';
  private failReason = '';
  private runners = new Map<string, OpRunner>();
  private threadOps = new Map<string, number>();
  private streaks = new Map<string, number>();
  private counts = new Map<string, number>();
  private sums = new Map<string, number>();
  private stageBase = new Map<string, number>();
  private givenKeys = new Set<string>();
  private markers = new Map<string, { handle: EntityHandle | null; target: () => Vec3 | null; blip: string | null }>();
  private curT: ThreadCtx | null = null;
  private hudKey = '';
  private unsub: (() => void) | null = null;
  private introPending = false;
  private bound: ModeContext | null = null;
  private driverFn: (() => VehicleDriver | null) | null = null;
  private firstCp: MissionCheckpointV1 | null = null;
  private restarted = false;

  readonly predEnv: PredEnv;

  constructor(private readonly opts: RuntimeOptions) {
    this.flagsCfg = { ...DEFAULT_FLAGS, ...(opts.flags ?? {}) };
    this.actors = new Actors(() => this.ctx, () => this.ir.id);
    this.tasks = new TaskRunner({
      ctx: () => this.ctx,
      actors: this.actors,
      zoneCenter: (z) => this.zoneCenter(z),
      zoneInside: (z, h) => this.zoneInsideHandle(z, h),
      driver: () => this.driverFn?.() ?? null,
      pace: (cast) => this.paceOf(cast),
    });
    this.predEnv = this.makePredEnv();
    this.director = new DirectorSystem({
      ctx: () => this.ctx,
      actors: this.actors,
      tasks: this.tasks,
      markPos: (at) => this.markPos(at),
      comfort: () => this.comfort(),
      castOfSoul: (soul) => {
        for (const name of Object.keys(this.ir.cast).sort(byStr)) {
          const c = this.ir.cast[name];
          if (c && c.k === 'npc' && 'soul' in c.who && c.who.soul === soul) return name;
        }
        return null;
      },
      note: (name, data) => this.noteEvent(name, data),
      defineMarkZone: (zone, pos) => void this.dirZones.set(zone, pos),
      clearMarkZones: () => this.dirZones.clear(),
    });
  }

  /** Comfort settings the director obeys: reduced motion and the XR camera mode. */
  comfort(): Comfort {
    return this.opts.comfort?.() ?? { reducedMotion: false, xr: false };
  }

  // ---------------------------------------------------------------- binding and queries

  /** The engine's vehicle driver for NPC cars; without it `driveTo` moves the car in a straight line. */
  /** Clears the heat the player's current car carries (the body shop of m.a1.09). */
  private respray(): void {
    const h = this.actors.playerVehicle();
    if (h === null) return;
    const key = soft(() => this.ctx.ecs.keyOf(h));
    if (typeof key === 'string' && key !== '') soft(() => this.ctx.pursuit.respray(key));
  }

  /** How far behind a car the player may fall before the car eases off: set by the `follow` or `chase` objective that names it (M05c2). */
  private paceOf(cast: string): { slowAboveM: number; floorAtM: number; floor: number } | null {
    for (const o of this.objectives.values()) {
      if (o.state !== 'active') continue;
      const d = o.def;
      if (d.k === 'follow' && d.target === cast) return { slowAboveM: d.band[1] * 0.5, floorAtM: d.band[1] * 0.9, floor: 0 };
      if (d.k === 'chase' && d.target === cast) return { slowAboveM: Math.max(25, d.catchDist * 4), floorAtM: Math.max(60, d.catchDist * 10), floor: 0.35 };
    }
    return null;
  }

  setDriver(fn: (() => VehicleDriver | null) | null): void {
    this.driverFn = fn;
  }

  /** Makes `ctx` the context of the runtime (every tick passes it; `start` needs it first). */
  bind(ctx: ModeContext): void {
    this.ctx = ctx;
    if (this.bound !== ctx) {
      this.unsub?.();
      this.unsub = ctx.events.on('*', (e) => this.onSimEvent(e));
      this.bound = ctx;
    }
  }

  get missionId(): string | null {
    return this.phase === 'available' && !this.ir ? null : (this.ir?.id ?? null);
  }

  get story(): () => StorySlice {
    return this.opts.story;
  }

  get elapsedSec(): number {
    return this.clock / 60;
  }

  get stage(): StageDef | null {
    return this.ir?.stages[this.stageIndex] ?? null;
  }

  get beating(): boolean {
    return this.beat !== null;
  }

  get active(): boolean {
    return this.phase === 'starting' || this.phase === 'intro' || this.phase === 'stage' || this.phase === 'outro' || this.phase === 'failed';
  }

  /** Spends `n` ops of the thread that is running now. */
  cost(n: number): void {
    if (this.curT) this.curT.ops += n;
  }

  ended(): boolean {
    return this.pendingEnd !== null;
  }

  heat(): { level: number; phase: 'clear' | 'pursuit' | 'search' | 'cooldown' | 'busted' } {
    const s = soft(() => this.ctx.pursuit.state());
    return s ? { level: s.level, phase: s.phase } : { level: 0, phase: 'clear' };
  }

  scope(): string {
    return missionScope(this.ir.id);
  }

  zoneId(zone: string): string {
    return `${this.scope()}:${zone}`;
  }

  zoneInside(who: string, zone: string): boolean {
    const z = this.rm.zones[zone];
    if (!z) return false;
    if (z.k === 'cast') return this.actors.distance(who, z.cast) <= z.r;
    const h = this.actors.handleOf(who);
    return h !== null && this.zoneInsideHandle(zone, h);
  }

  private zoneInsideHandle(zone: string, h: EntityHandle): boolean {
    const z = this.rm.zones[zone];
    if (!z) return false;
    if (z.k === 'cast') {
      const c = this.actors.cast(z.cast);
      const a = this.actors.posOf(h);
      const b = c ? this.actors.posOf(c) : null;
      if (!a || !b) return false;
      const dx = a[0] - b[0];
      const dz = a[2] - b[2];
      return dx * dx + dz * dz <= z.r * z.r;
    }
    return this.ctx.zones.inside(this.zoneId(zone), h);
  }

  zoneCenter(zone: string): Vec3 | null {
    const alias = this.dirZones.get(zone);
    if (alias) return alias;
    const z = this.rm.zones[zone];
    if (!z) return null;
    switch (z.k) {
      case 'circle':
        return [z.at[0], z.at[1], z.at[2]];
      case 'poly': {
        let x = 0;
        let zz = 0;
        for (const [px, pz] of z.ring) {
          x += px;
          zz += pz;
        }
        const n = z.ring.length || 1;
        const gy = this.ctx.physics.groundY(x / n, zz / n);
        return [x / n, gy ?? 0, zz / n];
      }
      case 'cast':
        return this.actors.pos(z.cast);
      case 'edges':
        return null;
    }
  }

  landmarkPos(id: string): Vec3 | null {
    const lm = soft(() => this.ctx.world.resolver.landmark(id as never));
    return lm ? [lm.enu[0], lm.enu[1], lm.enu[2]] : null;
  }

  eventCount(name: string): number {
    return this.counts.get(name) ?? 0;
  }

  eventSum(name: string): number {
    return this.sums.get(name) ?? 0;
  }

  isCarried(cast: string): boolean {
    return this.carriedSet.has(cast);
  }

  carry(cast: string): void {
    this.carriedSet.add(cast);
    this.despawnCast(cast, true);
    this.noteEvent('carry', { cast });
  }

  uncarry(cast: string): void {
    this.carriedSet.delete(cast);
  }

  pred(p: Pred, cost: Cost): boolean {
    return evalPred(p, this.predEnv, cost);
  }

  private makePredEnv(): PredEnv {
    const stateOf = (id: string): 'pending' | 'active' | 'done' | 'failed' => this.objectives.get(id)?.state ?? (this.doneIds.has(id) ? 'done' : 'pending');
    return {
      inZone: (who, zone) => this.zoneInside(who, zone),
      inVehicle: (who, vehicle) => this.actors.inVehicle(who, vehicle),
      distance: (a, b) => this.actors.distance(a, b),
      health: (who) => this.actors.healthFrac(who),
      ko: (who) => this.actors.isKo(who),
      destroyed: (cast) => this.isDestroyed(cast),
      busted: () => this.heat().phase === 'busted',
      heat: () => this.heat(),
      speed: (who) => this.actors.speed(who),
      hour: () => soft(() => this.ctx.clock.env().hour) ?? 12,
      weather: () => soft(() => this.ctx.clock.env().weather) ?? ('clear' as WeatherPreset),
      flag: (key) => this.opts.story().flags[key],
      trust: (npc) => this.opts.story().npcRelations[npc]?.trust ?? 0,
      itemCount: (id) => {
        const v = this.opts.story().flags[`item.${id}`];
        return typeof v === 'number' ? v : 0;
      },
      cashCents: () => this.ctx.economy.balance(),
      objective: stateOf,
      stageSeconds: () => (this.clock - this.stageSince) / 60,
      eventSeen: (name, since) => (since === 'mission' ? this.eventCount(name) > 0 : this.eventCount(name) > (this.stageBase.get(name) ?? 0)),
      modeResult: (hook) => this.modeResults[hook],
      passed: (m) => this.opts.story().missions[m]?.state === 'passed',
      act: () => this.opts.story().act,
      unlocked: (id) => this.ctx.unlocks.has(id),
    };
  }

  private isDestroyed(cast: string): boolean {
    const cr = this.castRt.get(cast);
    if (!cr || !cr.live) return false;
    if (this.carriedSet.has(cast)) return false;
    if (this.actors.cast(cast) === null) return cr.seen;
    cr.seen = true;
    return this.actors.isKo(cast) || this.actors.damage(cast) >= 0.98;
  }

  // ---------------------------------------------------------------- start and end

  /** Starts a resolved mission (phase `starting` to `intro` or `stage`). `bind` must have been called. */
  start(rm: ResolvedMission, o: StartOptions): void {
    const carry = o.carry;
    this.resetAll();
    if (carry) {
      this.walletDelta = carry.walletDelta;
      this.revokeGen = carry.revokeGen;
      this.touchedFlags = new Set(carry.touchedFlags);
    }
    this.rm = rm;
    this.ir = rm.ir;
    this.attempt = o.attempt;
    this.seed = o.seed;
    this.rng = new Rng(o.seed);
    this.phase = 'starting';
    for (const name of Object.keys(this.ir.cast).sort(byStr)) this.castRt.set(name, { name, key: this.actors.keyOf(name), live: false, carried: false, seen: false });
    this.defineZones();
    this.trackTimeline();
    this.applyStartPolicy();
    this.opts.log?.(`mission ${this.ir.id} start attempt ${o.attempt}`);
    this.telemetry('mission.start', 0);
    if (o.from) {
      this.spawnStartCast();
      this.firstCp = carry?.first ?? null;
      restoreCheckpoint(this, o.from);
      this.startThreads();
      this.phase = 'stage';
      this.enterStage(o.from.stage, true);
      return;
    }
    this.spawnStartCast();
    this.firstCp = captureCheckpoint(this);
    const intro = this.ir.intro;
    if (intro) {
      this.phase = 'intro';
      this.introPending = true;
      const w = this.startBeat(intro, 'phase.intro');
      if (!w) this.finishIntro();
      return;
    }
    this.phase = 'stage';
    this.startThreads();
    this.enterStage(0, false);
  }

  /** The player and every cast entry get a track on the timeline (a position every 2 ticks), for the preview scrubber. */
  private trackTimeline(): void {
    const tl = this.ctx.timeline as { trackKey?(key: StableKey, name: string): void };
    if (!tl.trackKey) return;
    tl.trackKey('player:0' as StableKey, 'player');
    for (const name of this.castRt.keys()) tl.trackKey(this.actors.keyOf(name), `cast.${name}`);
  }

  private finishIntro(): void {
    this.introPending = false;
    this.phase = 'stage';
    this.startThreads();
    this.enterStage(0, false);
  }

  /** Throws the previous mission's state away (threads, cast, markers, zones) without side effects on the world policies. */
  private resetAll(): void {
    this.killThreads();
    this.tasks.clear();
    this.clearMarkers();
    this.clock = 0;
    this.stageIndex = -1;
    this.objectives.clear();
    this.doneIds = new Set();
    this.talkResults = {};
    this.modeResults = {};
    this.activeHook = null;
    this.castRt.clear();
    this.carriedSet.clear();
    this.touchedFlags.clear();
    this.walletDelta = 0;
    this.revokeGen = 0;
    this.commands = [];
    this.pendingEnd = null;
    this.pendingJump = null;
    this.completing = false;
    this.beat = null;
    this.counts.clear();
    this.sums.clear();
    this.stageBase.clear();
    this.givenKeys.clear();
    this.eventLog.length = 0;
    this.hudKey = '';
    this.introPending = false;
    this.probes.reset();
  }

  private defineZones(): void {
    for (const name of Object.keys(this.rm.zones).sort(byStr)) {
      const z = this.rm.zones[name];
      if (z && z.k !== 'cast') this.ctx.zones.define(this.zoneId(name), z);
    }
  }

  private undefineZones(): void {
    for (const name of Object.keys(this.rm.zones)) {
      const z = this.rm.zones[name];
      if (z && z.k !== 'cast') soft(() => this.ctx.zones.undefine(this.zoneId(name)));
    }
  }

  /** On start: ambient multipliers, the clock lock, the start heat and the heat cap. */
  private applyStartPolicy(): void {
    const ir = this.ir;
    const scope = this.scope();
    if (ir.ambient?.traffic !== undefined) soft(() => this.ctx.world.traffic.setDensity('traffic', ir.ambient?.traffic as number, scope));
    if (ir.ambient?.peds !== undefined) soft(() => this.ctx.world.traffic.setDensity('ped', ir.ambient?.peds as number, scope));
    const lock = ir.ambient?.lock;
    if (lock) soft(() => this.ctx.clock.lock(scope, lock.hour, lock.weather));
    soft(() => this.ctx.pursuit.capHeat(ir.heatPolicy.maxHeat));
    if (ir.heatPolicy.startHeat !== undefined) soft(() => this.ctx.pursuit.setHeat(ir.heatPolicy.startHeat as never, 'mission'));
  }

  /** The `finally` table: runs on every way out, restores what the mission changed. */
  private release(): void {
    const scope = this.scope();
    soft(() => this.ctx.clock.unlock(scope));
    soft(() => {
      this.ctx.world.traffic.setDensity('traffic', 1, scope);
      this.ctx.world.traffic.setDensity('ped', 1, scope);
      this.ctx.world.traffic.release(scope);
    });
    soft(() => this.ctx.pursuit.capHeat(5));
    if (this.ir.heatPolicy.clearOnPass) soft(() => this.ctx.pursuit.clear('mission'));
    if (this.beat || this.director.active) {
      this.director.disarm(false);
      this.director.stopAuto();
      this.camUntil = null;
      soft(() => this.ctx.camera.release());
      if (this.beat?.cut) soft(() => this.ctx.input.pop('cutscene'));
      this.beat = null;
    }
    this.undefineZones();
    this.ctx.ui.patch('mode.story.talk', null);
  }

  private killThreads(): void {
    const sched = this.bound?.scheduler;
    for (const id of [...this.runners.keys()]) soft(() => sched?.kill(id));
    this.runners.clear();
    for (const o of this.objectives.values()) soft(() => sched?.kill(o.threadId));
    this.threadOps.clear();
    this.streaks.clear();
  }

  /** Quit, error, kill or mode exit: everything the mission changed goes back; the mission is no longer active. */
  abort(reason: 'quit' | 'error' | 'kill' | 'modeExit'): void {
    if (!this.ir || this.phase === 'passed' || this.phase === 'aborted' || (this.phase === 'available' && !this.active)) return;
    const was = this.phase;
    this.killThreads();
    this.tasks.clear();
    this.clearMarkers();
    for (const n of [...this.castRt.keys()]) this.despawnCast(n);
    this.release();
    this.opts.story().activeMission = null;
    this.phase = reason === 'quit' ? 'available' : 'aborted';
    if (was !== 'failed') this.telemetry('mission.fail', undefined, reason);
    this.noteEvent('abort', { reason });
    this.ctx.ui.patch('hud.mission', null);
  }

  // ---------------------------------------------------------------- the tick

  tick(ctx: ModeContext): void {
    this.bind(ctx);
    if (!this.ir) return;
    this.applyCommands();
    if (this.restarted) {
      // a retry just put the world back: the clock stands at the checkpoint for this tick
      this.restarted = false;
      return;
    }
    if (this.phase === 'intro') {
      this.advanceBeat();
      if (this.beat === null && this.introPending) this.finishIntro();
      return;
    }
    if (this.phase === 'outro') {
      this.advanceBeat();
      if (this.beat === null) this.finishPass();
      return;
    }
    if (this.phase !== 'stage') return;
    this.tasks.tick();
    // while a cutscene's answer is awaited the fallback script holds; it starts from its first tick on `fallback`
    if (this.beat?.cut?.state !== 'armed') this.director.step(ctx.tick);
    this.advanceBeat();
    if (this.camUntil !== null && this.clock >= this.camUntil) {
      this.camUntil = null;
      this.director.stopAuto();
      soft(() => ctx.camera.release());
    }
    if (this.beat === null || missionDeps().clockCountsBeats) this.clock++;
    if (this.pendingEnd) {
      const end = this.pendingEnd;
      this.pendingEnd = null;
      if (end.k === 'pass') this.pass();
      else this.fail(end.reason, 'checkpoint');
      return;
    }
    if (this.beat === null) {
      this.probes.step(this, ctx);
      this.updateObjectives();
      if (this.phase === 'stage') this.checkFailRules();
      if (this.phase === 'stage') this.checkTimeLimit();
    }
    if (this.phase === 'stage') this.updateMarkers();
    this.publishHud();
  }

  /** While a child mode runs: only the fail rules run. */
  suspendedTick(ctx: ModeContext): void {
    this.bind(ctx);
    if (this.phase === 'stage') this.checkFailRules();
  }

  private checkFailRules(): void {
    const cost: Cost = { n: 0 };
    const ir = this.ir;
    for (const f of ir.fail) {
      if (this.pred(f.when, cost)) {
        this.fail(f.reason, f.retry);
        return;
      }
    }
    if (ir.heatPolicy.maxHeat > 0 && this.predEnv.busted()) this.fail('fail.reason.busted', 'checkpoint');
  }

  private checkTimeLimit(): void {
    const s = this.stage;
    if (!s || s.timeLimitSec === undefined || this.completing) return;
    const limit = Math.ceil(s.timeLimitSec * (this.opts.timerScale?.() ?? 1) * 60);
    if (this.clock - this.stageSince > limit) this.fail('fail.reason.time', 'checkpoint');
  }

  // ---------------------------------------------------------------- stages

  private enterStage(i: number, restore: boolean): void {
    const s = this.ir.stages[i];
    if (!s) {
      this.pass();
      return;
    }
    this.killStageThreads();
    this.clearObjectiveMarkers();
    this.stageIndex = i;
    this.stageSince = this.clock;
    this.completing = false;
    this.stageBase = new Map(this.counts);
    this.noteEvent('stage', { index: i, id: s.id });
    const wantCheckpoint = s.checkpoint ?? (i === 0 || stageHasHeat(s));
    if (wantCheckpoint && !restore) writeCheckpoint(this, captureCheckpoint(this));
    this.objectives.clear();
    s.objectives.forEach((def, idx) => {
      const o: ObjRt = { def, state: s.join === 'sequence' && idx > 0 ? 'pending' : 'active', since: this.clock, threadId: this.tid(`1.obj.${def.id}`), data: {} };
      this.objectives.set(def.id, o);
      if (o.state === 'active') this.activateObjective(o);
    });
    if (s.onEnter && s.onEnter.length > 0) this.spawnOpThread(this.tid('0.enter'), s.onEnter, `/stages/${i}/onEnter`);
  }

  private activateObjective(o: ObjRt): void {
    o.state = 'active';
    o.since = this.clock;
    startObjective(this, o.def, o);
    this.spawnObjectiveThread(o);
    if (o.def.marker !== false) this.placeObjectiveMarker(o);
    this.noteEvent('objective', { id: o.def.id, state: 'active' });
  }

  private tid(name: string): string {
    return `${this.scope()}:${name}`;
  }

  private killStageThreads(): void {
    const sched = this.ctx.scheduler;
    for (const o of this.objectives.values()) soft(() => sched.kill(o.threadId));
    for (const id of [this.tid('0.enter'), this.tid('0.complete')]) {
      if (this.runners.has(id)) {
        soft(() => sched.kill(id));
        this.runners.delete(id);
      }
    }
  }

  private startThreads(): void {
    for (const name of Object.keys(this.ir.threads ?? {}).sort(byStr)) {
      const id = this.tid(`2.thr.${name}`);
      if (this.runners.has(id)) {
        soft(() => this.ctx.scheduler.kill(id));
        this.runners.delete(id);
      }
      this.spawnOpThread(id, (this.ir.threads as Record<string, Op[]>)[name] as Op[], `/threads/${name}`);
    }
  }

  private updateObjectives(): void {
    const s = this.stage;
    if (!s) return;
    if (this.completing) {
      if (!this.runners.has(this.tid('0.complete'))) this.advance();
      return;
    }
    const list = [...this.objectives.values()];
    for (const o of list) {
      if (o.state === 'failed' && o.def.optional !== true) {
        this.fail(`fail.reason.${o.def.k}`, 'checkpoint');
        return;
      }
    }
    if (s.join === 'sequence') {
      const next = list.find((o) => o.state === 'pending');
      const lastDone = list.every((o) => o.state === 'done' || o.state === 'pending' || o.state === 'failed');
      const active = list.find((o) => o.state === 'active');
      if (!active && next && lastDone) this.activateObjective(next);
    }
    const required = list.filter((o) => o.def.optional !== true);
    const done =
      s.join === 'any'
        ? list.some((o) => o.state === 'done')
        : required.length > 0
          ? required.every((o) => o.state === 'done')
          : list.every((o) => o.state === 'done' || o.state === 'failed');
    if (done) this.completeStage();
  }

  private completeStage(): void {
    const s = this.stage as StageDef;
    for (const o of this.objectives.values()) {
      if (o.state === 'done') this.doneIds.add(o.def.id);
      if (o.state === 'active' || o.state === 'pending') {
        soft(() => this.ctx.scheduler.kill(o.threadId));
        o.state = 'pending';
      }
    }
    this.clearObjectiveMarkers();
    this.noteEvent('stage.done', { index: this.stageIndex, id: s.id });
    this.completing = true;
    if (s.onComplete && s.onComplete.length > 0) {
      this.spawnOpThread(this.tid('0.complete'), s.onComplete, `/stages/${this.stageIndex}/onComplete`);
      return;
    }
    this.advance();
  }

  private advance(): void {
    const s = this.stage as StageDef;
    const ids = this.ir.stages.map((x) => x.id);
    let next = this.stageIndex + 1;
    const target = this.pendingJump ?? s.next;
    this.pendingJump = null;
    if (target !== undefined && target !== null) {
      const j = ids.indexOf(target);
      if (j >= 0) next = j;
    }
    if (next >= this.ir.stages.length) {
      this.pass();
      return;
    }
    this.enterStage(next, false);
  }

  /** QA: jumps to a stage without running the stages in between. */
  jumpTo(stage: number): void {
    if (this.phase !== 'stage' && this.phase !== 'intro') return;
    if (stage < 0 || stage >= this.ir.stages.length) return;
    if (this.phase === 'intro') {
      if (this.beat?.cut) soft(() => this.ctx.input.pop('cutscene'));
      this.beat = null;
      soft(() => this.ctx.camera.release());
      this.finishIntro();
    }
    this.pendingEnd = null;
    this.enterStage(stage, false);
  }

  // ---------------------------------------------------------------- pass and fail

  private pass(): void {
    if (this.phase !== 'stage') return;
    this.killStageThreads();
    this.clearObjectiveMarkers();
    const outro = this.ir.outro;
    if (outro) {
      this.phase = 'outro';
      const w = this.startBeat(outro, 'phase.outro');
      if (w) return;
    }
    this.finishPass();
  }

  private finishPass(): void {
    const ir = this.ir;
    const story = this.opts.story();
    const r = ir.rewards;
    if (r.cashCents) this.ctx.economy.credit(r.cashCents, 'mission.reward', `${this.scope()}:reward`);
    if (r.streetCred) story.wallet.streetCred += r.streetCred;
    if (r.techClout) story.wallet.techClout += r.techClout;
    for (const it of r.items ?? []) this.addItem(it.id, it.qty);
    for (const t of r.trust ?? []) this.addTrust(t.npc, t.delta);
    if (r.safehouse && !story.property.safehouses.includes(r.safehouse)) story.property.safehouses.push(r.safehouse);
    if (r.streetCred || r.techClout) this.ctx.ui.patch('hud.wallet', { cashCents: story.wallet.cashCents, streetCred: story.wallet.streetCred, techClout: story.wallet.techClout });
    const sec = Math.round((this.clock / 60) * 100) / 100;
    const prev = story.missions[ir.id];
    const medals = this.medalFor(sec);
    story.missions[ir.id] = {
      state: 'passed',
      bestSec: prev?.bestSec !== undefined ? Math.min(prev.bestSec, sec) : sec,
      medals: (Math.max(prev?.medals ?? 0, medals) as 0 | 1 | 2 | 3),
    };
    const garage = (this.ctx as ModeContext & { garage?: { add(i: VehicleInstance): boolean } }).garage;
    for (const defId of r.vehicles ?? []) garage?.add(newGarageCar({ defId, seed: `mis:${ir.id}:${defId}`, source: 'reward' }));
    this.noteEvent('reward', { cashCents: r.cashCents ?? 0, vehicles: (r.vehicles ?? []).join(',') });
    for (const u of ir.unlocks ?? []) this.ctx.unlocks.emit(u as UnlockEventId, { kind: 'mission', ref: ir.id });
    story.activeMission = null;
    this.ctx.save.request('missionPass');
    this.telemetry('mission.complete', undefined);
    this.noteEvent('pass', { sec });
    this.killThreads();
    this.tasks.clear();
    this.clearMarkers();
    for (const n of [...this.castRt.keys()]) this.despawnCast(n);
    this.release();
    this.phase = 'passed';
    this.ctx.ui.patch('hud.mission', null);
  }

  private medalFor(sec: number): number {
    const m = this.ir.medals;
    if (!m) return 1;
    if (sec <= m.goldSec && (m.goldIf === undefined || this.pred(m.goldIf, { n: 0 }))) return 3;
    return sec <= m.silverSec ? 2 : 1;
  }

  fail(reason: string, retry: 'checkpoint' | 'start' = 'checkpoint'): void {
    if (this.phase !== 'stage' && this.phase !== 'intro') return;
    this.killThreads();
    this.tasks.clear();
    this.clearMarkers();
    for (const n of [...this.castRt.keys()]) this.despawnCast(n);
    this.release();
    this.phase = 'failed';
    this.lastFailRetry = retry;
    this.failReason = reason;
    this.pendingEnd = null;
    this.telemetry('mission.fail', undefined, reason);
    this.noteEvent('fail', { reason });
    this.ctx.ui.patch('hud.mission', { titleKey: this.ir.title, objectiveKey: '', failKey: reason, retry });
    this.ctx.ui.toast({ id: `${this.scope()}:fail`, kind: 'warning', text: reason });
    this.hudKey = '';
  }

  /** The script broke its budget (60 ticks in a row at 2,000 ops) or threw: the mission fails with `fail.reason.script_error`. */
  scriptError(code: string, thread: string, detail?: string): void {
    this.opts.log?.(`mission ${this.ir?.id}: ${code} in ${thread}${detail ? `: ${detail}` : ''}`);
    soft(() => this.ctx.telemetry.emit('err.sim', { code, mid: this.ir.id, thread }));
    if (this.phase === 'stage' || this.phase === 'intro') this.fail('fail.reason.script_error', 'checkpoint');
  }

  // ---------------------------------------------------------------- commands

  command(c: StoryCommand): void {
    this.commands.push(c);
  }

  private applyCommands(): void {
    if (this.commands.length === 0) return;
    const list = this.commands;
    this.commands = [];
    for (const c of list) this.apply(c);
  }

  private apply(c: StoryCommand): void {
    switch (c.name) {
      case 'mission.retry':
        this.retry();
        return;
      case 'mission.quit':
        this.abort('quit');
        return;
      case 'talk.result':
        this.applyTalkResult(c);
        return;
      case 'cut.state':
        this.onCutState(c.playId, c.state, c.trigger);
        return;
      case 'debug.jump':
        this.jumpTo(c.stage);
        return;
      case 'debug.pass':
        if (this.phase === 'stage') this.pass();
        return;
      case 'debug.fail':
        if (this.phase === 'stage') this.fail('fail.reason.debug', 'checkpoint');
        return;
      case 'debug.flag':
        this.setFlag(c.key, c.value);
        return;
      case 'mission.start':
        return;
    }
  }

  private retry(): void {
    if (this.phase !== 'failed') return;
    const stored = readCheckpoint(this.opts.story().activeMission, this.ir.id, this.ir.version, this.rm.bake);
    const from = this.lastFailRetry === 'start' ? (this.firstCp ?? stored) : (stored ?? this.firstCp);
    const carry = { walletDelta: this.walletDelta, revokeGen: this.revokeGen, touchedFlags: new Set(this.touchedFlags), first: this.firstCp };
    this.start(this.rm, { attempt: this.attempt + 1, seed: this.seed, ...(from ? { from } : {}), carry });
    this.restarted = true;
  }

  private applyTalkResult(c: Extract<StoryCommand, { name: 'talk.result' }>): void {
    const o = [...this.objectives.values()].find((x) => x.def.k === 'talk' && x.def.talk.id === c.talkId && x.state === 'active');
    if (!o || o.def.k !== 'talk') return;
    const talk = o.def.talk;
    const out = talk.outcomes[c.outcome];
    if (!out) return;
    // a gated or unaffordable outcome is refused; the scripted default of a CI run is always taken
    if (c.path !== 'scripted' && this.talkChoices(talk).find((x) => x.id === c.outcome)?.enabled !== true) return;
    const cost = out.flags?.['talk.cost'];
    if (typeof cost === 'number' && cost > 0) this.ctx.economy.debit(cost, 'mission.talk', `${this.scope()}:talk:${talk.id}:${c.outcome}`);
    this.talkResults[talk.id] = c.outcome;
    this.ctx.timeline.external({ src: 'talk', tick: this.ctx.tick, data: { talkId: talk.id, outcome: c.outcome, turns: c.turns, path: c.path } });
    this.noteEvent('talk', { talkId: talk.id, outcome: c.outcome, path: c.path });
    for (const [k, v] of Object.entries(out.flags ?? {})) this.setFlag(k, v);
    if (out.trust) this.addTrust(this.soulOf(talk.npc), out.trust);
    if (out.stage !== undefined) this.pendingJump = out.stage;
    this.ctx.ui.patch('mode.story.talk', null);
  }

  // ---------------------------------------------------------------- state helpers

  setFlag(key: string, value: boolean | number | string): void {
    this.opts.story().flags[key] = value;
    this.touchedFlags.add(key);
    this.noteEvent('flag', { key, value });
    // the one flag that is a slice field: a story mission moves the campaign on by setting `story.act` (never back down, M05c2)
    if (key === 'story.act' && (value === 2 || value === 3)) {
      const story = this.opts.story();
      if (value > story.act) story.act = value;
    }
  }

  soulOf(cast: string): string {
    const c = this.ir.cast[cast];
    if (c?.k === 'npc') return 'soul' in c.who ? c.who.soul : `slot:${c.who.slot}`;
    return cast;
  }

  private addTrust(soul: string, delta: number): void {
    const rel = (this.opts.story().npcRelations[soul] ??= { trust: 0, met: false });
    rel.trust = Math.max(-100, Math.min(100, rel.trust + delta));
    rel.met = true;
  }

  private addItem(id: string, qty: number): void {
    const flags = this.opts.story().flags;
    const key = `item.${id}`;
    const have = flags[key];
    flags[key] = (typeof have === 'number' ? have : 0) + qty;
  }

  /** A mission event: counted (for `event` predicates and `waitEvent`), logged, and recorded on the timeline as `mis.<name>`. */
  noteEvent(name: string, data: Record<string, string | number | boolean> = {}): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    const n = typeof data['n'] === 'number' ? data['n'] : 0;
    if (n !== 0) this.sums.set(name, (this.sums.get(name) ?? 0) + n);
    const tick = this.ctx.tick;
    soft(() => this.ctx.timeline.emit({ t: `mis.${name}`, tick, data }));
    this.eventLog.push({ tick, t: name, data });
    if (this.eventLog.length > EVENT_LOG_MAX) this.eventLog.shift();
  }

  private onSimEvent(e: SimEvent): void {
    if (!this.ir || e.t.startsWith('mode.cmd')) return;
    // The main thread's answer (`UiCommand cutscene.state`) arrives as a sim event; the next tick applies it like any command.
    const cs = parseStateEvent(e);
    if (cs) this.command({ name: 'cut.state', playId: cs.playId, state: cs.state, ...(cs.item !== undefined ? { item: cs.item } : {}), ...(cs.trigger ? { trigger: cs.trigger } : {}) });
    this.counts.set(e.t, (this.counts.get(e.t) ?? 0) + 1);
    if (e.n !== undefined) this.sums.set(e.t, (this.sums.get(e.t) ?? 0) + e.n);
    if (e.t === 'mode.childExit' && this.activeHook !== null && e.n !== undefined) {
      this.modeResults[this.activeHook] = CHILD_OUTCOMES[e.n] ?? 'abort';
      this.noteEvent('mode.result', { hook: this.activeHook, outcome: this.modeResults[this.activeHook] as string });
    }
  }

  private telemetry(name: 'mission.start' | 'mission.fail' | 'mission.complete', stage: number | undefined, reason?: string): void {
    const props: Record<string, string | number | boolean> = {
      mid: this.ir.id,
      stage: stage ?? Math.max(0, this.stageIndex),
      sec: Math.round(this.clock / 60),
      attempt: this.attempt,
    };
    if (reason !== undefined) props['reason'] = reason;
    soft(() => this.ctx.telemetry.emit(name, props));
  }

  // ---------------------------------------------------------------- cast

  private spawnStartCast(): void {
    for (const name of Object.keys(this.ir.cast).sort(byStr)) {
      const c = this.ir.cast[name];
      if (c && (c.spawnAt ?? 'start') === 'start') this.spawnCast(name);
    }
  }

  spawnCast(name: string, pose?: { pos: Vec3; yaw: number }): void {
    const cr = this.castRt.get(name);
    const c = this.ir.cast[name];
    if (!cr || !c || cr.live) return;
    const at = pose ?? this.rm.spawns[name];
    if (!at) return;
    const prefab = c.k === 'npc' ? (c.prefab ?? 'ped.actor') : c.prefab;
    const gy = this.ctx.physics.groundY(at.pos[0], at.pos[2]);
    soft(() => this.ctx.prefabs.spawn(prefab, { pos: [at.pos[0], pose ? at.pos[1] : (gy ?? at.pos[1]), at.pos[2]], yaw: at.yaw }, cr.key));
    cr.live = true;
    cr.seen = false;
  }

  despawnCast(name: string, keepRecord = false): void {
    const cr = this.castRt.get(name);
    if (!cr) return;
    const h = this.actors.cast(name);
    if (h !== null) soft(() => this.ctx.prefabs.despawn(h));
    cr.live = false;
    cr.seen = false;
    this.tasks.clear(name);
    if (!keepRecord) this.carriedSet.delete(name);
  }

  // ---------------------------------------------------------------- threads

  private spawnOpThread(id: string, ops: readonly Op[], basePtr: string): void {
    const runner = new OpRunner(ops, basePtr);
    this.runners.set(id, runner);
    this.ctx.scheduler.spawn(id, (t) => this.stepRunner(id, runner, t));
  }

  private frozenFor(id: string): boolean {
    return this.beat !== null && this.beat.owner !== id;
  }

  private stepRunner(id: string, runner: OpRunner, t: ThreadCtx): ThreadYield {
    if (this.frozenFor(id) || this.phase === 'failed') return { k: 'continue' };
    this.curT = t;
    let r;
    try {
      r = runner.step(this, t, OPS_BUDGET);
    } catch (e) {
      this.curT = null;
      this.scriptError('E_SCRIPT', id, e instanceof Error ? e.message : String(e));
      return { k: 'done' };
    }
    this.curT = null;
    this.threadOps.set(id, t.ops);
    if (r === 'budget') {
      const n = (this.streaks.get(id) ?? 0) + 1;
      this.streaks.set(id, n);
      if (n >= BUDGET_STREAK_LIMIT) {
        this.scriptError('E_BUDGET', id);
        return { k: 'done' };
      }
      return { k: 'continue' };
    }
    this.streaks.set(id, 0);
    if (r === 'done') {
      this.runners.delete(id);
      this.threadOps.delete(id);
      return { k: 'done' };
    }
    const until = runner.clockWaitUntil();
    if (until !== null) return { k: 'waitTicks', n: Math.max(1, until - this.clock) };
    return { k: 'continue' };
  }

  private spawnObjectiveThread(o: ObjRt): void {
    const step = objectiveStep(this, o);
    this.ctx.scheduler.spawn(o.threadId, (t) => {
      if (this.frozenFor(o.threadId) || this.phase !== 'stage') return { k: 'continue' };
      this.curT = t;
      let r;
      try {
        r = step();
      } catch (e) {
        this.curT = null;
        this.scriptError('E_SCRIPT', o.threadId, e instanceof Error ? e.message : String(e));
        return { k: 'done' };
      }
      this.curT = null;
      this.threadOps.set(o.threadId, t.ops);
      if (r === 'running') return { k: 'continue' };
      this.finishObjective(o, r);
      return { k: 'done' };
    });
  }

  private finishObjective(o: ObjRt, state: Extract<ObjState, 'done' | 'failed'>): void {
    o.state = state;
    if (state === 'done') this.doneIds.add(o.def.id);
    this.removeMarker(`obj.${o.def.id}`);
    this.noteEvent('objective', { id: o.def.id, state });
  }

  // ---------------------------------------------------------------- OpHost leaf ops

  leaf(op: Op, ptr: string, owner: string): WaitSpec | void {
    switch (op.op) {
      case 'spawn':
        for (const n of op.cast) this.spawnCast(n);
        return;
      case 'despawn':
        for (const n of op.cast) this.despawnCast(n);
        return;
      case 'task':
        this.tasks.assign(op.cast, op.task, this.ctx.tick);
        return;
      case 'say': {
        const text = this.lineText(op.line);
        const ticks = Math.max(SAY_MIN_TICKS, Math.ceil(text.length * SAY_TICKS_PER_CHAR));
        this.noteEvent('say', { speaker: op.speaker, line: op.line, ticks });
        this.ctx.ui.patch('hud.subtitle', { speaker: op.speaker, text: op.line, startMs: Math.round((this.ctx.tick * 1000) / 60), endMs: Math.round(((this.ctx.tick + ticks) * 1000) / 60) });
        return op.wait ? { k: 'clock', until: this.clock + ticks } : undefined;
      }
      case 'text':
        this.noteEvent('text', { from: op.from, line: op.line });
        this.ctx.ui.toast({ id: `${this.scope()}:text:${op.line}`, kind: 'info', text: op.line });
        return;
      case 'marker':
        this.markerOp(op.target, op.kind, op.on);
        return;
      case 'beat':
        return this.startBeat(op.ref, owner);
      case 'camera':
        this.noteEvent('camera', { shot: op.shot });
        if (op.shot === 'release') {
          this.director.stopAuto();
          this.camUntil = null;
          soft(() => this.ctx.camera.release());
        } else {
          // every shot name is the auto-director's: it picks the angles (D6.2); `subject` defaults to the player, `sec` to 8
          const who = op.subject ?? 'player';
          this.director.startAuto(typeof who === 'string' ? who : 'player', missionDeps().missionSeed(this.seed, `camera:${this.camSerial++}`, this.attempt));
          this.camUntil = this.clock + Math.ceil((op.sec ?? 8) * 60);
        }
        return;
      case 'fade':
        this.noteEvent('fade', { to: op.to, sec: op.sec });
        this.ctx.ui.patch('hud.fade', { to: op.to, sec: op.sec });
        return op.sec > 0 ? { k: 'clock', until: this.clock + Math.ceil(op.sec * 60) } : undefined;
      case 'heat':
        if (op.set !== undefined) soft(() => this.ctx.pursuit.setHeat(op.set as never, 'mission'));
        if (op.cap !== undefined) soft(() => this.ctx.pursuit.capHeat(op.cap as never));
        if (op.clear) soft(() => this.ctx.pursuit.clear('mission'));
        this.noteEvent('heat', { set: op.set ?? -1, cap: op.cap ?? -1, clear: op.clear === true });
        return;
      case 'clock':
        if (op.unlock) soft(() => this.ctx.clock.unlock(this.scope()));
        if (op.lock) soft(() => this.ctx.clock.lock(this.scope(), op.lock?.hour, op.lock?.weather));
        this.noteEvent('clock', { unlock: op.unlock === true });
        return;
      case 'ambient':
        if (op.traffic !== undefined) soft(() => this.ctx.world.traffic.setDensity('traffic', op.traffic as number, this.scope()));
        if (op.peds !== undefined) soft(() => this.ctx.world.traffic.setDensity('ped', op.peds as number, this.scope()));
        this.noteEvent('ambient', { traffic: op.traffic ?? -1, peds: op.peds ?? -1 });
        return;
      case 'flag':
        for (const k of Object.keys(op.set).sort(byStr)) this.setFlag(k, op.set[k] as boolean | number | string);
        return;
      case 'trust':
        this.addTrust(this.soulOf(op.npc), op.delta);
        return;
      case 'give':
        this.give(op);
        return;
      case 'emit':
        this.noteEvent(op.event);
        // a body shop job: the player's car loses the heat it carries (C06 `PursuitApi.respray`, M05c2)
        if (op.event === 'vehicle.respray') this.respray();
        return;
      case 'pass':
        this.pendingEnd ??= { k: 'pass' };
        return;
      case 'fail':
        this.pendingEnd ??= { k: 'fail', reason: op.reason };
        return;
      default:
        void ptr;
        return;
    }
  }

  private give(op: Extract<Op, { op: 'give' }>): void {
    const key = `${this.scope()}:${op.idem}:g${this.revokeGen}`;
    if (this.givenKeys.has(key)) return;
    this.givenKeys.add(key);
    if (op.cashCents && this.ctx.economy.credit(op.cashCents, 'mission.give', key)) this.walletDelta += op.cashCents;
    for (const it of op.items ?? []) this.addItem(it.id, it.qty);
    this.noteEvent('give', { idem: op.idem, cashCents: op.cashCents ?? 0 });
  }

  private lineText(id: string): string {
    return this.opts.lineText?.(id) ?? id;
  }

  // ---------------------------------------------------------------- beats

  private startBeat(ref: { cutscene: string } | { director: string }, owner: string): WaitSpec | undefined {
    this.noteEvent('beat', { ref: 'director' in ref ? ref.director : ref.cutscene });
    const cutRef = 'cutscene' in ref ? (this.opts.cutscenes?.get(ref.cutscene) ?? null) : null;
    const scriptId = 'director' in ref ? ref.director : (cutRef?.fallback ?? null);
    const script = scriptId !== null ? (this.opts.directors?.get(scriptId) ?? null) : null;
    const instant = !script || this.flagsCfg.beats === 'instant';
    const id = ++this.beatSerial;
    // an instant beat still lasts one tick (C9: "a beat completes in one tick and applies its end marks"), and that tick is not mission time
    this.beat = { id, owner, script, ticksLeft: instant ? 1 : Math.max(1, Math.ceil((script as DirectorScript).durationSec * 60)), instant };
    if (!instant) {
      const sc = script as DirectorScript;
      this.director.stopAuto();
      if (cutRef !== null && 'cutscene' in ref) {
        // A generated cutscene (D7): ask the main thread for it and arm the fallback on the request tick.
        const playNo = this.opts.playCounter ? this.opts.playCounter() : ++this.playSerial;
        this.beat.cut = { playNo, playId: playIdOf(playNo), refId: ref.cutscene, state: 'armed', waited: 0 };
        soft(() => this.ctx.input.push('cutscene'));
        this.ctx.events.emit(requestEvent(this.ctx.tick, [ref.cutscene], playNo));
        this.noteEvent('cut.request', { ref: ref.cutscene, n: playNo });
      }
      // the full script runs: actors on their start marks, the first shot on this tick; while an answer is awaited the runner holds
      this.director.arm(sc, this.beat.cut ? 'cutscene' : 'mission', this.ctx.rng(`cutscene:${sc.id}`));
    }
    return { k: 'pred', pred: () => this.beat === null || this.beat.id !== id };
  }

  /** The main thread's answer for the play in force. A stale or repeated answer is ignored. */
  private onCutState(playId: string, answer: 'video' | 'fallback' | 'done', trigger?: string): void {
    const b = this.beat;
    if (!b?.cut || b.cut.playId !== playId) return;
    const next = transition(b.cut.state, answer);
    this.noteEvent('cut.state', { playId, state: answer, ...(trigger ? { trigger } : {}) });
    if (next === null) return;
    if (next === 'ended') {
      this.endBeat(b, 'cut');
      return;
    }
    b.cut.state = next;
    // The script runs from its start: the command carries no clip position.
    if (next === 'fallback' && b.script) {
      b.ticksLeft = Math.max(1, Math.ceil(b.script.durationSec * 60));
      this.director.arm(b.script, 'cutscene', this.ctx.rng(`cutscene:${b.script.id}`));
    }
  }

  private advanceBeat(): void {
    const b = this.beat;
    if (!b) return;
    if (b.cut) {
      if (b.cut.state === 'video') return; // the host pauses the sim; nothing counts while a clip covers the screen
      if (b.cut.state === 'armed') {
        b.cut.waited++;
        // The mission never waits on the main thread: no answer in time is a `fallback`.
        if (answerOverdue(b.cut)) this.onCutState(b.cut.playId, 'fallback', 'not_ready');
        return;
      }
    }
    b.ticksLeft--;
    if (b.ticksLeft > 0) return;
    this.endBeat(b, b.cut ? 'script' : 'director');
  }

  /** The beat is over: end marks, camera and input back, the clock runs on. */
  private endBeat(b: Beat, via: 'cut' | 'script' | 'director'): void {
    this.beat = null;
    if (!b.instant) {
      this.director.disarm(true);
      soft(() => this.ctx.camera.release());
    } else if (b.script) this.applyEndMarks(b.script);
    if (b.cut) {
      soft(() => this.ctx.input.pop('cutscene'));
      this.ctx.events.emit(doneEvent(this.ctx.tick, b.cut.playNo));
    }
    this.noteEvent('beat.done', { instant: b.instant, ...(b.cut ? { via } : {}) });
  }

  /** Puts each actor of the script on its end mark. */
  private applyEndMarks(script: DirectorScript): void {
    for (const a of script.actors) {
      const mark = script.marks[a.end];
      if (!mark) continue;
      const h = this.actors.handleOf(a.who);
      if (h === null) continue;
      const p = this.markPos(mark.at);
      if (p) {
        // a mark names a spot on the map; the actor stands on the ground there
        const gy = soft(() => this.ctx.physics.groundY(p[0], p[2]));
        this.actors.place(h, [p[0], gy ?? p[1], p[2]], (mark.yawDeg * Math.PI) / 180);
      }
    }
  }

  private markPos(at: DirectorScript['marks'][string]['at']): Vec3 | null {
    if ('local' in at) return [at.local[0], at.local[1], at.local[2]];
    if ('landmark' in at) return this.landmarkPos(at.landmark);
    const e = soft(() => this.ctx.world.resolver.toEnu({ lat: at[0], lng: at[1] }));
    return e ? [e[0], e[1], e[2]] : null;
  }

  // ---------------------------------------------------------------- talk offer and HUD

  offerTalk(talk: TalkDef, o: ObjRt): void {
    void o;
    const choices = this.talkChoices(talk);
    const open = `line.${this.ir.id}.talk.${talk.id}.open` as `line.${string}`;
    const opening = this.ir.lines.includes(open) ? this.lineText(open) : undefined;
    this.ctx.ui.patch('mode.story.talk', {
      talkId: talk.id,
      npc: this.soulOf(talk.npc),
      intent: talk.intent,
      ...(opening !== undefined ? { open: opening } : {}),
      choices,
    } as unknown as JsonValue);
    if (this.flagsCfg.talk === 'scripted') this.command({ name: 'talk.result', talkId: talk.id, outcome: talk.default, turns: 0, path: 'scripted' });
  }

  /**
   * The outcome buttons of a talk, in id order. Offline (no NPC brain before M06a3), a `TalkUnlock` is read like this (03-story-missions.md C7):
   * `actions` count as offered (the ink knot plays the offer), `mood` and `minTrust` need the NPC's trust to reach `minTrust` (default 20 for a mood
   * gate), and a numeric flag `talk.cost` on the outcome is paid from the wallet, so the button is off when the wallet is short.
   */
  talkChoices(talk: TalkDef): { id: string; label: string; enabled: boolean; hint?: string; hintParams?: Record<string, string | number> }[] {
    const trust = this.opts.story().npcRelations[this.soulOf(talk.npc)]?.trust ?? 0;
    const cash = this.ctx.economy.balance();
    return Object.entries(talk.outcomes)
      .sort((a, b) => byStr(a[0], b[0]))
      .map(([id, out]) => {
        const need = out.when?.minTrust ?? (out.when?.mood ? 20 : undefined);
        const cost = out.flags?.['talk.cost'];
        let hint: string | undefined;
        let hintParams: Record<string, string | number> | undefined;
        if (need !== undefined && trust < need) {
          hint = out.when?.mood ? 'talk.gate.mood' : 'talk.gate.trust';
          hintParams = { need };
        } else if (typeof cost === 'number' && cash < cost) {
          hint = 'talk.gate.cost';
          hintParams = { cents: cost };
        }
        return { id, label: out.label, enabled: hint === undefined, ...(hint !== undefined ? { hint, hintParams: hintParams as Record<string, string | number> } : {}) };
      });
  }

  private publishHud(): void {
    const s = this.stage;
    if (!s || this.phase !== 'stage') return;
    const first = [...this.objectives.values()].find((o) => o.state === 'active' && o.def.optional !== true) ?? [...this.objectives.values()].find((o) => o.state === 'active');
    const view: Record<string, JsonValue> = { titleKey: this.ir.title, objectiveKey: first?.def.text ?? '' };
    if (s.timeLimitSec !== undefined) {
      const limit = Math.ceil(s.timeLimitSec * (this.opts.timerScale?.() ?? 1) * 60);
      view['timerSec'] = Math.max(0, Math.ceil((limit - (this.clock - this.stageSince)) / 60));
    }
    const key = JSON.stringify(view);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.ctx.ui.patch('hud.mission', view);
  }

  // ---------------------------------------------------------------- markers

  private placeObjectiveMarker(o: ObjRt): void {
    const target = (): Vec3 | null => objectiveTarget(this, o.def);
    this.addMarker(`obj.${o.def.id}`, target, o.def.text);
  }

  private markerOp(target: string, kind: string, on: boolean): void {
    const key = `op.${target}`;
    if (!on) {
      this.removeMarker(key);
      return;
    }
    const z = this.rm.zones[target];
    const getter = (): Vec3 | null => (z ? this.zoneCenter(target) : this.actors.pos(target));
    this.addMarker(key, getter, `marker.${kind}`);
  }

  private addMarker(key: string, target: () => Vec3 | null, labelKey: string): void {
    this.removeMarker(key);
    const p = target();
    const blip = `${this.scope()}:${key}`;
    let handle: EntityHandle | null = null;
    if (p) {
      const gy = this.ctx.physics.groundY(p[0], p[2]);
      handle = soft(() => this.ctx.prefabs.spawn('marker.beam', { pos: [p[0], gy ?? p[1], p[2]], yaw: 0 }, `${this.scope()}:~${key.replace(/[^a-z0-9_.-]/gi, '_')}` as never)) ?? null;
      soft(() => this.ctx.world.map.setBlip({ id: blip, kind: 'mission', shape: 'diamond', colorToken: 'mission', x: p[0], z: p[2], priority: 8, labelKey }));
    }
    this.markers.set(key, { handle, target, blip: p ? blip : null });
  }

  private removeMarker(key: string): void {
    const m = this.markers.get(key);
    if (!m) return;
    if (m.handle !== null) {
      const h = m.handle;
      soft(() => this.ctx.prefabs.despawn(h));
    }
    if (m.blip) soft(() => this.ctx.world.map.removeBlip(m.blip as string));
    this.markers.delete(key);
  }

  private clearObjectiveMarkers(): void {
    for (const k of [...this.markers.keys()]) if (k.startsWith('obj.')) this.removeMarker(k);
  }

  private clearMarkers(): void {
    for (const k of [...this.markers.keys()]) this.removeMarker(k);
  }

  private updateMarkers(): void {
    if (this.ctx.tick % MARKER_UPDATE_EVERY !== 0) return;
    for (const [key, m] of this.markers) {
      const p = m.target();
      if (!p) continue;
      if (m.handle === null) {
        // the target appeared after the marker was asked for (a cast entry that spawned later)
        this.addMarker(key, m.target, '');
        continue;
      }
      const gy = this.ctx.physics.groundY(p[0], p[2]);
      this.actors.place(m.handle, [p[0], gy ?? p[1], p[2]], 0);
      if (m.blip) soft(() => this.ctx.world.map.setBlip({ id: m.blip as string, kind: 'mission', shape: 'diamond', colorToken: 'mission', x: p[0], z: p[2], priority: 8 }));
    }
  }

  // ---------------------------------------------------------------- checkpoint, hash, debug

  checkpoint(): MissionCheckpointV1 {
    return captureCheckpoint(this);
  }

  /** A hash of the mission state: equal for two runs that did the same things at the same ticks. */
  stateHash(): string {
    const h = new Fnv64();
    h.str(this.phase).u32(this.stageIndex + 1).u32(this.attempt).u32(this.seed).u32(this.clock);
    for (const w of this.rng.getState()) h.u32(w);
    const story = this.opts.story();
    for (const k of [...this.touchedFlags].sort(byStr)) h.str(k).str(String(story.flags[k]));
    for (const [id, o] of [...this.objectives].sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.str(id).str(o.state);
    for (const id of [...this.doneIds].sort(byStr)) h.str(id);
    for (const k of Object.keys(this.talkResults).sort(byStr)) h.str(k).str(this.talkResults[k] as string);
    for (const k of Object.keys(this.modeResults).sort(byStr)) h.str(k).str(this.modeResults[k] as string);
    for (const [n, c] of [...this.castRt].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      h.str(n).u8(c.live ? 1 : 0);
      const p = this.actors.pos(n);
      if (p) h.f32(p[0]).f32(p[1]).f32(p[2]);
    }
    for (const c of [...this.carriedSet].sort(byStr)) h.str(c);
    h.f64(this.walletDelta).u32(this.revokeGen).u32(this.beat ? 1 : 0);
    for (const id of [...this.runners.keys()].sort(byStr)) h.str(id).str(this.runners.get(id)?.view().ptr ?? '');
    return h.hex();
  }

  /** The state for the QA overlay and `__dvBridge.mission.state()`. */
  debugState(): Record<string, JsonValue> {
    const objectives = [...this.objectives.values()].map((o) => ({ id: o.def.id, k: o.def.k, state: o.state, text: o.def.text, optional: o.def.optional === true }));
    const threads: ThreadView[] = [...this.runners.entries()].map(([id, r]) => {
      const v = r.view();
      return { id, ptr: v.ptr, wait: v.wait, ops: this.threadOps.get(id) ?? 0 };
    });
    for (const o of this.objectives.values()) threads.push({ id: o.threadId, ptr: `/stages/${this.stageIndex}/objectives/${o.def.id}`, wait: o.state, ops: this.threadOps.get(o.threadId) ?? 0 });
    const cast = [...this.castRt.values()].map((c) => ({ name: c.name, key: c.key, alive: this.actors.cast(c.name) !== null && !this.actors.isKo(c.name), task: this.tasks.kindOf(c.name), distance: round1(this.actors.distance('player', c.name)) }));
    const story = this.opts.story();
    const flags: Record<string, JsonValue> = {};
    for (const k of [...this.touchedFlags].sort(byStr)) flags[k] = story.flags[k] ?? null;
    return {
      phase: this.phase,
      mission: this.ir?.id ?? null,
      stage: this.stageIndex,
      stageId: this.stage?.id ?? null,
      stages: this.ir?.stages.length ?? 0,
      attempt: this.attempt,
      seed: this.seed,
      clockSec: round1(this.clock / 60),
      beat: this.beat !== null,
      objectives, threads, cast, flags,
      failReason: this.phase === 'failed' ? this.failReason : null,
      events: this.eventLog.map((e) => ({ tick: e.tick, t: e.t, data: e.data })),
      hash: this.stateHash(),
    } as unknown as Record<string, JsonValue>;
  }

  /** Evaluates the predicate at a JSON Pointer of the IR (`/stages/0/objectives/0` for an objective's own condition is not a predicate; `/fail/0/when`, `/requires/0` are). */
  predicateAt(path: string): boolean | null {
    const parts = path.split('/').filter((x) => x !== '');
    let node: unknown = this.ir;
    for (const p of parts) {
      if (node === null || typeof node !== 'object') return null;
      node = (node as Record<string, unknown>)[p];
    }
    if (!node || typeof node !== 'object' || !('p' in node)) return null;
    return this.pred(node as Pred, { n: 0 });
  }

  /** Flushes the state so the runtime can be discarded (the mode left). */
  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.bound = null;
  }
}

const round1 = (n: number): number => (Number.isFinite(n) ? Math.round(n * 10) / 10 : -1);

function stageHasHeat(s: StageDef): boolean {
  if (s.conduct === 'unlawful') return true;
  if (s.objectives.some((o) => o.k === 'escape' || o.k === 'stealth')) return true;
  let heat = false;
  const scan = (ops: readonly Op[] | undefined): void => {
    for (const o of ops ?? []) {
      if (o.op === 'heat' && o.set !== undefined && o.set > 0) heat = true;
      if (o.op === 'seq') scan(o.body);
      if (o.op === 'all' || o.op === 'race') o.branches.forEach(scan);
      if (o.op === 'if') {
        scan(o.then);
        scan(o.else);
      }
      if (o.op === 'loop') scan(o.body);
    }
  };
  scan(s.onEnter);
  return heat;
}

export { hash32 };
