/**
 * The engine side of ambient traffic (M03b1): binds `TrafficSim` to the ECS, Rapier and the vehicle module.
 *
 *  - One system in `SimStage.AI` runs the brain every second tick (30 Hz, `AI_DIVISOR 2`); on the ticks between it moves every agent
 *    on along its heading so the snapshot is smooth. It is the only writer of the traffic components (C01: writes only in AI and Rules).
 *  - Each agent is an entity keyed `amb:<cell>:<slot>` with `Transform`, `RenderKey` (the archetype's gray-box asset), `Anim` (lights,
 *    speed, colour for the instanced renderer), `Ambient` and `TrafficAgent` (or `ParkedCar`); robotaxis add `RobotaxiBrain`, `Robotaxi`
 *    and `WorldWitness`. The publisher marks `Ambient` entities `SNAP_FLAG_INSTANCED`, so the object pool leaves them to the traffic renderer.
 *  - Near agents (within 80 m, the tier's cap, nearest first) get a kinematic box body; `PhysicsPre` moves it from `Transform`.
 *  - A near agent hit by a vehicle at 3 m/s or more becomes the real vehicle prefab (M03a1) with the exchange of momentum, rolls free for 8 s
 *    and is then a wreck that holds its handbrake and is removed after 10 s out of sight.
 *
 * Sim code; C02 lint applies.
 */
import {
  NULL_HANDLE, SimStage, dcos, dsin, dsqrt, type EntityHandle, type EntityId, type SimConfig, type StableKey, type SystemDef,
} from '@dv/shared';
import {
  Ambient, Anim, BodyRef, CharacterBody, GROUPS, GROUP_BIT, LocalPlayer, RenderKey, Robotaxi, Transform, Vehicle, Velocity, playerSide,
  type EcsWorld, type EngineServices, type SimResource, type VehiclePhysics,
} from '@dv/engine/sim';
import type { ByteReader, ByteWriter } from '@dv/engine/sim';
import type { WorldServices } from '../api/world-api.ts';
import { type Agent, hashAgents, loadAgents, saveAgents } from './agent.ts';
import {
  ARCHETYPES, AgentKind, AgentState, ParkedCar, RobotaxiBrain, TrafficAgent, WorldWitness, type Archetype,
} from './components.ts';
import { NEAR_CAP, NEAR_RADIUS_M, densityTier } from './density.ts';
import type { Mover } from './promote.ts';
import type { Obstacle, Siren } from './reactions.ts';
import { AI_DT, TrafficSim, type TrafficFocus } from './sim.ts';
import { WitnessBoard, INFRACTION_CODE, kindOfCode } from './witness.ts';
import { trafficWorldOf, type TrafficChunkSource } from './world.ts';

export const TRAFFIC_BRAIN_ID = 'world.traffic.brain';
export const TRAFFIC_RESOURCE_ID = 'world.traffic.agents';

/** Default half extents of a vehicle the traffic did not create (the player's car), metres. */
const MOVER_HALF_W = 0.95;
const MOVER_HALF_L = 2.4;
const MOVER_MASS = 1500;
/** Everything this far from the focus is not looked at when the obstacle list is built. */
const OBSTACLE_RANGE_M = 120;

export interface AmbientDeps {
  ecs: EcsWorld;
  backend: VehiclePhysics;
  services: EngineServices;
  world: WorldServices;
  store: TrafficChunkSource;
  cfg: SimConfig;
  /** `WorldIndex.worldSeed`. */
  seed: number;
  /** Options for the brain (tests and the QA scenarios turn the initial fill or the parked cars off). */
  initialFill?: boolean;
  parked?: boolean;
}

interface Wreck {
  handle: EntityHandle;
  unseen: number;
}

interface Kick {
  handle: EntityHandle;
  vx: number;
  vz: number;
}

/** The prefab id the traffic uses for an archetype and kind. */
export const ambientPrefab = (arch: number, parked: boolean): string => `amb.${parked ? 'parked.' : ''}${(ARCHETYPES[arch] as Archetype).prefab}`;

