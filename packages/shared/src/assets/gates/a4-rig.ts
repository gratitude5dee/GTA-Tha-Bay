/**
 * Gate A4 (spec/domains/05-assets-pipeline.md section 2): a rigged character. Bone names map onto the `bay_rig_v1` required set
 * through the alias table, vertex weights sum to 1 within 0.01 with at most four influences, the clip count equals the request, and
 * the rest pose is a T-pose. Pure.
 */
import { finding, type GateFinding } from './types.ts';

export interface RigFamily {
  family: string;
  required: readonly string[];
  /** Vendor bone name to canonical name. Canonical names always map to themselves. */
  aliases: Readonly<Record<string, string>>;
}

export interface RigStats {
  boneNames: readonly string[];
  /** Largest |sum of a vertex's weights - 1| over all skinned vertices. */
  maxWeightSumDeviation: number;
  /** Largest number of non-zero influences on one vertex. */
  maxInfluences: number;
  clipCount: number;
  /** True when the rest pose is a T-pose (arms near horizontal). */
  tPoseRest: boolean;
}

export const A4_WEIGHT_TOLERANCE = 0.01;
export const A4_MAX_INFLUENCES = 4;

/** Canonical name of a bone, or null when the table does not know it. */
export function canonicalBone(rig: RigFamily, name: string): string | null {
  const a = rig.aliases[name];
  if (a !== undefined) return a;
  return rig.required.includes(name) ? name : null;
}

/** Required bones that no bone of the file maps to. */
export function missingBones(rig: RigFamily, boneNames: readonly string[]): string[] {
  const have = new Set<string>();
  for (const n of boneNames) {
    const c = canonicalBone(rig, n);
    if (c !== null) have.add(c);
  }
  return rig.required.filter((r) => !have.has(r));
}

export function checkA4Rig(file: string, s: RigStats, rig: RigFamily, expectedClips: number): GateFinding[] {
  const out: GateFinding[] = [];
  const f = (rule: string, detail: string): void => {
    out.push(finding('A4', file, rule, detail));
  };
  const missing = missingBones(rig, s.boneNames);
  if (missing.length > 0) f('bone-unmapped', `no bone maps to ${missing.join(', ')} through the ${rig.family} alias table`);
  if (s.maxWeightSumDeviation > A4_WEIGHT_TOLERANCE) f('weights', `vertex weights deviate from 1 by ${s.maxWeightSumDeviation} (limit ${A4_WEIGHT_TOLERANCE})`);
  if (s.maxInfluences > A4_MAX_INFLUENCES) f('influences', `${s.maxInfluences} influences on a vertex (limit ${A4_MAX_INFLUENCES})`);
  if (s.clipCount !== expectedClips) f('clips', `${s.clipCount} clip(s), ${expectedClips} requested`);
  if (!s.tPoseRest) f('rest-pose', 'the rest pose is not a T-pose');
  return out;
}
