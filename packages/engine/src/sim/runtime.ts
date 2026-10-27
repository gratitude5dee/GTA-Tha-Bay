import { datan2, SimStage, type UiCommand, type BootPayload, type BotInput, type ComponentDef, type FrameSignal, type InputFrame, type SimConfig, type SimProfile, type SystemDef } from '@dv/shared';
import type { DebugCommand, StatsReport } from './transport/envelope.ts';
import type { WorkerCommand, WorkerTransport } from './transport/types.ts';
import type { RetryEnv } from './physics/rapier-backend.ts';
import { publishedCamera } from './camera/collision.ts';
import { requestRagdoll, requestTeleport } from './control/ownership.ts';
import { CONTROL_OWNER } from './control/states.ts';
import { Control, LocalPlayer, Transform, Vehicle } from './ecs/components.ts';
import { playerSide, snapshotPublisher } from './publish.ts';
import { scenarioById } from './scenarios/index.ts';
import { createPhysicsSim, type PhysicsSim } from './sim-factory.ts';
import type { SimResource } from './services.ts';
import type { SaveControl } from './worker/save-control.ts';
import type { UiOut } from './ui/bridge.ts';
import { installClock, type WorldClock } from './world/clock.ts';

/** What `SimModule.onInit` receives: the booted sim, the session config and the ports the page transferred in the init message. */
export interface SimModuleContext {
  readonly sim: PhysicsSim;
  readonly cfg: SimConfig;
  readonly boot: BootPayload;
  readonly runtime: SimRuntime;
  /** Transferred ports and other init extras by name (`InitMessage.p.ports`); empty when the page sent none. */
  readonly ports: Readonly<Record<string, unknown>>;
}

/**
 * The engine sim-module hook (DL-651). A domain package (the world streaming module of M02b1; M02c1 and M03c later) contributes
 * systems and hashed resources to the sim worker without the engine importing it. `SimRuntime.boot` adds `resources` and `systems`
 * in array order before the first tick, then awaits `onInit`. A module that finds nothing to do (no world in the boot payload)
 * leaves its systems inert, so a session without its data runs and hashes as a session without the module.
 */
export interface SimModule {
  readonly id: string;
  readonly systems: readonly SystemDef[];
  readonly resources?: readonly SimResource[];
  /**
   * Components the module adds to the session's ECS (M03b1: the world components 256 to 263). The registry is fixed when the sim is
   * built, so the runtime asks before it builds one; a module that has nothing to add for this boot payload (no world) returns none,
   * and the session then registers, allocates and hashes exactly what a session without the module does.
   */
  components?(boot: BootPayload): readonly ComponentDef[];
  onInit?(ctx: SimModuleContext): void | Promise<void>;
  /** Side-block entries for the snapshot of this tick (Publish stage), merged after the engine's own keys. Must be cheap and JSON-friendly. */
  side?(): Record<string, unknown>;
  /** A debug command the engine does not handle itself (QA builds only), for example `debug.blackout`. */
  onDebug?(cmd: DebugCommand): void;
}

/**
 * QA-only input-line tools (M03a1), installed by the QA worker entry because the line player and recorder are not allowed in a
 * production bundle. `play` builds a bot that plays `line` from `baseTick`; recording sees every frame the sim reads.
 */
export interface LineTools {
  play(line: unknown, baseTick: number, probe: () => { x: number; z: number; yaw: number; inVehicle: boolean; speed?: number }): BotInput;
  startRecording(meta: { scenario: string; seed: number; profile: SimProfile; pos: [number, number, number]; yaw: number; prefab?: string }): void;
  record(frame: InputFrame): void;
  readonly recording: boolean;
  stopRecording(): unknown;
}

/** What the host environment lends the runtime: a clock and a blocking sleep. Sim code has neither. */
export interface SimRuntimeEnv {
  now(): number;
  /** Blocks the worker for `ms` milliseconds (debug.stall). */
  blockFor(ms: number): void;
  /** Debug commands are honoured only when true (QA builds). */
  qa: boolean;
  retry?: Partial<RetryEnv>;
  /** Refuse a second, different Rapier build in this realm. The real worker sets it. */
  exclusive?: boolean;
  /** Reports an internal error line to the page. */
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Domain modules (DL-651). Applied by `boot` in array order; absent means none. */
  modules?: readonly SimModule[];
  /** Transferred ports and other init extras (`InitMessage.p.ports`), handed to every module's `onInit`. */
  ports?: Readonly<Record<string, unknown>>;
  /** Install the game clock and weather (M02b2). Default true; a test that wants the bare sim passes false. */
  clock?: boolean;
}

