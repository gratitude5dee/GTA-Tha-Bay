/**
 * ChunkStore (02-world.md section 3 and 5.2): interest, priority, residency and eviction of world units, as a synchronous
 * state machine over injected `request` and `evict` callbacks. It has no clock, no IO and no randomness of its own (the host
 * passes `now()` in its own unit: sim ticks in sim.worker, milliseconds on the page), so the same calls give the same requests.
 *
 * One class serves both halves (Builder decision BD-M02b1-01): the sim.worker instance manages the `p0` level (colliders and,
 * later, the graph and the ambient brains), the page instance manages `l0`, `l1` and `l2` (the units the mesher turns into
 * render objects) from the same pure ranking. A host answers a request with `settle`; replies reach it however the host likes
 * (the sim applies them at the start of a tick, in `seq` order, DL-678).
 */
import { packRefOf, type ChunkKey, type ChunkZ, type PackFamily, type QualityTierId } from '@dv/shared';
import { NOMINAL_KNOBS, STREAMING, planFor, type StreamingKnobs, type StreamingPlan } from './plan.ts';
import { boundsOf, insideRing, rankUnits, distanceToBox, lookAheadPoint, type Focus } from './priority.ts';

export type Level = 'p0' | 'l0' | 'l1' | 'l2';
export const LEVELS: readonly Level[] = ['p0', 'l0', 'l1', 'l2'];
export const LEVEL_Z: Readonly<Record<Level, ChunkZ>> = { p0: 9, l0: 9, l1: 7, l2: 5 };
export type Priority = 'now' | 'soon' | 'idle';
export const LEVEL_PRIORITY: Readonly<Record<Level, Priority>> = { p0: 'now', l0: 'soon', l1: 'idle', l2: 'idle' };

/** The pack that holds a unit (its host tile, block or region), as a `world_pack` AssetRef. */
export const packOf = (level: Level, key: ChunkKey): string => packRefOf(key, level as PackFamily);

export type UnitState = 'requested' | 'ready' | 'empty' | 'failed' | 'retrying';

/** Why a load did not produce a unit. `unavailable` and `offline` retry with backoff; `corrupt` and `decode` end in `failed`. */
export type FailReason = 'unavailable' | 'offline' | 'quota' | 'aborted' | 'corrupt' | 'decode';

export type LoadResult<P> = { ok: true; payload: P } | { ok: true; empty: true } | { ok: false; reason: FailReason };

export interface LoadRequest {
  level: Level;
  key: ChunkKey;
  priority: Priority;
  /** 0 on the first try; counts the retries of an unavailable pack. */
  attempt: number;
}

export type ChunkEvent = 'ready' | 'evicted' | 'failed' | 'retrying' | 'recovered';

export interface Unit<P> {
  level: Level;
  key: ChunkKey;
  state: UnitState;
  payload: P | null;
  /** Host clock at the last use (wanted or read). */
  lastUse: number;
  attempts: number;
  retryAt: number;
  reason: FailReason | null;
}

export interface ChunkStoreOptions<P> {
  /** The levels this instance manages. */
  levels: readonly Level[];
  tier: QualityTierId;
  /** Whether the bake has this unit (`WorldIndex.tiles`). */
  exists: (level: Level, key: ChunkKey) => boolean;
  /** Issues a load. The host answers with `settle` (any time later). */
  request: (r: LoadRequest) => void;
  /** Frees whatever the host holds for an evicted unit. */
  evicted?: (level: Level, key: ChunkKey, payload: P | null) => void;
  /** Host clock. */
  now: () => number;
  /** Retry delays in the host's clock unit. */
  retry: { firstDelay: number; maxDelay: number; maxAttempts: number };
  /** Units that share one request (a `p0` tile pack holds 16 chunks): they count once against the in-flight cap. */
  groupOf?: (level: Level, key: ChunkKey) => string;
}

type Listener = (e: { level: Level; k: ChunkKey; ev: ChunkEvent }) => void;

