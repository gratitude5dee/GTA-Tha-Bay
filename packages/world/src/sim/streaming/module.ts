/**
 * The world streaming module: what sim.worker runs for a baked world (DL-651; the engine `SimModule` hook). One system at
 * `SimStage.Streaming` plus one hashed resource.
 *
 * Each tick (DL-678):
 *  1. apply the pack replies that arrived since the last tick, in `seq` order (a later `seq` waits for an earlier one);
 *  2. ask the `ChunkStore` for the `p0` units around the player, nearest and ahead first, and post the requests;
 *  3. feed at most one chunk's colliders to the physics backend (a wall for a chunk that failed);
 *  4. report the world status to the page when it changed (`world.status`, `world.chunk`).
 *
 * Without `BootPayload.config.world` the module stays inert: its system returns at once and it registers no resource, so a
 * session without a world runs and hashes as a session without the module.
 */
import { SimStage, decodeP0, type ChunkKey, type SimChunk, type SystemContext, type SystemDef } from '@dv/shared';
import { playerSide, type EcsWorld, type PhysicsSystemsBackend, type SimEventLog, type SimModule, type SimModuleContext, type SimResource } from '@dv/engine/sim';
import { ChunkStore, packOf, type FailReason, type LoadRequest } from './chunk-store.ts';
import { WORLD_PORT, type PackErrorReason, type PackReply, type PackRequest, type WorldSimConfig } from './channel.ts';
import { STREAMING, type planFor } from './plan.ts';
import { StaticsFeeder } from './statics.ts';
import type { Focus } from './priority.ts';

/** The sim tick rate the retry delays (milliseconds in the config) are converted with. */
const SIM_HZ = 60;
/** After this many ticks the streaming pass runs every `PASS_EVERY` ticks instead of every tick. */
const BOOT_TICKS = 180;
const PASS_EVERY = 5;

/** What the module needs of a `MessagePort` (the sim tsconfig has no DOM lib). */
export interface PackPort {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  start?(): void;
  close?(): void;
}

interface Pending {
  seq: number;
  pack: string;
  keys: Set<ChunkKey>;
  /** The sim already asked for a purge and refetch of this pack once. */
  refetched: boolean;
}

type Arrival = { pend: Pending; chunks: SimChunk[] } | { pend: Pending; error: PackErrorReason | 'decode' };

const failOf = (r: PackErrorReason | 'decode'): FailReason =>
  r === 'offline' ? 'offline' : r === 'quota' ? 'quota' : r === 'aborted' ? 'aborted' : r === 'hash-mismatch' ? 'corrupt' : r === 'decode' ? 'decode' : 'unavailable';

/** The sim half of a streamed world. */
export class WorldSim {
  readonly store: ChunkStore<SimChunk>;
  readonly feeder: StaticsFeeder;
  readonly events: SimEventLog;
  /** Cumulative chunks whose colliders were added (the `world.chunk` event value). */
  addedTotal = 0;
  /** `seq` of every reply applied, in application order (tests check the order; at most a few hundred entries a session). */
  readonly appliedSeqs: number[] = [];
  tick = 0;

  private seq = 0;
  private nextApply = 1;
  private readonly bySeq = new Map<number, Pending>();
  private readonly byPack = new Map<string, Pending>();
  private readonly arrivals = new Map<number, Arrival>();
  private lastStatus = '';
  private spawnFocus: Focus;