/** Post a stats report every this many frame groups (about 10 Hz at 60 fps). */
const STATS_EVERY_FRAMES = 6;

/**
 * The loop that runs inside sim.worker, with the worker API taken out so Node tests can drive it directly:
 *  - boot: load the Rapier build, build the scenario, register the input sampler and the snapshot publisher;
 *  - pump: handle every pending command in arrival order, coalescing consecutive frame signals into one advance, so a
 *    stalled worker catches up through the C02 accumulator clamp (rule 1) instead of replaying every frame;
 *  - SimControlMessage and debug commands are handled between ticks, never inside one (C02 rule 9).
 */
export class SimRuntime {
  sim: PhysicsSim | null = null;
  cfg: SimConfig | null = null;
  framesHandled = 0;
  /** Whether the last frame group ran paused (`FrameSignal.paused`). */
  private paused = false;
  /** `FrameSignal.frame` of the first paused signal of the pause in force; null while running (BD-FIX-CI10-R03). */
  private pausedSince: number | null = null;
  /** QA input source (BotInput, C03 1.1). Replaces the page's input block while set. */
  bot: BotInput | null = null;
  /** C05 save plumbing (M04a1). While null, `save.request` is answered 'not-implemented'. */
  saveControl: SaveControl | null = null;
  /** UI channel hooks (M04a2), set by the modes module in `onInit`: a `UiCommand` is applied between ticks; the outbox is sent once per frame group. */
  uiCommand: ((cmd: UiCommand) => void) | null = null;
  uiOutbox: (() => UiOut | null) | null = null;
  /** The game clock once booted (M02b2); null with `env.clock === false`. */
  clock: WorldClock | null = null;
  /**
   * Builds a bot from a `debug.bot` script (ticks relative to `baseTick`, the tick about to run). Set by the QA worker entry only,
   * because the bot module is not allowed in a production bundle; without it `debug.bot` does nothing.
   */
  botFactory: ((script: Extract<DebugCommand, { t: 'debug.bot' }>['script'], baseTick: number) => BotInput) | null = null;
  /** Input-line player and recorder (M03a1); set by the QA worker entry only. */
  lineTools: LineTools | null = null;
  /** The entity inspector and the physics-shape list (M03a1); set by the QA worker entry only. */
  inspector: ((sim: PhysicsSim, cmd: DebugCommand, reply: (name: string, data: unknown) => void) => void) | null = null;

  /** The vehicle QA commands `debug.spawn` and `debug.vehicle` (M03a1); set by the QA worker entry only. */
  vehicleQa: ((sim: PhysicsSim, cmd: DebugCommand, reply: (name: string, data: unknown) => void) => void) | null = null;

  private frameGroups = 0;
  private lastAlpha = 0;

  constructor(readonly transport: WorkerTransport, readonly env: SimRuntimeEnv) {}

