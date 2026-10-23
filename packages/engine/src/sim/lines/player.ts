/**
 * The input-line player (QA builds and headless CI; M03a1). It is a C03 `BotInput`: it writes player 0's `InputFrame` from a
 * line, deriving `pressed` and `released` from the change of `buttons`. Any real input stops it on the tick the input arrives,
 * and the real frame is what the sim reads on that tick. Not bundled into production builds.
 *
 * Commands: `aim` holds the view heading, `follow` steers or walks toward a point, `waitNear` holds the line's clock until the
 * player is near a point or a timeout passes, `cruise` holds a vehicle's speed with throttle and brake (BD-FIX-CI7-E01). The
 * player's position, heading and vehicle speed come from a probe the host supplies.
 *
 * Sim-adjacent code: arithmetic uses `detmath` where the result reaches the sim (the commands' steering).
 */
import { datan2, dsqrt, normalizeAngle, TWO_PI, type BotInput, type InputFrame } from '@dv/shared';
import { inputAt, lineLength, type LineCommand, type LineFile, type LineInput } from './format.ts';

const DEVICE_BOT = 7;

/**
 * Where the player is and which way it (or its vehicle) faces; heading is radians about +Y, 0 faces -Z. `speed` is the signed
 * forward speed of the vehicle in m/s (C01 `Vehicle.speed`); without it `cruise` is skipped.
 */
export interface LineProbe {
  (): { x: number; z: number; yaw: number; inVehicle: boolean; speed?: number };
}

/** True when `f` carries input a person produced: any button, stick, pedal or steer. View angles alone do not count. */
export function isRealInput(f: InputFrame | null | undefined): boolean {
  if (!f) return false;
  return f.buttons !== 0 || f.moveX !== 0 || f.moveY !== 0 || f.throttle !== 0 || f.brake !== 0 || f.steer !== 0;
}

const NEUTRAL: LineInput = { buttons: 0, moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, camYaw: 0, camPitch: 0, context: 0 };
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** `cruise`: the pedal is full this many m/s away from the target speed and falls off linearly to the target (a P band). */
export const CRUISE_BAND = 2;
/** `cruise`: no brake until the vehicle is this many m/s above the target, so that throttle and brake never alternate on the target. */
export const CRUISE_DEADBAND = 0.5;
/** Below this forward speed the brake pedal selects reverse (`@dv/shared` vehicle handling), so `cruise` never brakes there. */
const REVERSE_BELOW = 1.5;

/** The pedals that hold `target` m/s at forward speed `speed`, at most `maxThrottle` and `maxBrake` (0..127). */
export function cruisePedals(speed: number, target: number, maxThrottle: number, maxBrake: number): { throttle: number; brake: number } {
  const err = target - speed;
  if (err > 0) return { throttle: Math.round(maxThrottle * clamp(err / CRUISE_BAND, 0, 1)), brake: 0 };
  const over = -err - CRUISE_DEADBAND;
  if (over <= 0 || speed <= REVERSE_BELOW) return { throttle: 0, brake: 0 };
  return { throttle: 0, brake: Math.max(1, Math.round(maxBrake * clamp(over / CRUISE_BAND, 0, 1))) };
}

export class LinePlayer implements BotInput {
  readonly device = 'bot' as const;
  /** The runtime hands this bot the real frame of each tick and drops it once `stoppedAt` is set. */
  readonly stopsOnRealInput = true as const;
  /** The sim tick at which a real input stopped the line, or null while it plays. */
  stoppedAt: number | null = null;
  /** True once the last run has been played. */
  finished = false;

  private lastButtons = 0;
  private lastTick = -1;
  private hold = 0;
  private waitDone = new Set<number>();
  private waitStart = new Map<number, number>();
  private lastInput: LineInput = NEUTRAL;

  /**
   * @param baseTick the sim tick at which line tick 0 plays
   * @param probe position and heading of the player, for `follow` and `waitNear`; without it those commands are skipped
   */
  constructor(readonly line: LineFile, readonly baseTick: number, private readonly probe: LineProbe | null = null) {}

