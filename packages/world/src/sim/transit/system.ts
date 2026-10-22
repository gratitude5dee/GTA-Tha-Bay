/**
 * The engine side of transit (M03b2): binds `TransitSim` and `RideService` to the ECS and the interaction service.
 *
 *  - One system in `SimStage.AI` (order 120) runs the transit brain every second tick (30 Hz) and the ride clock every tick.
 *  - Buses, trains, cable cars and ferries are entities keyed `pfb:transit.<kind>.<n>` with `Transform`, `RenderKey`, `Anim`,
 *    `Ambient` and `TransitVehicle` (`AmbientBoat` for a ferry); the publisher marks `Ambient` entities instanced, so the transit
 *    renderer draws them. Airliners add `Aircraft` and are a pure function of the tick.
 *  - Bay Rail entrances are `Interactable{Transit}` entities that stand while their station is within `entrance.liveM` of the focus.
 *    The `Transit` handler sends the rider to the next station of the line (the choice of station is the phone app's, M04b2).
 *
 * Sim code; C02 lint applies.
 */
import {
  NULL_HANDLE, SimStage, dcos, dsin, dsqrt, type EntityHandle, type SimConfig, type StableKey, type SystemDef,
} from '@dv/shared';
import {
  Ambient, Anim, INTERACT_KIND, Interactable, RenderKey, Transform, type EcsWorld, type EngineServices, type SimResource,
} from '@dv/engine/sim';
import type { ByteReader, ByteWriter } from '@dv/engine/sim';
import type { WorldServices } from '../api/world-api.ts';
import { TELEPORT_MSG } from '../api/teleport.ts';
import type { AmbientTraffic } from '../traffic/system.ts';
import { trafficCap, densityTier } from '../traffic/density.ts';
import type { TrafficFocus } from '../traffic/sim.ts';
import { airPose, airProgress, type Corridor } from './aircraft.ts';
import {
  Aircraft, AmbientBoat, TRANSIT_CONFIG, TRANSIT_PREFABS, TransitVehicle, countOf, moverKey, prefabOfKind, type MoverKind, type TransitPrefab,
} from './components.ts';
import { hashMovers, loadMovers, saveMovers, type TransitMover } from './mover.ts';
import { parseRoutes } from './path.ts';
import { bayRailStations, entranceKey, nextStation, stationOfKey } from './rail.ts';
import { RecordingFareSink, type FareSink } from './fares.ts';
import { RideService, type RobotaxiPhase } from './ride.ts';
import { TransitSim } from './sim.ts';

export const TRANSIT_BRAIN_ID = 'world.transit.brain';
export const TRANSIT_RESOURCE_ID = 'world.transit.movers';

const AI_DT = 2 / 60;

export interface AmbientTransitDeps {
  ecs: EcsWorld;
  services: EngineServices;
  world: WorldServices;
  cfg: SimConfig;
  traffic: AmbientTraffic;
  sink?: FareSink;
}

/** `groundY` throws for a point a float rounding error puts just outside its chunk (BD-M03b2-09): that point has no ground this step. */
function safeGround(w: WorldServices, x: number, z: number): number | null {
  try {
    return w.query.groundY(x, z);
  } catch {
    return null;
  }
}

const prefabId = (p: TransitPrefab): string => `transit.${p.id}`;
const H = (n: number): EntityHandle => n as unknown as EntityHandle;

export class AmbientTransit {
  readonly sim: TransitSim;
  readonly ride: RideService;
  readonly sink: FareSink;
  private readonly ecs: EcsWorld;
  private readonly deps: AmbientTransitDeps;
  private readonly tier;
  private readonly entrances = new Map<string, number>();
  private readonly airHandles: number[] = [];
  private readonly airOut = new Float64Array(4);
  private readonly airTmp = new Float64Array(4);
  private readonly stations;
  private tick = 0;
  /** Phase of the robotaxi ride, for the bridge and the sim events. */
  phase: RobotaxiPhase = 'idle';
  last = { movers: 0, air: 0, entrances: 0 };