  async boot(cfg: SimConfig, boot: BootPayload): Promise<void> {
    const id = typeof boot.config['scenario'] === 'string' ? boot.config['scenario'] : 'physics-drop';
    const scenario = scenarioById(id);
    if (!scenario) throw new Error(`unknown scenario ${id}`);
    const sim = await createPhysicsSim(cfg, scenario, {
      ecs: { shared: this.transport.kind === 'sab', components: (this.env.modules ?? []).flatMap((m) => m.components?.(boot) ?? []) },
      backend: { ...(this.env.retry ? { retry: this.env.retry } : {}), exclusive: this.env.exclusive === true },
      now: () => this.env.now(),
      debug: this.env.qa,
      boot: boot.config,
    });
    this.sim = sim;
    this.cfg = cfg;
    sim.core.addSystem({
      id: 'engine.input.sample', owner: 'S01', stage: SimStage.Commands, order: -1000,
      run: ({ tick }) => {
        let frame: InputFrame;
        const bot = this.bot as (BotInput & { stopsOnRealInput?: boolean; stoppedAt?: number | null; frame(tick: number, real?: InputFrame): InputFrame }) | null;
        if (bot?.stopsOnRealInput) {
          // A line plays until the person touches a control: the real frame decides, the line hands over on that tick.
          frame = bot.frame(tick, this.transport.sampleInput(tick));
          if (bot.stoppedAt !== null && bot.stoppedAt !== undefined) this.bot = null;
        } else frame = bot ? bot.frame(tick) : this.transport.sampleInput(tick);
        if (this.lineTools?.recording) this.lineTools.record(frame);
        sim.services.input = frame;
      },
    });
    this.clock = this.env.clock === false ? null : installClock(sim.core);
    const publisher = snapshotPublisher(this.transport.snapshots, sim.ecs, () => sim.backend.origin, () => {
      const side: Record<string, unknown> = {};
      if (this.clock) side['env'] = this.clock.env();
      for (const m of this.env.modules ?? []) if (m.side) Object.assign(side, m.side());
      const cam = publishedCamera(sim.services);
      if (cam) side['cam'] = cam;
      const pl = playerSide(sim.ecs);
      if (pl) {
        const c = sim.services.control;
        if (c.respawnSeq !== 0) pl.respawn = { seq: c.respawnSeq, yaw: c.respawnYaw };
        if (c.moveLatch) pl.latched = true;
        side['pl'] = pl;
      }
      for (const [key, provide] of sim.services.side) {
        const v = provide();
        if (v !== null && v !== undefined) side[key] = v;
      }
      return side;
    });
    sim.core.addSystem(publisher);
    for (const m of this.env.modules ?? []) {
      for (const r of m.resources ?? []) sim.core.addResource(r);
      for (const def of m.systems) sim.core.addSystem(def);
    }
    for (const m of this.env.modules ?? []) {
      await m.onInit?.({ sim, cfg, boot, runtime: this, ports: this.env.ports ?? {} });
    }
    // Publish the starting state (stamped tick 0) so the page has something to draw before the first tick.
    publisher.run({ ...sim.core.ctx, tick: sim.core.tick - 1 });
    this.transport.snapshots.setAlpha(0);
    this.transport.snapshots.endFrame();
    this.transport.postEvent({ v: 1, t: 'ready', seq: 0, p: { physicsBuild: cfg.physicsBuild, transport: this.transport.kind } });
  }

  /** Handle everything pending. Returns the number of commands handled. */
  pump(): number {
    const batch: WorkerCommand[] = [];
    this.transport.drain((m) => batch.push(m));
    let i = 0;
    while (i < batch.length) {
      const m = batch[i] as WorkerCommand;
      if (m.t === 'frame') {
        // Coalesce the run of frame signals that share paused and timeScale.
        let dt = 0;
        let j = i;
        while (j < batch.length) {
          const f = batch[j] as WorkerCommand;
          if (f.t !== 'frame' || f.p.paused !== m.p.paused || f.p.timeScale !== m.p.timeScale) break;
          dt += f.p.dtSec;
          j++;
        }
        this.runFrame({ ...m.p, dtSec: dt });
        i = j;
      } else {
        this.handleOther(m);
        i++;
      }
    }
    // Port writes and control messages are handled here, between pumps, never inside a tick (C02 rule 9).
    if (this.saveControl && this.saveControl.pending > 0) {
      void this.saveControl.flush().catch((e: unknown) => this.env.log?.('warn', `save flush failed: ${e instanceof Error ? e.message : String(e)}`));
    }
    return batch.length;
  }

  private runFrame(sig: FrameSignal): void {
    const sim = this.sim;
    if (!sim) return;
    const r = sim.core.advance(sig.dtSec, sig.timeScale, sig.paused);
    this.lastAlpha = r.alpha;
    this.transport.snapshots.setAlpha(r.alpha);
    this.transport.snapshots.endFrame();
    this.framesHandled++;
    this.postSimEvents();
    this.postUi();
    // A report every STATS_EVERY_FRAMES frame groups, and one at once when a pause or a resume reaches the sim: on a slow page (a software
    // GPU at a few frames a second) the regular report can be seconds old, and the tick the sim stopped at would only show in the next one.
    const turned = sig.paused !== this.paused;
    this.paused = sig.paused;
    // A group starts with its first signal (`pump` keeps that signal's frame), so this is the page frame whose signal stopped the ticks.
    if (turned) this.pausedSince = sig.paused ? sig.frame : null;
    if (++this.frameGroups % STATS_EVERY_FRAMES === 0 || turned) this.postStats();
  }

