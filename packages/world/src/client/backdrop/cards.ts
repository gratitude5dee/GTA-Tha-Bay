/**
 * Skyline cards (`xr-visionpro` and `mobile` at 20 km, `mobile-low` and `xr-quest` at 10 km): one mesh, the atlas `texture/far-bay-cards`.
 * Since M10d2 the atlas is a KTX2 rasterised by bake S11, transcoded by the page's KTX2 decoder (M10d0); a bake from before it still
 * serves the PNG placeholder, which `atlasTexture` decodes.
 */
import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, DoubleSide, Mesh, MeshBasicNodeMaterial, Sphere, Texture, SRGBColorSpace, Vector3 } from 'three/webgpu';
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

/** A transcoded KTX2 atlas as the cards sample it: clamped at the edges (the cells of the atlas never wrap), sRGB. */
export function ktx2Atlas(tex: Texture): Texture {
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
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