  constructor(deps: AmbientTransitDeps) {
    this.deps = deps;
    this.ecs = deps.ecs;
    this.tier = densityTier(deps.cfg.profile, deps.cfg.tier);
    const w = deps.world;
    this.stations = bayRailStations(w.index.transit);
    this.sim = new TransitSim({
      world: { net: w.network, graph: w.graph, groundY: (x, z) => safeGround(w, x, z) },
      tier: this.tier,
    });
    this.sink = deps.sink ?? new RecordingFareSink();
    this.ride = new RideService({
      teleport: w.teleport,
      stations: this.stations,
      sink: this.sink,
      now: () => this.tick,
      playerPos: () => this.livePlayer(),
      heat: () => w.teleport.policy.heat(),
      resolve: (to) => {
        if ('x' in to) return { x: to.x, z: to.z };
        if ('node' in to) {
          const n = w.index.transit.find((t) => t.id === to.node);
          return n ? { x: n.x, z: n.z } : null;
        }
        const l = w.places.landmark(to.landmark as never);
        return l ? { x: l.arrival.x, z: l.arrival.z } : null;
      },
      onPhase: (phase, info) => {
        this.phase = phase;
        deps.services.events.push({ t: 'world.ride', tick: this.tick, s: phase, n: Math.round(info.distanceM) });
      },
    });
    this.definePrefabs();
    this.registerHandler();
    deps.services.ride = {
      destinations: () => this.stations.map((s) => ({ id: s.id, nameKey: s.nameKey, x: s.x, z: s.z })),
      fastTravelTo: async (toId) => {
        const at = this.livePlayer();
        let from: string | null = null;
        let best = Infinity;
        if (at) {
          for (const s of this.stations) {
            const d = (s.x - at[0]) ** 2 + (s.z - at[2]) ** 2;
            if (d < best) {
              best = d;
              from = s.id;
            }
          }
        }
        // standing at the destination itself: ride from the next station on instead of refusing a same-station trip
        if (from === toId) from = this.nextStationOf(toId);
        if (!from) return { ok: false, messageKey: TELEPORT_MSG.unknownTarget };
        const r = await this.ride.fastTravel(from, toId);
        return r.ok ? { ok: true, cents: r.cents, kind: r.kind } : { ok: false, messageKey: r.messageKey };
      },
      callRobotaxi: async (to) => {
        const r = await this.ride.callRobotaxi(to, 'point');
        return r.ok ? { ok: true, cents: r.cents, kind: r.kind } : { ok: false, messageKey: r.messageKey };
      },
    };
  }

  private livePlayer(): [number, number, number] | null {
    const ecs = this.ecs;
    const key = ecs.byKey('player:0' as StableKey);
    if (key === NULL_HANDLE) return null;
    const id = ecs.resolve(key);
    if (id === null) return null;
    const tr = ecs.store(Transform);
    return [tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number];
  }

  // ---- prefabs and entities -----------------------------------------------------------------------------------------------

