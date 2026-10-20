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
import { SimStage, decodeDistrictGrid, decodeGraph, decodeP0, type ChunkKey, type SimChunk, type SystemContext, type SystemDef, type WorldIndex } from '@dv/shared';
import { GROUP_BIT, playerSide, requestTeleport, type DebugCommand, type EcsWorld, type PhysicsSystemsBackend, type SimEventLog, type SimModule, type SimModuleContext, type SimResource } from '@dv/engine/sim';
import { ChunkStore, packOf, type FailReason, type LoadRequest } from './chunk-store.ts';
import { rankUnits } from './priority.ts';
import { WORLD_PORT, type PackErrorReason, type PackReply, type PackRequest, type WorldSimConfig } from './channel.ts';
import { STREAMING, type planFor } from './plan.ts';
import { StaticsFeeder } from './statics.ts';
import { BLACKOUT_DEBUG_OWNER, Blackout } from '../env/blackout.ts';
import { playWallPrisms } from '../api/boundaries.ts';
import type { TeleportHost } from '../api/teleport.ts';
import { createWorldApi, type WorldServices } from '../api/world-api.ts';
import { AmbientTraffic } from '../traffic/system.ts';
import { WORLD_COMPONENTS } from '../traffic/components.ts';
import { runWorldDebug, type WorldDebugCommand, type WorldDebugPhysics } from '../api/debug.ts';
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
  /** A pack that is not a chunk pack (the road topology, the district grid): its handler gets the bytes. */
  aux?: (bytes: ArrayBuffer) => void;
}

type Arrival = { pend: Pending; chunks: SimChunk[] } | { pend: Pending; raw: ArrayBuffer } | { pend: Pending; error: PackErrorReason | 'decode' };

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
  /** The destination of the teleport in flight (its ground is requested and pinned until the teleport ends), else null. */
  private teleportTo: Focus | null = null;
  private teleportKeys: ChunkKey[] = [];

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

  /** The world services once the module has built them (M02c1); null for a session that sent no world index. */
  api: WorldServices | null = null;

  /**
   * Asks the asset worker for a pack that is not a chunk pack (`map_data/sf-graph.v1`, `data/district-grid.v1`); `fn` gets the
   * bytes on the tick they are applied, in `seq` order with the chunk replies. Returns false when the config has no ref for it.
   */
  loadAux(name: string, fn: (bytes: ArrayBuffer) => void): boolean {
    const ref = this.cfg.refs[name];
    if (!ref) return false;
    const pend: Pending = { seq: ++this.seq, pack: name, keys: new Set(), refetched: true, aux: fn };
    this.bySeq.set(pend.seq, pend);
    const msg: PackRequest = { seq: pend.seq, ref, priority: 'now' };
    this.port.postMessage(msg);
    return true;
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
      if (pend.aux) {
        this.arrivals.set(reply.seq, { pend, raw: reply.bytes });
        return;
      }
      try {
        this.arrivals.set(reply.seq, { pend, chunks: decodeP0(reply.bytes) });
      } catch {
        this.arrivals.set(reply.seq, { pend, error: 'decode' });
      }
    } else {
      this.arrivals.set(reply.seq, { pend, error: reply.error.reason });
    }
  }

  /** Requests posted and not yet applied (the residency rule of the determinism scenarios waits for it to reach 0). */
  pendingCount(): number {
    return this.bySeq.size;
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
      if (pend.aux) {
        // not a chunk pack: hand the bytes to the handler, or note that they did not come
        if ('raw' in a) {
          try {
            pend.aux(a.raw);
          } catch (e) {
            this.log?.('warn', `world: ${pend.pack} could not be read (${e instanceof Error ? e.message : String(e)})`);
          }
        } else if ('error' in a) {
          this.log?.('warn', `world: ${pend.pack} did not load (${a.error})`);
        }
        continue;
      }
      if ('raw' in a) continue;   // raw bytes answer only the requests that carry a handler
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
    const dest = this.followTeleport(ctx.services as unknown as { control?: { teleportActive: boolean; teleportX: number; teleportZ: number } });
    this.api?.step(ctx.tick, pl ? { x: pl.pos[0], z: pl.pos[2] } : null);
    const st = this.feeder.step(this.store, focus, this.store.plan.physicsM, dest);
    if (st.added) {
      this.addedTotal++;
      this.events.push({ t: 'world.chunk', tick: ctx.tick, n: this.addedTotal, s: st.added });
    }
    this.report(ctx.tick);
  }

  /**
   * A teleport waits for colliders at its destination (the ownership machine of M01b1), and the player's own focus is far from there.
   * While one is pending, the `p0` chunks around the destination are requested and pinned, and the statics feed adds them after the
   * player's own; the pins go when the teleport ends. Returns the destination focus, or null.
   */
  private followTeleport(services: { control?: { teleportActive: boolean; teleportX: number; teleportZ: number } }): Focus | null {
    const c = services.control;
    if (!c || !c.teleportActive) {
      if (this.teleportKeys.length > 0) this.store.unpin('p0', this.teleportKeys);
      this.teleportKeys = [];
      this.teleportTo = null;
      return null;
    }
    if (!this.teleportTo || this.teleportTo.x !== c.teleportX || this.teleportTo.z !== c.teleportZ) {
      if (this.teleportKeys.length > 0) this.store.unpin('p0', this.teleportKeys);
      this.teleportTo = { x: c.teleportX, z: c.teleportZ, vx: 0, vz: 0 };
      const ranked = rankUnits(9, this.teleportTo, this.store.plan.physicsM, { exists: (k) => this.store.exists('p0', k), firstRing: true });
      this.teleportKeys = ranked.map((r) => r.key);
      void this.store.preload(this.teleportKeys.map((key) => ({ level: 'p0' as const, key })));
    }
    return this.teleportTo;
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
  /** The world services (M02c1) once built, or null while the session has no world index. */
  readonly api: WorldServices | null;
  /** The blackout switch (M02b2): TrafficControl adopts it unchanged; until then the QA bridge and the debug panel set it. */
  readonly blackout: Blackout;
  /** The ambient traffic (M03b1) once built, or null while the session has no world services. */
  readonly traffic: AmbientTraffic | null;
}

