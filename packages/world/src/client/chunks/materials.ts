/**
 * The world's TSL node materials (P-03: no GLSL). One shared material per family, so a thousand chunk objects share a few pipelines:
 *
 *  - `chunk`  for L0 objects: vertex colour times baked AO (`aAO`), a dithered fade-in from the per-object `aBirth` time, the lit night
 *    windows (sky/night.ts) and the wet look of upward faces (`uWet`; desktop tiers also lose roughness), both driven by the sky;
 *  - `coarse` for L1 and L2 objects: the same, plus the cover mask `aCover` (16 bits, 4 x 4 cells of the unit): fragments over a
 *    resident child are discarded, so the finer level shows through without a seam.
 *
 * Per-object state travels in vertex attributes rather than uniforms, so the materials never change when objects come and go.
 * The fade is a screen-space dither over `uFadeSec` seconds (0 on the tiers that swap hard).
 */
import {
  attribute, clamp, dot, exp2, floor, fract, mod, positionLocal, positionWorld, normalLocal, screenCoordinate, select, sin, uniform, vec2, float, vertexColor,
} from 'three/tsl';
import { DoubleSide, FrontSide, MeshStandardNodeMaterial, type Material } from 'three/webgpu';
import { createLookNodes, type LookNodes } from '../look/common.ts';
import { LOOK, type LookFile } from '../look/config.ts';
import { createLookMaterials, type LookMaterialSet, type MaterialProfile } from '../look/look-materials.ts';
import { windowEmissive } from '../sky/night.ts';
import { createSkyNodes, type SkyNodes } from '../sky/nodes.ts';
import { asNode, loose } from '../sky/tsl.ts';
import { MESHER } from './mesher.ts';
import type { ObjectKind } from './mesh-types.ts';

export interface WorldMaterials {
  /** The M02b1/M02b2 materials (the `legacy` look profile, and the XR tiers). */
  chunk: MeshStandardNodeMaterial;
  coarse: MeshStandardNodeMaterial;
  /** M02e: the look materials of the tier's profile, null on a `legacy` tier. */
  look: LookMaterialSet | null;
  /** M02e: the nodes the look materials share (clocks, the window glow). */
  lookNodes: LookNodes;
  /** Whether the look materials are in use (QA `setLook` and the `world.look` flag switch it). */
  lookOn(): boolean;
  /** The material for an object kind of a level: the look's when it is on, else the legacy one. */
  materialFor(level: 'l0' | 'l1' | 'l2', kind: ObjectKind): Material;
  /** Switches the look on or off; false when the tier has no look materials. The caller re-records the resident units. */
  setLook(on: boolean): boolean;
  /** The look clock (waves): frozen by `shot()`. */
  setLookTime(seconds: number): void;
  /** Seconds, advanced by the chunk renderer each frame. */
  setTime(seconds: number): void;
  /** Night factor 0..1 (a test hook; the sky writes the shared node every frame). */
  setNight(n: number): void;
  setFadeSeconds(s: number): void;
  dispose(): void;
}

export const COARSE_CELLS = 4;

export function createWorldMaterials(o: {
  fadeSeconds: number;
  coarseCellM?: { l1: number; l2: number };
  sky?: SkyNodes;
  /** M02e: the profile of the tier's look (`legacy` or absent: the legacy materials only) and the config. */
  look?: { profile: MaterialProfile | 'legacy'; config?: LookFile };
}): WorldMaterials {
  const uTime = uniform(0);
  const uFade = uniform(o.fadeSeconds);
  // The sky's shared nodes (M02b2): the night windows, the wet look and the blackout read them. Without a sky they hold the day values.
  const sky = o.sky ?? createSkyNodes();
  const lookNodes = createLookNodes(sky, o.fadeSeconds);

  const aAO = attribute('aAO', 'float');
  const aBirth = attribute('aBirth', 'float');
  const aCover = attribute('aCover', 'float');
  const aCell = attribute('aCell', 'float');

  // Dither threshold in [0, 1): a hash of the pixel.
  const noise = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
  const fade = select(uFade.greaterThan(0), clamp(uTime.sub(aBirth).div(uFade), 0, 1), float(1));
  const shown = select(noise.lessThanEqual(fade), float(1), float(0));

  // The night window mask: warm squares on the walls (normal.y near 0) in a 3 m x 4 m grid, off by day.
  const wall = float(1).sub(clamp(normalLocal.y.abs().mul(3), 0, 1));
  const windows = select(fract(positionWorld.y.mul(0.28)).greaterThan(0.45), float(1), float(0)).mul(
    select(fract(positionWorld.x.add(positionWorld.z).mul(0.3)).greaterThan(0.4), float(1), float(0)),
  );
  const emissive = asNode(windowEmissive(sky, loose(wall), loose(windows)));
  // Wet ground and roofs: upward faces darken in the rain; the desktop tiers also lose roughness.
  const upward = clamp(normalLocal.y.sub(0.55).mul(5), 0, 1);
  const wetDark = float(1).sub(sky.uWet.mul(0.38).mul(upward as never) as never);

  const shade = aAO.mul(0.5).add(0.5);
  const base = (): MeshStandardNodeMaterial => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0, side: FrontSide });
    m.colorNode = vertexColor(0).mul(shade).mul(wetDark as never);
    m.roughnessNode = float(0.95).sub(sky.uWet.mul(sky.uWetRough).mul(0.55).mul(upward as never) as never) as never;
    m.emissiveNode = emissive;
    m.alphaTest = 0.5;
    return m;
  };

  const chunk = base();
  chunk.opacityNode = shown;

  // Cover mask: the cell of the fragment inside its unit (positions are local to the unit corner).
  const cellM = aCell; // metres per cell, constant per object (256 for an L1 tile, 1024 for an L2 block)
  const cx = clamp(floor(positionLocal.x.div(cellM)), 0, COARSE_CELLS - 1);
  const cz = clamp(floor(positionLocal.z.div(cellM)), 0, COARSE_CELLS - 1);
  const bit = cz.mul(COARSE_CELLS).add(cx);
  const covered = mod(floor(aCover.div(exp2(bit))), 2);
  const coarse = base();
  coarse.opacityNode = select(covered.greaterThan(0.5), float(0), shown);
  coarse.side = DoubleSide;

  // M02e: the look materials of the tier's profile. Built once; `setLook` only chooses between them and the legacy pair.
  const profile = o.look?.profile ?? 'legacy';
  const look: LookMaterialSet | null =
    profile === 'legacy'
      ? null
      : createLookMaterials({ profile, look: o.look?.config ?? LOOK, nodes: lookNodes, foundationM: MESHER.foundationM, parapetM: MESHER.parapetM });
  let lookOn = look !== null;

  return {
    chunk,
    coarse,
    look,
    lookNodes,
    lookOn: () => lookOn,
    materialFor: (level, kind) => {
      if (lookOn && look) {
        const m = (level === 'l0' ? look.l0 : look.coarse)[kind];
        if (m) return m;
      }
      return level === 'l0' ? chunk : coarse;
    },
    setLook: (on) => {
      if (on && !look) return false;
      lookOn = on;
      return true;
    },
    setLookTime: (s) => void (lookNodes.uLook.value = s),
    setTime: (s) => {
      uTime.value = s;
      lookNodes.uTime.value = s;
    },
    setNight: (n) => void (sky.uNight.value = n),
    setFadeSeconds: (s) => {
      uFade.value = s;
      lookNodes.uFade.value = s;
    },
    dispose: () => {
      chunk.dispose();
      coarse.dispose();
      look?.dispose();
    },
  };
}