  constructor(
    readonly cfg: WorldSimConfig,
    tier: Parameters<typeof planFor>[0],
    private readonly port: PackPort,
    backend: Pick<PhysicsSystemsBackend, 'addChunkStatics' | 'removeChunkStatics'>,
    events: SimEventLog,
    private readonly log?: (level: 'info' | 'warn' | 'error', message: string) => void,
  ) {
    this.events = events;
    this.feeder = new StaticsFeeder(backend);
    this.spawnFocus = { x: cfg.spawn[0], z: cfg.spawn[2], vx: 0, vz: 0 };
    const p0Tiles = new Set(cfg.p0Tiles);
    this.store = new ChunkStore<SimChunk>({
      levels: ['p0'],
      tier,
      exists: (_level, key) => {
        const m = /^9\/(\d+)\/(\d+)$/.exec(key);
        return m !== null && p0Tiles.has(`${Math.floor(Number(m[1]) / 4)}-${Math.floor(Number(m[2]) / 4)}`);
      },
      request: (r) => this.request(r),
      evicted: (_level, key) => void this.feeder.drop(key),
      now: () => this.tick,
      retry: {
        firstDelay: Math.round((STREAMING.retry.firstMs * SIM_HZ) / 1000),
        maxDelay: Math.round((STREAMING.retry.maxMs * SIM_HZ) / 1000),
        maxAttempts: STREAMING.retry.maxAttempts,
      },
      groupOf: (level, key) => packOf(level, key),
    });
    port.onmessage = (ev) => this.receive(ev.data as PackReply);
    port.start?.();
  }

  // ---- requests and replies -------------------------------------------------------------------------------------------

  private request(r: LoadRequest): void {
    const pack = packOf(r.level, r.key);
    const open = this.byPack.get(pack);
    if (open) {
      open.keys.add(r.key);
      return;
    }
    this.post(pack, new Set([r.key]), r.priority, false);
  }

  private post(pack: string, keys: Set<ChunkKey>, priority: LoadRequest['priority'], refetch: boolean): void {
    const ref = this.cfg.refs[pack];
    if (!ref) {
      for (const k of keys) this.store.settle('p0', k, { ok: false, reason: 'corrupt' });
      return;
    }
    const pend: Pending = { seq: ++this.seq, pack, keys, refetched: refetch };
    this.bySeq.set(pend.seq, pend);
    this.byPack.set(pack, pend);
    const msg: PackRequest = { seq: pend.seq, ref, priority, ...(refetch ? { refetch: true } : {}) };
    this.port.postMessage(msg);
  }

  /** Port handler: runs between ticks. Decodes at once; the result waits for the next tick's start. */
  private receive(reply: PackReply): void {
    const pend = this.bySeq.get(reply.seq);
    if (!pend) return;
    if ('bytes' in reply) {
      try {
        this.arrivals.set(reply.seq, { pend, chunks: decodeP0(reply.bytes) });
      } catch {
        this.arrivals.set(reply.seq, { pend, error: 'decode' });
      }
    } else {
      this.arrivals.set(reply.seq, { pend, error: reply.error.reason });
    }
  }

  /** Applies arrivals in `seq` order; stops at the first `seq` that has not arrived. Returns the number applied. */
  applyReplies(): number {
    let n = 0;
    for (;;) {
      const a = this.arrivals.get(this.nextApply);
      if (!a) return n;
      this.arrivals.delete(this.nextApply);
      this.bySeq.delete(this.nextApply);
      this.appliedSeqs.push(this.nextApply);
      this.nextApply++;
      n++;
      const { pend } = a;
      if (this.byPack.get(pend.pack) === pend) this.byPack.delete(pend.pack);
      if ('chunks' in a) {
        const byKey = new Map(a.chunks.map((c) => [c.key, c] as const));
        for (const k of pend.keys) {
          const c = byKey.get(k);
          this.store.settle('p0', k, c ? { ok: true, payload: c } : { ok: true, empty: true });
        }
      } else if (a.error === 'decode' && !pend.refetched) {
        // Corrupt bytes that passed the hash check: purge and fetch once more (02-world.md 5.6).
        this.post(pend.pack, pend.keys, 'now', true);
      } else {
        const reason = failOf(a.error);
        this.log?.('warn', `world: ${pend.pack} did not load (${a.error})`);
        for (const k of pend.keys) this.store.settle('p0', k, { ok: false, reason });
      }
    }
  }

  // ---- the tick ---------------------------------------------------------------------------------------------------------

