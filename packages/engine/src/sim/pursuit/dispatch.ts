/**
 * The dispatcher (M03c): which units exist at a heat level, where they spawn, which way they drive and which tactic each runs.
 *
 *  - Units per level: `levels[l].maxUnits` in total (the helicopter and the SUVs count), `suv` of them SUVs, one helicopter where
 *    `heli`. One unit is added every `SPAWN_GAP_TICKS` until the level is full.
 *  - A spawn is on a road lane at least 120 m from the player and out of view (outside the player's forward cone, or without a line
 *    of sight to the player), found with stream `police`.
 *  - Routes are A* over the road graph and are re-planned at most every 150 ticks (2.5 s) per unit and at most one unit per step.
 *  - Line of sight to the player is batched round-robin, `search.losChecksPerTick` rays per step.
 *  - After a clear the units disperse along the road away from the player and despawn once unseen beyond 1.25 times the search radius
 *    they had (or after `DISPERSE_MAX_TICKS`).
 *  - Roadblocks (`roadblock2`, `roadblockHeavy`) and spike strips are planned on the predicted route (or the route hint).
 *
 * Every steering decision ends as a `DriveInput` for `stepHandling`. Sim code under the C02 lint.
 */
import { dcos, dsin, dsqrt } from '@dv/shared';
import type { Fnv64, HeatLevel, PursuitConfig, StableKey, Tactic } from '@dv/shared';
import type { Rng } from '@dv/shared';
import { TICKS_PER_SEC } from './heat.ts';
import type { DriveInput, LanePoint, PlayerView, PursuitHost, PursuitWorld, UnitRole, UnitView, Vec3, VehicleDamagePort } from './ports.ts';
import { boxHeld, boxInTarget, rollingBlockTarget, suvRamTarget } from './tactics/boxin.ts';
import { clamp, dist2, driveToward, followSpeed, forwardOf, hold, UNIT_MAX_SPEED, type SteerTarget } from './tactics/follow.ts';
import { heliOrbit, heliSees, heliStep, type HeliPose } from './tactics/heli.ts';
import { pitAllowed, pitTarget } from './tactics/pit.ts';
import { planRoadblock, type BlockSpec, type RoadblockKind } from './tactics/roadblock.ts';
import { crossedTires, planSpikes, type StripSpec } from './tactics/spikes.ts';

export const PREFAB_CRUISER = 'police.cruiser';
export const PREFAB_SUV = 'police.suv';
export const PREFAB_HELI = 'police.heli';
export const PREFAB_BARRIER = 'prop.barrier';
export const PREFAB_SPIKES = 'prop.spikestrip';

/** A spawn is at least this far from the player, metres. */
export const MIN_SPAWN_M = 120;
const MAX_SPAWN_M = 280;
const SPAWN_TRIES = 10;
/** One spawn per this many ticks. */
export const SPAWN_GAP_TICKS = 60;
/** A route is re-planned at most this often per unit (2.5 s). */
export const REPLAN_TICKS = 150;
/** Ground sight range of a unit, metres. */
export const SIGHT_M = 150;
/** A line-of-sight result is believed for this many ticks. */
const SIGHT_VALID_TICKS = 60;
/** Cosine of the half angle of the player's view, 75 degrees. */
const VIEW_COS = 0.2588;
const DISPERSE_MAX_TICKS = 45 * TICKS_PER_SEC;
const BLOCK_EVERY_TICKS = 20 * TICKS_PER_SEC;
const BLOCK_LIFE_TICKS = 45 * TICKS_PER_SEC;
const SPIKE_EVERY_TICKS = 25 * TICKS_PER_SEC;
const SPIKE_LIFE_TICKS = 60 * TICKS_PER_SEC;
/** A unit that has not moved for this long while it should is removed if unseen (stuck against geometry). */
const STUCK_TICKS = 12 * TICKS_PER_SEC;
const WAYPOINT_M = 14;
const MAX_PLAN_POINTS = 40;

export type UnitMode = 'chase' | 'roadblock' | 'disperse' | 'named';