  private definePrefabs(): void {
    const ecs = this.ecs;
    const base = (p: TransitPrefab): { def: never; init?: Record<string, number> }[] => [
      { def: Transform as never, init: { qw: 1 } },
      { def: RenderKey as never, init: { asset: ecs.strings.intern(p.asset), visible: 1 } },
      { def: Anim as never },
      { def: Ambient as never },
    ];
    ecs.definePrefab({ id: prefabId(TRANSIT_PREFABS.bus), components: [...base(TRANSIT_PREFABS.bus), { def: TransitVehicle }] } as never);
    ecs.definePrefab({ id: prefabId(TRANSIT_PREFABS.cablecar), components: [...base(TRANSIT_PREFABS.cablecar), { def: TransitVehicle }] } as never);
    ecs.definePrefab({ id: `${prefabId(TRANSIT_PREFABS.bus)}.metro`, components: [...base(TRANSIT_PREFABS.bus), { def: TransitVehicle }] } as never);
    ecs.definePrefab({ id: prefabId(TRANSIT_PREFABS.ferry), components: [...base(TRANSIT_PREFABS.ferry), { def: AmbientBoat }] } as never);
    ecs.definePrefab({ id: prefabId(TRANSIT_PREFABS.airliner), components: [...base(TRANSIT_PREFABS.airliner), { def: Aircraft }] } as never);
    ecs.definePrefab({
      id: prefabId(TRANSIT_PREFABS.entrance),
      components: [
        { def: Transform, init: { qw: 1 } },
        { def: RenderKey, init: { asset: ecs.strings.intern(TRANSIT_PREFABS.entrance.asset), visible: 1 } },
        { def: Anim },
        { def: Ambient },
        {
          def: Interactable,
          init: {
            kind: INTERACT_KIND.Transit, radius: TRANSIT_CONFIG.entrance.radiusM, coneDeg: 360, priority: 0,
            prompt: ecs.strings.intern('interact.transit'), flags: 0,
          },
        },
      ],
    } as never);
  }

  private prefabFor(m: TransitMover): string {
    if (m.kind === 'metro') return `${prefabId(TRANSIT_PREFABS.bus)}.metro`;
    return prefabId(prefabOfKind(m.kind));
  }

  private registerHandler(): void {
    const ia = this.deps.services.vehicleCtx?.interaction;
    if (!ia) return;
    ia.register({
      kind: INTERACT_KIND.Transit,
      canInteract: () => (this.deps.world.teleport.policy.heat() > 0 ? TELEPORT_MSG.heat : this.deps.world.teleport.busy ? TELEPORT_MSG.busy : true),
      begin: (_ctx, _actor, target) => {
        const key = this.ecs.keyOf(target);
        const from = key ? stationOfKey(key) : null;
        if (!from) return;
        const to = nextStation(this.stations, from);
        if (!to) return;
        void this.ride.fastTravel(from, to.id);
      },
    });
  }

  private ensureMover(m: TransitMover): void {
    if (m.handle !== 0) return;
    const ecs = this.ecs;
    if (ecs.byKey(m.key as StableKey) !== NULL_HANDLE) return;
    const p = prefabOfKind(m.kind);
    const init: Record<string, number> = {
      'Transform.px': m.x, 'Transform.py': m.y + p.lift, 'Transform.pz': m.z,
      'Transform.qy': dsin(m.yaw / 2), 'Transform.qw': dcos(m.yaw / 2),
      'Anim.state': 0, 'Anim.p0': m.speed, 'Anim.p1': m.kind === 'metro' ? 1 : 0,
      'Ambient.cell': ecs.strings.intern('transit'), 'Ambient.slot': 768 + m.n, 'Ambient.spawnTick': 0,
    };
    if (m.kind === 'ferry') {
      init['AmbientBoat.route'] = m.route;
      init['AmbientBoat.s'] = m.s;
    } else {
      init['TransitVehicle.route'] = m.route;
      init['TransitVehicle.s'] = m.s;
      init['TransitVehicle.dwell'] = m.dwell;
    }
    m.handle = ecs.commands.spawn(this.prefabFor(m), init, m.key as StableKey) as unknown as number;
  }

  // ---- the system ---------------------------------------------------------------------------------------------------------

  system(): SystemDef {
    return {
      id: TRANSIT_BRAIN_ID,
      owner: 'S02',
      stage: SimStage.AI,
      order: 120,
      run: (ctx) => this.run(ctx.tick),
    };
  }

  private focus(): TrafficFocus {
    const t = this.deps.traffic;
    if (t.focusOverride) return t.focusOverride;
    const p = this.livePlayer();
    if (p) return { x: p[0], z: p[2], vx: 0, vz: 0 };
    const sp = this.deps.world.play;
    return { x: (sp.minX + sp.maxX) / 2, z: (sp.minZ + sp.maxZ) / 2, vx: 0, vz: 0 };
  }

