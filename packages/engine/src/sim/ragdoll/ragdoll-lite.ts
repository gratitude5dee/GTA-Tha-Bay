/**
 * Ragdoll-lite (01-engine.md 2.4; M03a1). A ped hit hard enough by a vehicle stops being a kinematic capsule: for up to
 * `ragdollTicks` (3 s) it is a dynamic capsule carrying the impulse, then it gets up (states 300 ragdoll, 301 getting up).
 *
 * The impulse is the two-body formula against the whole assembly (P-SK-08): with the closing velocity `v` along the contact
 * normal, restitution `e`, car mass `M` and ped mass `m`, the exchanged impulse is `J = (1 + e) v / (1/M + 1/m)`. The ped gains
 * `J / m` and the car receives `-J` back as a real impulse. A ped velocity change below `RAGDOLL_MIN_DV` (6 m/s) is a stumble:
 * nothing starts. The number of simultaneous dynamic ragdolls is capped per tier (desktop 8, mobile 4, mobile-low and XR 2);
 * beyond the cap the ped plays the canned fall (control states as usual, no body change).
 *
 * Sim code under the C02 lint.
 */
import { dsqrt, SimStage, type EntityHandle, type EntityId, type QualityTierId, type SystemDef } from '@dv/shared';
import tiersJson from '../../../../../config/engine-tiers.json';
import type { ByteReader, ByteWriter } from '../bytes.ts';
import { Anim, BodyRef, CharacterBody, Control, Ped, Transform, Vehicle, Velocity } from '../ecs/components.ts';
import type { VehicleStore } from '../vehicle/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import { CONTROL_OWNER, CONTROL_PHASE, CONTROL_STATE, animStateOf, packPending } from '../control/states.ts';
import type { Vec3, VehiclePhysics } from '../physics/backend.ts';
import { PHYSICS_CONFIG } from '../physics/config.ts';
import { GROUP_BIT } from '../physics/groups.ts';
import type { EngineServices, SimResource } from '../services.ts';

export const RAGDOLL_ID = 'engine.ragdoll.lite';
export const RAGDOLL_RESOURCE = 'ragdoll-lite';
/** Ped velocity change (m/s) from which a hit ragdolls. */
export const RAGDOLL_MIN_DV = 6;
export const PED_MASS_KG = 80;
/** Restitution of the car-ped contact. */
export const HIT_RESTITUTION = 0.1;

/** Simultaneous dynamic ragdolls by tier, from `config/engine-tiers.json` (desktop 8, mobile 4, mobile-low and XR 2). */
export function ragdollCap(tier: QualityTierId): number {
  const t = (tiersJson.tiers as Record<string, { ragdollCap: number } | undefined>)[tier];
  return t ? t.ragdollCap : 2;
}

export type HitOutcome =
  | { kind: 'none'; pedDeltaV: number }
  | { kind: 'ragdoll'; pedDeltaV: number }
  | { kind: 'canned'; pedDeltaV: number };

interface Entry {
  /** 0: dynamic (or canned fall), 1: getting up. */
  phase: 0 | 1;
  canned: boolean;
  until: number;
}

export interface RagdollOptions {
  ecs: EcsWorld;
  backend: VehiclePhysics;
  services: Pick<EngineServices, 'events'>;
  /** Simultaneous dynamic ragdolls; default from the tier. */
  cap: number;
  dynamicTicks?: number;
  getUpTicks?: number;
}

const identity: [number, number, number, number] = [0, 0, 0, 1];

export class RagdollLite {
  private readonly entries = new Map<number, Entry>();
  private readonly dynamicTicks: number;
  private readonly getUpTicks: number;

  constructor(private readonly o: RagdollOptions) {
    this.dynamicTicks = o.dynamicTicks ?? PHYSICS_CONFIG.character.ragdollTicks;
    this.getUpTicks = o.getUpTicks ?? PHYSICS_CONFIG.character.getUpTicks;
  }