export interface UnitRec {
  id: number;
  key: string;
  prefab: string;
  role: UnitRole;
  mode: UnitMode;
  tactic: Tactic;
  born: number;
  /** Planned waypoints and the next one. */
  plan: LanePoint[];
  planIdx: number;
  planTick: number;
  /** Where the plan leads (chase: the player or the last known position; disperse: away). */
  goal: { x: number; z: number } | null;
  /** Roadblock slot: which block (`blockId`) and which of its two slots. */
  blockId: number;
  blockSlot: number;
  /** Box-in slot 0..2 and the tick the box formed. */
  boxSlot: number;
  boxSince: number;
  /** Last line-of-sight result and its tick. */
  sees: boolean;
  seesTick: number;
  /** Ticks the unit has hardly moved. */
  stuck: number;
  disperseSince: number;
}

interface BlockRec {
  id: number;
  spec: BlockSpec;
  props: number[];
  born: number;
}

interface StripRec {
  spec: StripSpec;
  prop: number;
  born: number;
  /** `<vehicle id>:<tire>` already punctured. */
  hits: Set<string>;
}

export interface StepInput {
  tick: number;
  dt: number;
  level: HeatLevel;
  /** True while the pursuit is on (the player is wanted and not busted). */
  active: boolean;
  player: PlayerView;
  /** The last known position of the player (the chase goal while unseen). */
  lastKnown: Vec3 | null;
  hint: readonly number[] | null;
  /** Radius to despawn dispersing units at, metres. */
  despawnRadius: number;
}

export interface StepResult {
  /** A unit (or the helicopter) sees the player now. */
  seen: boolean;
  raysUsed: number;
}

const KIND_OF: Record<Tactic, number> = {
  follow: 0, siren: 1, loudspeaker: 2, pit: 3, boxIn: 4, rollingBlock: 5, roadblock2: 6, roadblockHeavy: 7, spikes: 8, heliSpotlight: 9, suvRam: 10, portalSeal: 11,
};

export class Dispatcher {
  readonly units: UnitRec[] = [];
  private readonly blocks: BlockRec[] = [];
  private readonly strips: StripRec[] = [];
  private readonly edgeCache = new Map<number, LanePoint[]>();
  private readonly heliPoses = new Map<number, HeliPose>();
  private serial = 0;
  private blockSerial = 0;
  private propSerial = 0;
  private lastSpawn = -1e9;
  private lastBlock = -1e9;
  private lastSpike = -1e9;
  private rayCursor = 0;
  private replanCursor = 0;
  private readonly input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  /** Units that were counted as seen this step; read by the director for the SearchModel. */
  lastSeen = false;
  /** Rays cast in the latest step (AC-4 reads it). */
  raysLast = 0;
  /** Replans in the latest step. */
  replansLast = 0;
  /** Spawn positions chosen so far (tests assert distance and view). */
  readonly spawnLog: { tick: number; pos: Vec3; role: UnitRole }[] = [];
  /** Tire punctures so far. */
  punctures = 0;

  constructor(
    public cfg: PursuitConfig,
    private readonly host: PursuitHost,
    private readonly world: PursuitWorld,
    private readonly rng: Rng,
    private readonly damage: VehicleDamagePort,
  ) {}

  // ---- composition -----------------------------------------------------------------------------------------------------------

  private want(level: HeatLevel): { cruisers: number; suvs: number; heli: number } {
    const def = this.cfg.levels[level];
    const heli = def.heli ? 1 : 0;
    const suvs = Math.min(def.suv, Math.max(0, def.maxUnits - heli));
    return { cruisers: Math.max(0, def.maxUnits - heli - suvs), suvs, heli };
  }

  count(role?: UnitRole, includeDispersing = true): number {
    let n = 0;
    for (const u of this.units) if ((role === undefined || u.role === role) && (includeDispersing || u.mode !== 'disperse')) n++;
    return n;
  }

  /** Ground units (not the helicopter) that exist in the ECS. */
  groundViews(): UnitView[] {
    const out: UnitView[] = [];
    for (const u of this.units) {
      if (u.role === 'heli') continue;
      const v = this.host.unit(u.id);
      if (v?.ready) out.push(v);
    }
    return out;
  }

  // ---- spawning --------------------------------------------------------------------------------------------------------------