  private run(tick: number): void {
    this.tick = tick;
    this.ride.step(tick);
    this.syncAir(tick);
    if ((tick & 1) !== 0) {
      this.between();
      return;
    }
    const focus = this.focus();
    this.sim.step(tick, focus);
    this.syncMovers();
    this.syncEntrances(focus);
  }

  private syncMovers(): void {
    const ecs = this.ecs;
    const tr = ecs.store(Transform);
    const an = ecs.store(Anim);
    const tv = ecs.store(TransitVehicle);
    const ab = ecs.store(AmbientBoat);
    for (const m of this.sim.sorted()) {
      this.ensureMover(m);
      if (m.handle === 0) continue;
      const id = ecs.resolve(H(m.handle));
      if (id === null || !ecs.hasId(id, Transform)) continue;
      const lift = prefabOfKind(m.kind).lift;
      tr.px[id] = m.x;
      tr.py[id] = m.y + lift;
      tr.pz[id] = m.z;
      tr.qx[id] = 0;
      tr.qy[id] = dsin(m.yaw / 2);
      tr.qz[id] = 0;
      tr.qw[id] = dcos(m.yaw / 2);
      an.p0[id] = m.speed;
      an.state[id] = m.dwell > 0 ? 1 : 0;
      if (m.kind === 'ferry') {
        ab.route[id] = m.route;
        ab.s[id] = m.s;
      } else {
        tv.route[id] = m.route;
        tv.s[id] = m.s;
        tv.dwell[id] = m.dwell > 65535 ? 65535 : m.dwell;
      }
    }
    this.last.movers = this.sim.movers.length;
  }

  /** The tick between two brain steps: moving vehicles go on along their heading. */
  private between(): void {
    const ecs = this.ecs;
    const tr = ecs.store(Transform);
    const dt = AI_DT / 2;
    for (const m of this.sim.movers) {
      if (m.handle === 0 || m.speed < 0.05) continue;
      const id = ecs.resolve(H(m.handle));
      if (id === null || !ecs.hasId(id, Transform)) continue;
      tr.px[id] = m.x + m.hx * m.speed * dt;
      tr.pz[id] = m.z + m.hz * m.speed * dt;
    }
  }

  /** Airliners: a pure function of the tick, written every tick. */
  private syncAir(tick: number): void {
    const ecs = this.ecs;
    const n = this.sim.airCount;
    const cs: readonly Corridor[] = this.sim.air;
    if (n === 0 || cs.length === 0) return;
    for (let i = 0; i < n; i++) {
      let h = this.airHandles[i] ?? 0;
      const c = cs[i % cs.length] as Corridor;
      const t = airProgress(c, i, n, tick);
      airPose(c, t, this.airOut, this.airTmp);
      if (h === 0) {
        const key = moverKey('air', i) as StableKey;
        if (ecs.byKey(key) !== NULL_HANDLE) continue;
        const init: Record<string, number> = {
          'Transform.px': this.airOut[0] as number, 'Transform.py': this.airOut[1] as number, 'Transform.pz': this.airOut[2] as number,
          'Transform.qy': dsin((this.airOut[3] as number) / 2), 'Transform.qw': dcos((this.airOut[3] as number) / 2),
          'Ambient.cell': ecs.strings.intern('transit'), 'Ambient.slot': 864 + i, 'Ambient.spawnTick': 0,
          'Aircraft.corridor': i % cs.length, 'Aircraft.t': t,
        };
        h = ecs.commands.spawn(prefabId(TRANSIT_PREFABS.airliner), init, key) as unknown as number;
        this.airHandles[i] = h;
        continue;
      }
      const id = ecs.resolve(H(h));
      if (id === null || !ecs.hasId(id, Transform)) continue;
      const tr = ecs.store(Transform);
      tr.px[id] = this.airOut[0] as number;
      tr.py[id] = this.airOut[1] as number;
      tr.pz[id] = this.airOut[2] as number;
      tr.qy[id] = dsin((this.airOut[3] as number) / 2);
      tr.qw[id] = dcos((this.airOut[3] as number) / 2);
      ecs.store(Aircraft).t[id] = t;
      ecs.store(Aircraft).corridor[id] = i % cs.length;
      ecs.store(Anim).p0[id] = t;
    }
    this.last.air = n;
  }