  /** A frame for sim tick `tick`. `real` is what the page sampled for the same tick, if the host passes it. */
  frame(tick: number, real?: InputFrame | null): InputFrame {
    if (this.stoppedAt !== null) return real ?? this.neutral(tick);
    if (real && isRealInput(real)) {
      this.stoppedAt = tick;
      return real;
    }
    const rel = tick - this.baseTick;
    const cmds = this.line.commands ?? [];
    // waitNear: the line clock stands still while the player is away from the point
    let clock = rel - this.hold;
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i] as LineCommand;
      if (c.t !== 'waitNear' || this.waitDone.has(i) || clock < c.tick || !this.probe) continue;
      const started = this.waitStart.get(i) ?? tick;
      this.waitStart.set(i, started);
      const p = this.probe();
      const near = (p.x - c.x) * (p.x - c.x) + (p.z - c.z) * (p.z - c.z) <= c.r * c.r;
      if (near || tick - started >= c.timeout) this.waitDone.add(i);
      else {
        this.hold++;
        clock = rel - this.hold;
        return this.build(tick, this.lastInput);
      }
    }
    const raw = rel < 0 ? null : inputAt(this.line.frames, clock);
    if (!raw && clock >= lineLength(this.line)) this.finished = true;
    const input = this.applyCommands(raw ?? NEUTRAL, clock, cmds);
    this.lastInput = input;
    return this.build(tick, input);
  }

  private neutral(tick: number): InputFrame {
    return this.build(tick, NEUTRAL);
  }

  private build(tick: number, i: LineInput): InputFrame {
    const buttons = i.buttons >>> 0;
    // Rewinding (a restore) restarts edge tracking from the previous tick's state.
    if (tick !== this.lastTick + 1) this.lastButtons = this.buttonsAt(tick - 1);
    const pressed = (buttons & ~this.lastButtons) >>> 0;
    const released = (this.lastButtons & ~buttons) >>> 0;
    this.lastButtons = buttons;
    this.lastTick = tick;
    return {
      tick, buttons, pressed, released, moveX: i.moveX, moveY: i.moveY, throttle: i.throttle, brake: i.brake, steer: i.steer,
      camYaw: i.camYaw, camPitch: i.camPitch, context: i.context, device: DEVICE_BOT,
    };
  }

  private buttonsAt(tick: number): number {
    const t = tick - this.baseTick - this.hold;
    return (inputAt(this.line.frames, t)?.buttons ?? 0) >>> 0;
  }

  private applyCommands(base: LineInput, clock: number, cmds: readonly LineCommand[]): LineInput {
    let out = base;
    let aim: number | null = null;
    let follow: Extract<LineCommand, { t: 'follow' }> | null = null;
    let cruise: Extract<LineCommand, { t: 'cruise' }> | null = null;
    for (const c of cmds) {
      if (c.tick > clock) continue;
      if (c.t === 'aim') {
        aim = c.yaw;
        follow = null;
      } else if (c.t === 'follow') follow = c;
      else if (c.t === 'cruise') cruise = c;
    }
    if (aim !== null) out = { ...out, camYaw: aim };
    if (cruise && this.probe) {
      const p = this.probe();
      if (p.inVehicle && p.speed !== undefined) out = { ...out, ...cruisePedals(p.speed, cruise.speed, cruise.throttle ?? 127, cruise.brake ?? 127) };
    }
    if (follow && this.probe) {
      const p = this.probe();
      const dx = follow.x - p.x;
      const dz = follow.z - p.z;
      const dist = dsqrt(dx * dx + dz * dz);
      if (dist > (follow.r ?? 2)) {
        // heading that faces the point: forward is (-sin yaw, -cos yaw)
        const want = datan2(-dx, -dz);
        if (p.inVehicle) {
          const err = normalizeAngle(want - p.yaw);
          out = { ...out, steer: clamp(Math.round(-err * 160), -127, 127) };   // yaw grows to the left, a right steer is positive
        } else {
          let yaw = want;
          if (yaw < 0) yaw += TWO_PI;
          out = { ...out, camYaw: Math.round((yaw / TWO_PI) * 65536) & 0xffff, moveX: 0, moveY: -127 };
        }
      }
    }
    return out;
  }
}