export class AmbientTraffic {
  readonly sim: TrafficSim;
  readonly board: WitnessBoard;
  /** QA: the traffic follows this point instead of the player (the perf routes move the camera, not the player). */
  focusOverride: TrafficFocus | null = null;
  /** The sirens in range of the traffic this tick (the pursuit director sets it, M03c); none when absent. */
  sirenSource: (() => readonly Siren[]) | null = null;
  /** `world.witness` events emitted. */
  witnessEvents = 0;
  private readonly ecs: EcsWorld;
  private readonly deps: AmbientDeps;
  private readonly tier;
  private readonly kicks: Kick[] = [];
  private readonly vehicles = new Map<string, EntityHandle>();
  private readonly wrecks: Wreck[] = [];
  private readonly obstacles: Obstacle[] = [];
  private readonly movers: Mover[] = [];
  private lastVel = new Map<number, [number, number]>();
  private tick = 0;
  /** The report for the QA bridge. */
  last = { agents: 0, near: 0, promoted: 0, parked: 0 };

  constructor(deps: AmbientDeps) {
    this.deps = deps;
    this.ecs = deps.ecs;
    this.tier = densityTier(deps.cfg.profile, deps.cfg.tier);
    this.board = new WitnessBoard();
    this.definePrefabs();
    const w = deps.world;
    this.sim = new TrafficSim({
      world: trafficWorldOf(w, deps.store),
      seed: deps.seed,
      tier: this.tier,
      board: this.board,
      ...(deps.initialFill !== undefined ? { initialFill: deps.initialFill } : {}),
      ...(deps.parked !== undefined ? { parked: deps.parked } : {}),
      hooks: {
        spawned: (a) => this.onSpawned(a),
        despawned: (a, why) => this.onDespawned(a, why),
        promoted: (a, vx, vz) => this.onPromoted(a, vx, vz),
        wrecked: (key) => this.onWrecked(key),
        los: (ax, ay, az, bx, by, bz) => this.clear(ax, ay, az, bx, by, bz),
      },
    });
    this.board.onWitness((e) => {
      this.witnessEvents++;
      deps.services.events.push({ t: 'world.witness', tick: this.tick, s: e.kind, n: e.reportAtTick });
    });
  }

  // ---- prefabs and entities ----------------------------------------------------------------------------------------------

  private definePrefabs(): void {
    const ecs = this.ecs;
    for (const arch of ARCHETYPES) {
      const base = [
        { def: Transform, init: { qw: 1 } },
        { def: RenderKey, init: { asset: ecs.strings.intern(arch.asset), visible: 1 } },
        { def: Anim },
        { def: Ambient },
      ];
      const robo = arch.prefab === 'robotaxi.default' ? [{ def: RobotaxiBrain }, { def: Robotaxi }, { def: WorldWitness }] : [];
      ecs.definePrefab({ id: ambientPrefab(arch.id, false), components: [...base, { def: TrafficAgent }, ...robo] });
      ecs.definePrefab({ id: ambientPrefab(arch.id, true), components: [...base, { def: ParkedCar }] });
    }
  }

  private onSpawned(a: Agent): void {
    // the entity is made by `ensureEntity` on the next sync: a despawn of the same key may still be pending in this stage
    void a;
  }

  private ensureEntity(a: Agent): void {
    if (a.handle !== 0) return;
    const ecs = this.ecs;
    if (ecs.byKey(a.key as StableKey) !== NULL_HANDLE) return;
    const init: Record<string, number> = {
      'Transform.px': a.x, 'Transform.py': a.y + (ARCHETYPES[a.arch] as Archetype).lift, 'Transform.pz': a.z,
      'Transform.qy': dsin(a.yaw / 2), 'Transform.qw': dcos(a.yaw / 2),
      'Anim.state': a.lights, 'Anim.p0': a.speed, 'Anim.p1': a.color,
      'Ambient.cell': ecs.strings.intern(a.cell), 'Ambient.slot': a.slot, 'Ambient.spawnTick': a.spawnTick,
    };
    if (a.isParked) {
      init['ParkedCar.seg'] = a.seg;
      init['ParkedCar.s'] = a.s;
      init['ParkedCar.side'] = a.side;
      init['ParkedCar.locked'] = a.locked;
    } else {
      init['TrafficAgent.edge'] = a.edge;
      init['TrafficAgent.s'] = a.s;
      init['TrafficAgent.lane'] = a.lane;
      init['TrafficAgent.speed'] = a.speed;
      init['TrafficAgent.nextEdge'] = a.nextEdge;
      init['TrafficAgent.turn'] = a.turn;
      init['TrafficAgent.state'] = a.state;
    }
    a.handle = ecs.commands.spawn(ambientPrefab(a.arch, a.isParked), init, a.key as StableKey) as unknown as number;
  }