  private outOfView(player: PlayerView, p: Vec3): boolean {
    const dx = p[0] - player.pos[0], dz = p[2] - player.pos[2];
    const d = dsqrt(dx * dx + dz * dz);
    if (d === 0) return false;
    const [fx, fz] = forwardOf(player.yaw);
    if ((dx * fx + dz * fz) / d < VIEW_COS) return true;
    return !this.host.los([p[0], p[1] + 1.5, p[2]], [player.pos[0], player.pos[1] + 1.5, player.pos[2]]);
  }

  /** A road lane point at least `MIN_SPAWN_M` from the player and out of view, or null. */
  pickSpawn(player: PlayerView): LanePoint | null {
    for (let k = 0; k < SPAWN_TRIES; k++) {
      const a = this.rng.range(0, 6.283185307179586);
      const r = this.rng.range(MIN_SPAWN_M + 10, MAX_SPAWN_M);
      const x = player.pos[0] + dcos(a) * r, z = player.pos[2] + dsin(a) * r;
      const road = this.world.nearestRoad(x, z, 45);
      if (!road) continue;
      const lp = this.world.lanePoint(road.edge, road.s);
      if (!lp) continue;
      if (dist2(lp.x, lp.z, player.pos[0], player.pos[2]) < MIN_SPAWN_M) continue;
      if (!this.outOfView(player, [lp.x, lp.y, lp.z])) continue;
      return lp;
    }
    return null;
  }

  private newUnit(id: number, key: string, prefab: string, role: UnitRole, mode: UnitMode, tick: number): UnitRec {
    const u: UnitRec = {
      id, key, prefab, role, mode, tactic: 'follow', born: tick, plan: [], planIdx: 0, planTick: -1e9, goal: null,
      blockId: -1, blockSlot: 0, boxSlot: 0, boxSince: -1, sees: false, seesTick: -1e9, stuck: 0, disperseSince: -1,
    };
    this.units.push(u);
    return u;
  }

  private spawnOne(role: UnitRole, prefab: string, player: PlayerView, tick: number): UnitRec | null {
    const lp = this.pickSpawn(player);
    if (!lp) return null;
    const key = `veh:pol${this.serial++}` as StableKey;
    const y = role === 'heli' ? lp.y + 55 : lp.y;
    const id = this.host.spawnUnit(prefab, role, [lp.x, y, lp.z], lp.yaw, key);
    if (id === 0) return null;
    if (role === 'heli') this.heliPoses.set(id, { pos: [lp.x, y, lp.z], yaw: lp.yaw });
    this.spawnLog.push({ tick, pos: [lp.x, lp.y, lp.z], role });
    return this.newUnit(id, key, prefab, role, 'chase', tick);
  }

  /** A scripted unit (S03's chase scenes); placed like any other spawn. Returns its handle or 0. */
  spawnNamed(prefab: string, key: StableKey, player: PlayerView, tick: number): number {
    const lp = this.pickSpawn(player);
    if (!lp) return 0;
    const role: UnitRole = prefab === PREFAB_HELI ? 'heli' : 'named';
    const id = this.host.spawnUnit(prefab, role, [lp.x, role === 'heli' ? lp.y + 55 : lp.y, lp.z], lp.yaw, key);
    if (id === 0) return 0;
    if (role === 'heli') this.heliPoses.set(id, { pos: [lp.x, lp.y + 55, lp.z], yaw: lp.yaw });
    this.spawnLog.push({ tick, pos: [lp.x, lp.y, lp.z], role });
    const u = this.newUnit(id, key, prefab, role, 'named', tick);
    u.goal = { x: player.pos[0], z: player.pos[2] };
    return id;
  }

  // ---- plans -----------------------------------------------------------------------------------------------------------------

  private edgePoints(edge: number): LanePoint[] {
    const have = this.edgeCache.get(edge);
    if (have) return have;
    const pts: LanePoint[] = [];
    const len = this.world.edgeLength(edge);
    for (let s = 0; s <= len + 0.01 && pts.length < 60; s += WAYPOINT_M) {
      const p = this.world.lanePoint(edge, s);
      if (p) pts.push(p);
    }
    const end = this.world.lanePoint(edge, len);
    if (end) pts.push(end);
    if (pts.length > 0) this.edgeCache.set(edge, pts);
    return pts;
  }

