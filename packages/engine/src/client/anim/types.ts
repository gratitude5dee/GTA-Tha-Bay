import type { SkeletonId } from '@dv/shared';

/**
 * Animation graph types (spec/domains/01-engine-contracts.md, "Engine service interfaces"; C04 anim states live in
 * `@dv/shared`). Presentation only: the graph is driven by the `Anim{state, p0, p1}` fields of the snapshot, and the sim owns
 * every position, so there is no root motion.
 */
export interface ClipRef {
  /** C07 AssetRef `<kind>/<id>`, for example `anim/<slug>.base`. */
  asset: string;
  clip: string;
  speed?: number;
}

export interface AnimStateDef {
  id: number;
  name: string;
  loop: boolean;
  clip?: ClipRef;
  blend1d?: { param: 0 | 1; points: [threshold: number, clip: ClipRef][] };
  blend2d?: { params: [0, 1]; points: [x: number, y: number, clip: ClipRef][] };
  fadeInSec: number;
}

export interface AnimGraphDef {
  id: string;
  skeleton: SkeletonId;
  states: AnimStateDef[];
  ik: { feet: boolean; hands: 'off' | 'xr' };
}

/** Mixer update bands in metres from the camera; beyond `quarterHzWithinM` the pose is frozen. */
export interface AnimLodBands {
  fullHzWithinM: number;
  halfHzWithinM: number;
  quarterHzWithinM: number;
}