  /** Entrances stand while their station is within `liveM` of the focus and its chunk is resident. */
  private syncEntrances(focus: TrafficFocus): void {
    const ecs = this.ecs;
    const live = TRANSIT_CONFIG.entrance.liveM;
    for (const s of this.stations) {
      const dx = s.x - focus.x, dz = s.z - focus.z;
      const d = dsqrt(dx * dx + dz * dz);
      const have = this.entrances.get(s.id);
      if (have !== undefined) {
        if (d > live * 1.5) {
          ecs.commands.despawn(H(have));
          this.entrances.delete(s.id);
        }
        continue;
      }
      if (d > live) continue;
      const gy = safeGround(this.deps.world, s.x, s.z);
      if (gy === null) continue;
      const key = entranceKey(s.id) as StableKey;
      if (ecs.byKey(key) !== NULL_HANDLE) continue;
      const lift = TRANSIT_PREFABS.entrance.lift;
      const h = ecs.commands.spawn(prefabId(TRANSIT_PREFABS.entrance), {
        'Transform.px': s.x, 'Transform.py': gy + lift, 'Transform.pz': s.z, 'Transform.qw': 1,
        'Ambient.cell': ecs.strings.intern('transit'), 'Ambient.slot': 768 + 40 + this.stations.indexOf(s), 'Ambient.spawnTick': this.tick,
      }, key) as unknown as number;
      this.entrances.set(s.id, h);
    }
    this.last.entrances = this.entrances.size;
  }

  /** The id of the station after `from` in line order (wrapping), or null. */
  nextStationOf(from: string): string | null {
    return nextStation(this.stations, from)?.id ?? null;
  }

  /** The fast-travel stations in line order. */
  stationList(): readonly { id: string; nameKey: string; x: number; z: number }[] {
    return this.stations;
  }

  /** The place of the player on foot or in a vehicle, or null. */
  playerAt(): [number, number, number] | null {
    return this.livePlayer();
  }

  /** The traffic cap left for buses once the cars are counted (buses share it). */
  busBudget(): number {
    const room = trafficCap(this.tier) - this.deps.traffic.sim.agents.size;
    return room < 0 ? 0 : room;
  }

  // ---- state --------------------------------------------------------------------------------------------------------------

  /** Installs the routes (bytes of `data/transit-routes.v1`). False when they are not that file. */
  loadRoutes(bytes: ArrayBuffer): boolean {
    const d = parseRoutes(bytes);
    if (!d) return false;
    this.sim.setRoutes(d);
    return true;
  }

  resource(): SimResource {
    const sim = this.sim;
    return {
      name: TRANSIT_RESOURCE_ID,
      hash: (h) => {
        hashMovers(h, sim.sorted());
        h.u8(sim.placed ? 1 : 0);
      },
      save: (w: ByteWriter) => {
        saveMovers(w, sim.sorted());
        w.u8(sim.placed ? 1 : 0);
      },
      load: (r: ByteReader) => {
        const list = loadMovers(r);
        sim.movers.length = 0;
        for (const m of list) sim.movers.push(m);
        sim.placed = r.u8() !== 0;
      },
    };
  }

  describe(): Record<string, unknown> {
    return {
      ...this.last, tier: this.tier, counts: this.sim.counts(), phase: this.phase, fares: (this.sink as RecordingFareSink).calls ?? [],
      want: { metro: countOf('metro', this.tier), bus: countOf('bus', this.tier), cablecar: countOf('cablecar', this.tier), ferry: countOf('ferry', this.tier), air: countOf('air', this.tier) },
    };
  }

  kinds(): readonly MoverKind[] {
    return ['metro', 'bus', 'cablecar', 'ferry'];
  }
}
