/**
 * The final look of vehicles and props (M10d1): a `DrawnThing` made from a decoded `.glb` model (`art-model.ts`). The node tree keeps its
 * names, so `anchors.ts` finds `body`, `wheel_*`, `steer_*`, `light_*`, `tyre_*` and `rim_*` as it did on the gray-box kit; wheels spin
 * about X and the steering pivots turn about Y. Every primitive is one mesh with the shared material of its pass (`art.material`), opaque
 * or glass. The model is placed on the entity as the gray-box was: a road vehicle with its ground `cgHeightM` below the position and its
 * hubs where the handling preset has them, a prop about the middle of its bounds (the beam and the helicopter as authored).
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, type Material, type Object3D } from 'three/webgpu';
import { handlingById } from '../../sim/vehicle/presets.ts';
import { resolveAnchors } from './anchors.ts';
import { art } from './art.ts';
import type { ArtModelData, ArtNode, ArtPrimitive } from './art-model.ts';
import { ART_ANCHOR, ART_VEHICLES } from './art-tables.ts';
import { beamMaterial } from './marker-beam.ts';
import { buildTowBoom, type Attachment, type DrawnThing, type GrayboxAssets } from './vehicle-view.ts';

const geometries = new WeakMap<ArtPrimitive, BufferGeometry>();

/** The geometry of one primitive, shared by every entity that draws the model. */
export function primitiveGeometry(p: ArtPrimitive): BufferGeometry {
  let g = geometries.get(p);
  if (!g) {
    g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p.positions, 3));
    g.setAttribute('normal', new BufferAttribute(p.normals, 3));
    g.setAttribute('color', new BufferAttribute(p.colors, 3));
    g.setAttribute('aPart', new BufferAttribute(p.parts, 1));
    g.setIndex(new BufferAttribute(p.indices, 1));
    geometries.set(p, g);
  }
  return g;
}

/** Counts the meshes (primitives outside the collider) of a model: the render objects one entity costs. */
export function artMeshCount(model: ArtModelData): number {
  let n = 0;
  const visit = (node: ArtNode): void => {
    if (node.name === 'collider_hull') return;
    n += node.primitives.length;
    node.children.forEach(visit);
  };
  model.roots.forEach(visit);
  return n;
}

function build(node: ArtNode, material: (p: ArtPrimitive) => Material): Object3D | null {
  if (node.name === 'collider_hull') return null;
  let obj: Object3D;
  const prims = node.primitives;
  if (prims.length === 1) {
    const p = prims[0] as ArtPrimitive;
    obj = new Mesh(primitiveGeometry(p), material(p));
  } else {
    obj = new Group();
    for (const p of prims) {
      const m = new Mesh(primitiveGeometry(p), material(p));
      m.name = `${node.name}.${p.material}`;
      obj.add(m);
    }
  }
  obj.name = node.name;
  obj.position.set(node.translation[0], node.translation[1], node.translation[2]);
  for (const c of node.children) {
    const child = build(c, material);
    if (child) obj.add(child);
  }
  return obj;
}

const centreOf = (model: ArtModelData): [number, number, number] => {
  const b = model.bounds;
  return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
};

/** A drawn thing for `key` from its decoded model. `assets` is the pool's gray-box kit (the tow boom borrows its box geometry). */
export function buildArtThing(assets: GrayboxAssets, key: string, model: ArtModelData): DrawnThing {
  const isBeam = key === 'prop/marker.beam';
  const material = (p: ArtPrimitive): Material => (isBeam ? beamMaterial() : art.material(p.material === 'glass' ? 'glass' : 'opaque'));
  const root = new Group();
  root.name = key;
  const inner = new Group();
  inner.name = 'art';
  root.add(inner);
  for (const r of model.roots) {
    const o = build(r, material);
    if (o) inner.add(o);
  }
  root.userData['dvArt'] = key;

  const veh = ART_VEHICLES[key];
  let attachments: Attachment[] | undefined;
  const spin: Object3D[] = [];
  const steer: Object3D[] = [];
  let r = 0.33;
  let lockRad = 0.5;
  if (veh) {
    const hp = handlingById(veh.hp);
    r = typeof model.extras['wheelRadiusM'] === 'number' ? (model.extras['wheelRadiusM'] as number) : hp.drive.wheelRadiusM;
    lockRad = Math.min(0.5, hp.steer.lockDeg * 0.0174533);
    // ground at -cg; the front hubs of the model at the preset's front axle (forward is -Z)
    const frontZ = -hp.wheelbaseM * (1 - hp.frontWeightPct / 100);
    const frontHub = inner.getObjectByName('wheel_fl');
    // the model is not placed yet, so its own hub z is the sum of the pivot and the wheel positions up to `inner`
    let z = -hp.wheelbaseM / 2;
    if (frontHub) {
      z = 0;
      for (let o: Object3D | null = frontHub; o && o !== inner; o = o.parent) z += o.position.z;
    }
    inner.position.set(0, -hp.cgHeightM, frontZ - z);
    const anchors = resolveAnchors(root);
    for (const w of anchors.wheels) if (w) spin.push(w);
    steer.push(...anchors.steer);
    if (key === 'vehicle/traffic.pickup') {
      // the tow boom of the m.a1.01 stage stands over the bed, as on the gray-box pickup
      const tow = buildTowBoom(assets, 0.4, 1.45);
      (inner.getObjectByName('body') ?? inner).add(tow.node);
      attachments = [tow.attachment];
    }
  } else if (ART_ANCHOR[key] !== 'origin') {
    const c = centreOf(model);
    inner.position.set(-c[0], -c[1], -c[2]);
  }

  const rotors: { node: Object3D; axis: 'y' | 'x'; rate: number }[] = [];
  const main = inner.getObjectByName('rotor_main');
  const tail = inner.getObjectByName('rotor_tail');
  if (main) rotors.push({ node: main, axis: 'y', rate: 18 });
  if (tail) rotors.push({ node: tail, axis: 'x', rate: 30 });
  const spinY = key === 'prop/pickup-cash' || key === 'prop/pickup-item' ? 2 : 0;
  const bob = spinY !== 0;
  const baseY = inner.position.y;
  let angle = 0;
  let t = 0;
  return {
    root,
    anchors: resolveAnchors(root),
    ...(attachments ? { attachments } : {}),
    update(dt, speed, steerInput) {
      if (veh) {
        angle -= (speed / r) * dt;
        for (const w of spin) w.rotation.x = angle;
        const delta = -steerInput * lockRad;
        for (const s of steer) s.rotation.y = delta;
        return;
      }
      for (const q of rotors) q.node.rotation[q.axis] += dt * q.rate;
      if (spinY !== 0) {
        t += dt;
        inner.rotation.y += dt * spinY;
        if (bob) inner.position.y = baseY + Math.sin(t * 2.4) * 0.12;
      }
    },
  };
}