  /** Sends the view-model patches, toasts and overlay ops gathered since the last send (M04a2). */
  private postUi(): void {
    const out = this.uiOutbox?.();
    if (out) this.transport.postEvent({ v: 1, t: 'ui', seq: 0, p: out });
  }

  private handleOther(m: Exclude<WorkerCommand, { t: 'frame' }>): void {
    if (m.t === 'ctl') {
      const control = this.saveControl;
      if (!control) {
        this.transport.postEvent({ v: 1, t: 'ctl.result', seq: 0, p: { t: 'save.result', ok: false, reason: 'not-implemented' } });
        return;
      }
      void control.handle(m.p).then(
        (p) => void this.transport.postEvent({ v: 1, t: 'ctl.result', seq: 0, p }),
        (e: unknown) => {
          this.env.log?.('warn', `save.request failed: ${e instanceof Error ? e.message : String(e)}`);
          this.transport.postEvent({ v: 1, t: 'ctl.result', seq: 0, p: { t: 'save.result', ok: false, reason: 'IDB_UNAVAILABLE' } });
        },
      );
      return;
    }
    if (m.t === 'ui') {
      try {
        this.uiCommand?.(m.p);
      } catch (e) {
        this.env.log?.('warn', `ui command ${m.p.t} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.postUi();
      return;
    }
    if (!this.env.qa) {
      this.env.log?.('warn', `debug command ${m.p.t} ignored: not a QA build`);
      return;
    }
    this.debug(m.p);
  }

  private debug(cmd: DebugCommand): void {
    const sim = this.sim;
    switch (cmd.t) {
      case 'debug.crash':
        throw new Error('debug.crash: the sim worker was told to fail');
      case 'debug.stall':
        this.env.blockFor(cmd.ms);
        break;
      case 'debug.rebase':
        if (sim) {
          const o = sim.backend.origin;
          sim.backend.rebase(cmd.to ?? [o[0] + 1000, o[1], o[2]]);
        }
        break;
      case 'debug.step':
        if (sim) {
          for (let n = 0; n < cmd.n; n++) sim.core.stepOnce();
          this.transport.snapshots.setAlpha(this.lastAlpha);
          this.transport.snapshots.endFrame();
          this.postSimEvents();
        }
        break;
      case 'debug.teleport':
        if (sim) this.refuse(requestTeleport(sim.ecs, sim.services, sim.ecs.byKey('player:0'), cmd.pos, sim.core.tick), 'teleport');
        break;
      case 'debug.ragdoll':
        if (sim) this.refuse(requestRagdoll(sim.ecs, sim.ecs.byKey('player:0')), 'ragdoll');
        break;
      case 'debug.camera.lock':
        if (sim) {
          sim.services.camera.lockPlayerToggle = cmd.on;
          sim.services.camera.reason = cmd.on ? 'debug' : 'player';
        }
        break;
      case 'debug.hour':
        this.clock?.setHour(cmd.h);
        if (cmd.pause !== undefined) this.clock?.pause(cmd.pause);
        break;
      case 'debug.weather':
        this.clock?.forceWeather(cmd.w, cmd.blendSec);
        break;
      case 'debug.clock.pause':
        this.clock?.pause(cmd.on);
        break;
      case 'debug.blackout':
      case 'debug.world':
      case 'debug.pursuit':
      case 'debug.modes':
        break;   // the world, pursuit and modes modules handle them (SimModule.onDebug)
      case 'debug.bot':
        if (sim && this.botFactory) this.bot = cmd.script.length === 0 ? null : this.botFactory(cmd.script, sim.core.tick);
        break;
      case 'debug.spawn':
      case 'debug.vehicle':
        if (sim) this.vehicleQa?.(sim, cmd, (name, data) => void this.transport.postEvent({ v: 1, t: 'qa', seq: 0, p: { name, data } }));
        break;
      case 'debug.line':
        this.debugLine(cmd);
        break;
      case 'debug.inspect':
      case 'debug.edit':
      case 'debug.physics':
        if (sim) this.inspector?.(sim, cmd, (name, data) => void this.transport.postEvent({ v: 1, t: 'qa', seq: 0, p: { name, data } }));
        break;
    }
    for (const m of this.env.modules ?? []) m.onDebug?.(cmd);
    this.postUi();
    this.postStats();
  }

  private debugLine(cmd: Extract<DebugCommand, { t: 'debug.line' }>): void {
    const sim = this.sim;
    const tools = this.lineTools;
    const reply = (data: unknown): void => void this.transport.postEvent({ v: 1, t: 'qa', seq: 0, p: { name: `line.reply.${cmd.id}`, data } });
    if (!sim || !tools || !this.cfg) {
      reply({ ok: false, reason: 'line tools are not available in this build' });
      return;
    }
    const player = (): { x: number; y: number; z: number; yaw: number; vehicle: number } => {
      const ids = sim.ecs.query([LocalPlayer, Transform, Control]);
      const id = (ids[0] ?? 0) as number;
      const tr = sim.ecs.store(Transform);
      const co = sim.ecs.store(Control);
      const inCar = co.owner[id] === CONTROL_OWNER.Vehicle;
      const at = inCar ? (co.target[id] as number) : id;
      const yaw = 2 * datan2(tr.qy[at] as number, tr.qw[at] as number);
      return { x: tr.px[at] as number, y: tr.py[at] as number, z: tr.pz[at] as number, yaw, vehicle: inCar ? at : 0 };
    };
    switch (cmd.op) {
      case 'play':
        try {
          this.bot = tools.play(cmd.line, sim.core.tick, () => {
            const p = player();
            // the vehicle's signed forward speed, for `cruise` (BD-FIX-CI7-E01)
            return { x: p.x, z: p.z, yaw: p.yaw, inVehicle: p.vehicle !== 0, ...(p.vehicle !== 0 ? { speed: sim.ecs.store(Vehicle).speed[p.vehicle] as number } : {}) };
          });
          reply({ ok: true, baseTick: sim.core.tick });
        } catch (e) {
          reply({ ok: false, reason: e instanceof Error ? e.message : String(e) });
        }
        break;
      case 'stop':
        this.bot = null;
        reply({ ok: true });
        break;
      case 'record': {
        const p = player();
        tools.startRecording({ scenario: this.cfg.worldBake, seed: this.cfg.seed, profile: this.cfg.profile, pos: [p.x, p.y, p.z], yaw: p.yaw });
        reply({ ok: true, tick: sim.core.tick });
        break;
      }
      case 'save':
        reply({ ok: true, line: tools.recording ? tools.stopRecording() : null });
        break;
    }
  }

  private refuse(r: { ok: true } | { ok: false; reason: string }, what: string): void {
    if (!r.ok) this.env.log?.('warn', `debug.${what} refused: ${r.reason}`);
  }

  /** Sends the sim events gathered since the last frame to the page (ownership transitions and refusals). */
  private postSimEvents(): void {
    const sim = this.sim;
    if (!sim || sim.services.events.size === 0) return;
    const events = sim.services.events.drain();
    this.transport.postEvent({ v: 1, t: 'events', seq: 0, p: { events } });
    for (const e of events) if (e.t === 'control.refused' && e.s) this.env.log?.('warn', `control: ${e.s}`);
  }

  statsReport(): StatsReport | null {
    const sim = this.sim;
    if (!sim || !this.cfg) return null;
    const s = sim.stats;
    return {
      stats: {
        tick: s.tick, ticksLastFrame: s.ticksLastFrame, tickMsP50: s.tickMsP50, tickMsP99: s.tickMsP99,
        droppedSec: s.droppedSec, overruns: s.overruns,
      },
      nanCount: s.nanCount,
      hash: sim.core.lastHash ? { ...sim.core.lastHash } : null,
      physicsBuild: this.cfg.physicsBuild,
      rebases: sim.backend.rebases,
      entities: sim.ecs.entityCount,
      bodies: sim.backend.bodyCount,
      eventsDropped: this.transport.eventsDropped,
      paused: this.paused,
      pausedSince: this.pausedSince,
    };
  }

  postStats(): void {
    const p = this.statsReport();
    if (p) this.transport.postEvent({ v: 1, t: 'stats', seq: 0, p });
  }

  dispose(): void {
    this.sim?.dispose();
    this.sim = null;
    this.transport.dispose();
  }
}