  /** Peds in a dynamic (non-canned) ragdoll right now. */
  get activeBodies(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.phase === 0 && !e.canned) n++;
    return n;
  }

  /** True while `ped` is down or getting up. */
  isDown(ped: EntityHandle): boolean {
    const id = this.o.ecs.resolve(ped);
    return id !== null && this.entries.has(id);
  }

  /**
   * A vehicle of mass `carMassKg` moving with velocity `carVel` (m/s) meets `ped`, which moves with `pedVel`. Applies the
   * result: the ped's ragdoll (or canned fall) and the opposite impulse on the car body `carBody`.
   */
  hit(ped: EntityHandle, tick: number, carBody: number, carMassKg: number, carVel: Readonly<Vec3>, pedVel: Readonly<Vec3> = [0, 0, 0]): HitOutcome {
    const ecs = this.o.ecs;
    const pid = ecs.resolve(ped);
    if (pid === null || this.entries.has(pid)) return { kind: 'none', pedDeltaV: 0 };
    const rx = carVel[0] - pedVel[0];
    const ry = carVel[1] - pedVel[1];
    const rz = carVel[2] - pedVel[2];
    const closing = dsqrt(rx * rx + ry * ry + rz * rz);
    if (!(closing > 0)) return { kind: 'none', pedDeltaV: 0 };
    const m = PED_MASS_KG;
    const big = carMassKg;
    const j = ((1 + HIT_RESTITUTION) * closing) / (1 / big + 1 / m);
    const pedDeltaV = j / m;
    if (pedDeltaV < RAGDOLL_MIN_DV) return { kind: 'none', pedDeltaV };
    const nx = rx / closing;
    const ny = ry / closing;
    const nz = rz / closing;
    // the car gets the opposite impulse
    this.o.backend.applyImpulse(carBody, [-j * nx, -j * ny, -j * nz]);
    const co = ecs.store(Control);
    const handle = ped;
    const hasControl = (ecs as EcsWorld).hasId(pid, Control);
    if (hasControl) {
      co.owner[pid] = CONTROL_OWNER.Ragdoll;
      co.state[pid] = CONTROL_STATE.ragdoll;
      co.sinceTick[pid] = tick;
      co.pending[pid] = packPending(CONTROL_PHASE.Active, CONTROL_OWNER.None);
    }
    if ((ecs as EcsWorld).hasId(pid, Anim)) {
      const an = ecs.store(Anim);
      an.state[pid] = animStateOf(CONTROL_STATE.ragdoll);
      an.sinceTick[pid] = tick;
    }
    const canned = this.activeBodies >= this.o.cap;
    this.entries.set(pid, { phase: 0, canned, until: tick + this.dynamicTicks });
    if (!canned) {
      const body = ecs.store(BodyRef).body[pid] as number;
      this.o.backend.setBodyKind(body, 'dynamic');
      // launch along the contact normal with a little lift, and a tumble about the horizontal axis across it
      const vx = nx * pedDeltaV;
      const vz = nz * pedDeltaV;
      const vy = 0.35 * pedDeltaV;
      this.o.backend.setBodyVelocity(body, [vx, vy, vz], [-nz * 4, 0, nx * 4]);
    }
    this.o.services.events.push({ t: 'ragdoll.start', tick, a: handle, n: pedDeltaV, s: canned ? 'canned' : 'body' });
    return { kind: canned ? 'canned' : 'ragdoll', pedDeltaV };
  }

  /** The PhysicsPost system: ends the dynamic phase, stands the ped up, hands it back to the base owner. */
  system(): SystemDef {
    const target: Vec3 = [0, 0, 0];
    const from: Vec3 = [0, 0, 0];
    const down: Vec3 = [0, -1, 0];
    return {
      id: RAGDOLL_ID, owner: 'S01', stage: SimStage.PhysicsPost, order: 30,
      run: ({ ecs: api, tick }) => {
        if (this.entries.size === 0) return;
        const ecs = api as EcsWorld;
        const ids = [...this.entries.keys()].sort((a, b) => a - b);
        const tr = ecs.store(Transform);
        const co = ecs.store(Control);
        for (const id of ids) {
          const e = this.entries.get(id) as Entry;
          const handle = ecs.handle(id as EntityId);
          if (ecs.resolve(handle) === null) {
            this.entries.delete(id);
            continue;
          }
          if (e.phase === 0 && tick >= e.until) {
            // stand up where it lies: feet on the ground under the capsule, upright, kinematic again
            const body = ecs.store(BodyRef).body[id] as number;
            const x = tr.px[id] as number;
            const z = tr.pz[id] as number;
            from[0] = x; from[1] = (tr.py[id] as number) + 1; from[2] = z;
            const g = this.o.backend.castRay(from, down, 6, GROUP_BIT.static);
            const y = g ? from[1] - g.toi : (tr.py[id] as number);
            if (!e.canned) {
              this.o.backend.setBodyVelocity(body, [0, 0, 0], [0, 0, 0]);
              this.o.backend.setBodyKind(body, 'kinematic');
              const centre = (PHYSICS_CONFIG.character.heightM / 2) + PHYSICS_CONFIG.character.skinM;
              target[0] = x; target[1] = y + centre; target[2] = z;
              this.o.backend.setBodyPose(body, target, identity);
              this.o.backend.setKinematicTarget(body, target, identity);
              tr.px[id] = x; tr.py[id] = y; tr.pz[id] = z;
              tr.qx[id] = 0; tr.qy[id] = 0; tr.qz[id] = 0; tr.qw[id] = 1;
              const ve = ecs.store(Velocity);
              ve.vx[id] = 0; ve.vy[id] = 0; ve.vz[id] = 0; ve.wx[id] = 0; ve.wy[id] = 0; ve.wz[id] = 0;
              if (ecs.hasId(id, CharacterBody)) {
                const cb = ecs.store(CharacterBody);
                cb.grounded[id] = 1; cb.groundNormalY[id] = 1; cb.airTicks[id] = 0;
              }
            }
            e.phase = 1;
            e.until = tick + this.getUpTicks;
            if (ecs.hasId(id, Control)) {
              co.state[id] = CONTROL_STATE.gettingUp;
              co.sinceTick[id] = tick;
            }
            if (ecs.hasId(id, Anim)) {
              const an = ecs.store(Anim);
              an.state[id] = animStateOf(CONTROL_STATE.gettingUp);
              an.sinceTick[id] = tick;
            }
          } else if (e.phase === 1 && tick >= e.until) {
            this.entries.delete(id);
            if (ecs.hasId(id, Control)) {
              co.owner[id] = CONTROL_OWNER.OnFoot;
              co.state[id] = CONTROL_STATE.idle;
              co.sinceTick[id] = tick;
              co.pending[id] = packPending(CONTROL_PHASE.Ready, CONTROL_OWNER.None);
            }
            if (ecs.hasId(id, Anim)) {
              const an = ecs.store(Anim);
              an.state[id] = 0;
              an.sinceTick[id] = tick;
            }
            this.o.services.events.push({ t: 'ragdoll.end', tick, a: handle });
          }
        }
      },
    };
  }

  resource(): SimResource {
    return {
      name: RAGDOLL_RESOURCE,
      hash: (h) => {
        for (const id of [...this.entries.keys()].sort((a, b) => a - b)) {
          const e = this.entries.get(id) as Entry;
          h.u32(id).u8(e.phase).u8(e.canned ? 1 : 0).u32(e.until);
        }
      },
      save: (w: ByteWriter) => {
        const ids = [...this.entries.keys()].sort((a, b) => a - b);
        w.u32(ids.length);
        for (const id of ids) {
          const e = this.entries.get(id) as Entry;
          w.u32(id); w.u8(e.phase); w.u8(e.canned ? 1 : 0); w.u32(e.until);
        }
      },
      load: (r: ByteReader) => {
        this.entries.clear();
        for (let n = r.u32(); n > 0; n--) {
          const id = r.u32();
          const phase = r.u8() as 0 | 1;
          const canned = r.u8() !== 0;
          this.entries.set(id, { phase, canned, until: r.u32() });
        }
      },
    };
  }
}