const cmpKey = (a: ChunkKey, b: ChunkKey): number => (a < b ? -1 : a > b ? 1 : 0);

/** Radius of a level's wanted ring under a plan. */
export function ringOf(level: Level, p: StreamingPlan): number {
  return level === 'p0' ? p.ambientM : level === 'l0' ? p.r0M : level === 'l1' ? p.r1M : p.r2M;
}

export class ChunkStore<P = unknown> {
  readonly units = new Map<string, Unit<P>>();
  plan: StreamingPlan;
  knobs: StreamingKnobs = { ...NOMINAL_KNOBS };
  /** Last focus given to `want`. */
  focus: Focus = { x: 0, z: 0, vx: 0, vz: 0 };
  /** Density factor the pressure response lowers; read by the ambient systems of later milestones. */
  density = 1;
  readonly stats = { requests: 0, evictions: 0, failures: 0, retries: 0 };

  private readonly pinned = new Set<string>();
  private readonly listeners = new Set<Listener>();
  private readonly o: ChunkStoreOptions<P>;
  private pressure: 'none' | 'soft' | 'hard' = 'none';
  private waiters: { keys: string[]; resolve: () => void }[] = [];

  constructor(o: ChunkStoreOptions<P>) {
    this.o = o;
    this.plan = planFor(o.tier, this.knobs);
  }

  private id(level: Level, key: ChunkKey): string {
    return `${level}:${key}`;
  }

  unit(level: Level, key: ChunkKey): Readonly<Unit<P>> | null {
    return this.units.get(this.id(level, key)) ?? null;
  }

  /** `ready`: resident with data, or known to be empty. */
  ready(key: ChunkKey, level: Level = 'p0'): boolean {
    const u = this.units.get(this.id(level, key));
    return u !== undefined && (u.state === 'ready' || u.state === 'empty');
  }

  /** The decoded payload of a ready unit (the sim chunk for `p0`). */
  payload(key: ChunkKey, level: Level = 'p0'): P | null {
    const u = this.units.get(this.id(level, key));
    return u && u.state === 'ready' ? u.payload : null;
  }

  failed(level?: Level): ChunkKey[] {
    return this.keysIn((u) => u.state === 'failed', level);
  }

  residentKeys(level: Level = 'p0'): ChunkKey[] {
    return this.keysIn((u) => u.state === 'ready' || u.state === 'empty', level);
  }

  /** Units in the `retrying` state: the pack was unavailable and a retry is scheduled (the "re-downloading district" overlay). */
  unavailable(level?: Level): ChunkKey[] {
    return this.keysIn((u) => u.state === 'retrying', level);
  }

  private keysIn(pred: (u: Unit<P>) => boolean, level?: Level): ChunkKey[] {
    const out: ChunkKey[] = [];
    for (const u of this.units.values()) if ((level === undefined || u.level === level) && pred(u)) out.push(u.key);
    return out.sort(cmpKey);
  }

  /** Units requested and not yet settled. */
  pending(): number {
    let n = 0;
    for (const u of this.units.values()) if (u.state === 'requested') n++;
    return n;
  }

