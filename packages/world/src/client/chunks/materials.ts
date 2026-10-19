/**
 * The world's TSL node materials (P-03: no GLSL). One shared material per family, so a thousand chunk objects share a few pipelines:
 *
 *  - `chunk`  for L0 objects: vertex colour times baked AO (`aAO`), a dithered fade-in from the per-object `aBirth` time, a night
 *    window mask hook (`uNight`, M02b2 drives it; 0 now);
 *  - `coarse` for L1 and L2 objects: the same, plus the cover mask `aCover` (16 bits, 4 x 4 cells of the unit): fragments over a
 *    resident child are discarded, so the finer level shows through without a seam.
 *
 * Per-object state travels in vertex attributes rather than uniforms, so the materials never change when objects come and go.
 * The fade is a screen-space dither over `uFadeSec` seconds (0 on the tiers that swap hard).
 */
import {
  attribute, clamp, dot, exp2, floor, fract, mod, positionLocal, positionWorld, normalLocal, screenCoordinate, select, sin, uniform, vec2, vec3, float, vertexColor,
} from 'three/tsl';
import { DoubleSide, FrontSide, MeshStandardNodeMaterial } from 'three/webgpu';

export interface WorldMaterials {
  chunk: MeshStandardNodeMaterial;
  coarse: MeshStandardNodeMaterial;
  /** Seconds, advanced by the chunk renderer each frame. */
  setTime(seconds: number): void;
  /** Night factor 0..1 (the window mask hook for M02b2). */
  setNight(n: number): void;
  setFadeSeconds(s: number): void;
  dispose(): void;
}

export const COARSE_CELLS = 4;

export function createWorldMaterials(o: { fadeSeconds: number; coarseCellM?: { l1: number; l2: number } }): WorldMaterials {
  const uTime = uniform(0);
  const uFade = uniform(o.fadeSeconds);
  const uNight = uniform(0);

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
  const emissive = vec3(1.0, 0.78, 0.45).mul(windows).mul(wall).mul(uNight).mul(1.4);

  const shade = aAO.mul(0.5).add(0.5);
  const base = (): MeshStandardNodeMaterial => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0, side: FrontSide });
    m.colorNode = vertexColor(0).mul(shade);
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

  return {
    chunk,
    coarse,
    setTime: (s) => void (uTime.value = s),
    setNight: (n) => void (uNight.value = n),
    setFadeSeconds: (s) => void (uFade.value = s),
    dispose: () => {
      chunk.dispose();
      coarse.dispose();
    },
  };
}