function isWorldConfig(v: unknown): v is WorldSimConfig {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c['bakeId'] === 'string' && Array.isArray(c['p0Tiles']) && typeof c['refs'] === 'object' && c['refs'] !== null && Array.isArray(c['spawn']);
}

/** A fresh module instance (tests build their own; each worker generation gets one through the exported singleton). */
export function createWorldStreamingModule(): WorldStreamingModule {
  let state: WorldSim | null = null;
  let api: WorldServices | null = null;
  let traffic: AmbientTraffic | null = null;
  let sendQa: ((name: string, data: unknown) => void) | null = null;
  let physics: WorldDebugPhysics | null = null;
  const blackout = new Blackout();
  const system: SystemDef = {
    id: 'world.streaming',
    owner: 'S02',
    stage: SimStage.Streaming,
    order: 0,
    run: (ctx) => state?.step(ctx),
  };
  // The map patch (blips, GPS route) goes out as a sim event once a tick changed it, before the snapshot is written.
  let events: SimEventLog | null = null;
  const mapSystem: SystemDef = {
    id: 'world.map',
    owner: 'S02',
    stage: SimStage.Publish,
    order: 900,
    run: (ctx) => {
      const patch = api?.flushMap(ctx.tick);
      if (patch && events) events.push({ t: 'world.map', tick: ctx.tick, n: patch.rev, s: JSON.stringify(patch) });
    },
  };
  return {
    id: 'world.streaming',
    systems: [system, mapSystem],
    get state() {
      return state;
    },
    get api() {
      return api;
    },
    get traffic() {
      return traffic;
    },
    blackout,
    // the world components exist only in a session that has a world with services (M03b1): other sessions hash as before
    components: (boot) => {
      const w = boot.config['world'];
      return isWorldConfig(w) && w.index ? WORLD_COMPONENTS : [];
    },
    side: () => {
      if (!state) return {};
      const out: Record<string, unknown> = blackout.side();
      // the fog far-plane factor near the county line (1 elsewhere; absent then)
      if (api && api.boundaries.fog < 1) out['wf'] = Math.round(api.boundaries.fog * 1000) / 1000;
      return out;
    },
    onDebug(cmd: DebugCommand): void {
      if (state && cmd.t === 'debug.blackout') blackout.set(cmd.on, BLACKOUT_DEBUG_OWNER);
      if (api && cmd.t === 'debug.world') runWorldDebug(api, state?.tick ?? 0, cmd as WorldDebugCommand, (id, data) => sendQa?.(`world.reply.${id}`, data), physics ?? undefined);
    },
    onInit(ctx: SimModuleContext): void {
      const raw = ctx.boot.config['world'];
      state?.dispose();
      api?.dispose();
      state = null;
      api = null;
      traffic = null;
      ctx.sim.services.world.api = null;
      ctx.sim.services.world.bounds = null;
      for (const by of [...blackout.owners()]) blackout.set(false, by);
      if (!isWorldConfig(raw)) return;
      const port = ctx.ports[WORLD_PORT] as PackPort | undefined;
      if (!port) throw new Error('the world streaming module needs the pack channel port (InitMessage.p.ports.world)');
      const log = ctx.runtime.env.log;
      events = ctx.sim.services.events;
      sendQa = (name, data) => void ctx.runtime.transport.postEvent({ v: 1, t: 'qa', seq: 0, p: { name, data } });
      physics = { castRay: (o, d, max, mask) => ctx.sim.backend.castRay(o, d, max, mask), staticMask: GROUP_BIT.static };
      const world = new WorldSim(raw, ctx.cfg.tier, port, ctx.sim.backend, ctx.sim.services.events, log);
      state = world;
      ctx.sim.core.addResource(world.resource());
      ctx.sim.core.addResource(blackout.resource());
      if (raw.index) {
        api = installWorldServices(ctx, world, raw.index, blackout);
        traffic = installTraffic(ctx, world, api, raw);
      }
    },
  };
}