  private buildPlan(u: UnitRec, v: UnitView, tick: number): void {
    u.planTick = tick;
    if (!u.goal) return;
    const route = this.world.route({ x: v.pos[0], z: v.pos[2] }, u.goal);
    this.replansLast++;
    u.plan = [];
    u.planIdx = 0;
    if (!route || route.edges.length === 0) return;
    const pts: LanePoint[] = [];
    let first = true;
    for (const e of route.edges) {
      const ep = this.edgePoints(e);
      for (const p of ep) {
        // on the first edge keep only the points ahead of the unit
        if (first && !this.ahead(v, p)) continue;
        pts.push(p);
        if (pts.length >= MAX_PLAN_POINTS) break;
      }
      first = false;
      if (pts.length >= MAX_PLAN_POINTS) break;
    }
    u.plan = pts;
  }

  private ahead(v: UnitView, p: { x: number; z: number }): boolean {
    const [fx, fz] = forwardOf(v.yaw);
    return (p.x - v.pos[0]) * fx + (p.z - v.pos[2]) * fz > -2;
  }

  /** The target on the plan: advance past reached points, look a point or two ahead. */
  private planTarget(u: UnitRec, v: UnitView, speed: number): SteerTarget | null {
    while (u.planIdx < u.plan.length - 1) {
      const p = u.plan[u.planIdx] as LanePoint;
      if (dist2(v.pos[0], v.pos[2], p.x, p.z) < 11) u.planIdx++;
      else break;
    }
    const p = u.plan[Math.min(u.planIdx + 1, u.plan.length - 1)];
    if (!p) return null;
    return { x: p.x, z: p.z, speed };
  }

  // ---- the step --------------------------------------------------------------------------------------------------------------

  step(i: StepInput): StepResult {
    this.replansLast = 0;
    this.raysLast = 0;
    const { tick } = i;

    // 1. composition: spawn, trim
    if (i.active) this.fill(i, tick);
    else this.disperseAll(tick);
    this.trim(i);

    // 2. sight: round-robin rays, heli spotlight
    this.lastSeen = this.updateSight(i);

    // 3. replans, one unit per step
    this.replan(i);

    // 4. props: roadblocks and strips
    if (i.active) this.manageProps(i);
    else this.dropProps();
    this.checkStrips(i);

    // 5. tactics and driving
    this.assignTactics(i);
    this.driveAll(i);

    // 6. housekeeping: despawn dispersed and stuck units
    this.collect(i);
    return { seen: this.lastSeen, raysUsed: this.raysLast };
  }

  private fill(i: StepInput, tick: number): void {
    const w = this.want(i.level);
    const total = this.units.length;
    const max = this.cfg.levels[i.level].maxUnits;
    if (total >= max || tick - this.lastSpawn < SPAWN_GAP_TICKS) return;
    const haveHeli = this.count('heli');
    const haveSuv = this.count('suv');
    const haveCruiser = this.count('cruiser');
    // the helicopter first at its level, then cruisers up to the quota, then SUVs
    let role: UnitRole | null = null;
    if (w.heli > haveHeli) role = 'heli';
    else if (w.cruisers > haveCruiser && (haveCruiser <= haveSuv * 2 || w.suvs <= haveSuv)) role = 'cruiser';
    else if (w.suvs > haveSuv) role = 'suv';
    else if (w.cruisers > haveCruiser) role = 'cruiser';
    if (!role) return;
    const prefab = role === 'heli' ? PREFAB_HELI : role === 'suv' ? PREFAB_SUV : PREFAB_CRUISER;
    const u = this.spawnOne(role, prefab, i.player, tick);
    this.lastSpawn = tick;
    if (u) u.goal = i.lastKnown ? { x: i.lastKnown[0], z: i.lastKnown[2] } : { x: i.player.pos[0], z: i.player.pos[2] };
  }

  /** Units above the level's cap start to disperse (the most recent first). */
  private trim(i: StepInput): void {
    if (!i.active) return;
    const max = this.cfg.levels[i.level].maxUnits;
    let active = this.count(undefined, false);
    for (let k = this.units.length - 1; k >= 0 && active > max; k--) {
      const u = this.units[k] as UnitRec;
      if (u.mode === 'disperse' || u.mode === 'named') continue;
      this.startDisperse(u, i.tick);
      active--;
    }
  }

