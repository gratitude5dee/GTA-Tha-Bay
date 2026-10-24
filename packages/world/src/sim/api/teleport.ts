/**
 * `TeleportApi` (M02c1; 02-world-maps.md section 5): the one entry for moving the player across the city, for the sandbox menu,
 * the map, fast travel, XR comfort, respawn and QA.
 *
 * A request runs these steps, one sim tick at a time (the sim has no timers: `step(tick)` is the clock):
 *  1. validate, in this order: the mode rules, the heat, the play bounds, the 30 s fast-travel cooldown, then resolve the target
 *     (a landmark uses its arrival pose);
 *  2. pre-stream: the destination `p0` chunk and the ring of chunks around it are requested as `needNow` and pinned; waiting more
 *     than 8 s answers `not-loaded` and leaves the player where it is;
 *  3. place: the highest ground at the target (heightfield, slabs, hoods); water and building footprints are rejected by taking
 *     the nearest valid point within 40 m (`water` or `blocked` when there is none);
 *  4. fade out (up to 200 ms), then the engine's ownership machine moves the player (Control 700, wait for colliders 701);
 *  5. fade in, and the request resolves with where the player stands.
 * Fares of fast travel are worked out from `config/world/transit.json` and recorded, not charged, until the economy exists (M04a2).
 * Pure; C02 lint applies.
 */
import {
  chunkKeyAt, dsqrt, parseChunkKey,
  type ChunkKey, type LandmarkRecord, type TeleportApi, type TeleportKind, type TeleportResult, type TeleportTarget, type TransitNode, type WorldIndex,
} from '@dv/shared';
import transitJson from '../../../../../config/world/transit.json';
import type { PlaceIndexImpl } from './places.ts';
import type { WorldQueryImpl } from './query.ts';

/** Ticks (60 Hz) to wait for the destination ground: 8 s. */
export const PRESTREAM_TICKS = 480;
/** Ticks of the fade-out before the player moves: 200 ms. */
export const FADE_TICKS = 12;
/** Search radius for a valid arrival around a rejected target, metres, and its lattice step. */
export const PLACE_RADIUS_M = 40;
export const PLACE_STEP_M = 2;
/** Clearance from a building footprint a placed player needs, metres. */
export const PLACE_CLEARANCE_M = 0.6;
/** Ticks the engine gets to finish a move before the request gives up. */
export const MOVE_TIMEOUT_TICKS = 900;
/** The player counts as arrived when it stands within this of the target, metres. */
export const ARRIVE_TOLERANCE_M = 3;
/** XR comfort arcs snap to a teleport node this close, metres. */
export const XR_SNAP_M = 3;

export interface TransitConfig {
  schema: 'world-transit/1';
  fares: {
    'bay-rail': { baseCents: number; perStopCents: number };
    'cable-car': { baseCents: number };
    robotaxi: { baseCents: number; perKmCents: number };
    ferry: { baseCents: number };
  };
  stopSpacingM: number;
  cooldown: { fastTravelS: number };
}
export const TRANSIT: TransitConfig = transitJson as unknown as TransitConfig;

/** What the service needs of the sim: where the player is, and the engine's teleport and fade. */
export interface TeleportHost {
  /** The local player's feet position, or null before there is one. */
  playerPos(): [number, number, number] | null;
  /** Asks the ownership machine to move the player; `busy` when it is already moving or not idle. */
  begin(x: number, y: number, z: number, yaw: number): { ok: true } | { ok: false; reason: 'busy' | 'no-player' };
  /** True while the ownership machine is still moving the player. */
  active(): boolean;
  /** Tells the page to fade the screen out or in. */
  fade(dir: 'out' | 'in'): void;
}

/** The hooks mode rules and the heat level plug into (default: a sandbox session with no heat). */
export interface TeleportPolicy {
  /** Whether the session's mode allows this kind of teleport (story rules: M05c2). */
  allowed(kind: TeleportKind): boolean;
  /** Heat level; fast travel and sandbox teleport need 0 (pursuit: M03c). */
  heat(): number;
}
export const SANDBOX_POLICY: TeleportPolicy = { allowed: () => true, heat: () => 0 };