  step(ctx: SystemContext): void {
    this.tick = ctx.tick;
    this.applyReplies();
    const pl = playerSide(ctx.ecs as unknown as EcsWorld);
    const focus: Focus = pl ? { x: pl.pos[0], z: pl.pos[2], vx: pl.vel[0], vz: pl.vel[2] } : this.spawnFocus;
    if (ctx.tick < BOOT_TICKS || ctx.tick % PASS_EVERY === 0) this.store.want(focus);
    const st = this.feeder.step(this.store, focus, this.store.plan.physicsM);
    if (st.added) {
      this.addedTotal++;
      this.events.push({ t: 'world.chunk', tick: ctx.tick, n: this.addedTotal, s: st.added });
    }
    this.report(ctx.tick);
  }

  /** Posts `world.status` when the unavailable, failed or ready counts changed. */
  private report(tick: number): void {
    const unavailable = this.store.unavailable('p0').length;
    const failed = this.store.failed('p0').length;
    const ready = this.store.residentKeys('p0').length;
    const reasons = new Set<string>();
    for (const u of this.store.units.values()) if (u.state === 'retrying' && u.reason) reasons.add(u.reason);
    const reason = reasons.has('offline') ? 'offline' : unavailable > 0 ? 'unavailable' : 'ok';
    const status = `${unavailable}:${failed}:${ready}:${reason}`;
    if (status === this.lastStatus) return;
    this.lastStatus = status;
    this.events.push({ t: 'world.status', tick, n: unavailable, a: failed, b: ready, s: reason });
  }

  resource(): SimResource {
    return {
      name: 'world.streaming',
      hash: (h) => {
        const keys = this.feeder.keys();
        h.u32(keys.length);
        for (const k of keys) h.str(k);
      },
      save: (w) => {
        const keys = this.feeder.keys();
        w.u32(keys.length);
        for (const k of keys) w.str(k);
      },
      load: (r) => {
        this.feeder.terrain.clear();
        this.feeder.walls.clear();
        for (let n = r.u32(); n > 0; n--) this.feeder.terrain.add(r.str() as ChunkKey);
      },
    };
  }

  dispose(): void {
    this.port.onmessage = null;
    this.port.close?.();
  }
}

export interface WorldStreamingModule extends SimModule {
  /** The live world sim after `onInit`, or null while the session has no world. */
  readonly state: WorldSim | null;
}

function isWorldConfig(v: unknown): v is WorldSimConfig {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c['bakeId'] === 'string' && Array.isArray(c['p0Tiles']) && typeof c['refs'] === 'object' && c['refs'] !== null && Array.isArray(c['spawn']);
}

/** A fresh module instance (tests build their own; each worker generation gets one through the exported singleton). */
export function createWorldStreamingModule(): WorldStreamingModule {
  let state: WorldSim | null = null;
  const system: SystemDef = {
    id: 'world.streaming',
    owner: 'S02',
    stage: SimStage.Streaming,
    order: 0,
    run: (ctx) => state?.step(ctx),
  };
  return {
    id: 'world.streaming',
    systems: [system],
    get state() {
      return state;
    },
    onInit(ctx: SimModuleContext): void {
      const raw = ctx.boot.config['world'];
      state?.dispose();
      state = null;
      if (!isWorldConfig(raw)) return;
      const port = ctx.ports[WORLD_PORT] as PackPort | undefined;
      if (!port) throw new Error('the world streaming module needs the pack channel port (InitMessage.p.ports.world)');
      const log = ctx.runtime.env.log;
      const world = new WorldSim(raw, ctx.cfg.tier, port, ctx.sim.backend, ctx.sim.services.events, log);
      state = world;
      ctx.sim.core.addResource(world.resource());
    },
  };
}

/** The module `apps/web/src/workers/sim.worker.ts` composes into the sim worker. */
export const worldStreamingModule: WorldStreamingModule = createWorldStreamingModule();
