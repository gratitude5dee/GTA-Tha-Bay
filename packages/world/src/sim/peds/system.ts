/**
 * The engine side of ambient pedestrians (M03b2): binds `PedSim` to the ECS.
 *
 *  - One system in `SimStage.AI` (order 110, after the traffic brain) runs the brain every second tick (30 Hz); on the ticks between
 *    it moves every walking pedestrian on along its heading. It is the only writer of the ped components (C01: writes only in AI and Rules).
 *  - Each pedestrian is an entity keyed `amb:<cell>:<slot>` (slot 256 to 511) with `Transform`, `RenderKey` (the body's gray-box asset),
 *    `Anim` (engine anim state, speed, outfit for the instanced renderer), `Ambient` and `PedAgent`. The publisher marks `Ambient`
 *    entities `SNAP_FLAG_INSTANCED`, so the object pool leaves them to the ped renderer.
 *  - Pedestrians feed the traffic as `ped` obstacles (cars stop for them, robotaxis keep 3 m and stop at occupied crosswalks) and read
 *    the traffic's moving vehicles back.
 *
 * Sim code; C02 lint applies.
 */
import {
  NULL_HANDLE, SimStage, dcos, dsin, type EntityHandle, type StableKey, type SystemDef,
} from '@dv/shared';
import { Ambient, Anim, LocalPlayer, RenderKey, Transform, playerSide, type EcsWorld, type EngineServices, type SimResource } from '@dv/engine/sim';
import type { ByteReader, ByteWriter } from '@dv/engine/sim';
import type { WorldServices } from '../api/world-api.ts';
import type { AmbientTraffic } from '../traffic/system.ts';
import type { Obstacle } from '../traffic/reactions.ts';
import type { TrafficFocus } from '../traffic/sim.ts';
import { AI_DT } from '../traffic/sim.ts';
import { trafficWorldOf, type TrafficChunkSource } from '../traffic/world.ts';
import { densityTier } from '../traffic/density.ts';
import type { Ped } from './agent.ts';
import { hashPeds, loadPeds, savePeds } from './agent.ts';
import { PED_ASSETS, PedAgent, PedState } from './components.ts';
import type { PedVehicle } from './fsm.ts';
import { PedSim, pedObstacle } from './sim.ts';
import type { SimConfig } from '@dv/shared';

export const PED_BRAIN_ID = 'world.peds.brain';
export const PED_RESOURCE_ID = 'world.peds.agents';

/** Engine anim states (`anim-states.ts`) the ped states play. */
const ANIM = { idle: 0, walk: 1, run: 2, ragdoll: 12, emote: 21 } as const;

export interface AmbientPedDeps {
  ecs: EcsWorld;
  services: EngineServices;
  world: WorldServices;
  store: TrafficChunkSource;
  cfg: SimConfig;
  seed: number;
  /** The ambient traffic whose board the witnesses report to and whose vehicles the pedestrians watch. */
  traffic: AmbientTraffic;
  initialFill?: boolean;
}

export const pedPrefab = (body: number): string => `amb.ped.${String.fromCharCode(97 + body)}`;

/** The anim state a ped plays. */
export function animOf(p: Pick<Ped, 'state' | 'speed'>): number {
  switch (p.state) {
    case PedState.Walk:
      return p.speed > 0.05 ? ANIM.walk : ANIM.idle;
    case PedState.Dodge:
    case PedState.Flee:
      return ANIM.run;
    case PedState.Hit:
      return ANIM.ragdoll;
    case PedState.Record:
    case PedState.Cheer:
      return ANIM.emote;
    default:
      return ANIM.idle;
  }
}

export class AmbientPeds {
  readonly sim: PedSim;
  private readonly ecs: EcsWorld;
  private readonly deps: AmbientPedDeps;
  private readonly vehicles: PedVehicle[] = [];
  private readonly vpool: PedVehicle[] = [];
  /** QA: an XR head pose the pedestrians keep 0.6 m clear of (null: the player's own position). */
  headOverride: { x: number; z: number } | null = null;
  last = { peds: 0, near: 0 };

  constructor(deps: AmbientPedDeps) {
    this.deps = deps;
    this.ecs = deps.ecs;
    const tier = densityTier(deps.cfg.profile, deps.cfg.tier);
    this.definePrefabs();
    this.sim = new PedSim({
      world: trafficWorldOf(deps.world, deps.store),
      seed: deps.seed,
      tier,
      board: deps.traffic.board,
      ...(deps.initialFill !== undefined ? { initialFill: deps.initialFill } : {}),
      hooks: {
        despawned: (p) => this.onDespawned(p),
      },
    });
    deps.traffic.extraObstacles = (out, focus) => this.obstaclesInto(out, focus);
  }

