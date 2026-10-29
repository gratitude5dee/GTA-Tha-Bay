/**
 * The landmark material of the look profiles (M02g2; TSL only). A landmark model is drawn as one mesh with vertex colours (the glass,
 * the stone and the metal are baked into them, `landmark-merge.ts`), and until now with the world's plain vertex-colour material. The
 * windows, mullions and ribs of those models are geometry a few tens of centimetres across, so beyond a few hundred metres their
 * triangles are smaller than a pixel and the colour moire-crawls over City Hall (the M02e before/after sheet).
 *
 * The fix is the same one the façade and the ground use: the detail fades out where a pixel covers more than the detail. Here the
 * vertex colour fades toward the model's area-weighted mean colour (`MergedLandmark.mean`, set per mesh in `userData.mean` and read
 * by an object-updated uniform, so every landmark shares one material and one pipeline) as the pixel footprint grows from 0.35 m to
 * 1.2 m. The night windows keep M02b2's rule and fade to their average the same way. The material is the same on `full`, `lite` and
 * `min`: it is cheap, and the `legacy` profile (the XR tiers) keeps the plain material of `chunks/materials.ts`.
 *
 * The mesh also carries the depth rule of this milestone: a landmark beats the hand-over proxy it replaces and its plinth beats the
 * terrain (`chunks/depth.ts`, `LANDMARK_FRONT`).
 */
import { uniform as uniformNode } from 'three/tsl';
import { Color, FrontSide, MeshStandardNodeMaterial } from 'three/webgpu';
import { LANDMARK_FRONT, type DepthRules } from '../chunks/depth.ts';
import { windowEmissive } from '../sky/night.ts';
import { asNode, clamp, float, fract, mix, normalLocal, positionWorld, select, smoothstep, vertexColor, type L } from '../sky/tsl.ts';
import { baseAttributes, fadeShown, type LookNodes } from './common.ts';
import { pixelFootprint } from './noise.ts';

/** The pixel footprint, metres, where the vertex colour starts to give way to the mean, and where it is entirely the mean. */
export const LANDMARK_FADE_M: readonly [number, number] = [0.35, 1.2];
/** Share of the 3 m x 4 m window grid that is lit when it is averaged out (0.55 x 0.6). */
const GRID_MEAN = 0.33;

export interface LandmarkMaterialOptions {
  nodes: LookNodes;
  depth: DepthRules;
}

/** One shared material for every landmark mesh; each mesh carries its own mean colour in `userData.mean` (linear RGB). */
export function createLandmarkMaterial(o: LandmarkMaterialOptions): MeshStandardNodeMaterial {
  const { nodes: n, depth } = o;
  const a = baseAttributes();
  const vc = vertexColor(0);
  const mean = (uniformNode(new Color(0.5, 0.5, 0.5)) as unknown as { onObjectUpdate(cb: (this: { value: Color }, f: { object: { userData: Record<string, unknown> } }) => void): L }).onObjectUpdate(function (f) {
    const m = f.object.userData['mean'] as readonly number[] | undefined;
    if (m) this.value.setRGB(m[0] as number, m[1] as number, m[2] as number);
  });

  const fp = pixelFootprint(positionWorld).max(0.002);
  const fade = smoothstep(LANDMARK_FADE_M[0], LANDMARK_FADE_M[1], fp);
  const shade = a.aAO.mul(0.3).add(0.7);
  // Rain darkens the upward faces, as on the chunks (`chunks/materials.ts`).
  const upward = clamp(normalLocal.y.sub(0.55).mul(5), 0, 1);
  const wetDark = float(1).sub(n.sky.uWet.mul(0.38).mul(upward));

  // The night windows: the same grid as the legacy material (3 m x 4 m), averaged out where the pixel covers many of them.
  const wall = float(1).sub(clamp(normalLocal.y.abs().mul(3), 0, 1));
  const grid = select(fract(positionWorld.y.mul(0.28)).greaterThan(0.45), float(1), float(0)).mul(
    select(fract(positionWorld.x.add(positionWorld.z).mul(0.3)).greaterThan(0.4), float(1), float(0)),
  );
  const gridFade = smoothstep(0.3, 1.1, fp.mul(0.3));
  const windows = mix(grid, float(GRID_MEAN), gridFade);

  const m = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, side: FrontSide });
  m.alphaTest = 0.5;
  m.opacityNode = asNode(fadeShown(n, a.aBirth)) as never;
  m.colorNode = asNode(mix(vc, mean, fade).mul(shade).mul(wetDark));
  m.roughnessNode = asNode(float(0.95).sub(n.sky.uWet.mul(n.sky.uWetRough).mul(0.55).mul(upward))) as never;
  m.emissiveNode = asNode(windowEmissive(n.sky, wall, windows));
  return depth.set(m, LANDMARK_FRONT);
}