  onChunk(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(level: Level, k: ChunkKey, ev: ChunkEvent): void {
    for (const fn of [...this.listeners]) fn({ level, k, ev });
  }

  pin(level: Level, keys: readonly ChunkKey[]): void {
    for (const k of keys) this.pinned.add(this.id(level, k));
  }

  unpinAll(): void {
    this.pinned.clear();
  }

  /** Applies governor knobs and recomputes the plan; takes effect at the next `want`. */
  setKnobs(k: Partial<StreamingKnobs>): void {
    this.knobs = { ...this.knobs, ...k };
    this.plan = planFor(this.o.tier, this.knobs);
  }

  /**
   * Memory pressure (11-platform.md 5.6). `soft`: evict L0 beyond 1.0 x its ring first, then lower the density and the render
   * rings one step. `hard`: the same, then also the coarse levels beyond 1.0 x, and the lowest step. `none` restores the rings.
   */
  setPressure(level: 'none' | 'soft' | 'hard'): void {
    if (level === this.pressure) return;
    this.pressure = level;
    if (level === 'none') {
      this.density = 1;
      this.setKnobs({ pressureStep: 0 });
      return;
    }
    // L0 beyond 1.0 x the ring goes first, before the ring itself shrinks.
    this.evictBeyond('l0', 1);
    if (level === 'hard') {
      this.evictBeyond('l1', 1);
      this.evictBeyond('l2', 1);
    }
    const last = STREAMING.pressureSteps.length - 1;
    const step = level === 'hard' ? last : Math.min(last, this.knobs.pressureStep + 1);
    this.density = Math.max(0.25, this.density * 0.75);
    this.setKnobs({ pressureStep: step });
    this.evictBeyond('l0', 1);
  }

  private evictBeyond(level: Level, factor: number): void {
    if (!this.o.levels.includes(level)) return;
    const r = ringOf(level, this.plan);
    for (const u of [...this.units.values()]) {
      if (u.level !== level || this.pinned.has(this.id(level, u.key))) continue;
      if (u.state !== 'ready' && u.state !== 'empty') continue;
      if (!insideRing(u.key, this.focus, r, factor)) this.evict(u);
    }
  }

  private evict(u: Unit<P>): void {
    this.units.delete(this.id(u.level, u.key));
    this.stats.evictions++;
    this.o.evicted?.(u.level, u.key, u.payload);
    this.emit(u.level, u.key, 'evicted');
  }

  /**
   * One streaming pass: recompute the wanted units of every managed level around `focus`, issue requests in order (the finest
   * level first, up to each level's in-flight cap), retry what is due, and evict what left 1.35 x its ring (least recently used
   * first when a level is over its resident cap).
   */
  want(focus: Focus, altitudeAglM = 0): void {
    this.focus = focus;
    if (altitudeAglM !== this.knobs.altitudeAglM) this.setKnobs({ altitudeAglM });
    const now = this.o.now();
    for (const level of LEVELS) {
      if (!this.o.levels.includes(level)) continue;
      const z = LEVEL_Z[level];
      const ranked = rankUnits(z, focus, ringOf(level, this.plan), {
        exists: (k) => this.o.exists(level, k),
        firstRing: z === 9,
      });
      const groups = new Set<string>();
      for (const u of this.units.values()) if (u.level === level && u.state === 'requested') groups.add(this.groupOf(level, u.key));
      const cap = STREAMING.inFlight[level];
      for (const r of ranked) {
        const id = this.id(level, r.key);
        let u = this.units.get(id);
        if (u) u.lastUse = now;
        if (u && u.state !== 'retrying') continue;
        if (u && u.retryAt > now) continue;
        const group = this.groupOf(level, r.key);
        if (!groups.has(group) && groups.size >= cap) continue;
        groups.add(group);
        if (!u) {
          u = { level, key: r.key, state: 'requested', payload: null, lastUse: now, attempts: 0, retryAt: 0, reason: null };
          this.units.set(id, u);
        } else {
          u.state = 'requested';
          this.stats.retries++;
        }
        this.stats.requests++;
        this.o.request({ level, key: r.key, priority: LEVEL_PRIORITY[level], attempt: u.attempts });
      }
      this.evictOutside(level, now);
    }
  }

  private groupOf(level: Level, key: ChunkKey): string {
    return this.o.groupOf ? this.o.groupOf(level, key) : this.id(level, key);
  }

  private evictOutside(level: Level, now: number): void {
    const ring = ringOf(level, this.plan);
    const factor = STREAMING.unloadFactor;
    const mine = [...this.units.values()].filter((u) => u.level === level);
    for (const u of mine) {
      if (this.pinned.has(this.id(level, u.key))) continue;
      if (u.state === 'requested') continue;
      if (!insideRing(u.key, this.focus, ring, factor)) this.evict(u);
    }
    const cap = this.plan.resident[level === 'p0' ? 'l0' : level];
    const resident = [...this.units.values()].filter((u) => u.level === level && (u.state === 'ready' || u.state === 'empty'));
    if (resident.length > cap) {
      // Over the cap: least recently used first among the unpinned units outside 1.0 x the ring.
      const victims = resident
        .filter((u) => !this.pinned.has(this.id(level, u.key)) && !insideRing(u.key, this.focus, ring, 1))
        .sort((a, b) => a.lastUse - b.lastUse || cmpKey(a.key, b.key));
      for (const v of victims) {
        if (resident.length <= cap) break;
        this.evict(v);
        resident.splice(resident.indexOf(v), 1);
      }
    }
    void now;
  }

  /** The host's answer to a request. Unknown or evicted units are ignored. */
  settle(level: Level, key: ChunkKey, result: LoadResult<P>): void {
    const u = this.units.get(this.id(level, key));
    if (!u || u.state !== 'requested') return;
    const now = this.o.now();
    if (result.ok) {
      const recovered = u.attempts > 0;
      u.attempts = 0;
      u.reason = null;
      if ('empty' in result) {
        u.state = 'empty';
        u.payload = null;
      } else {
        u.state = 'ready';
        u.payload = result.payload;
      }
      u.lastUse = now;
      this.emit(level, key, 'ready');
      if (recovered) this.emit(level, key, 'recovered');
      this.resolveWaiters();
      return;
    }
    u.reason = result.reason;
    if (result.reason === 'corrupt' || result.reason === 'decode') {
      u.state = 'failed';
      this.stats.failures++;
      this.emit(level, key, 'failed');
      this.resolveWaiters();
      return;
    }
    if (result.reason === 'aborted') {
      u.state = 'retrying';
      u.retryAt = now;
      return;
    }
    u.attempts++;
    if (u.attempts >= this.o.retry.maxAttempts) {
      u.state = 'failed';
      this.stats.failures++;
      this.emit(level, key, 'failed');
      this.resolveWaiters();
      return;
    }
    u.state = 'retrying';
    u.retryAt = now + Math.min(this.o.retry.maxDelay, this.o.retry.firstDelay * (1 << Math.min(20, u.attempts - 1)));
    this.emit(level, key, 'retrying');
  }

  /**
   * Requests `keys`, waits until every one is settled (ready, empty or failed) and pins them. For the boot set and the world
   * scenarios' residency rule (M03b1). Keys of unmanaged levels or absent from the bake settle at once.
   */
  preload(keys: readonly { level: Level; key: ChunkKey }[]): Promise<void> {
    const ids: string[] = [];
    const now = this.o.now();
    for (const { level, key } of keys) {
      if (!this.o.levels.includes(level) || !this.o.exists(level, key)) continue;
      const id = this.id(level, key);
      ids.push(id);
      this.pinned.add(id);
      if (!this.units.has(id)) {
        this.units.set(id, { level, key, state: 'requested', payload: null, lastUse: now, attempts: 0, retryAt: 0, reason: null });
        this.stats.requests++;
        this.o.request({ level, key, priority: 'now', attempt: 0 });
      }
    }
    return new Promise<void>((resolve) => {
      this.waiters.push({ keys: ids, resolve });
      this.resolveWaiters();
    });
  }

  private resolveWaiters(): void {
    this.waiters = this.waiters.filter((w) => {
      const done = w.keys.every((id) => {
        const u = this.units.get(id);
        return u === undefined || u.state === 'ready' || u.state === 'empty' || u.state === 'failed';
      });
      if (done) w.resolve();
      return !done;
    });
  }

  /** Forgets every unit without calling `evicted` (the host dropped them already, for example after a GPU loss rebuild). */
  reset(): void {
    this.units.clear();
    this.waiters = [];
  }

  /** Distance from the look-ahead focus to the unit's box, for diagnostics. */
  distanceTo(key: ChunkKey): number {
    const a = lookAheadPoint(this.focus);
    return distanceToBox(a.x, a.z, boundsOf(key));
  }
}
