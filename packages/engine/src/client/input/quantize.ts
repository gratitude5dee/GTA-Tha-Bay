/**
 * Quantization of the main thread's float input into the `InputFrame` fields (C03): i8 axes, u16 yaw, i16 pitch.
 * Main-thread code, so `Math.round` and friends are fine here; the sim only ever sees the integers.
 */
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * A signed axis in [-1, 1] to i8 -127..127: `round(|v| * 127)` with the sign put back, so that +v and -v quantize to
 * the same magnitude (`Math.round` alone rounds -63.5 to -63 and 63.5 to 64; M01b2 BD-M01b2-02).
 */
export function quantAxis(v: number): number {
  const c = clamp(v, -1, 1);
  const q = Math.round(Math.abs(c) * 127);
  return q === 0 ? 0 : c < 0 ? -q : q; // never -0
}

/** A one-sided axis (throttle, brake) in [0, 1] to 0..127. */
export function quantTrigger(v: number): number {
  return Math.round(clamp(v, 0, 1) * 127);
}

/** World yaw in radians to u16: 0..65535 covers 0..2 pi. Any real input wraps. */
export function yawToU16(yaw: number): number {
  const turns = yaw / TWO_PI;
  const frac = turns - Math.floor(turns);
  return Math.round(frac * 65536) & 0xffff;
}

/** Pitch in radians to i16: -16384..16384 covers -pi/2..pi/2. */
export function pitchToI16(pitch: number): number {
  return clamp(Math.round((pitch / HALF_PI) * 16384), -16384, 16384);
}

/** The inverse of `yawToU16`, radians in [0, 2 pi). */
export function u16ToYaw(u: number): number {
  return ((u & 0xffff) / 65536) * TWO_PI;
}

export function i16ToPitch(i: number): number {
  return (clamp(i, -16384, 16384) / 16384) * HALF_PI;
}
