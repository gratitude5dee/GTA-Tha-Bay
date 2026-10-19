/** Skyline cards (`xr-visionpro` and `mobile` at 20 km, `mobile-low` and `xr-quest` at 10 km): one mesh, the atlas `texture/far-bay-cards`. */
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial, Sphere, Texture, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { hexToLinear } from '../chunks/mesher.ts';
import { BACKDROP, type CardsLayout } from './far-mesh.ts';

/** PNG bytes of the atlas to a texture. Needs `createImageBitmap` (a page; the sky of Node tests passes a texture of its own). */
export async function atlasTexture(png: ArrayBuffer): Promise<Texture> {
  const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  const t = new Texture(bmp as unknown as HTMLImageElement);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

export function createCards(layout: CardsLayout, atlas: Texture): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(layout.positions, 3));
  g.setAttribute('uv', new BufferAttribute(layout.uvs, 2));
  g.setIndex(new BufferAttribute(layout.indices, 1));
  g.boundingSphere = new Sphere(new Vector3(0, 0, 0), 120_000);
  const tint = hexToLinear(BACKDROP.colors.card);
  const material = new MeshBasicNodeMaterial({ map: atlas, transparent: false, alphaTest: 0.5, side: DoubleSide });
  material.color.setRGB(tint[0], tint[1], tint[2]);
  const mesh = new Mesh(g, material);
  mesh.name = 'world.backdrop.cards';
  mesh.frustumCulled = false;
  return mesh;
}
