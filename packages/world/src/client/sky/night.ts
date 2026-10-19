/**
 * The night (M02b2; TSL only):
 *
 *  - `windowEmissive`: the lit-window term of the world materials. A building's windows come on when the night-driven lit fraction
 *    (`smoothstep` of `uNight`, or the preset's own `windowLit` in a dark rain) passes the building's threshold (0.15 to 0.75).
 *    The threshold is a hash of the baked wall colour, which is a function of the building record's seed (the mesher tints each
 *    building by `jitter(seed)`), so no vertex attribute is added and the upload budgets stay as they were. The blackout takes the
 *    glow to 0.15;
 *  - `NightLights`: the street lamps (instanced poles with emissive heads and additive halo sprites, drawn from the baked LAMP
 *    records of the resident L0 chunks) and the pool-of-light decals on the ground under the lamps nearest the player, at most
 *    `decalCap` of them. Lamps are off in a blackout. Three render objects in all, whatever the number of chunks.
 *
 * `uDark > 0.4` is the head- and tail-light signal for the traffic milestone (M03b1): `headlightsOn` reads it.
 */
import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, DoubleSide, AdditiveBlending, type Object3D, type Vector3 } from 'three/webgpu';
import type { SkyNodes } from './nodes.ts';
import { asNode, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, float, floor, fract, max, mix, positionWorld, sin, smoothstep, step, vec3, vec4, vertexColor, type L } from './tsl.ts';

/** Darkness above which cars switch their head- and tail-lights on (02-world-living.md section 6 rule 4). */
export const HEADLIGHTS_DARK = 0.4;
export const headlightsOn = (dark: number): boolean => dark > HEADLIGHTS_DARK;

/** Window threshold range per building (spec: from the record seed, 0.15 to 0.75). */
export const WINDOW_THRESHOLD = { lo: 0.15, hi: 0.75 } as const;
/** Window glow in a blackout, as a share of normal (spec: windows x 0.15). */
export const BLACKOUT_WINDOW_FACTOR = 0.15;

/** The warm window colour. */
const WINDOW_COLOR: [number, number, number] = [1.0, 0.78, 0.45];

/**
 * Emissive colour of the lit windows for a material whose vertex colour is the wall colour. `wall` is 1 on vertical faces and
 * `windows` the 0/1 window grid of the face (both from the material's own geometry terms).
 */
export function windowEmissive(n: SkyNodes, wall: L, windows: L): L {
  const c = vertexColor(0);
  // A building-constant hash of the wall colour: the tint is a function of the record seed, so this is a function of the seed.
  // Quantised first: a hash of the raw colour amplifies the float error of the interpolation into per-pixel noise.
  const key = floor(c.x.mul(91.7).add(c.y.mul(47.3)).add(c.z.mul(13.1)).mul(1000).add(0.5));
  const thr = float(WINDOW_THRESHOLD.lo).add(fract(sin(key.mul(12.9898)).mul(43758.5453)).mul(WINDOW_THRESHOLD.hi - WINDOW_THRESHOLD.lo));
  const night = smoothstep(0.1, 0.9, n.uNight);
  const lit = max(night, n.uWindowLit);
  const on = step(thr, lit);
  // Not every window of a lit building: a cell hash keeps about three quarters of them on.
  const cell = floor(positionWorld.y.mul(0.28)).add(floor(positionWorld.x.add(positionWorld.z).mul(0.3)).mul(31.0));
  const some = step(0.25, fract(sin(cell.mul(12.9898)).mul(43758.5453)));
  const blackout = float(1).sub(n.uBlackout.mul(1 - BLACKOUT_WINDOW_FACTOR));
  return vec3(...WINDOW_COLOR).mul(windows).mul(wall).mul(on).mul(some).mul(blackout).mul(1.5);
}

export interface NightLightsOptions {
  nodes: SkyNodes;
  parent: Object3D;
  /** Pool-of-light decal cap of the tier (0 for none). */
  decalCap: number;
  /** Most lamp poles drawn at once. */
  maxLamps: number;
  /** Lamps farther than this from the camera are not drawn, metres. */
  radiusM: number;
}

const POLE_H = 6.4;
const DECAL_R = 5.5;

