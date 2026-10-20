/**
 * The three half of the LandmarkLayer (M02d1): a decoded landmark model becomes one `Group` with a `Mesh` per primitive (at most
 * three at `hi` and `mid`, two at `lo`), drawn with the world's shared vertex-colour material so a landmark looks like the city
 * around it (sky, night windows, rain, fade-in all apply). The meshes are frustum-culled one by one, so `RenderBudgetMeter` counts
 * only what is in view. The group is not part of any chunk `BundleGroup`.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Object3D } from 'three/webgpu';
import type { LandmarkModelData } from './landmark-glb.ts';
import type { LandmarkHandle, LandmarkSpot } from './landmark-layer.ts';
import type { WorldMaterials } from './materials.ts';

export function mountLandmark(parent: Object3D, materials: WorldMaterials, spot: LandmarkSpot, model: LandmarkModelData, y: number, nowSec: number): LandmarkHandle {
  const group = new Group();
  group.name = `landmark:${spot.id}`;
  group.position.set(spot.x, y, spot.z);
  group.updateMatrix();
  group.matrixAutoUpdate = false;
  const geometries: BufferGeometry[] = [];
  let triangles = 0;
  for (const p of model.primitives) {
    const n = p.positions.length / 3;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(p.positions, 3));
    g.setAttribute('normal', new BufferAttribute(p.normals, 3));
    g.setAttribute('color', new BufferAttribute(p.colors, 3));
    g.setAttribute('aAO', new BufferAttribute(new Float32Array(n).fill(1), 1));
    g.setAttribute('aBirth', new BufferAttribute(new Float32Array(n).fill(nowSec), 1));
    g.setIndex(new BufferAttribute(p.indices, 1));
    const b = p.bounds;
    g.boundingSphere = new Sphere(new Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2), Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2);
    const mesh = new Mesh(g, materials.chunk);
    mesh.name = `landmark:${spot.id}:${p.material}`;
    mesh.frustumCulled = true;
    group.add(mesh);
    geometries.push(g);
    triangles += p.indices.length / 3;
  }
  parent.add(group);
  return {
    objects: model.primitives.length,
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
      for (const g of geometries) g.dispose();
    },
  };
}
