/**
 * The Node runner of the `pursuit-escape` scenario (M03c, AC-8; DL-678, DL-692). It boots the real sim runtime with the world streaming
 * module and the engine's pursuit module on the `synth` bake, puts the player at the wheel of a sedan on the road nearest to the City
 * Hall arrival pose, and plays a scripted bot: the line `pursuit-escape.line.json` lists the infractions the bot commits (tick, kind,
 * count) and the goals it drives to. The bot is a closed-loop route follower, so the same line gives the same run on every machine.
 *
 * Same residency rule as `traffic-synth`: the preload set is requested, received and pinned before tick 0, and no tick advances while a
 * requested `p0` is pending. The streams drawn are `pursuit` and `police` (the pursuit director) and the world's own.
 */
import { readFileSync } from 'node:fs';
import { type EntityHandle, type HeatState, type InfractionKind, type InputFrame, type StableKey } from '@dv/shared';
import {
  Transform, Velocity, createPursuitModule, driveToward, pathTarget, seatDriver, yawOf, MemoryWallet, pursuitWorldFrom,
  type PursuitModule, type UnitView,
} from '@dv/engine/sim';
import type { BakeData } from './bake.ts';
import { startTrafficRun, type TrafficRun } from './traffic-run.ts';

export interface PursuitLine {
  id: 'pursuit-escape';
  version: 1;
  seed: number;
  ticks: number;
  every: number;
  /** Goals the bot drives to in order (ENU metres, offsets from the arrival pose); the last repeats. */
  goals: { dx: number; dz: number }[];
  /** The speed the bot holds, m/s. */
  cruiseMps: number;
  infractions: { tick: number; kind: InfractionKind; count: number; witness: 'police' | 'robotaxi' | 'ped' | 'heli' }[];
  /** Cash of the wallet at the start, cents. */
  cashCents: number;
  /** `TrafficControl` density of the ambient traffic during the line, 0 to 1.5. */
  trafficDensity: number;
  /** Metres east of the arrival pose where the search for the starting lane is centred. */
  startDx: number;
}

export const loadLine = (): PursuitLine => JSON.parse(readFileSync(new URL('../pursuit/pursuit-escape.line.json', import.meta.url), 'utf8')) as PursuitLine;

export interface PursuitTrace {
  tick: number;
  level: number;
  phase: string;
  units: number;
  cooldown: number;
  radius: number;
  x: number;
  z: number;
  speed: number;
}

export interface PursuitRunResult {
  bakeId: string;
  seed: number;
  ticks: number;
  checkpoints: Record<string, string>;
  final: string;
  stallTicks: number;
  preload: string[];
  /** Tick the level returned to 0 after having been above it, or -1. */
  escapedAt: number;
  maxLevel: number;
  peakUnits: number;
  /** The sedan's distance driven, metres. */
  driven: number;
  trace: PursuitTrace[];
  rngStreams: string[];
  events: Record<string, number>;
}

export interface PursuitRun {
  run: TrafficRun;
  pursuit: PursuitModule;
  line: PursuitLine;
  /** Plays one tick of the bot, then the sim. */
  tick(): Promise<void>;
  player(): EntityHandle;
  vehicle(): EntityHandle;
  state(): HeatState | null;
  pos(): { x: number; y: number; z: number; yaw: number; speed: number };
  dispose(): void;
}

const NEUTRAL: InputFrame = {
  tick: 0, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0, device: 7,
};

