/**
 * The three half of the LandmarkLayer (M02d1, M02d2): a decoded landmark model becomes one `Group` holding one `Mesh` (the primitives
 * are merged: see `landmark-merge.ts`), drawn with the world's shared vertex-colour material so a landmark looks like the city
 * around it (sky, night windows, rain, fade-in all apply). The mesh is frustum-culled, so `RenderBudgetMeter` counts it only when
 * it is in view and visible. The group is not part of any chunk `BundleGroup`.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Object3D } from 'three/webgpu';
import type { LandmarkModelData } from './landmark-glb.ts';
import type { LandmarkHandle, LandmarkSpot } from './landmark-layer.ts';
import type { WorldMaterials } from './materials.ts';
import { mergePrimitives } from './landmark-merge.ts';

export function mountLandmark(parent: Object3D, materials: WorldMaterials, spot: LandmarkSpot, model: LandmarkModelData, y: number, nowSec: number): LandmarkHandle {
  const group = new Group();
  group.name = `landmark:${spot.id}`;
  group.position.set(spot.x, y, spot.z);
  group.updateMatrix();
  group.matrixAutoUpdate = false;
  // One mesh per landmark: the world draws every material class with the same material (see landmark-merge.ts).
  const m = mergePrimitives(model.primitives);
  const n = m.vertices;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  g.setAttribute('color', new BufferAttribute(m.colors, 3));
  g.setAttribute('aAO', new BufferAttribute(new Float32Array(n).fill(1), 1));
  g.setAttribute('aBirth', new BufferAttribute(new Float32Array(n).fill(nowSec), 1));
  g.setIndex(new BufferAttribute(m.indices, 1));
  const b = m.bounds;
  g.boundingSphere = new Sphere(new Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2), Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2);
  const mesh = new Mesh(g, materials.chunk);
  mesh.name = `landmark:${spot.id}`;
  mesh.frustumCulled = true;
  group.add(mesh);
  const triangles = m.triangles;
  parent.add(group);
  return {
    objects: 1,
    triangles,
    setHeight: (y) => {
      group.position.y = y;
      group.updateMatrix();
    },
    // a hidden group draws nothing and `RenderBudgetMeter` does not count it (the skyline instance under a full-fidelity model)
    setVisible: (visible) => {
      group.visible = visible;
    },
    dispose: () => {
      parent.remove(group);
      g.dispose();
    },
  };
}
