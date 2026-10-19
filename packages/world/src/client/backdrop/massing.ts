/** The far massing (desktop tiers): buildings of 15 m and more as boxes, one instanced draw (02-world-maps.md section 4.3). */
import { BoxGeometry, InstancedBufferAttribute, InstancedMesh, MeshStandardNodeMaterial } from 'three/webgpu';
import { hexToLinear } from '../chunks/mesher.ts';
import { BACKDROP, type MassingInstances } from './far-mesh.ts';

export function createMassing(m: MassingInstances): InstancedMesh {
  // A unit box standing on y = 0; the instance matrix scales it to w x h x d.
  const geometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const c = hexToLinear(BACKDROP.colors.massing);
  const material = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  material.color.setRGB(c[0], c[1], c[2]);
  const mesh = new InstancedMesh(geometry, material, m.count);
  mesh.instanceMatrix = new InstancedBufferAttribute(m.matrices, 16);
  mesh.position.set(m.originX, 0, m.originZ);
  mesh.name = 'world.backdrop.massing';
  mesh.frustumCulled = false;
  return mesh;
}
