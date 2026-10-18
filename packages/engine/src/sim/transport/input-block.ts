import type { InputFrame } from '@dv/shared';
import type { InputState } from './envelope.ts';

/**
 * The input block: a small `Int32Array`, over a SharedArrayBuffer on the SAB transport.
 *
 * Held buttons are level state (`Atomics.store`). Pressed and released edges are latched with `Atomics.or` on the main
 * thread and consumed with `Atomics.exchange` by the worker once per tick, so a tap shorter than a tick reaches
 * exactly one tick and is never lost or doubled (C03 rule 2; `pressed` is "latched; sub-tick taps never lost").
 */
export const INPUT_WORDS = 8;
const HELD = 0;
const PRESSED = 1;
const RELEASED = 2;
const AXES_A = 3; // moveX i8 | moveY i8 << 8 | throttle u8 << 16 | brake u8 << 24
const AXES_B = 4; // steer i8 | context u8 << 8 | device u8 << 16
const CAM = 5; // camYaw u16 | camPitch i16 << 16

export interface AxesInput {
  moveX?: number;
  moveY?: number;
  throttle?: number;
  brake?: number;
  steer?: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class InputBlock {
  constructor(readonly words: Int32Array) {
    if (words.length < INPUT_WORDS) throw new RangeError(`input block needs ${INPUT_WORDS} words`);
  }

  static create(buffer?: ArrayBufferLike): InputBlock {
    return new InputBlock(new Int32Array(buffer ?? new ArrayBuffer(INPUT_WORDS * 4)));
  }

  static byteLength(): number {
    return INPUT_WORDS * 4;
  }

  // ---------------------------------------------------------------- main-thread side

  /** Replace the held mask; bits that changed also latch an edge. */
  setHeld(mask: number): void {
    const next = mask | 0;
    const prev = Atomics.exchange(this.words, HELD, next);
    const rising = next & ~prev;
    const falling = prev & ~next;
    if (rising !== 0) Atomics.or(this.words, PRESSED, rising);
    if (falling !== 0) Atomics.or(this.words, RELEASED, falling);
  }

  press(bit: number): void {
    const m = 1 << bit;
    const prev = Atomics.or(this.words, HELD, m);
    if ((prev & m) === 0) Atomics.or(this.words, PRESSED, m);
  }

  release(bit: number): void {
    const m = 1 << bit;
    const prev = Atomics.and(this.words, HELD, ~m);
    if ((prev & m) !== 0) Atomics.or(this.words, RELEASED, m);
  }

  setAxes(a: AxesInput): void {
    const cur = Atomics.load(this.words, AXES_A);
    const curB = Atomics.load(this.words, AXES_B);
    const moveX = clamp(Math.round(a.moveX ?? (cur << 24) >> 24), -127, 127);
    const moveY = clamp(Math.round(a.moveY ?? (cur << 16) >> 24), -127, 127);
    const throttle = clamp(Math.round(a.throttle ?? (cur >>> 16) & 0xff), 0, 127);
    const brake = clamp(Math.round(a.brake ?? cur >>> 24), 0, 127);
    Atomics.store(this.words, AXES_A, (moveX & 0xff) | ((moveY & 0xff) << 8) | (throttle << 16) | (brake << 24));
    const steer = clamp(Math.round(a.steer ?? (curB << 24) >> 24), -127, 127);
    Atomics.store(this.words, AXES_B, (curB & ~0xff) | (steer & 0xff));
  }

  setContext(context: number, device: number): void {
    const curB = Atomics.load(this.words, AXES_B);
    Atomics.store(this.words, AXES_B, (curB & 0xff) | ((context & 0xff) << 8) | ((device & 0xff) << 16));
  }

  setLook(camYaw: number, camPitch: number): void {
    Atomics.store(this.words, CAM, (camYaw & 0xffff) | ((clamp(Math.round(camPitch), -16384, 16384) & 0xffff) << 16));
  }

  // ---------------------------------------------------------------- postMessage transport

  /** Take the state to post to the worker; edges are consumed. */
  drain(): InputState {
    return {
      held: Atomics.load(this.words, HELD),
      pressed: Atomics.exchange(this.words, PRESSED, 0),
      released: Atomics.exchange(this.words, RELEASED, 0),
      axesA: Atomics.load(this.words, AXES_A),
      axesB: Atomics.load(this.words, AXES_B),
      cam: Atomics.load(this.words, CAM),
    };
  }

  /** Worker side of the postMessage transport: level state replaces, edges accumulate until the next tick. */
  apply(s: InputState): void {
    Atomics.store(this.words, HELD, s.held);
    if (s.pressed !== 0) Atomics.or(this.words, PRESSED, s.pressed);
    if (s.released !== 0) Atomics.or(this.words, RELEASED, s.released);
    Atomics.store(this.words, AXES_A, s.axesA);
    Atomics.store(this.words, AXES_B, s.axesB);
    Atomics.store(this.words, CAM, s.cam);
  }

  // ---------------------------------------------------------------- worker side

  /** The InputFrame for `tick`. Consumes the latched edges: the next call sees none until the page latches more. */
  sample(tick: number): InputFrame {
    const a = Atomics.load(this.words, AXES_A);
    const b = Atomics.load(this.words, AXES_B);
    const cam = Atomics.load(this.words, CAM);
    return {
      tick,
      buttons: Atomics.load(this.words, HELD) >>> 0,
      pressed: Atomics.exchange(this.words, PRESSED, 0) >>> 0,
      released: Atomics.exchange(this.words, RELEASED, 0) >>> 0,
      moveX: (a << 24) >> 24,
      moveY: (a << 16) >> 24,
      throttle: (a >>> 16) & 0xff,
      brake: a >>> 24,
      steer: (b << 24) >> 24,
      camYaw: cam & 0xffff,
      camPitch: cam >> 16,
      context: (b >>> 8) & 0xff,
      device: (b >>> 16) & 0xff,
    };
  }
}
