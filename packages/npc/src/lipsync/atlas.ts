import { ATLAS_ORDER, atlasCell, type Viseme } from '@dv/shared/npc';
import type { LipSyncTarget } from './driver.ts';

/**
 * The mouth atlas (C07 `mouth_atlas`, 04-npc.md section 5.7): a 3x3 grid, row-major in the order of `ATLAS_ORDER`. The face decal samples one
 * cell: its UV offset is (col / 3, 1 - (row + 1) / 3) with a scale of 1/3 on both axes.
 */
export const ATLAS_GRID = 3;

export function cellUv(shape: Viseme): { u: number; v: number; scale: number } {
  const { col, row } = atlasCell(shape);
  return { u: col / ATLAS_GRID, v: 1 - (row + 1) / ATLAS_GRID, scale: 1 / ATLAS_GRID };
}

/** How far the jaw opens for each shape, 0 (closed) to 1 (widest). The bone angle is `open * maxJawRad` on the target's side. */
export const JAW_OPEN: Readonly<Record<Viseme, number>> = { X: 0, A: 0.05, B: 0.2, C: 0.5, D: 1, E: 0.45, F: 0.3, G: 0.15, H: 0.25 };
export const MAX_JAW_RAD = 0.35;

/** A two-component uniform of the face-decal material (a TSL `uniform(vec2)` has this shape). */
export interface UvOffsetUniform {
  value: { set(x: number, y: number): unknown };
}

/** Adapts the decal's UV-offset uniform (and, when the rig has `extras.bones.jaw`, a jaw setter) to the driver's target. */
export function atlasTarget(uv: UvOffsetUniform, jaw?: (radians: number) => void): LipSyncTarget {
  return {
    setCell(_col, _row, shape) {
      const c = cellUv(shape);
      uv.value.set(c.u, c.v);
    },
    setJaw(open) {
      jaw?.(open * MAX_JAW_RAD);
    },
  };
}

/** Every cell of the grid is reachable from some shape. */
export const CELLS = ATLAS_ORDER.length;