/**
 * Builds the world services on the live sim (M02c1): the engine host for the teleport, the barrier colliders, the play-bounds wall,
 * the hashed resources, the registration on `services.world`, and the two packs that arrive after the first chunks.
 */
function installWorldServices(ctx: SimModuleContext, world: WorldSim, index: WorldIndex, blackout: Blackout): WorldServices {
  const sim = ctx.sim;
  const events = sim.services.events;
  const host: TeleportHost = {
    playerPos: () => {
      const p = playerSide(sim.ecs as unknown as EcsWorld);
      return p ? [p.pos[0], p.pos[1], p.pos[2]] : null;
    },
    begin: (x, y, z) => {
      try {
        const r = requestTeleport(sim.ecs, sim.services, sim.ecs.byKey('player:0'), [x, y, z], sim.core.tick);
        return r.ok ? { ok: true } : { ok: false, reason: 'busy' };
      } catch {
        return { ok: false, reason: 'no-player' };
      }
    },
    active: () => sim.services.control.teleportActive,
    fade: (dir) => events.push({ t: 'world.teleport', tick: sim.core.tick, s: dir }),
  };
  const api = createWorldApi(world.store, index, { tick: () => sim.core.tick }, {
    blackout,
    host,
    onBoundary: (e) => events.push({ t: 'world.boundary', tick: e.tick, s: e.s }),
    onBarrierChange: (key) => void world.feeder.refresh(key, world.store),
  });
  world.api = api;
  world.feeder.extras = (key) => api.barrierPrisms(key);
  sim.backend.addChunkStatics('world.bounds', { prisms: Float32Array.from(playWallPrisms(api.play)) });
  for (const r of api.resources()) sim.core.addResource(r);
  sim.services.world.api = api;
  sim.services.world.bounds = api.bounds;
  world.loadAux('map_data/sf-graph.v1', (b) => api.setTopology(decodeGraph(b)));
  world.loadAux('data/district-grid.v1', (b) => api.setDistrictGrid(decodeDistrictGrid(b)));
  return api;
}

/**
 * Builds the ambient traffic (M03b1) on the live sim: its brain system at `SimStage.AI` and its hashed resource. Skipped when the
 * ECS has no traffic components (a session built without the world components) so a bare sim is never half-wired.
 */
function installTraffic(ctx: SimModuleContext, world: WorldSim, api: WorldServices, raw: WorldSimConfig): AmbientTraffic | null {
  const sim = ctx.sim;
  if (!sim.ecs.registry.getByName('TrafficAgent')) return null;
  const traffic = new AmbientTraffic({
    ecs: sim.ecs, backend: sim.backend, services: sim.services, world: api, store: world.store, cfg: ctx.cfg, seed: raw.index ? raw.index.worldSeed : 0,
  });
  api.ambient = traffic;
  sim.core.addSystem(traffic.system());
  sim.core.addResource(traffic.resource());
  return traffic;
}

/** The module `apps/web/src/workers/sim.worker.ts` composes into the sim worker. */
export const worldStreamingModule: WorldStreamingModule = createWorldStreamingModule();
