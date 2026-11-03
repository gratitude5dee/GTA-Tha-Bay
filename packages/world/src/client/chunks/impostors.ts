/**
 * The far-tree impostors (M02h5): opaque cards that stand in for a tree beyond `impostorM` (look.json `vegetation.scatter`), turned to
 * the camera about Y by a TSL `positionNode`. Two cards: `crown` (8 triangles: a trunk quad and a six-sided crown fan; every form but the
 * palm, told apart by the instance's scale and tint as the `low` crown is) and `palm` (12 triangles: a trunk quad and five drooping
 * fronds). No texture, no offscreen render, no alpha testing, alpha-to-coverage or transparency: the silhouette is geometry. The pools
 * never let an impostor cast.
 *
 * Geometry: in the card's own plane (`z = 0`), one unit tall, the normals up (the card is lit like the top of a crown whichever way it
 * turns). The instance matrix holds no rotation, only the scale `(sx, sy, sx)` and the foot; `aTint.w` holds `sx`, which the billboard
 * needs to find the foot again: three applies the instance matrix before `positionNode` (`NodeMaterial.setupPosition`, three@0.186.1),
 * so `positionLocal` is already `foot + scale x vertex` there.
 *
 * `geometryData` is pure (no `three`), so the tests count triangles and check the cards; `billboardPosition` is the node.
 */
import * as T from 'three/tsl';
import { FrontSide, MeshStandardNodeMaterial } from 'three/webgpu';
import { type Rgb, hexToLinear } from './mesher.ts';
import type { TreeGeometryData, TreeGeometryId } from './tree-forms.ts';
import { asNode, attribute, loose, vec3, type L } from '../sky/tsl.ts';

export type ImpostorId = 'imp-crown' | 'imp-palm';
export const IMPOSTOR_IDS: readonly ImpostorId[] = ['imp-crown', 'imp-palm'];
/** Triangles per card (AC-4). */
export const IMPOSTOR_TRIS: Readonly<Record<ImpostorId, number>> = { 'imp-crown': 8, 'imp-palm': 12 };

/** The card colours (sRGB): the crown is the `low` crown's neutral (the instance tint gives each form its own), a little darker as a card is lit flat. */
const CARD = { trunk: '#5c4330', crown: '#5f7d4a', palmTrunk: '#7d6b57', frond: '#4c7832' } as const;

class Card {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly leaf: number[] = [];
  readonly idx: number[] = [];
  v(x: number, y: number, c: Rgb, leaf: number): number {
    this.pos.push(x, y, 0);
    this.col.push(c[0], c[1], c[2]);
    this.leaf.push(leaf);
    return this.pos.length / 3 - 1;
  }
  /** Counter-clockwise seen from +z (the side the billboard turns to the camera). */
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  quad(x0: number, y0: number, x1: number, y1: number, c: Rgb, leaf: number): void {
    const a = this.v(x0, y0, c, leaf), b = this.v(x1, y0, c, leaf), d = this.v(x1, y1, c, leaf), e = this.v(x0, y1, c, leaf);
    this.tri(a, b, d);
    this.tri(a, d, e);
  }
  build(id: TreeGeometryId): TreeGeometryData {
    const n = this.pos.length / 3;
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1;
    return {
      id, positions: new Float32Array(this.pos), normals, colors: new Float32Array(this.col), leaf: new Float32Array(this.leaf), sway: null,
      indices: new Uint16Array(this.idx), triangles: this.idx.length / 3,
    };
  }
}

/** The crown card: the trunk to 0.42, a six-sided crown about (0, 0.66) as wide as the `low` crown (radius 0.32). */
function crownCard(): TreeGeometryData {
  const c = new Card();
  c.quad(-0.035, 0, 0.035, 0.42, hexToLinear(CARD.trunk), 0);
  const leaf = hexToLinear(CARD.crown);
  const centre = c.v(0, 0.66, leaf, 1);
  const ring: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    ring.push(c.v(Math.cos(a) * 0.32, 0.66 + Math.sin(a) * 0.33, leaf, 1));
  }
  for (let i = 0; i < 6; i++) c.tri(centre, ring[i] as number, ring[(i + 1) % 6] as number);
  return c.build('imp-crown');
}