/** The slice of `ChunkStore` the pre-stream uses. */
export interface PreStream {
  preload(keys: readonly { level: 'p0'; key: ChunkKey }[]): Promise<void>;
  unpin(level: 'p0', keys: readonly ChunkKey[]): void;
  exists(level: 'p0', key: ChunkKey): boolean;
}

export interface FareRecord {
  tick: number;
  to: string;
  kind: TransitNode['kind'] | 'robotaxi' | 'unknown';
  cents: number;
}

export interface TeleportDeps {
  stream: PreStream;
  query: WorldQueryImpl;
  places: PlaceIndexImpl;
  index: Pick<WorldIndex, 'transit'>;
  /** `config/world.bounds.json` `play`. */
  play: { minX: number; maxX: number; minZ: number; maxZ: number };
  host: TeleportHost;
  now(): number;
  policy?: TeleportPolicy;
  config?: TransitConfig;
}

type Fail = Extract<TeleportResult, { ok: false }>;
const fail = (reason: Fail['reason'], key: string): Fail => ({ ok: false, reason, messageKey: key });
export const TELEPORT_MSG = {
  notLoaded: 'world.teleport.notLoaded',
  water: 'world.teleport.water',
  blocked: 'world.teleport.blocked',
  forbidden: 'world.teleport.forbidden',
  heat: 'world.teleport.heat',
  outOfBounds: 'world.teleport.outOfBounds',
  cooldown: 'world.teleport.cooldown',
  unknownTarget: 'world.teleport.unknownTarget',
  busy: 'world.teleport.busy',
} as const;

interface Resolved {
  x: number;
  z: number;
  yaw: number;
  /** Id of the destination for the fare record. */
  id: string | null;
}

interface Job {
  kind: TeleportKind;
  to: Resolved;
  started: number;
  keys: ChunkKey[];
  /** Where the player stood when the request was made (x, z), for the fare. */
  from: [number, number] | null;
  streamed: boolean;
  phase: 'stream' | 'fade' | 'move';
  phaseStart: number;
  place: { x: number; y: number; z: number } | null;
  resolve(r: TeleportResult): void;
}

/** Lattice offsets within `PLACE_RADIUS_M`, nearest first (ties by dx, then dz), built once. */
const OFFSETS: { dx: number; dz: number }[] = (() => {
  const out: { dx: number; dz: number; d2: number }[] = [];
  const n = Math.floor(PLACE_RADIUS_M / PLACE_STEP_M);
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const dx = i * PLACE_STEP_M, dz = j * PLACE_STEP_M;
      const d2 = dx * dx + dz * dz;
      if (d2 <= PLACE_RADIUS_M * PLACE_RADIUS_M) out.push({ dx, dz, d2 });
    }
  }
  out.sort((a, b) => a.d2 - b.d2 || a.dx - b.dx || a.dz - b.dz);
  return out;
})();

export class TeleportService implements TeleportApi {
  /** Fares worked out for fast travel, in order; nothing is charged until `EconomyApi` lands (M04a2). */
  readonly fares: FareRecord[] = [];
  policy: TeleportPolicy;
  private job: Job | null = null;
  private lastFastTravel: number | null = null;
  private readonly cfg: TransitConfig;

  constructor(private readonly d: TeleportDeps) {
    this.policy = d.policy ?? SANDBOX_POLICY;
    this.cfg = d.config ?? TRANSIT;
  }

  get busy(): boolean {
    return this.job !== null;
  }

  // ---- candidates -------------------------------------------------------------------------------------------------------

  candidates(kind: TeleportKind): readonly { id: string; nameKey: string; x: number; z: number }[] {
    if (kind === 'fast-travel') {
      return this.d.index.transit.filter((t) => t.fastTravel).map((t) => ({ id: t.id, nameKey: t.nameKey, x: t.x, z: t.z }));
    }
    if (kind === 'sandbox' || kind === 'debug') {
      return this.d.places.landmarks().map((l) => ({ id: l.id, nameKey: l.nameKey, x: l.arrival.x, z: l.arrival.z }));
    }
    return [];
  }

  // ---- request ----------------------------------------------------------------------------------------------------------

