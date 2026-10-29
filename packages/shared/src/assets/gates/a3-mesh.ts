/**
 * Gate A3 (spec/domains/05-assets-pipeline.md section 2): a generated mesh before rigging. Pure: the measurements come from
 * tools/assets/src/glb-inspect.ts, the verdict is here so the CLI, the Workflow and the unit suite share it.
 */
import { finding, type GateFinding } from './types.ts';

export interface MeshStats {
  /** Errors reported by the glTF validator (0 for a valid file). */
  validatorErrors: number;
  triangles: number;
  /** Bounding-box height of the mesh in metres. */
  heightM: number;
  /** True when the model's front faces +Z. */
  facesPlusZ: boolean;
  /** Largest texture edge in pixels. */
  maxTexPx: number;
  /** Number of skins: a mesh candidate is unrigged. */
  skins: number;
}

export interface A3Target {
  /** `target_polycount` sent to the mesher. */
  targetTris: number;
}

export const A3_TRI_FACTOR = 1.1;
export const A3_HEIGHT_MIN_M = 1.5;
export const A3_HEIGHT_MAX_M = 2.1;
export const A3_MAX_TEX_PX = 2048;

export function checkA3Mesh(file: string, s: MeshStats, t: A3Target): GateFinding[] {
  const out: GateFinding[] = [];
  const f = (rule: string, detail: string): void => {
    out.push(finding('A3', file, rule, detail));
  };
  if (s.validatorErrors !== 0) f('validator', `glTF validator reported ${s.validatorErrors} error(s)`);
  if (s.triangles > t.targetTris * A3_TRI_FACTOR) f('triangles', `${s.triangles} triangles exceed ${A3_TRI_FACTOR} x the target ${t.targetTris}`);
  if (s.heightM < A3_HEIGHT_MIN_M || s.heightM > A3_HEIGHT_MAX_M) f('height', `bounding-box height ${s.heightM} m is outside ${A3_HEIGHT_MIN_M} to ${A3_HEIGHT_MAX_M} m`);
  if (!s.facesPlusZ) f('facing', 'the model does not face +Z');
  if (s.maxTexPx > A3_MAX_TEX_PX) f('texture', `largest texture ${s.maxTexPx}px exceeds ${A3_MAX_TEX_PX}px`);
  if (s.skins !== 0) f('skin', `${s.skins} skin(s) on an unrigged mesh candidate`);
  return out;
}
