/**
 * Per-vehicle runtime state that does not fit the C01 `Vehicle` component (M03a1; "HandlingState store in the engine id
 * range"). The `Vehicle`, `VehicleDamage` and `Seat` components carry what the page and the net layer read; this store
 * holds the rest of S06's `HandlingState`, the suspension memory, the driver link and the water-wall counters. It is a
 * hashed, checkpointed `SimResource`, keyed by the dense `EntityId` (which is stable inside a session and across a
 * checkpoint restore).
 */
import {
  newHandlingState, type HandlingProfile, type HandlingState, type WaterWallState,
} from '@dv/shared';
import type { ByteReader, ByteWriter } from '../bytes.ts';
import type { SimResource } from '../services.ts';
import { handlingById } from './presets.ts';

/** Quantized control input of one vehicle (the C03 `InputFrame` fields a car reads). */
export interface VehicleInput {
  /** 0..127 */
  throttle: number;
  /** 0..127 */
  brake: number;
  /** -127..127, positive to the right. */
  steer: number;
  handbrake: boolean;
}

export interface VehicleRuntime {
  readonly profile: HandlingProfile;
  readonly hs: HandlingState;
  /** Suspension length per wheel at the last substep, metres; NaN while the wheel has no ground. */
  readonly susp: [number, number, number, number];
  /** Ticks since any wheel touched ground (0 while at least one does). */
  airTicks: number;
  /** Ticks left of the extra landing damping after a flight. */
  landTicks: number;
  /** Dense id of the driver entity, 0 when nobody drives. */
  driver: number;
  /** A locked vehicle refuses entry (`engine.vehicle.locked`). */
  locked: boolean;
  /** True while a script or a brain sets `input` itself; otherwise `input` follows the driver (or the parked default). */
  external: boolean;
  /** Wheels with ground at the last substep. */
  contacts: number;
  wet: WaterWallState;
  /** Ticks since the vehicle was placed; used by the respawn fade. */
  respawnFade: number;
  /** Input of a vehicle without a local driver (traffic brains, scripts); a parked car holds the handbrake. */
  readonly input: VehicleInput;
  /** Body velocity at the end of the previous tick, for impact detection. */
  lastVx: number;
  lastVz: number;
  /** Horizontal speed lost over the run of ticks that is still counting as one impact, m/s. */
  impactAcc: number;
}

export function parkedInput(): VehicleInput {
  return { throttle: 0, brake: 0, steer: 0, handbrake: true };
}

export class VehicleStore {
  readonly rt = new Map<number, VehicleRuntime>();

  /** Creates the runtime of vehicle `id` for handling profile `handlingId`; replaces an existing one. */
  ensure(id: number, handlingId: string): VehicleRuntime {
    const have = this.rt.get(id);
    if (have && have.profile.id === handlingId) return have;
    const profile = handlingById(handlingId);
    const rt: VehicleRuntime = {
      profile,
      hs: newHandlingState(),
      susp: [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
      airTicks: 0,
      landTicks: 0,
      driver: 0,
      locked: false,
      external: false,
      contacts: 0,
      wet: { wetTicks: 0, stalled: false },
      respawnFade: 0,
      input: parkedInput(),
      lastVx: 0,
      lastVz: 0,
      impactAcc: 0,
    };
    this.rt.set(id, rt);
    return rt;
  }

  drop(id: number): void {
    this.rt.delete(id);
  }

  sortedIds(): number[] {
    return [...this.rt.keys()].sort((a, b) => a - b);
  }
}

export const VEHICLE_RESOURCE = 'vehicles';

export function vehicleResource(store: VehicleStore): SimResource {
  return {
    name: VEHICLE_RESOURCE,
    hash(h) {
      for (const id of store.sortedIds()) {
        const r = store.rt.get(id) as VehicleRuntime;
        const s = r.hs;
        h.u32(id).str(r.profile.id).u8(s.gear & 0xff).f32(s.rpm).u32(s.shiftTicks).f32(s.steerRad);
        for (let k = 0; k < 4; k++) h.f32(Number.isNaN(r.susp[k]) ? -1 : (r.susp[k] as number));
        h.u32(r.airTicks).u32(r.landTicks).u32(r.driver).u8(r.locked ? 1 : 0).u8(r.external ? 1 : 0).u8(r.contacts).u32(r.wet.wetTicks).u8(r.wet.stalled ? 1 : 0);
        h.u8(r.input.throttle).u8(r.input.brake).u8(r.input.steer & 0xff).u8(r.input.handbrake ? 1 : 0);
      }
    },
    save(w: ByteWriter) {
      const ids = store.sortedIds();
      w.u32(ids.length);
      for (const id of ids) {
        const r = store.rt.get(id) as VehicleRuntime;
        const s = r.hs;
        w.u32(id);
        w.str(r.profile.id);
        w.i8(s.gear);
        w.f64(s.rpm);
        w.u32(s.shiftTicks);
        w.f64(s.steerRad);
        for (let k = 0; k < 4; k++) w.f64(r.susp[k] as number);
        w.u32(r.airTicks);
        w.u32(r.landTicks);
        w.u32(r.driver);
        w.u8(r.locked ? 1 : 0);
        w.u8(r.external ? 1 : 0);
        w.u8(r.contacts);
        w.u32(r.wet.wetTicks);
        w.u8(r.wet.stalled ? 1 : 0);
        w.u32(r.respawnFade);
        w.u8(r.input.throttle);
        w.u8(r.input.brake);
        w.i8(r.input.steer);
        w.u8(r.input.handbrake ? 1 : 0);
        w.f64(r.lastVx);
        w.f64(r.lastVz);
        w.f64(r.impactAcc);
      }
    },
    load(r: ByteReader) {
      store.rt.clear();
      for (let n = r.u32(); n > 0; n--) {
        const id = r.u32();
        const rt = store.ensure(id, r.str());
        const s = rt.hs;
        s.gear = r.i8();
        s.rpm = r.f64();
        s.shiftTicks = r.u32();
        s.steerRad = r.f64();
        for (let k = 0; k < 4; k++) rt.susp[k] = r.f64();
        rt.airTicks = r.u32();
        rt.landTicks = r.u32();
        rt.driver = r.u32();
        rt.locked = r.u8() !== 0;
        rt.external = r.u8() !== 0;
        rt.contacts = r.u8();
        rt.wet = { wetTicks: r.u32(), stalled: r.u8() !== 0 };
        rt.respawnFade = r.u32();
        rt.input.throttle = r.u8();
        rt.input.brake = r.u8();
        rt.input.steer = r.i8();
        rt.input.handbrake = r.u8() !== 0;
        rt.lastVx = r.f64();
        rt.lastVz = r.f64();
        rt.impactAcc = r.f64();
      }
    },
  };
}
