/**
 * Ground cover shading (M02h3; TSL only), called from `groundNodes` for the terrain posts with a cover surface (ids 42..48, keys 23..29 of
 * the ground table): yard is mown grass with a +-`yardLotTone` tone per 8 m lot; mixed is grass over dirt in patches; dirt is M02e's
 * dirt term; vacant is dirt with gravel and dry weeds; scrub is dry gold-green grass with shrub clumps; a driveway is stained concrete; a
 * park is lawn. The `full` profile gets every term, `lite` one octave of each, and `min` and `legacy` draw the vertex colour with the
 * class roughness (look-materials.ts and the legacy materials; this file is not reached there). Every noise term fades with the pixel
 * footprint (`bandFade`, the AA noise of noise.ts), so the cover does not sparkle in the distance.
 */
import { float, mix, smoothstep, step, vec2, vec3, type L } from '../sky/tsl.ts';
import type { LookFile } from './config.ts';
import { around1, bandFade, edgeLineAA, fbm2AA, fbm3AA, hash21, vnoise, vnoiseAA } from './noise.ts';

/** First key of the cover classes in the ground table (`ground.ts` NAMES): key = `COVER_KEY0 - 1 + CoverClass`. */
export const COVER_KEY0 = 23;
export const COVER_KEYS = ['cover.yard', 'cover.dirt', 'cover.mixed', 'cover.driveway', 'cover.vacant', 'cover.scrub', 'cover.park'] as const;

export interface CoverDesign {
  /** Yard tone per 8 m lot: the colour varies by +- this share. */
  yardLotTone: number;
  /** Share of a `mixed` cell that shows dirt. */
  mixedDirt: number;
  /** Share of a `scrub` cell under shrub clumps. */
  scrubShrubs: number;
}

/**
 * The design values (look.json `ground`): the `noise` of `cover.yard` is the lot tone, of `cover.mixed` the dirt share, of `cover.scrub`
 * the shrub share (each class's albedo and roughness are read by `groundNodes` like any ground class).
 */
export function coverDesign(look: LookFile): CoverDesign {
  const g = look.ground;
  return { yardLotTone: g['cover.yard']?.noise ?? 0.06, mixedDirt: g['cover.mixed']?.noise ?? 0.45, scrubShrubs: g['cover.scrub']?.noise ?? 0.3 };
}

export interface CoverOut {
  /** 1 on a cover pixel, else 0. */
  mask: L;
  /** The cover colour (use where `mask` is 1). */
  color: L;
  /** Bump height in metres (0 off the cover). */
  height: L;
  /** The grassy classes (yard, mixed, scrub, park): the macro tone applies. */
  grassy: L;
  /** The driveway: wet like pavement. */
  paved: L;
}

const inKey = (key: L, k: number): L => step(k - 0.5, key).mul(step(key, k + 0.5));

/**
 * `key` is the ground table key of the pixel, `base` the bake's colour pulled toward the class albedo (as for every ground class), `p` the
 * world xz, `fp` the pixel footprint.
 */
