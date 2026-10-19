import { dcos, datan2, dsin, dsqrt, normalizeAngle, SimButton, SimStage, SIM_DT, TWO_PI, type EntityId, type InputFrame, type SystemDef } from '@dv/shared';
import type { EngineServices } from '../services.ts';
import { Anim, BodyRef, CharacterBody, Control, PlayerControlled, Transform, Velocity } from '../ecs/components.ts';
import type { PhysicsSystemsBackend, Vec3 } from '../physics/backend.ts';
import { PHYSICS_CONFIG, type CharacterConfig } from '../physics/config.ts';
import { GROUP_BIT } from '../physics/groups.ts';
import { animStateOf, CONTROL_OWNER, CONTROL_STATE } from './states.ts';
import { probeVault, vaultPoint, VAULT_TICKS, type VaultStore } from './vault.ts';

export const ONFOOT_ID = 'engine.control.onfoot';

export interface OnFootOptions {
  backend: PhysicsSystemsBackend;
  /** Supplies player 0's InputFrame (`services.input`); `events` receives the `foot.step` audio cues. */
  services: Pick<EngineServices, 'input'> & Partial<Pick<EngineServices, 'events'>>;
  /** Vaults in progress. Without a store the controller never vaults (the earlier scenarios and their goldens). */
  vault?: VaultStore;
  /** Defaults to the `character` block of config/physics.json. */
  config?: CharacterConfig;
}

/** What the sim reads when no InputFrame arrived for the tick. */
export const NEUTRAL_INPUT: Readonly<InputFrame> = Object.freeze({
  tick: 0, buttons: 0, pressed: 0, released: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0,
  camYaw: 0, camPitch: 0, context: 0, device: 0,
});

/** u16 `camYaw` to radians. */
export const YAW_UNIT = TWO_PI / 65536;
/** Heading turn rate when the character faces its movement direction, rad/s (presentation; replayed identically). */
const TURN_RATE = 12.566370614359172; // 4 pi

const isAirState = (s: number): boolean => s === CONTROL_STATE.jump || s === CONTROL_STATE.fall;

/** Ticks between footfalls while walking, running and sprinting (about 2.0, 3.3 and 4.3 steps a second). */
const STEP_PERIOD_TICKS: Readonly<Record<number, number>> = {
  [CONTROL_STATE.walk]: 30, [CONTROL_STATE.run]: 18, [CONTROL_STATE.sprint]: 14,
};
export const FOOT_STEP_CUE = 'foot.step';

/** Vertical offset from the feet (the `Transform`) to the centre of the capsule body. */
export function capsuleCentreOffset(cfg: CharacterConfig = PHYSICS_CONFIG.character): number {
  return cfg.heightM / 2 + cfg.skinM;
}

/**
 * The on-foot controller (stage PhysicsPre, before the rebase and before the generic kinematic-target loop).
 *
 * Movement is camera-relative and uses only collision queries and quantized input (R-ROLL-02): speeds are fixed per
 * profile, the hill factor reads the ground normal, the jump is a closed-form parabola (apex = `jumpApexM`), and the
 * Rapier `KinematicCharacterController` resolves the move. `Transform` holds the FEET; the capsule body sits
 * `capsuleCentreOffset()` above it.
 */
