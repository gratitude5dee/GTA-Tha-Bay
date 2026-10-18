import { SimStage, type BootPayload, type BotInput, type FrameSignal, type InputFrame, type SimConfig } from '@dv/shared';
import type { DebugCommand, StatsReport } from './transport/envelope.ts';
import type { WorkerCommand, WorkerTransport } from './transport/types.ts';
import type { RetryEnv } from './physics/rapier-backend.ts';
import { snapshotPublisher } from './publish.ts';
import { scenarioById } from './scenarios/index.ts';
import { createPhysicsSim, type PhysicsSim } from './sim-factory.ts';

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
  /** QA input source (BotInput, C03 1.1). Replaces the page's input block while set. */
  bot: BotInput | null = null;

  private frameGroups = 0;
  private lastAlpha = 0;

  constructor(readonly transport: WorkerTransport, readonly env: SimRuntimeEnv) {}

  async boot(cfg: SimConfig, boot: BootPayload): Promise<void> {
    const id = typeof boot.config['scenario'] === 'string' ? boot.config['scenario'] : 'physics-drop';
    const scenario = scenarioById(id);
    if (!scenario) throw new Error(`unknown scenario ${id}`);
    const sim = await createPhysicsSim(cfg, scenario, {
      ecs: { shared: this.transport.kind === 'sab' },
      backend: { ...(this.env.retry ? { retry: this.env.retry } : {}), exclusive: this.env.exclusive === true },
      now: () => this.env.now(),
      debug: this.env.qa,
    });
    this.sim = sim;
    this.cfg = cfg;
    sim.core.addSystem({
      id: 'engine.input.sample', owner: 'S01', stage: SimStage.Commands, order: -1000,
      run: ({ tick }) => {
        const frame: InputFrame = this.bot ? this.bot.frame(tick) : this.transport.sampleInput(tick);
        sim.services.input = frame;
      },
    });
    const publisher = snapshotPublisher(this.transport.snapshots, sim.ecs, () => sim.backend.origin);
    sim.core.addSystem(publisher);
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
    if (++this.frameGroups % STATS_EVERY_FRAMES === 0) this.postStats();
  }

  private handleOther(m: Exclude<WorkerCommand, { t: 'frame' }>): void {
    if (m.t === 'ctl') {
      // M04a replaces this with SaveService.
      this.transport.postEvent({ v: 1, t: 'ctl.result', seq: 0, p: { t: 'save.result', ok: false, reason: 'not-implemented' } });
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
        }
        break;
    }
    this.postStats();
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