  private definePrefabs(): void {
    const ecs = this.ecs;
    for (let b = 0; b < PED_ASSETS.length; b++) {
      ecs.definePrefab({
        id: pedPrefab(b),
        components: [
          { def: Transform, init: { qw: 1 } },
          { def: RenderKey, init: { asset: ecs.strings.intern(PED_ASSETS[b] as string), visible: 1 } },
          { def: Anim },
          { def: Ambient },
          { def: PedAgent },
        ],
      });
    }
  }

  private ensureEntity(p: Ped): void {
    if (p.handle !== 0) return;
    const ecs = this.ecs;
    if (ecs.byKey(p.key as StableKey) !== NULL_HANDLE) return;
    const init: Record<string, number> = {
      'Transform.px': p.x, 'Transform.py': p.y, 'Transform.pz': p.z,
      'Transform.qy': dsin(p.yaw / 2), 'Transform.qw': dcos(p.yaw / 2),
      'Anim.state': animOf(p), 'Anim.p0': p.speed, 'Anim.p1': p.outfit,
      'Ambient.cell': ecs.strings.intern(p.cell), 'Ambient.slot': p.slot, 'Ambient.spawnTick': p.spawnTick,
      'PedAgent.node': p.from, 'PedAgent.next': p.to, 'PedAgent.t': p.len > 0 ? p.s / p.len : 0, 'PedAgent.state': p.state, 'PedAgent.timer': p.timer,
    };
    p.handle = ecs.commands.spawn(pedPrefab(p.body), init, p.key as StableKey) as unknown as number;
  }

  private onDespawned(p: Ped): void {
    if (p.handle !== 0) {
      this.ecs.commands.despawn(H(p.handle));
      p.handle = 0;
    }
  }

  system(): SystemDef {
    return {
      id: PED_BRAIN_ID,
      owner: 'S02',
      stage: SimStage.AI,
      order: 110,
      run: (ctx) => this.run(ctx.tick),
    };
  }

  private focus(): TrafficFocus {
    const t = this.deps.traffic;
    if (t.focusOverride) return t.focusOverride;
    const pl = playerSide(this.ecs);
    if (pl) return { x: pl.pos[0], z: pl.pos[2], vx: pl.vel[0], vz: pl.vel[2] };
    const sp = this.deps.world.play;
    return { x: (sp.minX + sp.maxX) / 2, z: (sp.minZ + sp.maxZ) / 2, vx: 0, vz: 0 };
  }

  /** The head the pedestrians keep clear of: the QA override, else the player on foot. */
  private head(): { x: number; z: number } | null {
    if (this.headOverride) return this.headOverride;
    const ids = this.ecs.query([LocalPlayer, Transform]);
    if (ids.length === 0) return null;
    const tr = this.ecs.store(Transform);
    const id = ids[0] as number;
    return { x: tr.px[id] as number, z: tr.pz[id] as number };
  }

  private run(tick: number): void {
    if ((tick & 1) !== 0) {
      this.between();
      return;
    }
    const clock = this.deps.services.clock;
    const env = clock ? clock.env() : { hour: 12, weather: 'clear' as const };
    const focus = this.focus();
    this.gatherVehicles(focus);
    this.sim.step({ tick, focus, env: { hour: env.hour, weather: env.weather }, vehicles: this.vehicles, head: this.head() });
    this.sync();
  }

  /** The moving vehicles near the focus: the traffic's cars and the vehicles it does not own (the player's). */
  private gatherVehicles(focus: TrafficFocus): void {
    this.vehicles.length = 0;
    let n = 0;
    const take = (): PedVehicle => {
      let v = this.vpool[n];
      if (!v) {
        v = { x: 0, z: 0, vx: 0, vz: 0, hx: 0, hz: -1, speed: 0, halfW: 0, halfL: 0 };
        this.vpool[n] = v;
      }
      n++;
      this.vehicles.push(v);
      return v;
    };
    const r2 = 80 * 80;
    this.deps.traffic.movingVehicles(focus, r2, (x, z, vx, vz, hx, hz, speed, halfW, halfL) => {
      const v = take();
      v.x = x;
      v.z = z;
      v.vx = vx;
      v.vz = vz;
      v.hx = hx;
      v.hz = hz;
      v.speed = speed;
      v.halfW = halfW;
      v.halfL = halfL;
    });
  }