/** Pole and head as one small geometry; the `aEm` attribute is 1 on the head. */
function lampGeometry(): BufferGeometry {
  const pos: number[] = [];
  const em: number[] = [];
  const idx: number[] = [];
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, e: number): void => {
    const b = pos.length / 3;
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] as const) {
      pos.push(x, y, z);
      em.push(e);
    }
    for (const f of [[0, 1, 5, 0, 5, 4], [1, 2, 6, 1, 6, 5], [2, 3, 7, 2, 7, 6], [3, 0, 4, 3, 4, 7], [4, 5, 6, 4, 6, 7]] as const) idx.push(...f.map((i) => b + i));
  };
  box(-0.07, 0, -0.07, 0.07, POLE_H, 0.07, 0);
  box(-0.22, POLE_H - 0.02, -0.22, 0.22, POLE_H + 0.16, 0.22, 1);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aEm', new BufferAttribute(new Float32Array(em), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function quadGeometry(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}

export class NightLights {
  readonly poles: InstancedMesh;
  readonly halos: Mesh;
  readonly decals: Mesh;
  /** Lamps drawn now (poles), and decals. */
  poleCount = 0;
  decalCount = 0;

  private readonly haloPos: InstancedBufferAttribute;
  private readonly decalPos: InstancedBufferAttribute;
  private readonly m4 = new Matrix4();
  private readonly o: NightLightsOptions;
  /** Decals in force now (the governor can lower it below the cap the buffers were made for). */
  private decalCap: number;

