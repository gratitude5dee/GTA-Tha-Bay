import { RngStreams, type Fnv64, type InputFrame, type SimServices } from '@dv/shared';
import type { ByteReader, ByteWriter } from './bytes.ts';
import { SimEventLog } from './events.ts';
import type { PhysicsSystemsBackend } from './physics/backend.ts';
import type { VehicleDebugContext } from './vehicle/debug.ts';
import type { WorldClock } from './world/clock.ts';
import { createWorldHub, type WorldHub } from './world/index.ts';

/**
 * Sim state that lives outside the ECS but must be hashed and checkpointed (C02 rule 7: RNG states, clock, weather,
 * pursuit, economy; M01a2 adds physics). Resources are hashed in ascending `name` order after the component stores.
 */
export interface SimResource {
  readonly name: string;
  hash(h: Fnv64): void;
  save(w: ByteWriter): void;
  load(r: ByteReader): void;
}

/** The services bag of this milestone: C02 SimServices plus the named RNG streams and the current input frame. */
export interface EngineServices extends SimServices {
  readonly rng: RngStreams;
  /** Player 0's quantized input for the tick about to run (C02 determinism rule 4); null when there is none. */
  input: InputFrame | null;
  /** The physics backend once the session has one (M01a2); null in physics-free sims. */
  physics: PhysicsSystemsBackend | null;
  /** Facts for the page and other systems (ownership transitions). Drained by the host once per frame. */
  readonly events: SimEventLog;
  /** State of the ownership machine that does not fit the `Control` component (M01b1). */
  readonly control: ControlShared;
  /** Camera lock and the collision result the Publish stage puts in the snapshot side block (M01b1). */
  camera: CameraDirectiveState;
  /** The game clock and weather once the session has one (`installClock`, M02b2); null in clock-free sims. */
  clock: WorldClock | null;
  /** The world services (M02c1): `WorldApi` and `WorldBoundsPort`, null until the world sim module registers them. */
  readonly world: WorldHub;
  /** Snapshot side-block providers by key (M03a1: `veh`, `prompt`). Called once per tick in the Publish stage; a null result is left out. */
  readonly side: Map<string, () => unknown>;
  /** The vehicle module's handles for the QA commands (M03a1); set by `registerVehicleModule`, read only by `vehicleQa`. */
  vehicleCtx: VehicleDebugContext | null;
}

/** Where a pending teleport is going. One teleport at a time; a second request is refused as busy. */
export interface ControlShared {
  teleportActive: boolean;
  teleportX: number;
  teleportY: number;
  teleportZ: number;
}

/**
 * Camera state owned by the sim (C04 `CameraDirective`). `lockPlayerToggle` and `reason` are simulation state: hashed and
 * checkpointed. The rest is derived by the camera collision system in the Publish stage and read by the snapshot publisher.
 */
export interface CameraDirectiveState {
  lockPlayerToggle: boolean;
  reason: 'player' | 'vehicle' | 'mission' | 'cutscene' | 'mode' | 'debug';
  /** EntityHandle the camera follows; 0 when there is none. Derived. */
  target: number;
  /** Collision result along the tp offset for the right and the left shoulder, metres from the anchor. Derived. */
  allowedRight: number;
  allowedLeft: number;
}

export function createSimServices(seed: number): EngineServices {
  return {
    xrPoses: null,
    rng: new RngStreams(seed),
    input: null,
    physics: null,
    events: new SimEventLog(),
    control: { teleportActive: false, teleportX: 0, teleportY: 0, teleportZ: 0 },
    camera: { lockPlayerToggle: false, reason: 'player', target: 0, allowedRight: 0, allowedLeft: 0 },
    clock: null,
    world: createWorldHub(),
    side: new Map(),
    vehicleCtx: null,
  };
}

/** The ownership machine's shared state and the camera lock as a hashed, checkpointed resource. */
export function controlResource(services: Pick<EngineServices, 'control' | 'camera'>): SimResource {
  const reasons = ['player', 'vehicle', 'mission', 'cutscene', 'mode', 'debug'] as const;
  return {
    name: 'control',
    hash(h) {
      const c = services.control;
      h.u8(c.teleportActive ? 1 : 0).f64(c.teleportX).f64(c.teleportY).f64(c.teleportZ);
      h.u8(services.camera.lockPlayerToggle ? 1 : 0).u8(reasons.indexOf(services.camera.reason));
    },
    save(w) {
      const c = services.control;
      w.u8(c.teleportActive ? 1 : 0);
      w.f64(c.teleportX);
      w.f64(c.teleportY);
      w.f64(c.teleportZ);
      w.u8(services.camera.lockPlayerToggle ? 1 : 0);
      w.u8(reasons.indexOf(services.camera.reason));
    },
    load(r) {
      const c = services.control;
      c.teleportActive = r.u8() !== 0;
      c.teleportX = r.f64();
      c.teleportY = r.f64();
      c.teleportZ = r.f64();
      services.camera.lockPlayerToggle = r.u8() !== 0;
      services.camera.reason = reasons[r.u8()] ?? 'player';
    },
  };
}

/** The RNG streams as a hashed, checkpointed resource (C02 rule 3: stream states are hashed resources). */
export function rngResource(rng: RngStreams): SimResource {
  return {
    name: 'rng',
    hash(h) {
      for (const { name, state } of rng.states()) {
        h.str(name);
        for (const word of state) h.u32(word);
      }
    },
    save(w) {
      const states = rng.states();
      w.u32(states.length);
      for (const { name, state } of states) {
        w.str(name);
        for (const word of state) w.u32(word);
      }
    },
    load(r) {
      const list: { name: string; state: [number, number, number, number] }[] = [];
      for (let n = r.u32(); n > 0; n--) {
        const name = r.str();
        list.push({ name, state: [r.u32(), r.u32(), r.u32(), r.u32()] });
      }
      rng.setStates(list);
    },
  };
}