export function coverNodes(look: LookFile, key: L, base: L, p: L, fp: L, detail: 'full' | 'lite'): CoverOut {
  const d = coverDesign(look);
  const yard = inKey(key, COVER_KEY0);
  const dirt = inKey(key, COVER_KEY0 + 1);
  const mixed = inKey(key, COVER_KEY0 + 2);
  const drive = inKey(key, COVER_KEY0 + 3);
  const vacant = inKey(key, COVER_KEY0 + 4);
  const scrub = inKey(key, COVER_KEY0 + 5);
  const park = inKey(key, COVER_KEY0 + 6);
  const mask = yard.add(dirt).add(mixed).add(drive).add(vacant).add(scrub).add(park);
  const full = detail === 'full';
  const big = (freq: number): L => (full ? fbm3AA(p, freq, fp) : fbm2AA(p, freq, fp));

  // blades and clumps of a lawn; `lite` keeps the clumps only
  const clump = vnoiseAA(p, 3.1, fp);
  const blade = full ? vnoiseAA(p, 18, fp) : float(0.5);
  const lawnF = around1(clump, 0.08).mul(around1(blade, 0.06));

  // yard: mown lawn, one tone per 8 m lot (hash of the lot square), with a soft drift
  const lot = hash21(p.div(8).floor().add(vec2(17.3, 3.1))).sub(0.5).mul(2 * d.yardLotTone).mul(bandFade(fp, 0.125));
  const yardC = base.mul(float(1).add(lot)).mul(lawnF).mul(around1(big(0.18), 0.05));

  // dirt (M02e's dirt term)
  const dirtF = around1(big(0.5), 0.2).mul(around1(vnoiseAA(p, 13, fp), full ? 0.1 : 0));
  const dirtTone = vec3(1.0, 0.92, 0.8);
  const dirtC = base.mul(dirtF);

  // mixed: patches of dirt through the grass, fbm over 3 m
  const patch = smoothstep(0.5 - d.mixedDirt * 0.25, 0.5 + d.mixedDirt * 0.25, big(0.33)).mul(d.mixedDirt * 1.6).min(1);
  const mixedC = mix(base.mul(lawnF), base.mul(dirtTone).mul(dirtF).mul(0.92), patch);

  // vacant: dirt, gravel specks and dry weeds
  const gravel = full ? smoothstep(0.62, 0.8, vnoiseAA(p, 9.3, fp)).mul(0.18) : float(0.04);
  const weeds = smoothstep(0.55, 0.75, vnoiseAA(p, 0.9, fp)).mul(0.6);
  const vacantC = mix(base.mul(dirtF).mul(float(1).add(gravel)), base.mul(vec3(1.02, 1.06, 0.72)).mul(lawnF), weeds);

  // scrub: dry gold-green grass with shrub clumps (darker, greener, slightly raised)
  const shrubN = vnoiseAA(p, 0.55, fp).mul(0.7).add(vnoiseAA(p, 2.4, fp).mul(0.3));
  const shrubs = smoothstep(1 - d.scrubShrubs - 0.08, 1 - d.scrubShrubs + 0.08, shrubN);
  const scrubC = mix(base.mul(vec3(1.06, 1.0, 0.78)).mul(lawnF), base.mul(vec3(0.5, 0.66, 0.46)).mul(around1(vnoiseAA(p, 7, fp), 0.12)), shrubs);

  // driveway: stained concrete with a pour seam every 3 m and oil under the car
  const pour = p.div(3);
  const seam = edgeLineAA(pour.x, 0.006, 3, fp).max(edgeLineAA(pour.y, 0.006, 3, fp));
  const oil = smoothstep(0.6, 0.85, vnoise(p.mul(0.5).add(vec2(5.1, 29.7)))).mul(bandFade(fp, 0.5));
  const driveC = base.mul(around1(big(0.2), 0.08)).mul(around1(vnoiseAA(p, 11.3, fp), full ? 0.06 : 0)).mul(float(1).sub(oil.mul(0.3))).mul(float(1).sub(seam.mul(0.2)));

  // park: lawn with a slow drift
  const parkC = base.mul(lawnF).mul(around1(big(0.12), 0.07));

  const color = yardC.mul(yard).add(dirtC.mul(dirt)).add(mixedC.mul(mixed)).add(driveC.mul(drive)).add(vacantC.mul(vacant)).add(scrubC.mul(scrub)).add(parkC.mul(park));

  const clumpH = clump.sub(0.5).mul(0.012).add(full ? blade.sub(0.5).mul(0.006) : float(0));
  const grainH = vnoiseAA(p, 7.3, fp).sub(0.5).mul(0.004);
  const height = yard.add(park).mul(clumpH)
    .add(mixed.mul(mix(clumpH, grainH, patch)))
    .add(dirt.add(vacant).mul(grainH.add(gravel.mul(0.004))))
    .add(scrub.mul(clumpH.add(shrubs.mul(0.03))))
    .add(drive.mul(seam.mul(-0.006).add(grainH.mul(0.5))));
  return { mask, color, height, grassy: yard.add(mixed).add(scrub).add(park), paved: drive };
}
