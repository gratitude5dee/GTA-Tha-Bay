/**
 * A headless harness for the mission runtime: a real ECS world, the real scheduler, zone service, timeline recorder and economy,
 * and recording fakes for the rest of `ModeContext`. One `step()` is one sim tick in the order the engine runs them: the mode's
 * tick (here `rt.tick`), the zone watchers, the threads, then the end-of-stage flush of the ECS command buffer.
 */
import {
  RngStreams, enuFromLatLng, type EntityHandle, type JsonValue, type MissionIR, type ModeContext, type SimEvent, type StorySlice, type UnlockEventId, type WorldResolver,
} from '@dv/shared';
import { Control, Health, LocalPlayer, Pickup, Prop, Seat, Transform, Vehicle, VehicleDamage, Velocity, CONTROL_OWNER, Ped, MissionOwned } from '@dv/engine/sim';
import { EcsWorld } from '../../../engine/src/sim/ecs/world.ts';
import { EconomyImpl } from '../../../engine/src/sim/modes/economy.ts';
import { ModeEventBus } from '../../../engine/src/sim/modes/host.ts';
import { defaultStory } from '../../../engine/src/sim/modes/builtin/story-freeroam.ts';
import { SimSchedulerImpl } from '../../../engine/src/sim/script/scheduler.ts';
import { TimelineRecorderImpl } from '../../../engine/src/sim/script/timeline.ts';
import { ZoneServiceImpl } from '../../../engine/src/sim/script/zones.ts';
import { resolveMission, type ResolvedMission } from '../src/compiler/resolve.ts';
import { MissionRuntime } from '../src/vm/runtime.ts';
import type { RuntimeOptions, StartOptions } from '../src/vm/types.ts';

export const flatResolver = (bake = 'test-bake', over: Partial<WorldResolver> = {}): WorldResolver => ({
  bake,
  toEnu: (ll) => {
    const p = enuFromLatLng(ll.lat, ll.lng);
    return [p.x, 0, p.z];
  },
  landmark: () => null,
  snap: (req) => {
    if (!('lat' in req.at)) return null;
    const p = enuFromLatLng(req.at.lat, req.at.lng);
    return { pos: [p.x, 0, p.z], yaw: 0, distM: 0 };
  },
  route: () => null,
  ...over,
});

export interface Calls {
  unlocks: { id: string; src: { kind: string; ref: string }; isNew: boolean }[];
  clockLocks: string[];
  clockUnlocks: string[];
  density: { kind: string; mult: number; by: string }[];
  trafficReleased: string[];
  heat: string[];
  telemetry: { name: string; props: Record<string, string | number | boolean> }[];
  saves: string[];
  camera: string[];
  children: { id: string; args: unknown }[];
  toasts: { id: string; text: string }[];
  blips: Map<string, unknown>;
}

export interface Harness {
  ecs: EcsWorld;
  ctx: ModeContext;
  rt: MissionRuntime;
  story: StorySlice;
  calls: Calls;
  vm: Map<string, JsonValue | null>;
  bus: ModeEventBus;
  sched: SimSchedulerImpl;
  timeline: TimelineRecorderImpl;
  economy: EconomyImpl;
  player: EntityHandle;
  tickNo: { n: number };
  /** The heat state the fake pursuit reports. */
  pursuit: { level: number; phase: 'clear' | 'pursuit' | 'search' | 'cooldown' | 'busted' };
  /** Whether `startChild` succeeds. */
  childOk: { value: boolean };
  step(n?: number): void;
  start(ir: MissionIR, o?: Partial<StartOptions>, resolver?: WorldResolver): ResolvedMission;
  /** Moves the player. */
  put(h: EntityHandle, x: number, z: number, y?: number): void;
  at(key: string): EntityHandle;
  emit(e: SimEvent): void;
}

export interface HarnessOptions extends Partial<RuntimeOptions> {
  groundY?: (x: number, z: number) => number | null;
  unlocked?: string[];
}