/** Convenience for callers holding only an `EcsApi`: the closing speed at which a ped of 80 kg takes `dv` from a car of `carMassKg`. */
export function closingSpeedFor(dv: number, carMassKg: number): number {
  return (dv * (1 / carMassKg + 1 / PED_MASS_KG) * PED_MASS_KG) / (1 + HIT_RESTITUTION);
}

/**
 * The contact between moving vehicles and `Ped` capsules: a ped inside the vehicle's footprint (its wheelbase and overhangs, its
 * track, 1.8 m of height) while the vehicle moves faster than 2 m/s is hit. The closing velocity is the vehicle's velocity.
 */
export function vehiclePedHitSystem(ragdoll: RagdollLite, store: VehicleStore): SystemDef {
  return {
    id: 'engine.ragdoll.vehicle-hits', owner: 'S01', stage: SimStage.PhysicsPost, order: 25,
    run: ({ ecs: api, tick }) => {
      const ecs = api as EcsWorld;
      const peds = ecs.query([Ped, Transform, BodyRef]);
      if (peds.length === 0) return;
      const cars = ecs.query([Vehicle, Transform, Velocity, BodyRef]);
      const tr = ecs.store(Transform);
      const ve = ecs.store(Velocity);
      const bodies = ecs.store(BodyRef).body;
      for (let c = 0; c < cars.length; c++) {
        const cid = cars[c] as number;
        const vx = ve.vx[cid] as number;
        const vz = ve.vz[cid] as number;
        if (vx * vx + vz * vz < 4) continue;
        const rt = store.rt.get(cid);
        if (!rt) continue;
        const p = rt.profile;
        const qx = tr.qx[cid] as number;
        const qy = tr.qy[cid] as number;
        const qz = tr.qz[cid] as number;
        const qw = tr.qw[cid] as number;
        const fx = -2 * (qx * qz + qw * qy);
        const fz = -(1 - 2 * (qx * qx + qy * qy));
        // the body reaches about 1.1 m past the axles; the capsule radius and a margin make the contact certain before Rapier stops the car
        const front = p.wheelbaseM / 2 + 1.1 + 0.35 + 0.6;
        const back = p.wheelbaseM / 2 + 1.1 + 0.35 + 0.6;
        const half = p.trackM / 2 + 0.35 + 0.35;
        for (let i = 0; i < peds.length; i++) {
          const pid = peds[i] as number;
          const dx = (tr.px[pid] as number) - (tr.px[cid] as number);
          const dz = (tr.pz[pid] as number) - (tr.pz[cid] as number);
          const dy = (tr.py[pid] as number) - (tr.py[cid] as number);
          if (dy > 1.8 || dy < -2.5) continue;
          const along = dx * fx + dz * fz;
          const across = dx * -fz + dz * fx;
          if (along > front || along < -back || across > half || across < -half) continue;
          ragdoll.hit(ecs.handle(pid as EntityId), tick, bodies[cid] as number, p.massKg, [vx, ve.vy[cid] as number, vz]);
        }
      }
    },
  };
}

