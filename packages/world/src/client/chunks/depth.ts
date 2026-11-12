/**
 * Polygon offsets of the world's materials (M02g2): where two surfaces fight over the same depth, the finer one wins.
 *
 * `polygonOffsetFactor` and `polygonOffsetUnits` are added to the depth value, so which way is "towards the camera" depends on the
 * depth buffer: a negative offset is nearer on a standard buffer and further on a reversed one, which is the one the renderer host asks
 * for (`reversedDepthBuffer: true`; the WebGL backend keeps it only with `EXT_clip_control`, and `RendererHost.depthPolicy` says which
 * came out). M02e wrote the coarse levels' offset as -64 meaning "pushed back", which is right on the reversed buffer only; the rules
 * below are written as a signed amount towards the camera (positive: nearer, negative: further) and mapped by the policy, so both
 * buffers get the intended order.
 */
import type { Material } from 'three/webgpu';

export type DepthPolicy = 'standard' | 'reversed';

/** The offset of one material: factor and units, positive towards the camera. */
export interface DepthBias {
  factor: number;
  units: number;
}

/** The raw `polygonOffset` values for a bias on a depth policy. */
export function polygonOffsetFor(policy: DepthPolicy, bias: DepthBias): DepthBias {
  const k = policy === 'reversed' ? 1 : -1;
  return { factor: bias.factor * k, units: bias.units * k };
}

/** Every material that carries an offset, so a change of depth policy (a renderer replaced after a device loss) can rewrite them all. */
export class DepthRules {
  private readonly entries: { m: Material; bias: DepthBias }[] = [];
  private current: DepthPolicy;

  constructor(policy: DepthPolicy = 'reversed') {
    this.current = policy;
  }

  get policy(): DepthPolicy {
    return this.current;
  }

  /** Gives `m` the bias (positive: towards the camera); `{0, 0}` clears it. Returns `m`. */
  set<M extends Material>(m: M, bias: DepthBias): M {
    const at = this.entries.findIndex((e) => e.m === m);
    if (at >= 0) this.entries[at] = { m, bias };
    else this.entries.push({ m, bias });
    this.write(m, bias);
    return m;
  }

  /** The bias a material was given, or null. */
  biasOf(m: Material): DepthBias | null {
    return this.entries.find((e) => e.m === m)?.bias ?? null;
  }

  setPolicy(policy: DepthPolicy): void {
    if (policy === this.current) return;
    this.current = policy;
    for (const e of this.entries) this.write(e.m, e.bias);
  }

  private write(m: Material, bias: DepthBias): void {
    const on = bias.factor !== 0 || bias.units !== 0;
    const raw = polygonOffsetFor(this.current, bias);
    m.polygonOffset = on;
    m.polygonOffsetFactor = on ? raw.factor : 0;
    m.polygonOffsetUnits = on ? raw.units : 0;
    m.needsUpdate = true;
  }
}

/**
 * The coarse levels (L1, L2) sit this far behind a detailed L0 surface in the same place (factor and units). M02e wrote 64; M02h1 raised it
 * to 512: the street paint made a coarse ribbon that wins the depth test where the L0 ribbon stands visible (at a graze of 1 m the double
 * yellow broke into horizontal stripes where an L1 or L2 road came through the L0 one; the stripes were gone from 128 up, DL/BD-M02h1-09).
 */
export const COARSE_BACK: DepthBias = { factor: -512, units: -512 };
/** A road ribbon over the terrain under it: `config/world/mesher.json` `depth.roadFactor` and `roadUnits` are the standard-depth values (-1, -4), nearer. */
export const roadBias = (factor: number, units: number): DepthBias => ({ factor: -factor, units: -units });
/** A landmark over the hand-over proxy it replaces (the chunk's extrusion, masked a frame later) and its plinth over the terrain. */
export const LANDMARK_FRONT: DepthBias = { factor: 2, units: 8 };

/** Adds two biases. */
export const plus = (a: DepthBias, b: DepthBias): DepthBias => ({ factor: a.factor + b.factor, units: a.units + b.units });