export function makeHarness(o: HarnessOptions = {}): Harness {
  const ecs = new EcsWorld();
  ecs.definePrefab({ id: 'player.default', components: [{ def: Transform, init: { qw: 1 } }, { def: Velocity }, { def: Health, init: { hp: 100, max: 100 } }, { def: Control }, { def: LocalPlayer }] });
  ecs.definePrefab({ id: 'ped.actor', components: [{ def: Transform, init: { qw: 1 } }, { def: Velocity }, { def: Health, init: { hp: 100, max: 100 } }, { def: Seat }, { def: Ped }, { def: MissionOwned }] });
  ecs.definePrefab({ id: 'prop.crate', components: [{ def: Transform, init: { qw: 1 } }, { def: Velocity }, { def: Prop }] });
  ecs.definePrefab({ id: 'pickup.item', components: [{ def: Transform, init: { qw: 1 } }, { def: Pickup }] });
  ecs.definePrefab({ id: 'vehicle.compact', components: [{ def: Transform, init: { qw: 1 } }, { def: Velocity }, { def: Vehicle }, { def: VehicleDamage, init: { body: 1, engine: 1 } }] });
  ecs.definePrefab({ id: 'marker.beam', components: [{ def: Transform, init: { qw: 1 } }] });

  const tickNo = { n: 0 };
  const tick = (): number => tickNo.n;
  const calls: Calls = { unlocks: [], clockLocks: [], clockUnlocks: [], density: [], trafficReleased: [], heat: [], telemetry: [], saves: [], camera: [], children: [], toasts: [], blips: new Map() };
  const vm = new Map<string, JsonValue | null>();
  const bus = new ModeEventBus(() => undefined);
  const rng = new RngStreams(7);
  const sched = new SimSchedulerImpl({ rng, events: bus });
  const zones = new ZoneServiceImpl({ ecs, tick });
  const timeline = new TimelineRecorderImpl({ ecs, tick });
  const story = defaultStory();
  const economy = new EconomyImpl({ wallet: () => story.wallet, tick });
  const pursuit: Harness['pursuit'] = { level: 0, phase: 'clear' };
  const childOk = { value: false };
  const seen = new Set<string>(o.unlocked ?? []);

  const spawnAt = (id: string, at: { pos: [number, number, number]; yaw: number }, key?: string): EntityHandle =>
    ecs.commands.spawn(id, { 'Transform.px': at.pos[0], 'Transform.py': at.pos[1], 'Transform.pz': at.pos[2] }, key as never);

  const ctx = {
    get tick() {
      return tickNo.n;
    },
    dt: 1 / 60,
    origin: { kind: 'menu' },
    ecs,
    prefabs: { spawn: spawnAt, despawn: (h: EntityHandle) => ecs.commands.despawn(h) },
    physics: { groundY: o.groundY ?? (() => 0), castRay: () => null },
    rng: (s: string) => rng.get(s),
    clock: {
      now: () => ({ t: 0, paused: false }),
      env: () => ({ hour: 12, night: 0, dark: 0, weather: 'clear', next: 'clear', blend: 0, fogBankM: 0, rain: 0 }),
      setHour: () => undefined,
      pause: () => undefined,
      lock: (by: string) => void calls.clockLocks.push(by),
      unlock: (by: string) => void calls.clockUnlocks.push(by),
      forceWeather: () => undefined,
    },
    pursuit: {
      state: () => ({ level: pursuit.level, phase: pursuit.phase }),
      setHeat: (l: number, why: string) => void calls.heat.push(`set:${l}:${why}`),
      capHeat: (l: number) => void calls.heat.push(`cap:${l}`),
      clear: (why: string) => void calls.heat.push(`clear:${why}`),
    },
    interaction: {},
    zones,
    scheduler: sched,
    timeline,
    camera: { direct: () => void calls.camera.push('direct'), release: () => void calls.camera.push('release') },
    input: { frame: () => { throw new Error('no input'); }, push: () => undefined, pop: () => undefined },
    unlocks: {
      emit: (id: UnlockEventId, src: { kind: string; ref: string }) => {
        const isNew = !seen.has(id);
        seen.add(id);
        calls.unlocks.push({ id, src, isNew });
        return isNew;
      },
      has: (id: string) => seen.has(id),
      list: () => [...seen],
    },
    economy,
    combat: {},
    events: bus,
    ui: {
      patch: (k: string, v: JsonValue | null) => void vm.set(k, v),
      toast: (t: { id: string; text: string }) => void calls.toasts.push({ id: t.id, text: t.text }),
      openApp: () => undefined,
      closeOverlay: () => undefined,
    },
    assets: { request: () => undefined, ready: () => true },
    save: { request: (r: string) => void calls.saves.push(r) },
    telemetry: { emit: (name: string, props: Record<string, string | number | boolean>) => void calls.telemetry.push({ name, props }) },
    net: null,
    world: {
      traffic: {
        setDensity: (kind: string, mult: number, by: string) => void calls.density.push({ kind, mult, by }),
        release: (by: string) => void calls.trafficReleased.push(by),
        closeEdges: () => undefined,
        setBlackout: () => undefined,
        blackout: false,
      },
      map: { setBlip: (b: { id: string }) => void calls.blips.set(b.id, b), removeBlip: (id: string) => void calls.blips.delete(id), blips: () => [...calls.blips.values()] },
      resolver: flatResolver(),
      graph: { route: () => null },
    },
    npc: {},
    startChild: (id: string, args: unknown) => {
      calls.children.push({ id, args });
      return childOk.value;
    },
  } as unknown as ModeContext;

  const player = spawnAt('player.default', { pos: [0, 0, 0], yaw: 0 }, 'player:0');
  ecs.flush();

  const opts: RuntimeOptions = { story: () => story, ...o };
  const rt = new MissionRuntime(opts);
  rt.bind(ctx);

  const h: Harness = {
    ecs, ctx, rt, story, calls, vm, bus, sched, timeline, economy, player, tickNo, pursuit, childOk,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        rt.tick(ctx);
        zones.update(tickNo.n);
        sched.run(tickNo.n);
        timeline.update(tickNo.n);
        ecs.flush();
        tickNo.n++;
      }
    },
    start(ir, so = {}, resolver = flatResolver()) {
      const r = resolveMission(ir, resolver);
      if ('errors' in r) throw new Error(`resolve: ${r.errors.map((e) => `${e.code} ${e.pointer}`).join(', ')}`);
      rt.start(r, { attempt: 1, seed: 11, ...so });
      ecs.flush();
      return r;
    },
    put(e, x, z, y = 0) {
      const id = ecs.resolve(e);
      if (id === null) throw new Error('stale handle');
      const tr = ecs.store(Transform);
      tr.px[id] = x;
      tr.py[id] = y;
      tr.pz[id] = z;
    },
    at(key) {
      const e = ecs.byKey(key as never);
      if (e === 0) throw new Error(`no entity ${key}`);
      return e;
    },
    emit(e) {
      bus.emit(e);
    },
  };
  return h;
}

/** Puts the player in a vehicle the way the ownership machine does: `Control.owner = Vehicle`, `Control.target` = the vehicle's id. */
export function seatPlayer(h: Harness, vehicle: EntityHandle): void {
  const pid = h.ecs.resolve(h.player) as number;
  const vid = h.ecs.resolve(vehicle) as number;
  const co = h.ecs.store(Control);
  co.owner[pid] = CONTROL_OWNER.Vehicle;
  co.target[pid] = vid;
}

/** ENU metres to the lat/lng tuple the IR holds. */
export function ll(x: number, z: number): [number, number] {
  return [37.7793 - z / 110992.06, -122.4193 + x / 88083.39];
}
