/**
 * The macro variation of the ground (M02h2): `macroTone(x, z)`, a world-space value-noise fbm of two octaves (200 m and 50 m by default,
 * `config/world/mesher.json` `macro`), so large stretches of asphalt, sidewalk, curb, lot, plaza and grass differ a little in brightness and
 * roughness instead of repeating one tone. The shader computes the same function (`macroToneNode` in look/noise.ts) on the `full` and `lite`
 * profiles; on `min` the mesher bakes it into the vertex colours (`bakeMacro`).
 *
 * Pure and deterministic: no `three`, no randomness; the value depends on the world position only, so two chunks that share a border vertex
 * give it the same tone. The hash is the sine-free form the TSL helpers use (`hash21` in look/noise.ts).
 */
import mesherJson from '../../../../../config/world/mesher.json';
import { Surf } from '../look/surfaces.ts';

export interface MacroConfig {
  /** The cell size of each octave, metres (coarse first). */
  octavesM: readonly [number, number];
  /** The weight of each octave; they sum to 1. */
  weights: readonly [number, number];
  /** The albedo factor stays within 1 +- `albedo`. */
  albedo: number;
  /** The roughness offset stays within +- `roughness`. */
  roughness: number;
}

export const MACRO: MacroConfig = (mesherJson as unknown as { macro: MacroConfig }).macro;

const fract = (v: number): number => v - Math.floor(v);

/** The cell hash of look/noise.ts `hash21`, in [0, 1). */
export function hash21(x: number, y: number): number {
  const px = fract(x * 0.1031), py = fract(y * 0.1031), pz = fract(x * 0.1031);
  const d = px * (py + 33.33) + py * (px + 33.33) + pz * (pz + 33.33);
  const qx = px + d, qy = py + d, qz = pz + d;
  return fract((qx + qy) * qz);
}

/** Smooth value noise of look/noise.ts `vnoise`, in [0, 1). */
export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy), b = hash21(ix + 1, iy), c = hash21(ix, iy + 1), d = hash21(ix + 1, iy + 1);
  const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

/** The offset of the second octave (so the two do not share their lattice origin); the TSL mirror uses the same. */
export const MACRO_OFFSET: readonly [number, number] = [17.3, 5.9];

/** The fbm in [0, 1): the weighted sum of the two octaves at world (x, z). */
export function macroNoise(x: number, z: number, c: MacroConfig = MACRO): number {
  const [c0, c1] = c.octavesM;
  const [w0, w1] = c.weights;
  return (w0 * vnoise(x / c0, z / c0) + w1 * vnoise(x / c1 + MACRO_OFFSET[0], z / c1 + MACRO_OFFSET[1])) / (w0 + w1);
}

/** The albedo variation at world (x, z): a factor offset in (-albedo, +albedo); the surface's colour is multiplied by `1 + macroTone`. */
export function macroTone(x: number, z: number, c: MacroConfig = MACRO): number {
  return (macroNoise(x, z, c) - 0.5) * 2 * c.albedo;
}

/** The roughness offset at world (x, z), in (-roughness, +roughness), from the same noise as the tone (a darker patch is a little smoother). */
export function macroRoughness(x: number, z: number, c: MacroConfig = MACRO): number {
  return -(macroNoise(x, z, c) - 0.5) * 2 * c.roughness;
}

/**
 * Whether the macro variation applies to a surface id: asphalt (road ribbons, the ground's Asphalt class, the junction patch and the painted
 * quads over it), sidewalk (ground and ribbon), curb, lot, plaza and grass (Grass, Park). Paved keeps its plain tone when the look is off
 * (every Paved post is a Lot or a Plaza with the look on).
 */
export function macroApplies(id: number): boolean {
  return (
    id === Surf.GroundBase + 0 || id === Surf.GroundBase + 1 || id === Surf.GroundBase + 6 || id === Surf.GroundBase + 7 ||
    (id >= Surf.RoadBase && id <= Surf.RoadBase + 5) || id === Surf.Sidewalk ||
    id === Surf.Junction || id === Surf.Crosswalk || id === Surf.StopBar || id === Surf.Curb || id === Surf.Lot || id === Surf.Plaza
  );
}

/**
 * Bakes the tone into the vertex colours of a mesh (the `min` profile): each vertex whose surface `macroApplies` gets its colour times
 * `1 + macroTone` at its world position (`ox + x`, `oz + z`).
 */
export function bakeMacro(positions: Float32Array, colors: Float32Array, surf: Uint8Array, ox: number, oz: number, c: MacroConfig = MACRO): void {
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    if (!macroApplies(surf[i * 4] as number)) continue;
    const k = 1 + macroTone(ox + (positions[i * 3] as number), oz + (positions[i * 3 + 2] as number), c);
    colors[i * 3] = (colors[i * 3] as number) * k;
    colors[i * 3 + 1] = (colors[i * 3 + 1] as number) * k;
    colors[i * 3 + 2] = (colors[i * 3 + 2] as number) * k;
  }
}