  request(kind: TeleportKind, to: TeleportTarget): Promise<TeleportResult> {
    const early = this.validate(kind, to);
    if ('ok' in early) return Promise.resolve(early);
    if (this.job) return Promise.resolve(fail('blocked', TELEPORT_MSG.busy));
    return new Promise<TeleportResult>((resolve) => {
      const t = early.to;
      const here = parseChunkKey(chunkKeyAt(9, t.x, t.z));
      const keys: ChunkKey[] = [];
      if (here) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const key = `9/${here.x + dx}/${here.y + dy}` as ChunkKey;
            if (this.d.stream.exists('p0', key)) keys.push(key);
          }
        }
      }
      const at = this.d.host.playerPos();
      const job: Job = { kind, to: t, started: this.d.now(), keys, from: at ? [at[0], at[2]] : null, streamed: false, phase: 'stream', phaseStart: this.d.now(), place: null, resolve };
      this.job = job;
      void this.d.stream.preload(keys.map((key) => ({ level: 'p0' as const, key }))).then(() => {
        job.streamed = true;
      });
    });
  }

  private validate(kind: TeleportKind, to: TeleportTarget): { to: Resolved } | Fail {
    if (!this.policy.allowed(kind)) return fail('forbidden-in-mode', TELEPORT_MSG.forbidden);
    if ((kind === 'fast-travel' || kind === 'sandbox') && this.policy.heat() > 0) return fail('heat', TELEPORT_MSG.heat);
    const t = this.resolve(kind, to);
    if (!t) return fail('blocked', TELEPORT_MSG.unknownTarget);
    const p = this.d.play;
    if (!(t.x >= p.minX && t.x <= p.maxX && t.z >= p.minZ && t.z <= p.maxZ)) return fail('out-of-bounds', TELEPORT_MSG.outOfBounds);
    if (kind === 'fast-travel' && this.lastFastTravel !== null && this.d.now() - this.lastFastTravel < this.cfg.cooldown.fastTravelS * 60) {
      return fail('cooldown', TELEPORT_MSG.cooldown);
    }
    return { to: t };
  }

  private resolve(kind: TeleportKind, to: TeleportTarget): Resolved | null {
    if ('landmark' in to) {
      const l: LandmarkRecord | null = this.d.places.landmark(to.landmark as LandmarkRecord['id']);
      return l ? { x: l.arrival.x, z: l.arrival.z, yaw: l.arrival.yaw, id: l.id } : null;
    }
    if ('node' in to) {
      const n = this.d.index.transit.find((t) => t.id === to.node);
      if (n) return { x: n.x, z: n.z, yaw: 0, id: n.id };
      if (to.node.startsWith('tp.')) {
        const l = this.d.places.landmark(`lm.${to.node.slice(3)}` as LandmarkRecord['id']);
        if (l) return { x: l.arrival.x, z: l.arrival.z, yaw: l.arrival.yaw, id: to.node };
      }
      return null;
    }
    if (!Number.isFinite(to.x) || !Number.isFinite(to.z)) return null;
    let { x, z } = to;
    if (kind === 'xr-comfort') {
      const snap = this.d.query.teleportNodesNear(x, z, XR_SNAP_M, 'xr')[0];
      if (snap) {
        x = snap.x;
        z = snap.z;
      }
    }
    return { x, z, yaw: to.yaw ?? 0, id: null };
  }

  // ---- the clock ----------------------------------------------------------------------------------------------------------

  /** Advances the request in flight by one sim tick (`SimStage.Commands`, before the streaming and control stages). */
  step(tick: number): void {
    const job = this.job;
    if (!job) return;
    if (job.phase === 'stream') {
      if (job.streamed) {
        const placed = this.placeFor(job.to);
        if ('ok' in placed) return this.finish(job, placed);
        job.place = placed;
        this.d.host.fade('out');
        job.phase = 'fade';
        job.phaseStart = tick;
      } else if (tick - job.started >= PRESTREAM_TICKS) {
        this.finish(job, fail('not-loaded', TELEPORT_MSG.notLoaded));
      }
      return;
    }
    if (job.phase === 'fade') {
      if (tick - job.phaseStart < FADE_TICKS) return;
      const p = job.place as { x: number; y: number; z: number };
      const begun = this.d.host.begin(p.x, p.y, p.z, job.to.yaw);
      if (!begun.ok) return this.finish(job, fail('blocked', TELEPORT_MSG.busy));
      job.phase = 'move';
      job.phaseStart = tick;
      return;
    }
    // move: the ownership machine runs 700, then 701 until the colliders are there
    if (tick > job.phaseStart && !this.d.host.active()) {
      const at = this.d.host.playerPos();
      const p = job.place as { x: number; y: number; z: number };
      if (!at || dsqrt((at[0] - p.x) * (at[0] - p.x) + (at[2] - p.z) * (at[2] - p.z)) > ARRIVE_TOLERANCE_M) {
        this.d.host.fade('in');
        return this.finish(job, fail('not-loaded', TELEPORT_MSG.notLoaded));
      }
      this.d.host.fade('in');
      this.finish(job, { ok: true, x: at[0], y: at[1], z: at[2], yaw: job.to.yaw });
      return;
    }
    if (tick - job.phaseStart >= MOVE_TIMEOUT_TICKS) {
      this.d.host.fade('in');
      this.finish(job, fail('not-loaded', TELEPORT_MSG.notLoaded));
    }
  }

  private finish(job: Job, r: TeleportResult): void {
    if (this.job === job) this.job = null;
    this.d.stream.unpin('p0', job.keys);
    if (r.ok && job.kind === 'fast-travel') {
      this.lastFastTravel = this.d.now();
      this.fares.push(this.fareFor(job, r.x, r.z));
    }
    job.resolve(r);
  }

  // ---- placement ----------------------------------------------------------------------------------------------------------

  /** Ground height at a point when a player can stand there: resident, inside play, not water, clear of building footprints. */
  private validAt(x: number, z: number): number | null {
    const p = this.d.play;
    if (!(x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ)) return null;
    const gy = this.d.query.groundY(x, z);
    if (gy === null || this.d.query.isWater(x, z)) return null;
    if (this.d.query.distToBuildings(x, z, 2) < PLACE_CLEARANCE_M) return null;
    return gy;
  }

  private placeFor(t: Resolved): { x: number; y: number; z: number } | Fail {
    const key = chunkKeyAt(9, t.x, t.z);
    if (!this.d.query.chunkReady(key)) return fail('not-loaded', TELEPORT_MSG.notLoaded);
    for (const o of OFFSETS) {
      const x = t.x + o.dx, z = t.z + o.dz;
      const y = this.validAt(x, z);
      if (y !== null) return { x, y, z };
    }
    // nothing within 40 m: say why
    const chunkEmpty = this.d.query.groundY(t.x, t.z) === null;
    return this.d.query.isWater(t.x, t.z) || chunkEmpty ? fail('water', TELEPORT_MSG.water) : fail('blocked', TELEPORT_MSG.blocked);
  }

  // ---- fares --------------------------------------------------------------------------------------------------------------

  private fareFor(job: Job, x: number, z: number): FareRecord {
    const to = job.to;
    const tick = this.d.now();
    const node = this.d.index.transit.find((t) => t.id === to.id);
    const f = this.cfg.fares;
    const from = job.from;
    const dist = from ? dsqrt((from[0] - x) * (from[0] - x) + (from[1] - z) * (from[1] - z)) : 0;
    if (!node) return { tick, to: to.id ?? 'point', kind: 'robotaxi', cents: f.robotaxi.baseCents + Math.round((f.robotaxi.perKmCents * dist) / 1000) };
    switch (node.kind) {
      case 'cable-car':
        return { tick, to: node.id, kind: node.kind, cents: f['cable-car'].baseCents };
      case 'ferry':
        return { tick, to: node.id, kind: node.kind, cents: f.ferry.baseCents };
      default: {
        const stops = Math.max(1, Math.round(dist / this.cfg.stopSpacingM));
        return { tick, to: node.id, kind: node.kind, cents: f['bay-rail'].baseCents + f['bay-rail'].perStopCents * stops };
      }
    }
  }
}
