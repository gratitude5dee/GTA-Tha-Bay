/**
 * Vehicle node anchors (C07 1.1 `KindExtras` vehicle; 05-assets-pipeline.md "Vehicle node contract"). A vehicle asset names its
 * nodes: `body`, four wheels (pivot at the hub centre), the front steering pivots, and lights. This module finds them in a
 * three scene graph. The gray-box vehicles of `vehicle-view.ts` use the default names below; when real art lands (M10d) the
 * glTF's `extras.nodes` give the names and the same code reads them.
 *
 * Axis note: the C07 contract is +Z forward. The engine's prefabs face -Z, so a loaded glTF root is turned half a circle about +Y
 * (`GLTF_FORWARD_FLIP`) before it is parented to the vehicle's pose.
 */
import type { Object3D } from 'three/webgpu';

export interface VehicleNodeNames {
  body: string;
  wheels: [string, string, string, string];
  steer?: string[];
  lights?: string[];
}

/** Default names: wheel_fl|fr|rl|rr, steer_fl|fr, light_head_l|r, light_brake_l|r (the C07 contract). */
export const DEFAULT_NODE_NAMES: Readonly<Required<VehicleNodeNames>> = Object.freeze({
  body: 'body',
  wheels: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as [string, string, string, string],
  steer: ['steer_fl', 'steer_fr'],
  lights: ['light_head_l', 'light_head_r', 'light_brake_l', 'light_brake_r'],
});

/** Half a circle about +Y: from a +Z-forward asset to the engine's -Z-forward convention. */
export const GLTF_FORWARD_FLIP = Math.PI;

export interface VehicleAnchors {
  body: Object3D | null;
  /** Front left, front right, rear left, rear right; null where the node is missing. */
  wheels: (Object3D | null)[];
  steer: Object3D[];
  lights: Object3D[];
  /** Names that were asked for and not found. */
  missing: string[];
}

/** Looks the named nodes up under `root`. `nodes` is `extras.nodes` of the asset; without it the default names apply. */
export function resolveAnchors(root: Object3D, nodes: VehicleNodeNames = DEFAULT_NODE_NAMES as VehicleNodeNames): VehicleAnchors {
  const missing: string[] = [];
  const find = (name: string): Object3D | null => {
    const o = root.getObjectByName(name) ?? null;
    if (!o) missing.push(name);
    return o;
  };
  const found = (list: readonly string[] | undefined): Object3D[] => {
    const out: Object3D[] = [];
    for (const n of list ?? []) {
      const o = root.getObjectByName(n);
      if (o) out.push(o);
    }
    return out;
  };
  return {
    body: find(nodes.body),
    wheels: nodes.wheels.map(find),
    steer: found(nodes.steer),
    lights: found(nodes.lights),
    missing,
  };
}
