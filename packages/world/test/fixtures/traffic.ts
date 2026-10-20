/**
 * Harness for the traffic specs (M03b1): a `WorldServices` over hand-built or baked chunks, a `TrafficSim` on it, and a loop that runs
 * AI steps at 30 Hz without the engine, Rapier or an ECS.
 */
import type { ChunkKey, QualityTierId, SimChunk, WeatherPreset, WorldIndex } from '@dv/shared';
import { createWorldApi, type WorldServices } from '../../src/sim/api/world-api.ts';
import { Blackout } from '../../src/sim/env/blackout.ts';
import type { Agent } from '../../src/sim/traffic/agent.ts';
import { Turn } from '../../src/sim/traffic/components.ts';
import { stopDistance } from '../../src/sim/traffic/idm.ts';
import { CLAIM_TIMEOUT_TICKS } from '../../src/sim/traffic/junction.ts';
import { WitnessBoard } from '../../src/sim/traffic/witness.ts';
import { TrafficSim, type TrafficFocus, type StepInput, type TrafficHooks, type TrafficOptions } from '../../src/sim/traffic/sim.ts';
import { trafficWorldOf } from '../../src/sim/traffic/world.ts';
import { indexOf, loadAll, storeOf } from './world.ts';
import type { CrossRoads } from './roads.ts';
import type { ChunkStore } from '../../src/sim/streaming/chunk-store.ts';
import type { GraphTopology } from '@dv/shared';

export interface Rig {
  services: WorldServices;
  store: ChunkStore<SimChunk>;
  sim: TrafficSim;
  board: WitnessBoard;
  /** Ticks run so far. */
  tick: number;
  focus: TrafficFocus;
  env: { hour: number; weather: WeatherPreset };
  /** Runs `ticks` sim ticks; the AI steps on every second one. */
  run(ticks: number, each?: (tick: number) => void): void;
  input: Partial<StepInput>;
}

export interface RigOptions {
  chunks: readonly SimChunk[];
  topology?: GraphTopology | null;
  index?: WorldIndex;
  tier?: QualityTierId;
  seed?: number;
  focus?: TrafficFocus;
  hooks?: TrafficHooks;
  initialFill?: boolean;
  /** Fraction of the C13 cap that may be live. */
  crowd?: number;
  parked?: boolean;
  hour?: number;
  weather?: WeatherPreset;
  options?: Partial<TrafficOptions>;
}

export async function makeRig(o: RigOptions): Promise<Rig> {
  const store = storeOf(o.chunks);
  await loadAll(store, o.chunks.map((c) => c.key as ChunkKey));
  const clock = { t: 0 };
  const blackout = new Blackout();
  const services = createWorldApi(store, o.index ?? indexOf(), { tick: () => clock.t }, { blackout, ...(o.topology ? { topology: o.topology } : {}) });
  const board = new WitnessBoard();
  const sim = new TrafficSim({
    world: trafficWorldOf(services, store),
    seed: o.seed ?? 0xc0ffee,
    tier: o.tier ?? 'mobile-low',
    board,
    ...(o.hooks ? { hooks: o.hooks } : {}),
    initialFill: o.initialFill ?? true,
    ...(o.crowd !== undefined ? { crowdDensity: () => o.crowd as number } : {}),
    ...(o.parked !== undefined ? { parked: o.parked } : {}),
    ...(o.options ?? {}),
  });
  const rig: Rig = {
    services, store, sim, board, tick: 0,
    focus: o.focus ?? { x: 0, z: 0, vx: 0, vz: 0 },
    env: { hour: o.hour ?? 12, weather: o.weather ?? 'clear' },
    input: {},
    run(ticks, each) {
      for (let i = 0; i < ticks; i++) {
        clock.t = rig.tick;
        if (rig.tick % 2 === 0) sim.step({ tick: rig.tick, focus: rig.focus, env: rig.env, ...rig.input });
        each?.(rig.tick);
        rig.tick++;
      }
    },
  };
  return rig;
}

// ---- audits --------------------------------------------------------------------------------------------------------------

export interface Audit {
  crossings: number;
  /** Crossings of a stop line while the aspect of the movement was red. */
  red: number;
  /** Crossings on amber by an agent that could have stopped at 3.5 m/s^2. */
  amber: number;
  byRule: Record<string, number>;
  /** The longest a claim was held (entitled to go, held by the conflict set), ticks. */
  maxClaimTicks: number;
  /** The first violations, for the failure message. */
  first: string[];
}

/** Hooks that judge the red-light rule at every crossing of a stop line, and a per-tick probe for claims. */
export function auditHooks(extra: TrafficHooks = {}): { hooks: TrafficHooks; audit: Audit; probe: (rig: Rig) => void } {
  const audit: Audit = { crossings: 0, red: 0, amber: 0, byRule: {}, maxClaimTicks: 0, first: [] };
  const hooks: TrafficHooks = {
    ...extra,
    crossed: (c) => {
      audit.crossings++;
      const k = `${c.rule}/${c.aspectNow}`;
      audit.byRule[k] = (audit.byRule[k] ?? 0) + 1;
      if (c.aspectNow === 'red') {
        audit.red++;
        if (audit.first.length < 5) audit.first.push(`red: ${c.agent.key} at tick ${c.tick}, junction ${c.junction}, ${c.speedBefore.toFixed(1)} m/s, ${c.distBefore.toFixed(1)} m from the line`);
      } else if (c.aspectNow === 'amber' && stopDistance(c.speedBefore) <= c.distBefore - 0.3) {
        audit.amber++;
        if (audit.first.length < 5) audit.first.push(`amber: ${c.agent.key} at tick ${c.tick}, junction ${c.junction}, ${c.speedBefore.toFixed(1)} m/s, ${c.distBefore.toFixed(1)} m from the line`);
      }
      extra.crossed?.(c);
    },
  };
  const probe = (rig: Rig): void => {
    for (const a of rig.sim.agents.list()) if (a.claimTick >= 0) audit.maxClaimTicks = Math.max(audit.maxClaimTicks, rig.tick - a.claimTick);
  };
  return { hooks, audit, probe };
}

export const CLAIM_LIMIT_TICKS = CLAIM_TIMEOUT_TICKS + 4;

const TURN_OF: Readonly<Record<string, number>> = { straight: Turn.Straight, left: Turn.Left, right: Turn.Right, uturn: Turn.UTurn };

/** Fixes the movement an agent on arm `inArm` of a crossing takes at the centre (instead of the weighted draw). */
export function routeThrough(a: Agent, cross: CrossRoads, inArm: number, outArm: number): void {
  const mov = cross.movement(inArm, outArm);
  const m = (cross.junctions[0] as NonNullable<(typeof cross.junctions)[number]>).movements[mov];
  if (!m) throw new Error(`no movement ${inArm} to ${outArm}`);
  a.nextEdge = cross.outEdge[outArm] as number;
  a.mov = mov;
  a.jct = 0;
  a.turn = TURN_OF[m.turn] ?? Turn.Straight;
}
