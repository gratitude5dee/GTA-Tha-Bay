/** Gate A5 (spec/domains/05-assets-pipeline.md section 2, S05 values): a retargeted looping clip keeps the hips in place and ends where it began. Pure. */
import { dhypot } from '../../detmath.ts';
import { finding, type GateFinding } from './types.ts';

export const A5_HIP_DRIFT_FRACTION = 0.03;
export const A5_END_POSE_M = 0.01;

export interface RetargetStats {
  heightM: number;
  /** Horizontal distance the hips travel over the looping idle, metres. */
  hipDriftM: number;
  /** Largest distance between a bone's first-frame and last-frame position, metres. */
  endPoseDistM: number;
}

/** Horizontal (x, z) distance between the first and the last hip position of a clip. */
export function hipDrift(hips: readonly (readonly [number, number, number])[]): number {
  const a = hips[0];
  const b = hips[hips.length - 1];
  if (a === undefined || b === undefined) return 0;
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return dhypot(dx, dz);
}

export function checkA5Retarget(file: string, s: RetargetStats): GateFinding[] {
  const out: GateFinding[] = [];
  if (s.hipDriftM > A5_HIP_DRIFT_FRACTION * s.heightM) {
    out.push(finding('A5', file, 'hip-drift', `hip drift ${s.hipDriftM.toFixed(3)} m exceeds ${A5_HIP_DRIFT_FRACTION * 100} % of ${s.heightM} m`));
  }
  if (s.endPoseDistM > A5_END_POSE_M) out.push(finding('A5', file, 'end-pose', `end pose is ${s.endPoseDistM.toFixed(3)} m from the start (limit ${A5_END_POSE_M} m)`));
  return out;
}