  constructor(o: NightLightsOptions) {
    this.o = o;
    this.decalCap = o.decalCap;
    const n = o.nodes;
    const max_ = Math.max(1, o.maxLamps);

    // Poles: instanced, the head glows with the lamp strength.
    const em = attribute('aEm', 'float');
    const pm = new MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0.2 });
    (pm as unknown as { colorNode: unknown }).colorNode = asNode(mix(vec3(0.16, 0.17, 0.19), vec3(0.05, 0.05, 0.05), em));
    (pm as unknown as { emissiveNode: unknown }).emissiveNode = asNode(vec3(1.0, 0.82, 0.5).mul(em).mul(n.uLampOn).mul(3.0));
    this.poles = new InstancedMesh(lampGeometry(), pm, max_);
    this.poles.count = 0;
    this.poles.frustumCulled = false;
    this.poles.name = 'world.sky.lamps';

    // Halos: camera-facing glow sprites at the lamp heads, additive.
    this.haloPos = new InstancedBufferAttribute(new Float32Array(max_ * 3), 3);
    const hg = quadGeometry();
    hg.setAttribute('aPos', this.haloPos);
    const aPos = attribute('aPos', 'vec3');
    const corner = attribute('position', 'vec3');
    const head = aPos.add(vec3(0, POLE_H + 0.1, 0));
    const view = cameraViewMatrix.mul(vec4(head, 1));
    const dist = view.z.negate();
    const size = max(float(0.9), dist.mul(0.0035));
    const clip = cameraProjectionMatrix.mul(vec4(view.x.add(corner.x.mul(size)), view.y.add(corner.y.mul(size)), view.z, 1));
    const hm = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending, side: DoubleSide });
    const r2 = corner.x.mul(corner.x).add(corner.y.mul(corner.y));
    const falloff = clamp(float(1).sub(r2), 0, 1);
    (hm as unknown as { vertexNode: unknown }).vertexNode = asNode(clip);
    (hm as unknown as { colorNode: unknown }).colorNode = asNode(vec3(1.0, 0.8, 0.5));
    (hm as unknown as { opacityNode: unknown }).opacityNode = asNode(falloff.mul(falloff).mul(n.uLampOn).mul(float(1).sub(smoothstep(o.radiusM * 0.7, o.radiusM, dist))).mul(0.9));
    this.halos = new Mesh(hg, hm);
    hg.instanceCount = 0;
    this.halos.frustumCulled = false;
    this.halos.renderOrder = 15;
    this.halos.name = 'world.sky.halos';

    // Pool-of-light decals: flat warm discs on the ground under the nearest lamps.
    const dcap = Math.max(1, o.decalCap);
    this.decalPos = new InstancedBufferAttribute(new Float32Array(dcap * 3), 3);
    const dg = quadGeometry();
    dg.setAttribute('aPos', this.decalPos);
    const dc = attribute('position', 'vec3');
    const dworld = attribute('aPos', 'vec3').add(vec3(dc.x.mul(DECAL_R), 0.07, dc.y.mul(DECAL_R)));
    const dclip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(dworld, 1)));
    const dm = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending, side: DoubleSide });
    const rr = clamp(dc.x.mul(dc.x).add(dc.y.mul(dc.y)), 0, 1);
    const pool = float(1).sub(rr);
    (dm as unknown as { vertexNode: unknown }).vertexNode = asNode(dclip);
    (dm as unknown as { colorNode: unknown }).colorNode = asNode(vec3(1.0, 0.78, 0.45));
    (dm as unknown as { opacityNode: unknown }).opacityNode = asNode(pool.mul(pool).mul(n.uLampOn).mul(0.28));
    this.decals = new Mesh(dg, dm);
    dg.instanceCount = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 14;
    this.decals.name = 'world.sky.decals';
    this.decals.visible = o.decalCap > 0;

    o.parent.add(this.poles, this.halos);
    if (o.decalCap > 0) o.parent.add(this.decals);
  }

  /** Lowers or restores the decal cap (never above the cap the buffers were made for). */
  setDecalCap(cap: number): void {
    this.decalCap = Math.max(0, Math.min(this.o.decalCap, cap));
    this.decals.visible = this.decalCap > 0 && this.shown;
  }

  private shown = true;

  /** Shows or hides all three objects (the sky switch). */
  setVisible(on: boolean): void {
    this.shown = on;
    this.poles.visible = on;
    this.halos.visible = on;
    this.decals.visible = on && this.decalCap > 0;
  }

  /**
   * Replaces the lamp set. `lamps` holds world x, y, z triples; the nearest `maxLamps` within `radiusM` of `cam` are kept, and the
   * nearest `decalCap` of those get a pool of light.
   */
  setLamps(lamps: Float32Array, cam: Vector3): void {
    const count = Math.floor(lamps.length / 3);
    const r2 = this.o.radiusM * this.o.radiusM;
    const near: { d: number; i: number }[] = [];
    for (let i = 0; i < count; i++) {
      const dx = (lamps[i * 3] as number) - cam.x, dz = (lamps[i * 3 + 2] as number) - cam.z;
      const d = dx * dx + dz * dz;
      if (d <= r2) near.push({ d, i });
    }
    near.sort((a, b) => a.d - b.d || a.i - b.i);
    const keep = near.slice(0, this.o.maxLamps);
    for (let k = 0; k < keep.length; k++) {
      const i = (keep[k] as { i: number }).i;
      const x = lamps[i * 3] as number, y = lamps[i * 3 + 1] as number, z = lamps[i * 3 + 2] as number;
      this.m4.makeTranslation(x, y, z);
      this.poles.setMatrixAt(k, this.m4);
      this.haloPos.setXYZ(k, x, y, z);
    }
    this.poleCount = keep.length;
    this.poles.count = keep.length;
    this.poles.instanceMatrix.needsUpdate = true;
    this.haloPos.needsUpdate = true;
    (this.halos.geometry as InstancedBufferGeometry).instanceCount = keep.length;
    const dn = Math.min(this.decalCap, keep.length);
    for (let k = 0; k < dn; k++) {
      const i = (keep[k] as { i: number }).i;
      this.decalPos.setXYZ(k, lamps[i * 3] as number, lamps[i * 3 + 1] as number, lamps[i * 3 + 2] as number);
    }
    this.decalCount = dn;
    this.decalPos.needsUpdate = true;
    (this.decals.geometry as InstancedBufferGeometry).instanceCount = dn;
  }

  /** The render objects the night lights add to a frame. */
  get objects(): number {
    return this.shown ? 2 + (this.decalCap > 0 ? 1 : 0) : 0;
  }

  dispose(): void {
    this.o.parent.remove(this.poles, this.halos, this.decals);
    this.poles.geometry.dispose();
    (this.poles.material as MeshStandardNodeMaterial).dispose();
    this.halos.geometry.dispose();
    (this.halos.material as MeshBasicNodeMaterial).dispose();
    this.decals.geometry.dispose();
    (this.decals.material as MeshBasicNodeMaterial).dispose();
    this.poles.dispose();
  }
}