/** Boots the scenario, seats the player in a sedan on the nearest road and returns the handles; the caller ticks it. */
export async function startPursuitRun(o: { bake: BakeData; line?: PursuitLine; order?: 'in-order' | 'shuffled'; shuffleSeed?: number; cfg?: unknown }): Promise<PursuitRun> {
  const line = o.line ?? loadLine();
  const wallet = new MemoryWallet(line.cashCents);
  const pursuit = createPursuitModule({ wallet });
  const run = await startTrafficRun({
    bake: o.bake, extraModules: [pursuit], seed: line.seed, every: line.every, ...(o.order ? { order: o.order } : {}), ...(o.shuffleSeed !== undefined ? { shuffleSeed: o.shuffleSeed } : {}),
  });
  const sim = run.runtime.sim;
  const world = run.mod.state;
  if (!sim || !world) throw new Error('no sim');
  const ecs = sim.ecs;
  const player = ecs.byKey('player:0' as StableKey);

  // let the ownership machine release the player onto the ground, and the road network come up
  await run.step(180);
  const api = sim.services.world.api;
  if (!api) throw new Error('the world services did not come up');
  const tr = ecs.store(Transform);
  const pid = ecs.resolve(player) as number;
  const px = tr.px[pid] as number, pz = tr.pz[pid] as number;
  // the line runs on empty roads: the ambient cars would stop the closed-loop bot (it has no way round a stopped car)
  api.traffic.setDensity('traffic', line.trafficDensity, 'pursuit-escape');
  await run.step(30);
  // the route: the first leg starts on the lane that runs to the first goal with the shortest route; each later leg starts at the end of the
  // edge before it, so a junction cannot snap the start to a cross street
  const pre = pursuitWorldFrom({ api, bounds: null, tags: null });
  const routeEdges: number[] = [];
  const x0 = px + line.startDx;
  let prevEnd: { edge: number; s: number; lane: number } | null = null;
  for (let li = 0; li < line.goals.length; li++) {
    const g = line.goals[li] as { dx: number; dz: number };
    const to = { x: px + g.dx, z: pz + g.dz };
    let leg: { edges: number[]; lengthM: number } | null = null;
    if (prevEnd === null) {
      for (let dz = -9; dz <= 9; dz += 1.5) {
        const r = pre.route({ x: x0, z: pz + dz }, to);
        if (r && r.edges.length > 0 && (leg === null || r.lengthM < leg.lengthM)) leg = r;
      }
    } else {
      leg = api.graph.route({ from: prevEnd, to, maxExpand: 6000 });
    }
    if (!leg || leg.edges.length === 0) throw new Error(`no route for leg ${li}`);
    for (const e of leg.edges) if (e !== routeEdges[routeEdges.length - 1]) routeEdges.push(e);
    const last = leg.edges[leg.edges.length - 1] as number;
    prevEnd = { edge: last, s: pre.edgeLength(last), lane: 0 };
  }
  const first = { edges: routeEdges };
  const at0 = pre.lanePoint(first.edges[0] as number, 6);
  if (!at0) throw new Error('no lane point');
  const out = new Float64Array(4);
  out[0] = at0.x; out[1] = at0.y; out[2] = at0.z; out[3] = at0.yaw;
  const ctx = sim.services.vehicleCtx;
  if (!ctx) throw new Error('no vehicle module');
  const vehicle = ctx.prefabs.spawn('vehicle.sedan', { pos: [out[0] as number, (out[1] as number) + 0.3, out[2] as number], yaw: out[3] as number }, 'veh:pursuit0' as StableKey);
  await run.step(2);
  if (!seatDriver(ecs, ctx.backend, ctx.store, sim.services, player, vehicle, sim.core.tick)) throw new Error('could not seat the driver');
  await run.step(30);

  const view = pursuitWorldFrom({ api, bounds: null, tags: null });
  const plan: { pts: { x: number; z: number }[]; idx: number } = { pts: [], idx: 0 };
  const dst = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  const vstate = () => {
    const vid = ecs.resolve(vehicle) as number;
    const t = ecs.store(Transform);
    const v = ecs.store(Velocity);
    const yaw = yawOf(t.qx[vid] as number, t.qy[vid] as number, t.qz[vid] as number, t.qw[vid] as number);
    const vx = v.vx[vid] as number, vz = v.vz[vid] as number;
    return { x: t.px[vid] as number, y: t.py[vid] as number, z: t.pz[vid] as number, yaw, speed: vx * -Math.sin(yaw) + vz * -Math.cos(yaw), hs: Math.hypot(vx, vz) };
  };

  // the bot follows the route found once at the start (a re-plan from the car's position would snap to a cross street at a junction)
  for (const e of first.edges) {
    const len = view.edgeLength(e);
    for (let d = e === first.edges[0] ? 6 : 0; d <= len + 0.01; d += 12) {
      const q = view.lanePoint(e, d);
      const last = plan.pts[plan.pts.length - 1];
      if (q && !(last && Math.hypot(last.x - q.x, last.z - q.z) < 0.5)) plan.pts.push({ x: q.x, z: q.z });
    }
  }

  const bot = (tick: number): InputFrame => {
    const s = vstate();
    const p = pathTarget(plan.pts, plan.idx, s.x, s.z, s.speed, line.cruiseMps);
    if (!p) return { ...NEUTRAL, tick, brake: 127 };
    plan.idx = p.idx;
    const u: UnitView = { id: 0, role: 'named', pos: [s.x, s.y, s.z], yaw: s.yaw, speed: s.speed, vel: [0, 0, 0], ready: true, tires: [1, 1, 1, 1] };
    driveToward(u, p, dst);
    if (process.env['DV_DEBUG_BOT'] && tick % 6 === 0 && s.x > 30) console.log('bot', tick, 'pos', s.x.toFixed(1), s.z.toFixed(1), 'yaw', s.yaw.toFixed(2), 'v', s.speed.toFixed(1), 'tgt', p.x.toFixed(1), p.z.toFixed(1), 'cap', p.speed.toFixed(1), 'cmd', dst.throttle.toFixed(2), dst.brake.toFixed(2), dst.steer.toFixed(2));
    return { ...NEUTRAL, tick, throttle: Math.round(dst.throttle * 127), brake: Math.round(dst.brake * 127), steer: Math.round(dst.steer * 127) };
  };

  let botFrame: InputFrame = NEUTRAL;
  // the runtime's input system samples `runtime.bot` at the start of every tick
  run.runtime.bot = { device: 'bot', frame: () => botFrame };
  const rt: PursuitRun = {
    run, pursuit, line,
    async tick() {
      const t = sim.core.tick;
      for (const inf of line.infractions) {
        if (inf.tick === t) {
          const d = pursuit.director();
          const s = vstate();
          d?.report(inf.kind, [s.x, s.y, s.z], inf.witness, inf.count);
        }
      }
      botFrame = bot(t);
      await run.step(1);
    },
    player: () => player,
    vehicle: () => vehicle,
    state: () => pursuit.director()?.state() ?? null,
    pos: () => {
      const s = vstate();
      return { x: s.x, y: s.y, z: s.z, yaw: s.yaw, speed: s.speed };
    },
    dispose: () => run.dispose(),
  };
  return rt;
}

