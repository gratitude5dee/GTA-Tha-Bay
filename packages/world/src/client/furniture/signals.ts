/**
 * The signal heads' aspects (M02h6, R-MAP-04: the heads match the sim). Every head of the signal pool stores its junction's C08
 * `SignalProgram` and the movement it shows (the approach's straight movement, else its first; `@dv/shared` `signalHeads`). At `headsHz`
 * (10 Hz) the heads within `headsM` (200 m) of the camera evaluate C08 `signalAspect(program, tick, movement, blackout)` from the newest
 * snapshot's tick (`WorldFrame.simTick`) and blackout, and write the `aAspect` code (`traffic/lights.ts` `ASPECT_CODE`) the lens emission
 * reads. Heads farther away keep their last code. The sim junctions answer the same pure function (`sim/graph/junctions.ts`), so a head
 * shows what the traffic obeys. A held look shot pauses the sim, so the tick and the heads hold still with it.
 */
import { signalAspect, type Aspect } from '@dv/shared';
import type { FurnitureHead } from '../chunks/mesh-types.ts';
import { ASPECT_CODE } from '../traffic/lights.ts';

/** The `aAspect` code of a head at `tick`. */
export function aspectCodeOf(head: Pick<FurnitureHead, 'program' | 'movement'>, tick: number, blackout: boolean): number {
  return ASPECT_CODE[signalAspect(head.program, Math.max(0, tick), head.movement, blackout)];
}

export interface HeadSlot {
  head: FurnitureHead;
  /** World position of the pole. */
  x: number;
  z: number;
  /** The head's instance slot in the signal pool. */
  slot: number;
}

export interface HeadsReport {
  /** Heads evaluated in the last pass (within `headsM`). */
  n: number;
  /** Their aspects in the last pass. */
  aspects: Record<Aspect, number>;
  /** The tick of the last pass. */
  tick: number;
}

/** Evaluates the heads near the camera at most `hz` times a second and writes their codes; the report says what the last pass saw. */
export class SignalClock {
  private last = -Infinity;
  private report: HeadsReport = { n: 0, aspects: { green: 0, amber: 0, red: 0, dark: 0 }, tick: -1 };

  constructor(private readonly rangeM: number, private readonly hz: number) {}

  /** True when it wrote any code (the attribute needs an upload). */
  update(heads: Iterable<HeadSlot>, codes: Float32Array, tick: number, blackout: boolean, camX: number, camZ: number, nowMs: number): boolean {
    if (nowMs - this.last < 1000 / this.hz) return false;
    this.last = nowMs;
    const r2 = this.rangeM * this.rangeM;
    const aspects: Record<Aspect, number> = { green: 0, amber: 0, red: 0, dark: 0 };
    let n = 0;
    let wrote = false;
    for (const h of heads) {
      const dx = h.x - camX, dz = h.z - camZ;
      if (dx * dx + dz * dz > r2) continue;
      const code = aspectCodeOf(h.head, tick, blackout);
      n++;
      aspects[code === ASPECT_CODE.green ? 'green' : code === ASPECT_CODE.amber ? 'amber' : code === ASPECT_CODE.red ? 'red' : 'dark']++;
      if (codes[h.slot] !== code) {
        codes[h.slot] = code;
        wrote = true;
      }
    }
    this.report = { n, aspects, tick };
    return wrote;
  }

  /** Forces the next `update` to evaluate (a unit just joined). */
  poke(): void {
    this.last = -Infinity;
  }

  info(): HeadsReport {
    return { ...this.report, aspects: { ...this.report.aspects } };
  }
}
