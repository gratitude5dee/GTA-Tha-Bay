/**
 * Airliners (living part 5; M03b2): decorative aircraft on the 3 approach corridors. An airliner is a pure function of the tick:
 * it keeps no state, so the `Aircraft` component (264) is not hashed. It flies its corridor start to end at 75 m/s, climbing or
 * descending between the corridor's two altitudes, and starts again. Pure; C02 lint applies.
 */
import { datan2, TWO_PI } from '@dv/shared';
import { Path, type TransitRoutesData } from './path.ts';
import { TRANSIT_CONFIG, type TransitRows } from './components.ts';

export class Corridor {
  readonly id: string;
  readonly path: Path;
  readonly altitudeM: readonly [number, number];

  constructor(c: TransitRoutesData['air'][number]) {
    this.id = c.id;
    this.path = new Path(c.points);
    this.altitudeM = c.altitudeM;
  }
}

export const corridors = (d: TransitRoutesData): Corridor[] => d.air.map((c) => new Corridor(c)).filter((c) => c.path.length > 10);

/** Fraction of the corridor flown by airliner `n` of `count` at `tick` (60 Hz). */
export function airProgress(c: Corridor, n: number, count: number, tick: number, cfg: TransitRows = TRANSIT_CONFIG): number {
  const len = c.path.length;
  const phase = count > 0 ? n / count : 0;
  const s = (tick / 60) * cfg.speeds.airMps + phase * len;
  const t = (s % len) / len;
  return t < 0 ? t + 1 : t;
}

/** Pose of an airliner at fraction `t`: x, y, z, yaw. */
export function airPose(c: Corridor, t: number, out: Float64Array, tmp: Float64Array): void {
  c.path.at(t * c.path.length, tmp);
  out[0] = tmp[0] as number;
  out[1] = (c.altitudeM[0] + (c.altitudeM[1] - c.altitudeM[0]) * t);
  out[2] = tmp[1] as number;
  let yaw = datan2(-(tmp[2] as number), -(tmp[3] as number));
  if (yaw < 0) yaw += TWO_PI;
  out[3] = yaw;
}