  private startDisperse(u: UnitRec, tick: number): void {
    u.mode = 'disperse';
    u.disperseSince = tick;
    u.goal = null;
    u.plan = [];
    u.planTick = -1e9;
    u.blockId = -1;
  }

  disperseAll(tick: number): void {
    for (const u of this.units) if (u.mode !== 'disperse') this.startDisperse(u, tick);
  }

  private updateSight(i: StepInput): boolean {
    const { tick, player } = i;
    const eye: Vec3 = [player.pos[0], player.pos[1] + 1.2, player.pos[2]];
    let budget = this.cfg.search.losChecksPerTick;
    const n = this.units.length;
    // heli: one dedicated ray per step through heliSees
    let seen = false;
    for (let k = 0; k < n; k++) {
      const u = this.units[(this.rayCursor + k) % n] as UnitRec;
      if (u.role === 'heli') continue;
      const v = this.host.unit(u.id);
      if (!v?.ready) continue;
      if (budget > 0) {
        const d = dist2(v.pos[0], v.pos[2], player.pos[0], player.pos[2]);
        if (d <= SIGHT_M) {
          u.sees = this.host.los([v.pos[0], v.pos[1] + 1.2, v.pos[2]], eye);
          this.raysLast++;
          budget--;
        } else u.sees = false;
        u.seesTick = tick;
      }
    }
    if (n > 0) this.rayCursor = (this.rayCursor + Math.max(1, Math.min(n, this.cfg.search.losChecksPerTick))) % n;
    for (const u of this.units) {
      if (u.role === 'heli') {
        const hp = this.heliPoses.get(u.id);
        if (hp && this.cfg.levels[i.level].tactics.includes('heliSpotlight')) {
          u.sees = heliSees(this.host, hp.pos, player);
          u.seesTick = tick;
          this.raysLast++;
        }
      }
      if (u.mode !== 'disperse' && u.sees && tick - u.seesTick <= SIGHT_VALID_TICKS) seen = true;
    }
    return seen;
  }

  private replan(i: StepInput): void {
    const n = this.units.length;
    if (n === 0) return;
    for (let k = 0; k < n; k++) {
      const u = this.units[(this.replanCursor + k) % n] as UnitRec;
      if (u.role === 'heli' || u.mode === 'roadblock') continue;
      if (u.mode === 'disperse' && !u.goal) {
        const v = this.host.unit(u.id);
        if (v?.ready) {
          const dx = v.pos[0] - i.player.pos[0], dz = v.pos[2] - i.player.pos[2];
          const d = Math.max(1, dsqrt(dx * dx + dz * dz));
          u.goal = { x: v.pos[0] + (dx / d) * 500, z: v.pos[2] + (dz / d) * 500 };
        }
      } else if (u.mode === 'chase' || u.mode === 'named') {
        u.goal = i.lastKnown && !this.anySees() ? { x: i.lastKnown[0], z: i.lastKnown[2] } : { x: i.player.pos[0], z: i.player.pos[2] };
      }
      if (!u.goal || i.tick - u.planTick < REPLAN_TICKS) continue;
      const v = this.host.unit(u.id);
      if (!v?.ready) continue;
      this.buildPlan(u, v, i.tick);
      this.replanCursor = (this.replanCursor + k + 1) % n;
      return;
    }
  }

  private anySees(): boolean {
    return this.lastSeen;
  }

  // ---- props -----------------------------------------------------------------------------------------------------------------

