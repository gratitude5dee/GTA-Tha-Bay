/**
 * Ground (M02e; TSL only): asphalt (dark, value noise, roughness 0.85), sidewalk and paving (concrete with a 1.5 m slab joint grid
 * from world xz), park and grass (two-scale colour noise), sand, dirt, rock, pier planks and rail ballast. The class of a triangle is
 * its surface id (flat across the triangle); the colour is the bake's vertex colour pulled toward the class albedo, so the edge
 * between two classes stays soft, with the class's pattern on top. Wetness and its per-tier form (albedo, or albedo and roughness)
 * come from M02b2's nodes (`uWet`, `uWetRough`), never redefined here.
 */
import { clamp, float, mix, positionWorld, smoothstep, step, vec2, vec3, type L } from '../sky/tsl.ts';
import type { LookNodes } from './common.ts';
import { srgbHexToLinear, type LookFile } from './config.ts';
import { around1, bandFade, edgeLineAA, fbm2AA, fbm3AA, hash21, pickColor, pickFloat, pixelFootprint, vnoise, vnoiseAA } from './noise.ts';
import { GROUND_NAMES, ROAD_NAMES, Surf } from './surfaces.ts';

export interface GroundOut {
  color: L;
  roughness: L;
  metalness: L;
  /** 1 on the water surfaces (ground classes 9 and 10): the caller swaps in the water nodes there. */
  water: L;
  /** 1 where the water is deep (class 10), 0 on shallow cells. */
  deep: L;
}

/** The names that the surface ids 0..18 look up in `look.ground`. */
const NAMES: readonly string[] = [...GROUND_NAMES, ...ROAD_NAMES, 'Sidewalk'];

const inRange = (id: L, lo: number, hi: number): L => step(lo - 0.5, id).mul(step(id, hi + 0.5));

/**
 * `id` is the surface id, `vertexColor` the bake's colour (linear), `up` the world normal's y (1 on level ground), `detail`
 * picks the cheap noise on the lower profiles.
 */
