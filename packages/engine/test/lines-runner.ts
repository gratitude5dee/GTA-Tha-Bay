/**
 * Runs an input line headless in the `canonical` profile (M03a1): the oracle track, the vehicle named by `start.prefab` with the
 * player at its wheel, 60 settle ticks, then the line. The runner returns what the oracle tests measure.
 */
import { SIM_DT } from '@dv/shared';
import { Transform } from '../src/sim/ecs/components.ts';
import type { PhysicsBuild, VehiclePhysics } from '../src/sim/physics/backend.ts';
import type { WheelPath } from '../src/sim/vehicle/index.ts';
import { LinePlayer } from '../src/sim/lines/player.ts';
import { lineLength, type LineFile } from '../src/sim/lines/format.ts';
import { createVehicleWorld, launch, view, type VehicleView, type VehicleWorld } from './vehicle-sim.ts';

export const SETTLE_TICKS = 60;

export interface LineRun {
  world: VehicleWorld;
  /** The view at the end of every line tick (index = line tick). */
  trace: VehicleView[];
  /** Sim tick at which line tick 0 played. */
  baseTick: number;
  /** State hash after the last tick. */
  hash: string;
  /** Gear changes in order, from `Vehicle.gear` (the first gear counts). */
  gears: number[];
}

export interface RunOptions {
  /** Replaces `start.prefab`. */
  prefab?: string;
  /** Ticks to run after the line ends. */
  extraTicks?: number;
  keepWorld?: boolean;
  /** A wheel path other than the selected one, and a Rapier build other than `deterministic-compat` (M03a2 spike). */
  wheelPath?: (backend: VehiclePhysics) => WheelPath;
  build?: PhysicsBuild;
}

export async function runLine(line: LineFile, opts: RunOptions = {}): Promise<LineRun> {
  const prefab = opts.prefab ?? line.start.prefab ?? 'vehicle.sedan';
  const world = await createVehicleWorld({
    prefab, pos: line.start.pos, yaw: line.start.yaw,
    config: { seed: line.seed, profile: line.profile, ...(opts.build ? { physicsBuild: opts.build } : {}) },
    ...(opts.wheelPath ? { wheelPath: opts.wheelPath } : {}),
  });
  const sim = world.sim;
  // settle on the springs
  for (let i = 0; i < SETTLE_TICKS; i++) sim.step(1);
  if (line.start.speed) {
    // heading east in the oracle track; the speed is along the vehicle's heading
    launch(world, line.start.speed);
  }
  const baseTick = sim.tick;
  // the probe of `follow` and `waitNear`: where the vehicle is and which way it faces (yaw = 2 atan2(qy, qw), forward is (-sin, -cos))
  const probe = (): { x: number; z: number; yaw: number; inVehicle: boolean } => {
    const id = sim.ecs.resolve(world.vehicle) as number;
    const tr = sim.ecs.store(Transform);
    return { x: tr.px[id] as number, z: tr.pz[id] as number, yaw: 2 * Math.atan2(tr.qy[id] as number, tr.qw[id] as number), inVehicle: true };
  };
  const player = new LinePlayer(line, baseTick, probe);
  const trace: VehicleView[] = [];
  const gears: number[] = [];
  let lastGear = -99;
  const total = lineLength(line) + (opts.extraTicks ?? 0);
  for (let t = 0; t < total; t++) {
    sim.step(1, (tick) => player.frame(tick));
    const v = view(world);
    trace.push(v);
    if (v.gear !== lastGear) {
      gears.push(v.gear);
      lastGear = v.gear;
    }
  }
  const hash = sim.hash();
  void SIM_DT;
  if (!opts.keepWorld) sim.dispose();
  return { world, trace, baseTick, hash, gears };
}