/** Plays the whole line and reports what happened. */
export async function playPursuit(o: { bake: BakeData; order?: 'in-order' | 'shuffled'; shuffleSeed?: number; line?: PursuitLine }): Promise<PursuitRunResult> {
  const r = await startPursuitRun(o);
  const sim = r.run.runtime.sim;
  if (!sim) throw new Error('no sim');
  const line = r.line;
  const checkpoints: Record<string, string> = {};
  const trace: PursuitTrace[] = [];
  const events: Record<string, number> = {};
  let escapedAt = -1;
  let maxLevel = 0;
  let peakUnits = 0;
  let driven = 0;
  let last = r.pos();
  const startTick = sim.core.tick;
  const total = startTick + line.ticks;
  while (sim.core.tick < total) {
    await r.tick();
    const t = sim.core.tick;
    for (const e of sim.services.events.drain()) events[e.t] = (events[e.t] ?? 0) + 1;
    if (t % line.every === 0 && sim.core.lastHash) checkpoints[String(t)] = sim.core.lastHash.hex;
    const st = r.state();
    const p = r.pos();
    driven += Math.hypot(p.x - last.x, p.z - last.z);
    last = p;
    if (st) {
      if (st.level > maxLevel) maxLevel = st.level;
      peakUnits = Math.max(peakUnits, st.units.length);
      if (escapedAt < 0 && maxLevel > 0 && st.level === 0) escapedAt = t;
      if (t % 60 === 0) trace.push({ tick: t, level: st.level, phase: st.phase, units: st.units.length, cooldown: Math.round(st.cooldown * 100) / 100, radius: Math.round(st.searchRadiusM), x: Math.round(p.x), z: Math.round(p.z), speed: Math.round(p.speed * 10) / 10 });
    }
  }
  const final = sim.hash();
  const out: PursuitRunResult = {
    bakeId: o.bake.bakeId, seed: line.seed, ticks: line.ticks, checkpoints, final, stallTicks: r.run.stallTicks, preload: r.run.preload, escapedAt, maxLevel, peakUnits,
    driven: Math.round(driven), trace, rngStreams: [...sim.services.rng.streamNames()], events,
  };
  r.dispose();
  return out;
}