/** The palm card: a straight trunk to 0.84 and five fronds, each two triangles, arching out and down. */
function palmCard(): TreeGeometryData {
  const c = new Card();
  const top = 0.84;
  c.quad(-0.05, 0, 0.05, top, hexToLinear(CARD.palmTrunk), 0);
  const leaf = hexToLinear(CARD.frond);
  const fronds: [number, number][] = [[-0.4, -0.2], [-0.24, 0.02], [0, 0.12], [0.24, 0.02], [0.4, -0.2]];
  for (const [dx, dy] of fronds) {
    const root = c.v(0, top, leaf, 1);
    // a bent strip: the root, a mid pair across the frond (perpendicular to its direction, lifted a little), the tip
    const mx = dx * 0.55, my = top + Math.max(dy, 0) * 0.7 + 0.05;
    const len = Math.hypot(dx, dy) || 1;
    const w = 0.045, px = (-dy / len) * w, py = (dx / len) * w;
    const m0 = c.v(mx - px, my - py, leaf, 1);
    const m1 = c.v(mx + px, my + py, leaf, 1);
    const tip = c.v(dx, top + dy, leaf, 1);
    // both triangles counter-clockwise from +z whichever side the frond leans to
    const ccw = (a: number, b: number, d: number): void => {
      const ax = c.pos[a * 3] as number, ay = c.pos[a * 3 + 1] as number;
      const bx = c.pos[b * 3] as number, by = c.pos[b * 3 + 1] as number;
      const dxx = c.pos[d * 3] as number, dyy = c.pos[d * 3 + 1] as number;
      const cross = (bx - ax) * (dyy - ay) - (by - ay) * (dxx - ax);
      if (cross >= 0) c.tri(a, b, d);
      else c.tri(a, d, b);
    };
    ccw(root, m0, m1);
    ccw(m0, tip, m1);
  }
  return c.build('imp-palm');
}

/** The cards in pool order (`imp-crown`, `imp-palm`). Deterministic. */
export function buildImpostorSet(ids: readonly ImpostorId[] = IMPOSTOR_IDS): TreeGeometryData[] {
  return ids.map((id) => (id === 'imp-crown' ? crownCard() : palmCard()));
}

/**
 * The billboard (`positionNode` of the impostor material): the card turns about Y to face the camera. `positionLocal` is the vertex after
 * the instance transform (foot + `(sx, sy, sx)` x vertex, no rotation); `aTint.w` is `sx`. The card's x axis becomes the horizontal
 * perpendicular of the direction to the camera, oriented so the card's front (counter-clockwise from +z) faces it.
 */
export function billboardPosition(): L {
  const pl = loose(T.positionLocal);
  const g = loose(T.positionGeometry);
  const sx = (attribute('aTint', 'vec4') as L).w;
  const cam = loose((T.modelWorldMatrixInverse as unknown as { mul(v: unknown): unknown }).mul(T.vec4(T.cameraPosition, 1)));
  const footX = pl.x.sub(g.x.mul(sx));
  const footZ = pl.z;
  const dx = cam.x.sub(footX), dz = cam.z.sub(footZ);
  const len = loose(T.max(loose(T.sqrt(loose(dx.mul(dx).add(dz.mul(dz))) as never)) as never, 1e-4));
  const ux = dx.div(len), uz = dz.div(len);
  // right = (uz, -ux): right x up = (ux, 0, uz), the card's normal toward the camera
  const off = g.x.mul(sx);
  return vec3(footX.add(uz.mul(off)), pl.y, footZ.sub(ux.mul(off)));
}

/**
 * The impostor material: the look's vegetation material (`look/look-materials.ts`, its colour and roughness nodes shared, so the cards take
 * the crown tint, the colour variation and the rain darkening of the meshes) with the billboard as its `positionNode` and no wind. Opaque,
 * front faces only. Built once per look material set by the chunk renderer.
 */
export function createImpostorMaterial(vegetation: MeshStandardNodeMaterial): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0, side: FrontSide });
  m.colorNode = vegetation.colorNode;
  m.roughnessNode = vegetation.roughnessNode;
  m.positionNode = asNode(billboardPosition());
  m.name = 'world.vegetation.impostor';
  return m;
}
