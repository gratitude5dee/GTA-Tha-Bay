/** Gate A6 (spec/domains/05-assets-pipeline.md sections 2 and 3): one fidelity of a character against its row of config/asset-budgets.json. Pure. */
import { finding, type GateFinding } from './types.ts';

export interface FidelityLimits {
  tris: number;
  maxTexPx: number;
  materials: number;
  gpuTexBytes: number;
  fileBytes: number;
}

export type FidelityMeasure = FidelityLimits;

export function checkA6Budget(file: string, fidelity: 'hi' | 'mid' | 'lo', m: FidelityMeasure, limits: FidelityLimits): GateFinding[] {
  const out: GateFinding[] = [];
  const over = (rule: string, what: string, v: number, l: number): void => {
    if (v > l) out.push(finding('A6', file, rule, `${fidelity}: ${v} ${what} exceeds the budget of ${l}`));
  };
  over('tris', 'triangles', m.tris, limits.tris);
  over('texture', 'px texture edge', m.maxTexPx, limits.maxTexPx);
  over('materials', 'materials', m.materials, limits.materials);
  over('gpu-bytes', 'GPU texture bytes', m.gpuTexBytes, limits.gpuTexBytes);
  over('file-bytes', 'file bytes', m.fileBytes, limits.fileBytes);
  return out;
}

/** GPU bytes of a texture set: ASTC 4x4 is one byte per texel, plus a third for mips (spec section 3). */
export function gpuTexBytes(edges: readonly number[]): number {
  let total = 0;
  for (const e of edges) total += Math.ceil((e * e * 4) / 3);
  return total;
}