  /** Obstacles for the traffic: every pedestrian within range. A pedestrian on a crosswalk blocks a wider patch. */
  obstaclesInto(out: Obstacle[], focus: TrafficFocus): void {
    const r2 = 120 * 120;
    for (const p of this.sim.peds.list()) {
      const dx = p.x - focus.x, dz = p.z - focus.z;
      if (dx * dx + dz * dz > r2) continue;
      out.push(pedObstacle(p));
    }
  }

  private sync(): void {
    const ecs = this.ecs;
    const list = this.sim.peds.list();
    const tr = ecs.store(Transform);
    const an = ecs.store(Anim);
    const pa = ecs.store(PedAgent);
    const rk = ecs.store(RenderKey);
    let near = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Ped;
      this.ensureEntity(p);
      if (p.handle === 0) continue;
      const id = ecs.resolve(H(p.handle));
      if (id === null || !ecs.hasId(id, Transform)) continue;
      tr.px[id] = p.x;
      tr.py[id] = p.y;
      tr.pz[id] = p.z;
      tr.qx[id] = 0;
      tr.qy[id] = dsin(p.yaw / 2);
      tr.qz[id] = 0;
      tr.qw[id] = dcos(p.yaw / 2);
      an.state[id] = animOf(p);
      an.p0[id] = p.speed;
      an.p1[id] = p.outfit;
      rk.variant[id] = p.outfit;
      pa.node[id] = p.from;
      pa.next[id] = p.to;
      pa.t[id] = p.len > 0 ? p.s / p.len : 0;
      pa.state[id] = p.state;
      pa.timer[id] = p.timer < 0 ? 0 : p.timer > 65535 ? 65535 : p.timer;
      if (p.near) near++;
    }
    this.last = { peds: list.length, near };
  }

  /** The tick between two brain steps: walking pedestrians go on along their heading so the snapshot does not stutter. */
  private between(): void {
    const ecs = this.ecs;
    const tr = ecs.store(Transform);
    const dt = AI_DT / 2;
    for (const p of this.sim.peds.list()) {
      if (p.handle === 0 || p.speed < 0.05) continue;
      const id = ecs.resolve(H(p.handle));
      if (id === null || !ecs.hasId(id, Transform)) continue;
      tr.px[id] = p.x + p.hx * p.speed * dt;
      tr.pz[id] = p.z + p.hz * p.speed * dt;
    }
  }

  resource(): SimResource {
    const sim = this.sim;
    return {
      name: PED_RESOURCE_ID,
      hash: (h) => {
        hashPeds(h, sim.peds.list());
        const keys = [...sim.epochs.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
        h.u32(keys.length);
        for (const k of keys) h.str(k).u32(sim.epochs.get(k) as number);
        h.u8(sim.fill ? 1 : 0).u32(sim.cursorValue());
        const at = sim.attract.entries();
        h.u32(at.length);
        for (const a of at) h.u32(a.id).f64(a.x).f64(a.z).str(a.by);
      },
      save: (w: ByteWriter) => {
        savePeds(w, sim.peds.list());
        const keys = [...sim.epochs.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
        w.u32(keys.length);
        for (const k of keys) {
          w.str(k);
          w.u32(sim.epochs.get(k) as number);
        }
        w.u8(sim.fill ? 1 : 0);
        w.u32(sim.cursorValue());
        const at = sim.attract.entries();
        w.u32(at.length);
        for (const a of at) {
          w.u32(a.id);
          w.f64(a.x);
          w.f64(a.z);
          w.str(a.by);
        }
        w.u32(sim.attract.nextValue);
      },
      load: (r: ByteReader) => {
        loadPeds(r, sim.peds);
        sim.epochs.clear();
        for (let n = r.u32(); n > 0; n--) sim.epochs.set(r.str(), r.u32());
        sim.fill = r.u8() !== 0;
        sim.setCursor(r.u32());
        const list: { id: number; x: number; z: number; by: string }[] = [];
        for (let n = r.u32(); n > 0; n--) list.push({ id: r.u32(), x: r.f64(), z: r.f64(), by: r.str() });
        sim.attract.load(list, r.u32());
      },
    };
  }

  describe(): Record<string, unknown> {
    const s = this.sim.stats;
    return { ...this.last, tier: this.sim.tier, spawns: s.spawns, despawns: s.despawns, hits: s.hits, avoidPasses: s.avoidPasses, headClears: s.headClears };
  }
}

const H = (n: number): EntityHandle => n as unknown as EntityHandle;
