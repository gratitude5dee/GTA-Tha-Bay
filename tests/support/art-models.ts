/**
 * Test helper (M10d1): the decoded model (`ArtModelData`) of an art asset straight from its recipe, turned to the engine's -Z forward
 * as the world's reader does. Unit tests of the engine and the world use it instead of the pack store.
 */
import { simplifierReady } from '../../tools/assets/src/lod.ts';
import { ART_ASSETS, buildModel } from '../../tools/assets/src/recipes/catalog.ts';
import { modelBounds, type Fidelity, type ModelDoc, type ModelNode } from '../../tools/assets/src/recipes/model.ts';
import type { ArtModelData, ArtNode } from '../../packages/engine/src/client/vehicle/art-model.ts';

function toNode(n: ModelNode): ArtNode {
  const t = n.translation ?? [0, 0, 0];
  return {
    name: n.name,
    translation: [-t[0], t[1], -t[2]],
    primitives: (n.meshes ?? [])
      .filter((m) => m.idx.length > 0)
      .map((m) => {
        const positions = Float32Array.from(m.pos);
        const normals = Float32Array.from(m.nor);
        for (let i = 0; i < positions.length; i += 3) {
          positions[i] = -(positions[i] as number);
          positions[i + 2] = -(positions[i + 2] as number);
          normals[i] = -(normals[i] as number);
          normals[i + 2] = -(normals[i + 2] as number);
        }
        return { material: m.material, positions, normals, colors: Float32Array.from(m.col), parts: Float32Array.from(m.part), indices: Uint16Array.from(m.idx) };
      }),
    children: (n.children ?? []).map(toNode),
  };
}

/** The decoded model of a recipe document. */
export function artModelOf(doc: ModelDoc): ArtModelData {
  const b = modelBounds(doc);
  let triangles = 0, vertices = 0;
  const count = (n: ModelNode): void => {
    if (n.name !== 'collider_hull') {
      for (const m of n.meshes ?? []) {
        triangles += m.idx.length / 3;
        vertices += m.vertexCount;
      }
    }
    (n.children ?? []).forEach(count);
  };
  doc.roots.forEach(count);
  const extras: Record<string, unknown> = { ...doc.extras };
  return {
    ref: doc.ref,
    fidelity: doc.fidelity,
    extras,
    roots: doc.roots.map(toNode),
    triangles,
    vertices,
    bounds: [-b[3], b[1], -b[5], -b[0], b[4], -b[2]],
  };
}

/** The decoded model of an art ref (`vehicle/traffic.sedan`) at a fidelity. */
export async function artModel(ref: string, f: Fidelity = 'hi'): Promise<ArtModelData> {
  await simplifierReady();
  const def = ART_ASSETS.find((a) => `${a.kind}/${a.id}` === ref);
  if (!def) throw new Error(`no art asset ${ref}`);
  return artModelOf(buildModel(def, f));
}
