/**
 * A headless vehicle world for the M03a1 tests: the oracle track, the control systems, the vehicle module, one vehicle and
 * (optionally) the player at its wheel. `canonical` profile, the deterministic Rapier build.
 */
import { SIM_DT, SimButton, type EntityHandle, type InputFrame, type SimConfig } from '@dv/shared';
import { registerControlSystems } from '../src/sim/control/index.ts';
import { BodyRef, Control, LocalPlayer, Transform, Vehicle, VehicleDamage, Velocity } from '../src/sim/ecs/components.ts';
import { ENGINE_PREFABS, PrefabRegistry } from '../src/sim/prefabs/registry.ts';
import { createPhysicsSim, type PhysicsSim } from '../src/sim/sim-factory.ts';
import { registerVehicleModule, seatDriver, type VehicleModule } from '../src/sim/vehicle/index.ts';
import { oracleShapes } from './fixtures/oracle-track.ts';
import { testConfig } from './helpers.ts';

export interface VehicleSimOptions {
  config?: Partial<SimConfig>;
  /** Vehicle prefab id; default `vehicle.sedan`. `null` spawns none. */
  prefab?: string | null;
  pos?: [number, number, number];
  /** Heading about +Y; -pi/2 faces +X. */
  yaw?: number;
  /** Where the player stands; default next to the vehicle's driver door. */
  playerAt?: [number, number, number];
  /** The player's heading; default the vehicle's. */
  playerYaw?: number;
  /** Put the player at the wheel at once (default true). */
  seated?: boolean;
  /** Skip the oracle statics (the caller adds its own). */
  noTrack?: boolean;
  /** Extra setup after the module is registered. */
  setup?: (s: { sim: PhysicsSim; mod: VehicleModule; prefabs: PrefabRegistry }) => void;
}

export interface VehicleWorld {
  sim: PhysicsSim;
  mod: VehicleModule;
  prefabs: PrefabRegistry;
  vehicle: EntityHandle;
  player: EntityHandle;
  /** Player 0 input for each tick: set before stepping. */
  input: Partial<InputFrame>;
}

export const NEUTRAL: InputFrame = {
  tick: 0, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0, device: 7,
};

export async function createVehicleWorld(opts: VehicleSimOptions = {}): Promise<VehicleWorld> {
  const pos = opts.pos ?? [0, 0, 0];
  const yaw = opts.yaw ?? -Math.PI / 2;
  const holder: { vehicle: EntityHandle; player: EntityHandle; mod: VehicleModule | null; prefabs: PrefabRegistry | null } = {
    vehicle: 0 as EntityHandle, player: 0 as EntityHandle, mod: null, prefabs: null,
  };
  const sim = await createPhysicsSim(testConfig(opts.config), {
    id: 'vehicle-test',
    setup: (s) => {
      if (!opts.noTrack) for (const [key, shapes] of Object.entries(oracleShapes())) s.backend.addChunkStatics(key, shapes);
      registerControlSystems(s.core, s.backend);
      const prefabs = new PrefabRegistry(s.ecs, s.backend);
      prefabs.load(ENGINE_PREFABS);
      const mod = registerVehicleModule(s.core, s.backend, prefabs);
      holder.mod = mod;
      holder.prefabs = prefabs;
      const playerAt = opts.playerAt ?? [pos[0], pos[1], pos[2] - 3];
      holder.player = prefabs.spawn('player.default', { pos: playerAt, yaw: opts.playerYaw ?? yaw }, 'player:0');
      if (opts.prefab !== null) holder.vehicle = prefabs.spawn(opts.prefab ?? 'vehicle.sedan', { pos, yaw }, 'veh:test0');
      opts.setup?.({ sim: s as unknown as PhysicsSim, mod, prefabs });
      s.backend.step(SIM_DT, 1);
    },
  });
  const world: VehicleWorld = {
    sim, mod: holder.mod as VehicleModule, prefabs: holder.prefabs as PrefabRegistry, vehicle: holder.vehicle, player: holder.player, input: {},
  };
  if (opts.prefab !== null && opts.seated !== false) {
    // one tick so the spawn commands are applied, then seat the driver
    sim.step(1);
    const ok = seatDriver(sim.ecs, sim.backend, world.mod.store, sim.services, world.player, world.vehicle, sim.tick);
    if (!ok) throw new Error('could not seat the driver');
  }
  return world;
}

/** Steps `n` ticks with the world's held input (throttle, brake, steer are i8 as in C03). */
export function drive(w: VehicleWorld, n: number, f: Partial<InputFrame> = {}, each?: (tick: number) => void): void {
  for (let i = 0; i < n; i++) {
    w.sim.step(1, (tick) => ({ ...NEUTRAL, ...w.input, ...f, tick, pressed: 0, released: 0 }));
    each?.(w.sim.tick);
  }
}

export const THROTTLE = 127;
export const HANDBRAKE = 1 << SimButton.Handbrake;

export interface VehicleView {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Signed forward speed, m/s. */
  speed: number;
  kph: number;
  /** Horizontal speed, m/s. */
  horiz: number;
  gear: number;
  rpm: number;
  bodyHealth: number;
  engineHealth: number;
  /** y component of the body's up axis. */
  upY: number;
  yawRate: number;
  /** Wheels with ground. */
  contacts: number;
}

export function view(w: VehicleWorld): VehicleView {
  const e = w.sim.ecs;
  const id = e.resolve(w.vehicle) as number;
  const tr = e.store(Transform);
  const ve = e.store(Velocity);
  const v = e.store(Vehicle);
  const dm = e.store(VehicleDamage);
  const qx = tr.qx[id] as number; const qy = tr.qy[id] as number; const qz = tr.qz[id] as number; const qw = tr.qw[id] as number;
  const upY = 1 - 2 * (qx * qx + qz * qz);
  const vx = ve.vx[id] as number; const vy = ve.vy[id] as number; const vz = ve.vz[id] as number;
  const speed = v.speed[id] as number;
  return {
    x: tr.px[id] as number, y: tr.py[id] as number, z: tr.pz[id] as number, vx, vy, vz, speed, kph: speed * 3.6,
    horiz: Math.sqrt(vx * vx + vz * vz), gear: v.gear[id] as number, rpm: v.rpm[id] as number,
    bodyHealth: dm.body[id] as number, engineHealth: dm.engine[id] as number, upY, yawRate: ve.wy[id] as number,
    contacts: w.mod.store.rt.get(id)?.contacts ?? 0,
  };
}

export function playerControl(w: VehicleWorld): { owner: number; state: number; pending: number } {
  const e = w.sim.ecs;
  const id = e.query([LocalPlayer])[0] as number;
  const co = e.store(Control);
  return { owner: co.owner[id] as number, state: co.state[id] as number, pending: co.pending[id] as number };
}

/** Sets the vehicle's velocity along +X (heading east) without the jump counting as a collision. */
export function launch(w: VehicleWorld, mps: number, vy = 0): void {
  w.sim.backend.setBodyVelocity(bodyOf(w), [mps, vy, 0], [0, 0, 0]);
  const id = w.sim.ecs.resolve(w.vehicle) as number;
  const rt = w.mod.store.rt.get(id);
  if (rt) { rt.lastVx = mps; rt.lastVz = 0; rt.impactAcc = 0; }
}

export function bodyOf(w: VehicleWorld): number {
  const id = w.sim.ecs.resolve(w.vehicle) as number;
  return w.sim.ecs.store(BodyRef).body[id] as number;
}