export function onFootSystem(opts: OnFootOptions): SystemDef {
  const backend = opts.backend;
  const cfg = opts.config ?? PHYSICS_CONFIG.character;
  const g = -PHYSICS_CONFIG.gravity[1];
  const jumpV0 = dsqrt(2 * g * cfg.jumpApexM);
  const centre = capsuleCentreOffset(cfg);
  const moveOpts = { autostepM: cfg.autostepM, snapToGroundM: cfg.snapToGroundM, maxSlopeDeg: cfg.maxSlopeDeg, slide: cfg.slide };
  // In the air the character does not auto-step: a jump (apex 1.0 m) plus a 0.4 m step would otherwise clear a 1.4 m obstacle
  // that the vault rule says blocks. Scenarios without a vault store keep the earlier behaviour (their goldens).
  const airMoveOpts = { ...moveOpts, autostepM: 0 };
  const desired: Vec3 = [0, 0, 0];
  const origin: Vec3 = [0, 0, 0];
  const target: Vec3 = [0, 0, 0];
  const down: Vec3 = [0, -1, 0];
  const vaultAt: Vec3 = [0, 0, 0];
  const vaults = opts.vault;

  return {
    id: ONFOOT_ID, owner: 'S01', stage: SimStage.PhysicsPre, order: -20,
    run: ({ ecs, tick }) => {
      const services = opts.services;
      const ids = ecs.query([CharacterBody, Control, Transform, BodyRef, Velocity, Anim, PlayerControlled]);
      if (ids.length === 0) return;
      const tr = ecs.store(Transform);
      const ve = ecs.store(Velocity);
      const cb = ecs.store(CharacterBody);
      const co = ecs.store(Control);
      const an = ecs.store(Anim);
      const bodies = ecs.store(BodyRef).body;
      const players = ecs.store(PlayerControlled).player;

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as number;
        if (co.owner[id] !== CONTROL_OWNER.OnFoot) continue;
        const state = co.state[id] as number;
        if (state === CONTROL_STATE.teleportPending || state === CONTROL_STATE.teleportWaiting) {
          ve.vx[id] = 0;
          ve.vy[id] = 0;
          ve.vz[id] = 0;
          continue;
        }
        const frame = (players[id] === 0 ? services.input : null) ?? NEUTRAL_INPUT;

        // --- a vault in progress runs its scripted path and ignores the stick (a checkpoint without its plan just ends it)
        const plan = vaults?.plans.get(id);
        if (plan) {
          const k = tick - plan.startTick + 1;
          if (state === CONTROL_STATE.vault && k <= VAULT_TICKS) {
            vaultPoint(plan, k, vaultAt);
            const px = tr.px[id] as number;
            const py = tr.py[id] as number;
            const pz = tr.pz[id] as number;
            ve.vx[id] = (vaultAt[0] - px) / SIM_DT;
            ve.vy[id] = (vaultAt[1] - py) / SIM_DT;
            ve.vz[id] = (vaultAt[2] - pz) / SIM_DT;
            tr.px[id] = vaultAt[0];
            tr.py[id] = vaultAt[1];
            tr.pz[id] = vaultAt[2];
            target[0] = vaultAt[0];
            target[1] = vaultAt[1] + centre;
            target[2] = vaultAt[2];
            backend.setKinematicTarget(bodies[id] as number, target, IDENTITY);
            cb.grounded[id] = k === VAULT_TICKS ? 1 : 0;
            cb.groundNormalY[id] = k === VAULT_TICKS ? 1 : 0;
            cb.airTicks[id] = 0;
            if (k === VAULT_TICKS) ve.vy[id] = 0;
            an.p0[id] = dsqrt(ve.vx[id] * ve.vx[id] + ve.vz[id] * ve.vz[id]);
            continue;
          }
          vaults?.plans.delete(id);
        }

        // --- wish direction, camera-relative. Forward is (-sin yaw, -cos yaw); moveY < 0 pushes forward.
        const yaw = frame.camYaw * YAW_UNIT;
        let mx = Math.max(-1, Math.min(1, frame.moveX / 127));
        let my = Math.max(-1, Math.min(1, frame.moveY / 127));
        let mag = dsqrt(mx * mx + my * my);
        if (mag > 1) {
          mx /= mag;
          my /= mag;
          mag = 1;
        }
        const s = dsin(yaw);
        const c = dcos(yaw);
        let dirX = 0;
        let dirZ = 0;
        if (mag > 0) {
          dirX = (mx * c + my * s) / mag;
          dirZ = (-mx * s + my * c) / mag;
        }

        // --- speed by stick magnitude and Sprint
        const sprint = (frame.buttons & (1 << SimButton.Sprint)) !== 0;
        let speed = 0;
        let locomotion: number = CONTROL_STATE.idle;
        if (mag > 0) {
          if (mag <= cfg.walkStickMax) {
            speed = cfg.walkMps;
            locomotion = CONTROL_STATE.walk;
          } else if (sprint) {
            speed = cfg.sprintMps;
            locomotion = CONTROL_STATE.sprint;
          } else {
            speed = cfg.runMps;
            locomotion = CONTROL_STATE.run;
          }
        }

        const wasGrounded = cb.grounded[id] !== 0;
        const feetX = tr.px[id] as number;
        const feetY = tr.py[id] as number;
        const feetZ = tr.pz[id] as number;

        // --- hill factor: grade from the ground normal's Y, uphill direction from the normal's horizontal part
        if (speed > 0 && wasGrounded) {
          const ny = cb.groundNormalY[id] as number;
          if (ny < 0.9995 && ny > 0.01) {
            origin[0] = feetX;
            origin[1] = feetY + 0.3;
            origin[2] = feetZ;
            const hit = backend.castRay(origin, down, 1, GROUP_BIT.static);
            if (hit) {
              const nx = hit.normal[0];
              const nz = hit.normal[2];
              const horizontal = dsqrt(nx * nx + nz * nz);
              if (horizontal > 1e-6) {
                const grade = dsqrt(1 - ny * ny) / ny;
                const along = (grade * -(dirX * nx + dirZ * nz)) / horizontal; // > 0: climbing
                speed *= along > 0
                  ? Math.max(cfg.hillUphillMin, 1 - along * cfg.hillUphillSlope)
                  : Math.min(cfg.hillDownhillMax, 1 - along * cfg.hillDownhillSlope);
              }
            }
          }
        }

        // --- vertical: closed-form parabola, so the apex does not depend on the tick rate
        let vy = ve.vy[id] as number;
        const jumping = wasGrounded && (frame.pressed & (1 << SimButton.Jump)) !== 0;
        if (jumping && vaults && (locomotion === CONTROL_STATE.run || locomotion === CONTROL_STATE.sprint)) {
          const found = probeVault({ backend, x: feetX, y: feetY, z: feetZ, dirX, dirZ }, tick);
          if (found) {
            vaults.plans.set(id, found);
            vaultPoint(found, 1, vaultAt);
            ve.vx[id] = (vaultAt[0] - feetX) / SIM_DT;
            ve.vy[id] = (vaultAt[1] - feetY) / SIM_DT;
            ve.vz[id] = (vaultAt[2] - feetZ) / SIM_DT;
            tr.px[id] = vaultAt[0];
            tr.py[id] = vaultAt[1];
            tr.pz[id] = vaultAt[2];
            target[0] = vaultAt[0];
            target[1] = vaultAt[1] + centre;
            target[2] = vaultAt[2];
            backend.setKinematicTarget(bodies[id] as number, target, IDENTITY);
            cb.grounded[id] = 0;
            cb.groundNormalY[id] = 0;
            cb.airTicks[id] = 0;
            co.state[id] = CONTROL_STATE.vault;
            co.sinceTick[id] = tick;
            an.state[id] = animStateOf(CONTROL_STATE.vault);
            an.sinceTick[id] = tick;
            an.p0[id] = dsqrt(ve.vx[id] * ve.vx[id] + ve.vz[id] * ve.vz[id]);
            continue;
          }
        }
        if (jumping) vy = jumpV0;
        let dy = 0;
        if (jumping || !wasGrounded) {
          dy = (vy - 0.5 * g * SIM_DT) * SIM_DT;
          vy -= g * SIM_DT;
          if (vy < -cfg.terminalMps) vy = -cfg.terminalMps;
        } else {
          vy = 0;
        }

        desired[0] = dirX * speed * SIM_DT;
        desired[1] = dy;
        desired[2] = dirZ * speed * SIM_DT;
        const body = bodies[id] as number;
        const res = backend.character.move(body, desired, vaults && !wasGrounded ? airMoveOpts : moveOpts);

        const newX = feetX + res.moved[0];
        const newY = feetY + res.moved[1];
        const newZ = feetZ + res.moved[2];
        tr.px[id] = newX;
        tr.py[id] = newY;
        tr.pz[id] = newZ;
        target[0] = newX;
        target[1] = newY + centre;
        target[2] = newZ;
        backend.setKinematicTarget(body, target, IDENTITY);

        // --- ground contact. A move that was rising is not "grounded" even when the capsule still touches the floor.
        const grounded = res.grounded && vy <= 0;
        if (grounded) vy = 0;
        else if (vy > 0 && dy > 0 && res.moved[1] < dy * 0.5) vy = 0; // head against a ceiling

        let airTicks = cb.airTicks[id] as number;
        let next: number;
        if (!grounded) {
          if (airTicks < 65535) airTicks++;
          // A one or two tick loss of contact (a seam, the tick before the first step) is not worth an animation.
          next = jumping || airTicks >= 3 || isAirState(state) ? (vy > 0 ? CONTROL_STATE.jump : CONTROL_STATE.fall) : locomotion;
        } else {
          airTicks = 0;
          if (isAirState(state)) next = CONTROL_STATE.land;
          else if (state === CONTROL_STATE.land && tick - (co.sinceTick[id] as number) < cfg.landTicks) next = CONTROL_STATE.land;
          else next = locomotion;
        }

        cb.grounded[id] = grounded ? 1 : 0;
        cb.groundNormalY[id] = grounded ? res.groundNormalY : 0;
        cb.airTicks[id] = airTicks;
        ve.vx[id] = res.moved[0] / SIM_DT;
        ve.vy[id] = vy;
        ve.vz[id] = res.moved[2] / SIM_DT;
        ve.wx[id] = 0;
        ve.wy[id] = 0;
        ve.wz[id] = 0;

        // --- facing: turn toward the movement direction (presentation; the sim still replays it identically)
        if (mag > 0) {
          const heading = datan2(-dirX, -dirZ);
          const current = 2 * datan2(tr.qy[id] as number, tr.qw[id] as number);
          const delta = normalizeAngle(heading - current);
          const maxStep = TURN_RATE * SIM_DT;
          const stepYaw = delta > maxStep ? maxStep : delta < -maxStep ? -maxStep : delta;
          const yawNow = current + stepYaw;
          tr.qx[id] = 0;
          tr.qy[id] = dsin(yawNow / 2);
          tr.qz[id] = 0;
          tr.qw[id] = dcos(yawNow / 2);
        }

        if (next !== state) {
          co.state[id] = next;
          co.sinceTick[id] = tick;
        }
        // --- footfall cue: half a period after a locomotion state begins, then every period
        const period = STEP_PERIOD_TICKS[next];
        if (period !== undefined && grounded && services.events) {
          const elapsed = tick - (co.sinceTick[id] as number);
          if (elapsed > 0 && elapsed % period === period >> 1) {
            services.events.push({ t: 'audio.cue', tick, a: ecs.handle(id as EntityId), s: FOOT_STEP_CUE, n: next });
          }
        }
        const animState = animStateOf(next);
        if (an.state[id] !== animState) {
          an.state[id] = animState;
          an.sinceTick[id] = tick;
        }
        an.p0[id] = dsqrt(res.moved[0] * res.moved[0] + res.moved[2] * res.moved[2]) / SIM_DT;
      }
    },
  };
}

const IDENTITY: [number, number, number, number] = [0, 0, 0, 1];
