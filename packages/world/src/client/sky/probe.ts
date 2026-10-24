/**
 * The sky-derived lighting probe (C13 `probe-grid` on mobile and XR; 02-world-living.md section 6). One probe stands for the sky's
 * light: it is re-baked only when the sun has moved more than 0.006 rad or the darkness has changed by more than 0.04 since the last
 * bake, and never twice within 200 ms. What a bake does is the owner's callback (the hemisphere light's colours today). Pure logic,
 * so the tests run in Node.
 */
import type { SkyUniforms, Vec3 } from './types.ts';

export const PROBE_SUN_MOVE_RAD = 0.006;
export const PROBE_DARK_STEP = 0.04;
export const PROBE_MIN_INTERVAL_MS = 200;

export class SkyProbe {
  /** Bakes done so far. */
  bakes = 0;
  private lastDir: Vec3 | null = null;
  private lastDark = 0;
  private lastMs = Number.NEGATIVE_INFINITY;
  private dirty = false;

  constructor(private readonly bake: (u: Readonly<SkyUniforms>) => void) {}

  /** The next `update` bakes (still no sooner than 200 ms after the last bake). A weather change calls this. */
  invalidate(): void {
    this.dirty = true;
  }

  /** Whether `update` would bake now, without baking. */
  due(u: Readonly<SkyUniforms>, nowMs: number): boolean {
    if (this.lastDir === null) return true;
    if (nowMs - this.lastMs < PROBE_MIN_INTERVAL_MS) return false;
    if (this.dirty) return true;
    return angleBetween(this.lastDir, u.uSunDir) > PROBE_SUN_MOVE_RAD || Math.abs(u.uDark - this.lastDark) > PROBE_DARK_STEP;
  }

  /** Call every frame. Returns true when the probe was re-baked. */
  update(u: Readonly<SkyUniforms>, nowMs: number): boolean {
    if (!this.due(u, nowMs)) return false;
    this.bake(u);
    this.bakes++;
    this.lastDir = [u.uSunDir[0], u.uSunDir[1], u.uSunDir[2]];
    this.lastDark = u.uDark;
    this.lastMs = nowMs;
    this.dirty = false;
    return true;
  }
}

/** Angle between two unit vectors, radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d);
}
