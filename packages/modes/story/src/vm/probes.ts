/**
 * Event probes of the mission runtime (M05a2): the two `ObjectiveDef` kinds whose completion reads an event the engine does not
 * produce yet are fed from what the sim can see.
 *
 *  - `photo`: the shutter. `sim.Interact` pressed in the `photo` input context while a `photo` objective is active is the event
 *    `photo.taken` (C03 1.1; the autoplayer and the camera app both press it).
 *  - `score` with metric `drift`: points from the slip of the player's vehicle. While the vehicle moves at 5 m/s or more forwards
 *    with its velocity 15 degrees or more off its heading, it earns `speed x slip / 45` points per second (12 m/s at 45 degrees
 *    gives 12 per second). The racing and drift modes of M07 replace this with their own scoring; the event name is the same.
 *
 * Both probes run only while an objective that reads them is active, so a mission without those kinds is unaffected. The state
 * is one number (the fractional drift points); it is not hashed and a checkpoint restore starts it at 0. Sim code under the C02 lint.
 */
import { PI, SimButton, datan2, dsin, dcos, dsqrt, type ModeContext } from '@dv/shared';
import { Transform, Velocity } from '@dv/engine/sim';
import type { MissionRuntime } from './runtime.ts';
import { quatYaw } from './actors.ts';

/** `InputFrame.context` of the `photo` context (the index in the `InputContextId` list of C03). */
export const PHOTO_CONTEXT = 7;
export const DRIFT_MIN_SPEED_MPS = 5;
export const DRIFT_MIN_SLIP_DEG = 15;
const DRIFT_SLIP_FULL_DEG = 45;
const TICKS_PER_SEC = 60;

/** Slip of a body moving at `(vx, vz)` with heading `yaw` (forward is `(-sin yaw, -cos yaw)`), in degrees; null when it moves backwards or too slowly. */
export function slipDeg(vx: number, vz: number, yaw: number): { slipDeg: number; speed: number } | null {
  const speed = dsqrt(vx * vx + vz * vz);
  if (speed < DRIFT_MIN_SPEED_MPS) return null;
  const fx = -dsin(yaw);
  const fz = -dcos(yaw);
  const dot = vx * fx + vz * fz;
  if (dot <= 0) return null;
  const cross = vx * fz - vz * fx;
  const a = datan2(cross < 0 ? -cross : cross, dot);
  return { slipDeg: (a * 180) / PI, speed };
}

export class Probes {
  private driftAcc = 0;

  reset(): void {
    this.driftAcc = 0;
  }

  /** Called once per mission tick while the stage runs. */
  step(rt: MissionRuntime, ctx: ModeContext): void {
    let wantPhoto = false;
    let wantDrift = false;
    for (const o of rt.objectives.values()) {
      if (o.state !== 'active') continue;
      if (o.def.k === 'photo') wantPhoto = true;
      else if (o.def.k === 'score' && o.def.metric === 'drift') wantDrift = true;
    }
    if (wantPhoto) this.shutter(rt, ctx);
    if (wantDrift) this.drift(rt, ctx);
  }

  private shutter(rt: MissionRuntime, ctx: ModeContext): void {
    let f;
    try {
      f = ctx.input.frame();
    } catch {
      return;
    }
    if (f.context === PHOTO_CONTEXT && (f.pressed & (1 << SimButton.Interact)) !== 0) rt.noteEvent('photo.taken');
  }

  private drift(rt: MissionRuntime, ctx: ModeContext): void {
    const v = rt.actors.playerVehicle();
    if (v === null) return;
    const id = ctx.ecs.resolve(v);
    if (id === null || !ctx.ecs.has(v, Velocity) || !ctx.ecs.has(v, Transform)) return;
    const vel = ctx.ecs.store(Velocity);
    const tr = ctx.ecs.store(Transform);
    const s = slipDeg(vel.vx[id] as number, vel.vz[id] as number, quatYaw(tr.qy[id] as number, tr.qw[id] as number));
    if (!s || s.slipDeg < DRIFT_MIN_SLIP_DEG) return;
    const cap = s.slipDeg > DRIFT_SLIP_FULL_DEG ? DRIFT_SLIP_FULL_DEG : s.slipDeg;
    this.driftAcc += (s.speed * cap) / DRIFT_SLIP_FULL_DEG / TICKS_PER_SEC;
    const n = Math.floor(this.driftAcc);
    if (n >= 1) {
      this.driftAcc -= n;
      rt.noteEvent('score.drift', { n });
    }
  }
}
