/**
 * Harness for the pedestrian specs (M03b2): a `WorldServices` over hand-built or baked chunks, a `PedSim` on it, and a loop that runs
 * AI steps at 30 Hz without the engine, Rapier or an ECS.
 */
import { PedEdgeKind, PedNodeFlag, type ChunkKey, type GraphTopology, type PedEdge, type PedNode, type QualityTierId, type SimChunk, type WeatherPreset, type WorldIndex } from '@dv/shared';
import { DENSITY } from '../../src/sim/traffic/density.ts';
import { createWorldApi, type WorldServices } from '../../src/sim/api/world-api.ts';
import { Blackout } from '../../src/sim/env/blackout.ts';
import type { Head } from '../../src/sim/peds/avoidance.ts';
import type { PedVehicle } from '../../src/sim/peds/fsm.ts';
import { PedSim, type PedOptions } from '../../src/sim/peds/sim.ts';
import type { ChunkStore } from '../../src/sim/streaming/chunk-store.ts';
import type { TrafficFocus } from '../../src/sim/traffic/sim.ts';
import { WitnessBoard } from '../../src/sim/traffic/witness.ts';
import { trafficWorldOf } from '../../src/sim/traffic/world.ts';
import { crossRoads, type CrossRoads } from './roads.ts';
import { indexOf, loadAll, storeOf } from './world.ts';

export interface PedRig {
  services: WorldServices;
  store: ChunkStore<SimChunk>;
  sim: PedSim;
  board: WitnessBoard;
  tick: number;
  focus: TrafficFocus;
  env: { hour: number; weather: WeatherPreset };
  vehicles: PedVehicle[];
  head: Head | null;
  /** Runs `ticks` sim ticks; the AI steps on every second one. `each` runs after every tick with the tick that ran. */
  run(ticks: number, each?: (tick: number) => void): void;
}

export interface PedRigOptions {
  chunks: readonly SimChunk[];
  topology?: GraphTopology | null;
  index?: WorldIndex;
  tier?: QualityTierId;
  seed?: number;
  focus?: TrafficFocus;
  initialFill?: boolean;
  crowd?: number;
  hour?: number;
  weather?: WeatherPreset;
  options?: Partial<PedOptions>;
}

export async function makePedRig(o: PedRigOptions): Promise<PedRig> {
  const store = storeOf(o.chunks);
  await loadAll(store, o.chunks.map((c) => c.key as ChunkKey));
  const clock = { t: 0 };
  const blackout = new Blackout();
  const services = createWorldApi(store, o.index ?? indexOf(), { tick: () => clock.t }, { blackout, ...(o.topology ? { topology: o.topology } : {}) });
  const board = new WitnessBoard();
  const sim = new PedSim({
    world: trafficWorldOf(services, store),
    seed: o.seed ?? 0xc0ffee,
    tier: o.tier ?? 'mobile-low',
    board,
    initialFill: o.initialFill ?? true,
    ...(o.crowd !== undefined ? { crowdDensity: () => o.crowd as number } : {}),
    ...(o.options ?? {}),
  });
  const rig: PedRig = {
    services, store, sim, board, tick: 0,
    focus: o.focus ?? { x: 0, z: 0, vx: 0, vz: 0 },
    env: { hour: o.hour ?? 12, weather: o.weather ?? 'clear' },
    vehicles: [],
    head: null,
    run(ticks, each) {
      for (let i = 0; i < ticks; i++) {
        clock.t = rig.tick;
        if (rig.tick % 2 === 0) sim.step({ tick: rig.tick, focus: rig.focus, env: rig.env, vehicles: rig.vehicles, head: rig.head });
        each?.(rig.tick);
        rig.tick++;
      }
    },
  };
  return rig;
}

/** A moving vehicle for the dodge, flee, hit and yield rules: at (x, z) heading (hx, hz) at `speed`. */
export function vehicleAt(x: number, z: number, hx: number, hz: number, speed: number): PedVehicle {
  return { x, z, vx: hx * speed, vz: hz * speed, hx, hz, speed, halfW: 0.95, halfL: 2.4 };
}

export interface PedCrossing {
  cross: CrossRoads;
  chunk: SimChunk;
  /** Ped node ids: north-west, north corner of the crosswalk, south corner of the crosswalk, south-west. */
  nodes: [number, number, number, number];
  /** The movement the crosswalk waits for (north to south: the north-south phase, which is green first). */
  movement: number;
  /** The same crossing waiting for the east-west phase, which is green second. */
  movementEw: number;
}

/** Index of the `cbd` profile in `config/world/density.json` (a busy daytime pedestrian curve). */
const PROFILE_CBD = DENSITY.profiles.findIndex((p) => p.name === 'cbd');

const ped = (id: number, x: number, z: number, flags = 0): PedNode => ({ id, x, y: 0, z, flags });
const pedEdge = (a: number, b: number, kind: PedEdgeKind, junction = -1, movement = -1): PedEdge => ({ a, b, kind, widthM: kind === PedEdgeKind.Crosswalk ? 3 : 1.6, junction, movement });

/**
 * A signalled four-way crossing (the traffic fixture) with a pedestrian graph on its west arm: a sidewalk on each side of the road, 30
 * m long, and a crosswalk between their ends that waits for the parallel vehicle movement of junction 0. A pedestrian that walks this
 * loop meets the crossing every 60 m.
 */
export function pedCrossing(o: { green?: number } = {}): PedCrossing {
  const cross = crossRoads(o.green !== undefined ? { green: o.green } : {});
  const m = cross.movement(0, 2);
  const mEw = cross.movement(1, 3);
  const nodes: PedNode[] = [
    ped(0, -40, -6),
    ped(1, -10, -6, PedNodeFlag.Crossing | PedNodeFlag.Waiting),
    ped(2, -10, 6, PedNodeFlag.Crossing | PedNodeFlag.Waiting),
    ped(3, -40, 6),
  ];
  const edges: PedEdge[] = [
    pedEdge(0, 1, PedEdgeKind.Sidewalk),
    pedEdge(1, 2, PedEdgeKind.Crosswalk, 0, m),
    pedEdge(2, 3, PedEdgeKind.Sidewalk),
  ];
  const chunk: SimChunk = {
    ...cross.chunk,
    pedNodes: nodes,
    pedEdges: edges,
    spawn: { ...cross.chunk.spawn, pedSlots: 40, densityProfile: PROFILE_CBD },
  };
  return { cross, chunk, nodes: [0, 1, 2, 3], movement: m, movementEw: mEw };
}
