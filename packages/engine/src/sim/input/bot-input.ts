import type { BotInput, InputFrame } from '@dv/shared';

/**
 * C03 1.1 BotInput (QA only): writes player 0's InputFrames inside sim.worker for the mission autoplayer and the
 * S06/S07/S08 bots. It is bundled only into QA builds and headless CI; `apps/web/scripts/verify-dist.mjs` fails a
 * production dist that contains this module.
 *
 * A script is a list of segments. Each segment holds one input state for ticks [from, to); gaps give an idle frame.
 * Edges are derived from the change in `buttons` between consecutive ticks, the way the page's latch would produce
 * them, so a bot and a human feed the sim identical frame shapes.
 */
export interface BotSegment {
  from: number;
  to: number;
  buttons?: number;
  moveX?: number;
  moveY?: number;
  throttle?: number;
  brake?: number;
  steer?: number;
  camYaw?: number;
  camPitch?: number;
}

const DEVICE_BOT = 7; // index of 'bot' in the DeviceKind order (C03 1.1)

export class ScriptedBotInput implements BotInput {
  readonly device = 'bot' as const;
  private lastButtons = 0;
  private lastTick = -1;

  constructor(private readonly segments: readonly BotSegment[]) {}

  frame(tick: number): InputFrame {
    const seg = this.segments.find((s) => tick >= s.from && tick < s.to);
    const buttons = (seg?.buttons ?? 0) >>> 0;
    // Rewinding (restore) restarts edge tracking from the previous tick's state.
    if (tick !== this.lastTick + 1) this.lastButtons = this.stateAt(tick - 1);
    const pressed = (buttons & ~this.lastButtons) >>> 0;
    const released = (this.lastButtons & ~buttons) >>> 0;
    this.lastButtons = buttons;
    this.lastTick = tick;
    return {
      tick,
      buttons,
      pressed,
      released,
      moveX: seg?.moveX ?? 0,
      moveY: seg?.moveY ?? 0,
      throttle: seg?.throttle ?? 0,
      brake: seg?.brake ?? 0,
      steer: seg?.steer ?? 0,
      camYaw: seg?.camYaw ?? 0,
      camPitch: seg?.camPitch ?? 0,
      context: 0,
      device: DEVICE_BOT,
    };
  }

  private stateAt(tick: number): number {
    const seg = this.segments.find((s) => tick >= s.from && tick < s.to);
    return (seg?.buttons ?? 0) >>> 0;
  }
}

/** Validates untrusted script data (from `boot.config.bot`) before building a bot. */
export function parseBotScript(data: unknown): BotSegment[] {
  if (!Array.isArray(data)) throw new TypeError('bot script must be an array of segments');
  const keys = ['from', 'to', 'buttons', 'moveX', 'moveY', 'throttle', 'brake', 'steer', 'camYaw', 'camPitch'] as const;
  return data.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) throw new TypeError(`bot segment ${i} is not an object`);
    const seg: Record<string, number> = {};
    for (const k of keys) {
      const v = (raw as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`bot segment ${i}: ${k} must be a finite number`);
      seg[k] = v;
    }
    if (seg['from'] === undefined || seg['to'] === undefined) throw new TypeError(`bot segment ${i} needs from and to`);
    return seg as unknown as BotSegment;
  });
}
