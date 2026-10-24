import {
  MAX_TICKS_PER_FRAME, SIM_DT, SIM_HZ, SimStage,
  type SimConfig, type SystemContext, type SystemDef,
} from '@dv/shared';
import { ByteReader, ByteWriter } from '../bytes.ts';
import type { EcsWorld } from '../ecs/world.ts';
import { rngResource, type EngineServices, type SimResource } from '../services.ts';
import { SystemScheduler } from './scheduler.ts';
import { computeStateHash } from './state-hash.ts';
import { TickStats, type LoopStatsExt } from './stats.ts';

export class TimeScaleError extends Error {
  constructor(timeScale: number) {
    super(`timeScale ${timeScale} is allowed only in sandbox sessions and debug builds (C02 rule 4)`);
    this.name = 'TimeScaleError';
  }
}

export interface SimCoreOptions {
  /** timeScale other than 1 is allowed in sandbox sessions. */
  sandbox?: boolean;
  /** timeScale other than 1 is allowed in debug builds. */
  debug?: boolean;
  /** Millisecond clock for LoopStats (the host passes performance.now). Without it durations are 0. */
  now?: () => number;
}

export interface AdvanceResult {
  /** Ticks run by this call. */
  ticks: number;
  /** Fraction of the next tick already accumulated, 0 <= alpha < 1. */
  alpha: number;
}

const SNAPSHOT_MAGIC = 0x31435344; // 'DSC1'
const ALLOWED_SCALES: readonly number[] = [0.25, 0.5, 1, 2];
// Tolerance for the accumulator, in ticks: 9 ticks of 1/60 s must not become 8.999999999 ticks.
const EPS = 1e-9;

/**
 * Fixed-step simulation core (C02).
 *
 * `advance` implements rules 1, 3 and 4: it adds dtSec x timeScale to an accumulator, clamps the accumulator at
 * MAX_FRAME_DT, runs one tick per SIM_DT, and reports alpha. Time beyond the clamp is dropped and counted. The
 * accumulator is kept in ticks (seconds x SIM_HZ) so that nine ticks of 1/60 s compare exactly.
 *
 * Each tick runs the ten SimStages in order; after each stage the ECS command buffer is applied (C01 rule 2).
 */
export class SimCore {
  readonly scheduler: SystemScheduler;
  /** The context object handed to every system; `tick` is updated before each tick. */
  readonly ctx: SystemContext;
  /** Ticks completed so far (the number of the tick that runs next). */
  tick: number;
  /** Most recent hash published by the hashEvery cadence. */
  lastHash: { tick: number; hex: string } | null = null;

  private acc = 0;
  private sandboxScale = 1;
  private readonly stats = new TickStats();
  private readonly resources: SimResource[] = [];
  private readonly now: () => number;

  constructor(
    readonly cfg: SimConfig,
    readonly ecs: EcsWorld,
    readonly services: EngineServices,
    private readonly opts: SimCoreOptions = {},
  ) {
    this.tick = (cfg.startTick ?? 0) >>> 0;
    this.scheduler = new SystemScheduler(cfg.profile);
    this.ctx = { tick: this.tick, dt: SIM_DT, ecs, services };
    this.now = opts.now ?? (() => 0);
    this.addResource(rngResource(services.rng));
  }

  addSystem(def: SystemDef): void {
    this.scheduler.register(def);
  }

  removeSystem(id: string): boolean {
    return this.scheduler.unregister(id);
  }