  private manageProps(i: StepInput): void {
    const { tick, player } = i;
    const tactics = this.cfg.levels[i.level].tactics;
    // retire blocks
    for (let k = this.blocks.length - 1; k >= 0; k--) {
      const b = this.blocks[k] as BlockRec;
      const [fx, fz] = forwardOf(player.yaw);
      const passed = (b.spec.pos[0] - player.pos[0]) * fx + (b.spec.pos[2] - player.pos[2]) * fz < -30;
      if (passed || tick - b.born > BLOCK_LIFE_TICKS) this.removeBlock(k);
    }
    for (let k = this.strips.length - 1; k >= 0; k--) {
      const s = this.strips[k] as StripRec;
      if (tick - s.born > SPIKE_LIFE_TICKS) {
        this.host.removeProp(s.prop);
        this.strips.splice(k, 1);
      }
    }
    if (player.onFoot || player.speed < 8) return;

    const kinds: RoadblockKind[] = [];
    if (tactics.includes('roadblock2')) kinds.push('roadblock2');
    if (tactics.includes('roadblockHeavy')) kinds.push('roadblockHeavy');
    if (kinds.length > 0 && this.blocks.length === 0 && tick - this.lastBlock >= BLOCK_EVERY_TICKS) {
      const kind = kinds[this.blockSerial % kinds.length] as RoadblockKind;
      const free = this.freeUnits(2);
      if (free.length === 2) {
        const spec = planRoadblock(this.world, player, kind, i.hint);
        this.lastBlock = tick;
        if (spec) this.placeBlock(spec, free, tick);
      }
    }
    if (tactics.includes('spikes') && this.strips.length === 0 && tick - this.lastSpike >= SPIKE_EVERY_TICKS) {
      this.lastSpike = tick;
      const used = new Set<string>(this.strips.map((s) => s.spec.tag));
      const spec = planSpikes(this.world, player, i.hint, used);
      if (spec) {
        const prop = this.host.placeProp(PREFAB_SPIKES, spec.pos, spec.yaw, `pfb:${PREFAB_SPIKES}:s${this.propSerial++}` as StableKey);
        if (prop !== 0) this.strips.push({ spec, prop, born: tick, hits: new Set() });
      }
    }
  }

  /** The `n` chase units best placed to take a roadblock slot: ground units that exist, in id order, skipping the lead chaser. */
  private freeUnits(n: number): UnitRec[] {
    const out: UnitRec[] = [];
    let skipped = 0;
    for (const u of this.units) {
      if (u.mode !== 'chase' || u.role === 'heli') continue;
      const v = this.host.unit(u.id);
      if (!v?.ready) continue;
      if (skipped < 1) {
        skipped++;
        continue;
      }
      out.push(u);
      if (out.length === n) break;
    }
    return out;
  }

  private placeBlock(spec: BlockSpec, free: UnitRec[], tick: number): void {
    const id = this.blockSerial++;
    const props: number[] = [];
    for (const b of spec.barriers) {
      const p = this.host.placeProp(PREFAB_BARRIER, b.pos, b.yaw, `pfb:${PREFAB_BARRIER}:b${id}:${props.length}` as StableKey);
      if (p !== 0) props.push(p);
    }
    free.forEach((u, slot) => {
      u.mode = 'roadblock';
      u.blockId = id;
      u.blockSlot = slot;
      u.tactic = spec.kind;
    });
    this.blocks.push({ id, spec, props, born: tick });
  }

  private removeBlock(k: number): void {
    const b = this.blocks[k] as BlockRec;
    for (const p of b.props) this.host.removeProp(p);
    for (const u of this.units) {
      if (u.blockId === b.id && u.mode === 'roadblock') {
        u.mode = 'chase';
        u.blockId = -1;
        u.tactic = 'follow';
        u.planTick = -1e9;
      }
    }
    this.blocks.splice(k, 1);
  }

  private dropProps(): void {
    for (let k = this.blocks.length - 1; k >= 0; k--) this.removeBlock(k);
    for (const s of this.strips) this.host.removeProp(s.prop);
    this.strips.length = 0;
  }

  /** Marks the tires of non-police vehicles that roll over a strip. */
  private checkStrips(i: StepInput): void {
    for (const s of this.strips) {
      for (const v of this.host.vehiclesNear(s.spec.pos[0], s.spec.pos[2], 25)) {
        if (v.police) continue;
        for (const k of crossedTires(s.spec, v)) {
          const tag = `${v.id}:${k}`;
          if (s.hits.has(tag)) continue;
          s.hits.add(tag);
          this.damage.setTireHealth(v.id, k as 0 | 1 | 2 | 3, 0);
          this.punctures++;
          this.host.emit({ t: 'pursuit.spikes', tick: i.tick, a: v.id, n: k });
        }
      }
    }
  }

