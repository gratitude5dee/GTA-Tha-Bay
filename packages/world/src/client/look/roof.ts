/**
 * Roofs (M02e; TSL only): flat roofs a light membrane with seams and gravel, gable and hip roofs shingle courses along the slope,
 * rooftop equipment its own metal. The courses are lines of constant height, which on a roof plane are exactly its contours, so they
 * run along the eave without a slope coordinate.
 */
import { float, mix, positionWorld, step, vec2, vec3, smoothstep, type L } from '../sky/tsl.ts';
import { srgbHexToLinear, type LookFile } from './config.ts';
import { around1, bandFade, edgeLineAA, hash11, hash21, pixelFootprint, vnoise, vnoiseAA } from './noise.ts';
import { Surf } from './surfaces.ts';

export interface RoofOut {
  color: L;
  roughness: L;
  metalness: L;
}

const tri = (hex: string): [number, number, number] => srgbHexToLinear(hex);

/** `id` is the surface id (flat roof 25, gable 26, hip 27, equipment 29); `seed` is 0..1 from the facade attribute. */
export function roofNodes(look: LookFile, id: L, seed: L, detail: boolean): RoofOut {
  const flat = tri(look.roof.flat.albedo);
  const gable = tri(look.roof.gable.albedo);
  const hip = tri(look.roof.hip.albedo);
  const isGable = step(Surf.RoofGable - 0.5, id).mul(step(id, Surf.RoofGable + 0.5));
  const isHip = step(Surf.RoofHip - 0.5, id).mul(step(id, Surf.RoofHip + 0.5));
  const isEquip = step(Surf.Equipment - 0.5, id).mul(step(id, Surf.Equipment + 0.5));
  const isFlat = float(1).sub(isGable).sub(isHip).sub(isEquip);
  const seedI = seed.mul(32767).round();

  // Per-building tone: the base colour moves a little around the class colour.
  const tone = hash11(seedI.mul(1.13)).mul(0.3).add(0.85);
  const base = vec3(...flat).mul(isFlat).add(vec3(...gable).mul(isGable)).add(vec3(...hip).mul(isHip)).mul(tone);

  const p = positionWorld;
  const fp = pixelFootprint(p).max(0.002);
  // Membrane: seams every 1.2 m, a slow patchiness and fine gravel.
  const seamX = edgeLineAA(p.x.div(1.2), 0.025, 1.2, fp);
  const seamZ = edgeLineAA(p.z.div(1.2).add(0.37), 0.025, 1.2, fp);
  const patch = around1(vnoise(vec2(p.x.mul(0.35), p.z.mul(0.35)).add(seedI)), 0.1);
  const gravel = detail ? around1(vnoiseAA(vec2(p.x, p.z), 9, fp), 0.05) : float(1);
  const membrane = base.mul(patch).mul(gravel).mul(float(1).sub(seamX.max(seamZ).mul(0.09)));

  // Shingles: courses at constant height (0.2 m), tabs staggered along the eave, each a little different.
  const course = p.y.div(0.2);
  const row = course.floor();
  const courseFade = bandFade(fp, 5);
  const gap = float(1).sub(float(1).sub(smoothstep(0, 0.14, course.sub(row))).mul(0.22).mul(courseFade));
  const along = p.x.add(p.z).div(0.3).add(row.mul(0.5));
  const tab = edgeLineAA(along, 0.035, 0.3, fp).mul(0.1);
  const each = float(1).add(hash21(vec2(along.floor(), row)).sub(0.5).mul(0.16).mul(bandFade(fp, 3)));
  const shingle = base.mul(gap).mul(float(1).sub(tab)).mul(each).mul(patch);

  const roofColor = mix(membrane, shingle, isGable.add(isHip));
  const equip = vec3(0.45, 0.47, 0.5).mul(around1(vnoise(vec2(p.x.mul(3), p.z.mul(3))), 0.08));
  const color = mix(roofColor, equip, isEquip);

  const roughness = mix(mix(float(look.roof.flat.roughness), float(look.roof.gable.roughness), isGable.add(isHip)), float(0.55), isEquip);
  return { color, roughness, metalness: isEquip.mul(0.5) };
}