  private onDespawned(a: Agent, _why: string): void {
    if (a.body !== 0) {
      this.deps.backend.removeBody(a.body);
      a.body = 0;
    }
    if (a.handle !== 0) {
      this.ecs.commands.despawn(H(a.handle));
      a.handle = 0;
    }
  }

  // ---- promotion ---------------------------------------------------------------------------------------------------------

  private onPromoted(a: Agent, vx: number, vz: number): void {
    const ctx = this.deps.services.vehicleCtx;
    const arch = ARCHETYPES[a.arch] as Archetype;
    this.onDespawned(a, 'promoted');
    if (!ctx) return;
    const key = `veh:amb.${a.cell}.${a.slot}.${a.epoch}`;
    try {
      const handle = ctx.prefabs.spawn(arch.prefab, { pos: [a.x, a.y, a.z], yaw: a.yaw }, key as StableKey);
      this.vehicles.set(a.key, handle);
      this.kicks.push({ handle, vx, vz });
    } catch {
      // a vehicle with that key still stands (a wreck of the same epoch): the agent just disappears
    }
  }

  /** The tick after the vehicle exists: give it the velocity of the hit and let it roll free. */
  private applyKicks(): void {
    const ctx = this.deps.services.vehicleCtx;
    if (!ctx || this.kicks.length === 0) return;
    const bodies = this.ecs.store(BodyRef).body;
    for (const k of this.kicks) {
      const id = this.ecs.resolve(k.handle);
      if (id === null) continue;
      const body = bodies[id] as number;
      if (body === 0) continue;
      const handling = this.ecs.strings.get(this.ecs.store(Vehicle).handling[id] as number);
      const rt = ctx.store.ensure(id, handling);
      rt.external = true;
      rt.input.throttle = 0;
      rt.input.brake = 0;
      rt.input.steer = 0;
      rt.input.handbrake = false;
      ctx.backend.setBodyVelocity(body, [k.vx, 0, k.vz], [0, 0, 0]);
    }
    this.kicks.length = 0;
  }

  private onWrecked(key: string): void {
    const h = this.vehicles.get(key);
    this.vehicles.delete(key);
    const ctx = this.deps.services.vehicleCtx;
    if (h === undefined || !ctx) return;
    const id = this.ecs.resolve(h);
    if (id === null) return;
    const rt = ctx.store.rt.get(id);
    if (rt) {
      rt.external = false;
      rt.input.throttle = 0;
      rt.input.brake = 0;
      rt.input.steer = 0;
      rt.input.handbrake = true;
    }
    this.wrecks.push({ handle: h, unseen: 0 });
  }