  get activeBlocks(): readonly BlockSpec[] {
    return this.blocks.map((b) => b.spec);
  }

  get activeStrips(): readonly StripSpec[] {
    return this.strips.map((s) => s.spec);
  }

  // ---- tactics ---------------------------------------------------------------------------------------------------------------

  private assignTactics(i: StepInput): void {
    const tactics = this.cfg.levels[i.level].tactics;
    const has = (t: Tactic): boolean => tactics.includes(t);
    let cruiserRank = 0;
    let boxCount = 0;
    for (const u of this.units) {
      if (u.mode !== 'chase' && u.mode !== 'named') continue;
      if (u.role === 'heli') {
        u.tactic = 'heliSpotlight';
        continue;
      }
      const v = this.host.unit(u.id);
      const d = v ? dist2(v.pos[0], v.pos[2], i.player.pos[0], i.player.pos[2]) : 1e9;
      let t: Tactic = 'follow';
      if (u.role === 'suv' && has('suvRam') && !i.player.onFoot) t = 'suvRam';
      else if (u.role === 'cruiser' || u.role === 'named') {
        const r = cruiserRank++;
        if (r === 1 && has('pit') && pitAllowed(i.player) && d < 90) t = 'pit';
        else if (r === 2 && has('rollingBlock') && !i.player.onFoot && i.player.speed > 6 && d < 140) t = 'rollingBlock';
        else if (r >= 3 && r <= 5 && has('boxIn') && !i.player.onFoot && i.player.speed < 24 && d < 90 && boxCount < 3) {
          t = 'boxIn';
          u.boxSlot = boxCount++;
        }
      }
      if (t === 'boxIn' && u.tactic !== 'boxIn') u.boxSince = -1;
      u.tactic = t;
    }
  }

  private driveAll(i: StepInput): void {
    for (const u of this.units) {
      if (u.role === 'heli') {
        this.flyHeli(u, i);
        continue;
      }
      const v = this.host.unit(u.id);
      if (!v?.ready) continue;
      // stuck bookkeeping
      if (Math.abs(v.speed) < 0.6 && u.mode !== 'roadblock') u.stuck += i.dt;
      else u.stuck = 0;
      const out = this.input;
      out.throttle = 0; out.brake = 0; out.steer = 0; out.handbrake = false;
      if (u.mode === 'roadblock') {
        this.driveBlockUnit(u, v, out);
      } else if (u.mode === 'disperse') {
        const t = this.planTarget(u, v, 16);
        if (t) driveToward(v, t, out);
        else hold(out);
      } else {
        const t = this.chaseTarget(u, v, i);
        if (t) driveToward(v, t, out);
        else hold(out);
      }
      // a siren unit keeps its flashers on (render state only); nothing to write here
      this.host.drive(u.id, out);
    }
  }

  private chaseTarget(u: UnitRec, v: UnitView, i: StepInput): SteerTarget | null {
    const p = i.player;
    const d = dist2(v.pos[0], v.pos[2], p.pos[0], p.pos[2]);
    const near = d < 70 && (u.sees || d < 25);
    if (near) {
      switch (u.tactic) {
        case 'pit': return pitTarget(v, p);
        case 'suvRam': return suvRamTarget(v, p);
        case 'rollingBlock': return rollingBlockTarget(v, p);
        case 'boxIn': {
          if (u.boxSince < 0 && boxHeld(v, p, u.boxSlot)) u.boxSince = i.tick;
          return boxInTarget(v, p, u.boxSlot, u.boxSince < 0 ? 0 : i.tick - u.boxSince);
        }
        default: break;
      }
    }
    if (d < 45 && u.sees) {
      return { x: p.pos[0], z: p.pos[2], speed: followSpeed(v, p) };
    }
    const cruise = clamp(i.player.onFoot ? 22 : Math.max(24, p.speed + 8), 14, UNIT_MAX_SPEED);
    const t = this.planTarget(u, v, cruise);
    if (t) return t;
    // no plan: head for the goal in a straight line
    return u.goal ? { x: u.goal.x, z: u.goal.z, speed: 18 } : null;
  }

