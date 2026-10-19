/** The DEM ring (R-MAP-02; 02-world-maps.md section 4.3): one mesh, vertex coloured, out to 80 km on the desktop tiers. */
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardNodeMaterial, Sphere, Vector3 } from 'three/webgpu';
import type { RingMesh } from './far-mesh.ts';

export function createRing(r: RingMesh, material: MeshStandardNodeMaterial): Mesh {
  const b = r.buffers;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(b.positions, 3));
  g.setAttribute('normal', new BufferAttribute(b.normals, 3));
  g.setAttribute('color', new BufferAttribute(b.colors, 3));
  g.setIndex(new BufferAttribute(b.indices, 1));
  const [x0, y0, z0, x1, y1, z1] = b.bounds;
  g.boundingSphere = new Sphere(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2) / 2);
  const m = new Mesh(g, material);
  m.name = 'world.backdrop.ring';
  m.position.set(r.originX, 0, r.originZ);
  // The ring is one object that is always in view when the camera is inside it.
  m.frustumCulled = false;
  return m;
}

export function ringMaterial(): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
}