  private sweepWrecks(focus: TrafficFocus): void {
    const ctx = this.deps.services.vehicleCtx;
    if (!ctx || this.wrecks.length === 0) return;
    const tr = this.ecs.store(Transform);
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i] as Wreck;
      const id = this.ecs.resolve(w.handle);
      if (id === null) {
        this.wrecks.splice(i, 1);
        continue;
      }
      const dx = (tr.px[id] as number) - focus.x, dz = (tr.pz[id] as number) - focus.z;
      const near = dx * dx + dz * dz <= NEAR_RADIUS_M * NEAR_RADIUS_M;
      w.unseen = near ? 0 : w.unseen + 2;
      if (w.unseen >= 600) {
        ctx.prefabs.despawn(w.handle);
        this.wrecks.splice(i, 1);
      }
    }
  }

  // ---- the system --------------------------------------------------------------------------------------------------------

  private clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = dsqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.5) return true;
    const hit = this.deps.backend.castRay([ax, ay, az], [dx / d, dy / d, dz / d], d - 0.4, GROUP_BIT.static);
    return hit === null;
  }

  system(): SystemDef {
    return {
      id: TRAFFIC_BRAIN_ID,
      owner: 'S02',
      stage: SimStage.AI,
      order: 100,
      run: (ctx) => this.run(ctx.tick),
    };
  }

  private focus(): TrafficFocus {
    if (this.focusOverride) return this.focusOverride;
    const pl = playerSide(this.ecs);
    if (pl) return { x: pl.pos[0], z: pl.pos[2], vx: pl.vel[0], vz: pl.vel[2] };
    const sp = this.deps.world.play;
    return { x: (sp.minX + sp.maxX) / 2, z: (sp.minZ + sp.maxZ) / 2, vx: 0, vz: 0 };
  }

  private run(tick: number): void {
    this.tick = tick;
    if ((tick & 1) !== 0) {
      this.between();
      return;
    }
    const clock = this.deps.services.clock;
    const env = clock ? clock.env() : { hour: 12, weather: 'clear' as const };
    const focus = this.focus();
    this.applyKicks();
    this.gather(focus);
    this.sim.step({ tick, focus, env: { hour: env.hour, weather: env.weather }, obstacles: this.obstacles, movers: this.movers, sirens: this.sirenSource ? this.sirenSource() : NO_SIRENS });
    this.sync(focus);
    this.sweepWrecks(focus);
  }

  /** Obstacles and movers: the vehicles and the player on foot near the focus that are not part of the traffic. */
  private gather(focus: TrafficFocus): void {
    const ecs = this.ecs;
    this.obstacles.length = 0;
    this.movers.length = 0;
    const tr = ecs.store(Transform);
    const ve = ecs.store(Velocity);
    const ids = ecs.query([Vehicle, Transform]);
    const hasVel = (id: number): boolean => ecs.hasId(id, Velocity);
    const seen = new Map<number, [number, number]>();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const x = tr.px[id] as number, z = tr.pz[id] as number;
      const dx = x - focus.x, dz = z - focus.z;
      if (dx * dx + dz * dz > OBSTACLE_RANGE_M * OBSTACLE_RANGE_M) continue;
      const qx = tr.qx[id] as number, qy = tr.qy[id] as number, qz = tr.qz[id] as number, qw = tr.qw[id] as number;
      const hx = -2 * (qx * qz + qw * qy);
      const hz = -(1 - 2 * (qx * qx + qy * qy));
      const vx = hasVel(id) ? (ve.vx[id] as number) : 0;
      const vz = hasVel(id) ? (ve.vz[id] as number) : 0;
      // the speed before a contact: the hit is judged on the faster of this step's and the last step's velocity
      const prev = this.lastVel.get(id);
      let mvx = vx, mvz = vz;
      if (prev && prev[0] * prev[0] + prev[1] * prev[1] > vx * vx + vz * vz) {
        mvx = prev[0];
        mvz = prev[1];
      }
      seen.set(id, [vx, vz]);
      const key = ecs.keyOf(ecs.handle(id as unknown as EntityId)) ?? `e${id}`;
      this.obstacles.push({ id: key, kind: 'vehicle', x, z, vx, vz, halfW: MOVER_HALF_W, halfL: MOVER_HALF_L });
      this.movers.push({ id: key, x, z, vx: mvx, vz: mvz, hx, hz, halfW: MOVER_HALF_W, halfL: MOVER_HALF_L, massKg: MOVER_MASS });
    }
    this.lastVel = seen;
    const pids = ecs.query([LocalPlayer, Transform]);
    for (let i = 0; i < pids.length; i++) {
      const id = pids[i] as number;
      if (ecs.hasId(id, Vehicle) || !ecs.hasId(id, CharacterBody)) continue;
      const x = tr.px[id] as number, z = tr.pz[id] as number;
      this.obstacles.push({
        id: 'player', kind: 'player', x, z, vx: hasVel(id) ? (ve.vx[id] as number) : 0, vz: hasVel(id) ? (ve.vz[id] as number) : 0, halfW: 0.35, halfL: 0.35,
      });
    }
  }

  /** Writes the agents into the ECS and keeps the near agents' bodies. */
  private sync(focus: TrafficFocus): void {
    const ecs = this.ecs;
    const list = this.sim.agents.list();
    const tr = ecs.store(Transform);
    const an = ecs.store(Anim);
    const ta = ecs.store(TrafficAgent);
    const pc = ecs.store(ParkedCar);
    const rb = ecs.store(RobotaxiBrain);
    const ww = ecs.store(WorldWitness);
    const rk = ecs.store(RenderKey);
    let near = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Agent;
      this.ensureEntity(a);
      if (a.handle === 0) continue;
      const id = ecs.resolve(H(a.handle));
      if (id === null || !ecs.hasId(id, Transform)) continue;
      tr.px[id] = a.x;
      tr.py[id] = a.y + (ARCHETYPES[a.arch] as Archetype).lift;
      tr.pz[id] = a.z;
      tr.qx[id] = 0;
      tr.qy[id] = dsin(a.yaw / 2);
      tr.qz[id] = 0;
      tr.qw[id] = dcos(a.yaw / 2);
      an.state[id] = a.lights;
      an.p0[id] = a.speed;
      an.p1[id] = a.color;
      rk.variant[id] = a.color;
      if (a.isParked) {
        pc.seg[id] = a.seg;
        pc.s[id] = a.s;
        pc.side[id] = a.side;
        pc.locked[id] = a.locked;
      } else {
        ta.edge[id] = a.edge;
        ta.s[id] = a.s;
        ta.lane[id] = a.lane;
        ta.speed[id] = a.speed;
        ta.nextEdge[id] = a.nextEdge;
        ta.turn[id] = a.turn;
        ta.state[id] = a.state;
        if (a.isRobotaxi && ecs.hasId(id, RobotaxiBrain)) {
          rb.mode[id] = a.state === AgentState.Stalled ? 1 : a.stallPending ? 2 : 0;
          rb.holdUntil[id] = a.state === AgentState.Stalled ? a.holdUntil : 0;
          rb.fare[id] = a.fare;
          ww.target[id] = a.witnessId !== 0 ? ecs.strings.intern(a.witnessTarget) : 0;
          ww.reportAtTick[id] = a.witnessId !== 0 ? a.reportAt : 0;
          ww.kind[id] = a.witnessId !== 0 ? a.witnessKind : 0;
        }
      }
      if (a.near) near++;
    }
    this.bodies(list, focus);
    this.last = { agents: list.length, near, promoted: this.sim.promotions.count, parked: list.filter((a) => a.isParked).length };
  }

  /** Kinematic boxes for the nearest agents within 80 m, up to the tier's cap; the rest lose theirs. */
  private bodies(list: readonly Agent[], focus: TrafficFocus): void {
    const ecs = this.ecs;
    const cap = NEAR_CAP[this.tier];
    const cand: { a: Agent; d: number }[] = [];
    for (const a of list) {
      if (!a.near || a.handle === 0) continue;
      const dx = a.x - focus.x, dz = a.z - focus.z;
      cand.push({ a, d: dx * dx + dz * dz });
    }
    cand.sort((p, q) => (p.d !== q.d ? p.d - q.d : p.a.key < q.a.key ? -1 : p.a.key > q.a.key ? 1 : 0));
    const keep = new Set<Agent>();
    for (let i = 0; i < cand.length && i < cap; i++) keep.add((cand[i] as (typeof cand)[number]).a);
    for (const a of list) {
      if (a.body !== 0 && !keep.has(a)) {
        this.deps.backend.removeBody(a.body);
        a.body = 0;
        if (ecs.resolve(H(a.handle)) !== null) ecs.commands.remove(H(a.handle), BodyRef);
      }
    }
    for (const a of keep) {
      if (a.body !== 0 || ecs.resolve(H(a.handle)) === null || !ecs.has(H(a.handle), Transform)) continue;
      const arch = ARCHETYPES[a.arch] as Archetype;
      const half = a.yaw / 2;
      a.body = this.deps.backend.createBody({
        kind: 'kinematic',
        shape: 'box',
        dims: [arch.halfWidth, arch.halfHeight, arch.halfLength],
        at: [a.x, a.y + arch.lift, a.z],
        rot: [0, dsin(half), 0, dcos(half)],
        groups: GROUPS.vehicle,
      });
      ecs.commands.add(H(a.handle), BodyRef, { body: a.body });
    }
  }

  /** The ticks between two brain steps: every moving agent goes on along its heading so the snapshot does not stutter. */
  private between(): void {
    const ecs = this.ecs;
    const tr = ecs.store(Transform);
    const dt = AI_DT / 2;
    for (const a of this.sim.agents.list()) {
      if (a.isParked || a.handle === 0 || a.speed < 0.05) continue;
      const id = ecs.resolve(H(a.handle));
      if (id === null || !ecs.hasId(id, Transform)) continue;
      tr.px[id] = a.x + a.fx * a.speed * dt;
      tr.pz[id] = a.z + a.fz * a.speed * dt;
    }
  }

  // ---- state -------------------------------------------------------------------------------------------------------------

  resource(): SimResource {
    const sim = this.sim;
    return {
      name: TRAFFIC_RESOURCE_ID,
      hash: (h) => {
        hashAgents(h, sim.agents.list());
        const keys = [...sim.epochs.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
        h.u32(keys.length);
        for (const k of keys) h.str(k).u32(sim.epochs.get(k) as number);
        const pr = sim.promotions.entries();
        h.u32(pr.length);
        for (const p of pr) h.str(p.key).u32(p.tick);
        h.u8(sim.fill ? 1 : 0).u32(sim.cursorValue());
        const inf = this.board.pending();
        h.u32(inf.length);
        for (const i of inf) h.u32(i.id).u32(INFRACTION_CODE[i.kind]).f64(i.x).f64(i.z).u32(i.tick).u8(i.reported ? 1 : 0);
      },
      save: (w: ByteWriter) => {
        saveAgents(w, sim.agents.list());
        const keys = [...sim.epochs.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
        w.u32(keys.length);
        for (const k of keys) {
          w.str(k);
          w.u32(sim.epochs.get(k) as number);
        }
        const pr = sim.promotions.entries();
        w.u32(pr.length);
        for (const p of pr) {
          w.str(p.key);
          w.u32(p.tick);
        }
        w.u8(sim.fill ? 1 : 0);
        w.u32(sim.cursorValue());
      },
      load: (r: ByteReader) => {
        loadAgents(r, sim.agents);
        sim.epochs.clear();
        for (let n = r.u32(); n > 0; n--) sim.epochs.set(r.str(), r.u32());
        const pr: { key: string; tick: number }[] = [];
        for (let n = r.u32(); n > 0; n--) pr.push({ key: r.str(), tick: r.u32() });
        sim.promotions.load(pr);
        sim.fill = r.u8() !== 0;
        sim.setCursor(r.u32());
        this.board.clear();
      },
    };
  }

  /** Ids for the debug report. */
  describe(): Record<string, unknown> {
    const s = this.sim.stats;
    return { ...this.last, tier: this.tier, spawns: s.spawns, despawns: s.despawns, promotions: s.promotions, honks: s.honks, stalls: s.stalls, raysMax: s.raysMax, witness: this.witnessEvents, kind: AgentKind };
  }

  /** The world witness kind of a component byte (for the bridge). */
  static kindName(code: number): string | undefined {
    return kindOfCode(code);
  }
}

const NO_SIRENS: readonly Siren[] = [];

const H = (n: number): EntityHandle => n as unknown as EntityHandle;
