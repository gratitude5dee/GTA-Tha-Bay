/**
 * Software previews of the people parts (M10d4): a skinned mesh becomes a `Mesh` of the vehicle recipes' preview rasteriser with the
 * tint of its class baked into the vertex colour, so `renderModel` draws it without a GPU. The creator portraits (256 px cards) are
 * rendered this way; the same rasteriser serves the `--turntable` review sheets. Pure.
 */
import { Mesh, lin, type V3 } from './mesh.ts';
import type { ModelDoc } from './model.ts';
import { PERSON_PART, type SkinMesh } from './skin-mesh.ts';
import { encodePng, type Raster } from '../image.ts';
import { renderModel, type View } from './preview.ts';

export interface Tints {
  skin: V3;
  cloth: V3;
  cloth2: V3;
  hair: V3;
}

export const DEFAULT_TINTS: Tints = { skin: lin(0xc58c5f), cloth: lin(0x4a6fa5), cloth2: lin(0x2d3d5a), hair: lin(0x241a14) };

const tintOf = (part: number, t: Tints): V3 => {
  switch (part) {
    case PERSON_PART.skin: return t.skin;
    case PERSON_PART.lip: return [t.skin[0] * 0.95, t.skin[1] * 0.7, t.skin[2] * 0.72];
    case PERSON_PART.cloth: return t.cloth;
    case PERSON_PART.cloth2: return t.cloth2;
    case PERSON_PART.hair: return t.hair;
    default: return [0.82, 0.82, 0.8];
  }
};

/** One `Mesh` of the preview rasteriser from skinned meshes (the rest pose, tinted). */
export function previewMesh(parts: readonly SkinMesh[], tints: Tints = DEFAULT_TINTS): Mesh {
  const out = new Mesh('all');
  for (const s of parts) {
    const base = out.vertexCount;
    for (let i = 0; i < s.vertexCount; i++) {
      const c = tintOf(s.part[i] as number, tints);
      const ao = s.ao[i] as number;
      out.vertex(
        [s.pos[i * 3] as number, s.pos[i * 3 + 1] as number, s.pos[i * 3 + 2] as number],
        [s.nor[i * 3] as number, s.nor[i * 3 + 1] as number, s.nor[i * 3 + 2] as number],
        [c[0] * ao, c[1] * ao, c[2] * ao],
        s.part[i] as number,
      );
    }
    for (const i of s.idx) out.idx.push(i + base);
  }
  return out;
}

/**
 * The rasteriser looks down -Z with +X to the right; the people are authored facing -Z with the `l_` side on +X, so a view with azimuth 180
 * shows the front. The azimuths below are for the people frame.
 */
export const FRONT_VIEW: View = { azimuthDeg: 180, elevationDeg: 4 };
export const THREE_QUARTER: View = { azimuthDeg: 150, elevationDeg: 8 };

export function modelOf(ref: string, mesh: Mesh): ModelDoc {
  return { ref, fidelity: 'hi', extras: {}, roots: [{ name: 'people', meshes: [mesh] }] };
}

/** A card: the part and its context in one view, `size` px square. */
export function renderCard(context: readonly SkinMesh[], part: readonly SkinMesh[], view: View, size: number, tints: Tints = DEFAULT_TINTS, contextTints: Tints = DEFAULT_TINTS): Raster {
  const m = new Mesh('all');
  if (context.length > 0) m.append(previewMesh(context, contextTints));
  m.append(previewMesh(part, tints));
  return renderModel(modelOf('portrait', m), view, size);
}

export const cardPng = (r: Raster): Uint8Array => encodePng(r);
