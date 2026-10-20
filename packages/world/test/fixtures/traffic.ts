/**
 * Harness for the traffic specs (M03b1): a `WorldServices` over hand-built or baked chunks, a `TrafficSim` on it, and a loop that runs
 * AI steps at 30 Hz without the engine, Rapier or an ECS.
 */
import type { ChunkKey, QualityTierId, SimChunk, WeatherPreset, WorldIndex } from '@dv/shared';
import { createWorldApi, type WorldServices } from '../../src/sim/api/world-api.ts';
import { Blackout } from '../../src/sim/env/blackout.ts';
import { WitnessBoard } from '../../src/sim/traffic/witness.ts';
import { TrafficSim, type Focus, type StepInput, type TrafficHooks, type TrafficOptions } from '../../src/sim/traffic/sim.ts';
import { trafficWorldOf } from '../../src/sim/traffic/world.ts';
import { indexOf, loadAll, storeOf } from './world.ts';
import type { ChunkStore } from '../../src/sim/streaming/chunk-store.ts';
import type { GraphTopology } from '@dv/shared';

export interface Rig {
  services: WorldServices;
  store: ChunkStore<SimChunk>;
  sim: TrafficSim;
  board: WitnessBoard;
  /** Ticks run so far. */
  tick: number;
  focus: Focus;
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
  focus?: Focus;
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
