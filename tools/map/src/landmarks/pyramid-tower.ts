/**
 * lm.pyramid-tower: a fictional office tower, a tall square pyramid with two shafts on its flanks and a spire. Original geometry
 * from parameters; it stands for no company and carries no mark.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { box, pole, taperTower, type Geo } from './kit/primitives.ts';

export interface PyramidParams extends BaseParams {
  baseW: number;
  bodyH: number;
  topW: number;
  spireH: number;
  bands: number;
  bandH: number;
  wingW: number;
  wingD: number;
  wingH: number;
  podiumH: number;
  plazaW: number;
}

const G = -2;

export const pyramidTower: RecipeDef<PyramidParams> = {
  id: 'lm.pyramid-tower',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    baseW: 54, bodyH: 212, topW: 5, spireH: 48, bands: 36, bandH: 2.4, wingW: 9, wingD: 14, wingH: 150, podiumH: 4, plazaW: 90,
  },
  build(g: Geo, p: PyramidParams) {
    box(g, 0, G, 0, p.plazaW, p.podiumH - G, p.plazaW, { color: 'concrete' });
    const y0 = p.podiumH;
    // the body: a tapered square, light concrete
    taperTower(g, 0, y0, 0, p.baseW, p.baseW, p.topW, p.topW, p.bodyH, { color: 'whiteConcrete', slices: 1 });
    // window bands up the body
    const n = g.rules.count(p.bands, 8);
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.35) / n;
      const w = p.baseW + (p.topW - p.baseW) * t0 + 0.7;
      taperTower(g, 0, y0 + p.bodyH * t0, 0, w, w, w - 0.55 * (p.baseW - p.topW) / n, w - 0.55 * (p.baseW - p.topW) / n, (p.bodyH / n) * 0.45, { color: 'glassTeal', cls: 'glass', capTint: 1 });
    }
    // the two shafts on the east and west flanks, rising to a slanted top
    for (const s of [-1, 1]) {
      const wx = s * (p.baseW * 0.5 * (1 - (p.wingH / p.bodyH) * 0.5) + p.wingW * 0.4);
      taperTower(g, wx, y0, 0, p.wingW, p.wingD, p.wingW * 0.8, p.wingD * 0.8, p.wingH, { color: 'whiteConcrete', slices: 1 });
      if (g.rules.detail >= 1) taperTower(g, wx, y0 + p.wingH * 0.3, 0, p.wingW * 0.9 + 0.5, p.wingD * 0.9 + 0.5, p.wingW * 0.86 + 0.3, p.wingD * 0.86 + 0.3, p.wingH * 0.55, { color: 'glassTeal', cls: 'glass', capTint: 1 });
    }
    // crown and spire
    pole(g, 0, y0 + p.bodyH, 0, p.topW * 0.32, 0.25, p.spireH, { color: 'steelGrey', cls: 'metal', sides: 4 });
    box(g, 0, y0 + p.bodyH - 0.2, 0, p.topW + 1.4, 1.4, p.topW + 1.4, { color: 'steelGrey', cls: 'metal' });
  },
};