  private driveBlockUnit(u: UnitRec, v: UnitView, out: DriveInput): void {
    const b = this.blocks.find((x) => x.id === u.blockId);
    if (!b) return;
    const slot = b.spec.unitSlots[u.blockSlot % b.spec.unitSlots.length];
    if (!slot) return;
    const d = dist2(v.pos[0], v.pos[2], slot.pos[0], slot.pos[2]);
    if (d < 3.5) {
      hold(out);
      return;
    }
    driveToward(v, { x: slot.pos[0], z: slot.pos[2], speed: 22, arrive: true }, out);
  }

  private flyHeli(u: UnitRec, i: StepInput): void {
    const cur = this.heliPoses.get(u.id);
    if (!cur) return;
    const centre: Vec3 = u.mode === 'disperse' || !i.active
      ? [cur.pos[0] + (cur.pos[0] - i.player.pos[0]), 0, cur.pos[2] + (cur.pos[2] - i.player.pos[2])]
      : !this.lastSeen && i.lastKnown ? i.lastKnown : i.player.pos;
    const g = this.host.groundY(centre[0], centre[2]) ?? i.player.pos[1];
    const target = heliOrbit(i.tick, centre, g);
    const next = heliStep(cur, target, centre, i.dt);
    this.heliPoses.set(u.id, next);
    this.host.fly(u.id, next.pos, next.yaw);
  }

  // ---- removal ---------------------------------------------------------------------------------------------------------------

  private collect(i: StepInput): void {
    for (let k = this.units.length - 1; k >= 0; k--) {
      const u = this.units[k] as UnitRec;
      const v = this.host.unit(u.id);
      if (!v) {
        // the entity went away under us (a QA despawn): forget the unit
        this.forget(k);
        continue;
      }
      if (!v.ready) continue;
      const d = dist2(v.pos[0], v.pos[2], i.player.pos[0], i.player.pos[2]);
      const seen = u.sees && i.tick - u.seesTick <= SIGHT_VALID_TICKS;
      let gone = false;
      if (u.mode === 'disperse') {
        gone = (d > i.despawnRadius && !seen) || i.tick - u.disperseSince > DISPERSE_MAX_TICKS && !seen;
      } else if (u.stuck > STUCK_TICKS && !seen && d > MIN_SPAWN_M * 0.5) {
        gone = true;
      }
      if (gone) {
        this.host.despawnUnit(u.id);
        this.forget(k);
      }
    }
  }

  private forget(k: number): void {
    const u = this.units[k] as UnitRec;
    this.heliPoses.delete(u.id);
    this.units.splice(k, 1);
  }

  /** Removes every unit and prop at once (a busted or scripted reset). */
  removeAll(): void {
    this.dropProps();
    for (const u of this.units) this.host.despawnUnit(u.id);
    this.units.length = 0;
    this.heliPoses.clear();
  }

  hash(h: Fnv64): void {
    h.u32(this.serial).u32(this.blockSerial).u32(this.propSerial).f64(this.lastSpawn).f64(this.lastBlock).f64(this.lastSpike).u32(this.rayCursor).u32(this.replanCursor);
    h.u32(this.units.length);
    for (const u of this.units) {
      h.u32(u.id).str(u.key).str(u.prefab).u8(u.mode === 'chase' ? 0 : u.mode === 'roadblock' ? 1 : u.mode === 'disperse' ? 2 : 3).u8(KIND_OF[u.tactic]);
      h.f64(u.born).f64(u.planTick).u32(u.planIdx).u32(u.plan.length).u32(u.blockId >>> 0).u8(u.blockSlot).u8(u.boxSlot).f64(u.boxSince).u8(u.sees ? 1 : 0).f64(u.seesTick).u32(u.stuck).f64(u.disperseSince);
    }
    h.u32(this.blocks.length);
    for (const b of this.blocks) h.u32(b.id).u32(b.props.length).f64(b.born);
    h.u32(this.strips.length);
    for (const s of this.strips) h.str(s.spec.tag).u32(s.prop).f64(s.born).u32(s.hits.size);
    for (const [id, p] of [...this.heliPoses.entries()].sort((a, b) => a[0] - b[0])) h.u32(id).f64(p.pos[0]).f64(p.pos[1]).f64(p.pos[2]).f64(p.yaw);
  }
}