  /** Register state that is hashed and checkpointed with the ECS. Names are unique; hash order is by name. */
  addResource(r: SimResource): void {
    if (this.resources.some((x) => x.name === r.name)) throw new Error(`resource ${r.name} is already registered`);
    this.resources.push(r);
    this.resources.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /**
   * World speed of a sandbox session (M04e1). Only the numbers of ticks a frame pays for change: `SIM_DT` and the state do not.
   * Throws `TimeScaleError` unless `s` is one of the allowed scales.
   */
  setSandboxScale(s: number): void {
    if (!ALLOWED_SCALES.includes(s)) throw new TimeScaleError(s);
    this.sandboxScale = s;
  }

  /**
   * Accumulate `dtSec x timeScale` of time and run the ticks it pays for. `paused` runs none and keeps the
   * accumulator. A timeScale other than 1 throws unless the session is sandbox or debug.
   */
  advance(dtSec: number, timeScale: number, paused: boolean): AdvanceResult {
    if (!ALLOWED_SCALES.includes(timeScale)) throw new TimeScaleError(timeScale);
    if (timeScale !== 1 && !this.opts.sandbox && !this.opts.debug) throw new TimeScaleError(timeScale);
    if (paused) {
      this.stats.ticksLastFrame = 0;
      return { ticks: 0, alpha: this.acc };
    }
    const dt = dtSec > 0 && dtSec < Infinity ? dtSec : 0;
    // The sandbox world speed (engine-internal) takes over when it is not 1; the page keeps sending 1 (M04e1).
    const scale = this.sandboxScale !== 1 ? this.sandboxScale : timeScale;
    this.acc += dt * scale * SIM_HZ;
    if (this.acc > MAX_TICKS_PER_FRAME) {
      this.stats.droppedSec += (this.acc - MAX_TICKS_PER_FRAME) / SIM_HZ;
      this.stats.overruns++;
      this.acc = MAX_TICKS_PER_FRAME;
    }
    let ticks = 0;
    while (this.acc >= 1 - EPS) {
      this.acc -= 1;
      this.runTick();
      ticks++;
    }
    if (this.acc < 0) this.acc = 0;
    this.stats.ticksLastFrame = ticks;
    return { ticks, alpha: this.acc };
  }

  /** Run exactly one tick, regardless of the accumulator (debug and headless). */
  stepOnce(): void {
    this.runTick();
    this.stats.ticksLastFrame = 1;
  }

  private runTick(): void {
    const t0 = this.now();
    const ctx = this.ctx;
    ctx.tick = this.tick;
    for (let s = SimStage.Commands as number; s <= (SimStage.Publish as number); s++) {
      this.scheduler.runStage(s as SimStage, ctx);
      this.ecs.flush();
    }
    this.tick = (this.tick + 1) >>> 0;
    const every = this.cfg.hashEvery;
    if (every > 0 && this.tick % every === 0) {
      const r = computeStateHash(this.tick, this.ecs, this.resources);
      this.stats.nanCount += r.nanCount;
      this.lastHash = { tick: this.tick, hex: r.hex };
    }
    this.stats.recordTick(this.now() - t0);
  }

  /** stateHash for the current tick (C02 rule 7), 16 lowercase hex digits. */
  stateHash(): string {
    const r = computeStateHash(this.tick, this.ecs, this.resources);
    this.stats.nanCount += r.nanCount;
    return r.hex;
  }

  get loopStats(): LoopStatsExt {
    return this.stats.snapshot(this.tick);
  }

  /** Serialize tick, accumulator, ECS and resources. Call between ticks. */
  serialize(): Uint8Array {
    const w = new ByteWriter();
    w.u32(SNAPSHOT_MAGIC);
    w.u32(this.tick);
    w.f64(this.acc);
    this.ecs.serialize(w);
    w.u32(this.resources.length);
    for (const r of this.resources) {
      const sub = new ByteWriter();
      r.save(sub);
      w.str(r.name);
      w.u32(sub.length);
      w.bytes(sub.toBytes());
    }
    return w.toBytes();
  }

  restore(bytes: Uint8Array): void {
    const r = new ByteReader(bytes);
    if (r.u32() !== SNAPSHOT_MAGIC) throw new Error('SimCore.restore: bad snapshot');
    this.tick = r.u32();
    this.acc = r.f64();
    this.ecs.deserialize(r);
    for (let n = r.u32(); n > 0; n--) {
      const name = r.str();
      const len = r.u32();
      const payload = r.bytes(len);
      const res = this.resources.find((x) => x.name === name);
      if (!res) throw new Error(`SimCore.restore: snapshot has resource ${name}, which is not registered`);
      res.load(new ByteReader(payload));
    }
    this.lastHash = null;
  }
}