export function groundNodes(look: LookFile, n: LookNodes, id: L, vertexColor: L, up: L, detail: 'full' | 'lite'): GroundOut {
  const table = NAMES.map((name) => look.ground[name] ?? look.ground['Paved'] ?? { albedo: '#808080', roughness: 0.9, noise: 0.1 });
  const albedo = pickColor(id, table.map((g) => srgbHexToLinear(g.albedo)));
  const rough = pickFloat(id, table.map((g) => g.roughness));
  const noiseAmt = pickFloat(id, table.map((g) => g.noise));

  const asphalt = inRange(id, 12, 17).max(inRange(id, Surf.GroundBase + 6, Surf.GroundBase + 6));
  const walk = inRange(id, 3, 3).max(inRange(id, 7, 7)).max(inRange(id, Surf.Sidewalk, Surf.Sidewalk));
  const grass = inRange(id, 0, 1);
  const sand = inRange(id, 2, 2);
  const dirt = inRange(id, 4, 4);
  const rock = inRange(id, 5, 5);
  const pier = inRange(id, 8, 8);
  const rail = inRange(id, 11, 11);
  const water = inRange(id, 9, 10).max(inRange(id, Surf.Sea, Surf.Sea));
  const deep = inRange(id, 10, 10).max(inRange(id, Surf.Sea, Surf.Sea));

  const p = vec2(positionWorld.x, positionWorld.z);
  const fp = pixelFootprint(positionWorld).max(0.002);
  const base = mix(vertexColor, albedo, 0.55);
  // M02g2: every noise term fades to its mean once a pixel covers more than a cycle of it (the larger octaves stay), so the ground does
  // not sparkle or crawl at a grazing angle or in the distance: `big(freq)` is the large-scale fbm at `freq` cycles per metre.
  const big = (freq: number): L => (detail === 'full' ? fbm3AA(p, freq, fp) : fbm2AA(p, freq, fp));

  // Asphalt: patches of different wear, then the aggregate.
  const aspPatch = around1(big(0.07), 0.16);
  const aspGrain = around1(vnoiseAA(p, 7.3, fp), 0.07).mul(around1(vnoiseAA(p, 23.1, fp), 0.04));
  const aspF = aspPatch.mul(aspGrain);

  // Paving: slab joints every 1.5 m, each slab a little different.
  const slab = p.div(1.5);
  const joint = edgeLineAA(slab.x, 0.012, 1.5, fp).max(edgeLineAA(slab.y, 0.012, 1.5, fp));
  const walkF = float(1).add(hash21(slab.floor()).sub(0.5).mul(0.12).mul(bandFade(fp, 0.7))).mul(float(1).sub(joint.mul(0.2))).mul(around1(vnoiseAA(p, 5.7, fp), 0.05));

  // Grass: a slow drift, mid-scale clumps and blades; dry patches lean yellow.
  const drift = big(0.22);
  const clump = vnoiseAA(p, 3.1, fp);
  const blade = vnoiseAA(p, 18, fp);
  const grassF = float(1).add(drift.sub(0.5).mul(noiseAmt.mul(2))).mul(around1(clump, 0.09)).mul(around1(blade, 0.06));
  // The dry patches (0.09 cycles per metre) fade to their mean share (about 15 %) where a pixel covers a patch.
  const dry = mix(float(0.15), smoothstep(0.62, 0.85, vnoise(p.mul(0.09).add(vec2(13.1, 5.3)))), bandFade(fp, 0.09));
  const grassTint = mix(vec3(1, 1, 1), vec3(1.14, 1.04, 0.72), dry.mul(0.7));

  const sandF = around1(vnoiseAA(p, 5.2, fp), 0.07).mul(around1(vnoiseAA(p, 31, fp), 0.05));
  const dirtF = around1(big(0.5), 0.2).mul(around1(vnoiseAA(p, 13, fp), 0.1));
  // The cracks (a thin line where the noise crosses 0.5, 1.7 cycles per metre) fade to their average darkening (2.5 %).
  const crackRaw = float(1).sub(float(1).sub(smoothstep(0, 0.04, vnoise(p.mul(1.7)).sub(0.5).abs())).mul(0.25));
  const crack = mix(float(0.975), crackRaw, bandFade(fp, 1.7));
  const rockF = around1(big(0.45), 0.3).mul(crack);
  const plank = p.y.div(0.19);
  const plankF = float(1).add(hash21(vec2(plank.floor(), p.x.div(3.2).add(hash21(vec2(plank.floor(), 3.7)).mul(5)).floor())).sub(0.5).mul(0.24).mul(bandFade(fp, 5))).mul(float(1).sub(edgeLineAA(plank, 0.04, 0.19, fp).mul(0.35)));
  const railF = around1(vnoiseAA(p, 14, fp), 0.26).mul(around1(vnoiseAA(p, 4.3, fp), 0.1));

  const nothing = float(1).sub(asphalt).sub(walk).sub(grass).sub(sand).sub(dirt).sub(rock).sub(pier).sub(rail);
  const detailF = float(1)
    .mul(nothing)
    .add(aspF.mul(asphalt))
    .add(walkF.mul(walk))
    .add(grassF.mul(grass))
    .add(sandF.mul(sand))
    .add(dirtF.mul(dirt))
    .add(rockF.mul(rock))
    .add(plankF.mul(pier))
    .add(railF.mul(rail));
  const tinted = mix(base, base.mul(grassTint), grass);
  let color: L = tinted.mul(detailF.max(0.2));

  // Wet pavement: darker everywhere the tier has wetness, glossy in puddles where it also lowers roughness.
  const pavement = asphalt.max(walk).max(pier);
  const puddle = smoothstep(0.52, 0.72, fbm2AA(p.add(vec2(31.7 / 0.05, 17.3 / 0.05)), 0.05, fp));
  const wet = clamp(n.sky.uWet.mul(pavement).mul(float(0.45).add(puddle.mul(0.55))), 0, 1).mul(clamp(up.mul(4), 0, 1));
  color = color.mul(float(1).sub(wet.mul(0.42)));
  const roughness = mix(rough, float(0.07), wet.mul(n.sky.uWetRough).mul(0.92));
  return { color, roughness, metalness: float(0), water, deep };
}
