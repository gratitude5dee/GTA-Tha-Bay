/**
 * lm.flower-conservatory: a white-framed Victorian glasshouse: a tall glass dome on a drum in the middle, two long vaulted glass
 * wings, a low entry porch, flower beds and a lawn in front. Original geometry from parameters; no signs. The front faces
 * south (+Z).
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { glassHall } from './kit/glasshouse.ts';
import { flatDisc, flatRect, tree } from './kit/landscape.ts';
import { box, dome, frustum, pole, stairs, strut, type Geo, type V3 } from './kit/primitives.ts';
import type { ColorName } from './kit/palette.ts';

export interface ConservatoryParams extends BaseParams {
  domeR: number;
  drumH: number;
  domeH: number;
  wingL: number;
  wingW: number;
  wingWall: number;
  wingRise: number;
  ribs: number;
  porchW: number;
  beds: number;
  lawnW: number;
}

const G = -2;
const BEDS: readonly ColorName[] = ['flower', 'paintYellow', 'paintLilac', 'bridgeRed', 'paintRose'];

export const flowerConservatory: RecipeDef<ConservatoryParams> = {
  id: 'lm.flower-conservatory',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    domeR: 8.5, drumH: 6, domeH: 11, wingL: 24, wingW: 12, wingWall: 3.6, wingRise: 4.6, ribs: 14, porchW: 9, beds: 5, lawnW: 70,
  },
  build(g: Geo, p: ConservatoryParams) {
    // the plinth
    box(g, 0, G, 0, p.domeR * 2 + p.wingL * 2 + 6, 0.7 - G, p.wingW + 8, { color: 'concrete' });
    // the central drum and the glass dome on it
    frustum(g, 0, 0.7, 0, p.domeR, p.domeR, p.drumH, 16, { color: 'glassLight', cls: 'glass', smooth: false, capStart: true });
    dome(g, 0, 0.7 + p.drumH, 0, p.domeR, p.domeR, p.domeH, 16, 6, { color: 'glassLight', cls: 'glass' });
    pole(g, 0, 0.7 + p.drumH + p.domeH, 0, 0.35, 0.1, 3.2, { color: 'white', cls: 'metal', sides: 4 });
    // the white frame: ribs up the dome and bands around the drum
    if (g.rules.detail >= 1) {
      const nr = g.rules.count(p.ribs, 6);
      for (let i = 0; i < nr; i++) {
        const a = (i / nr) * Math.PI * 2;
        const pts: V3[] = [0, 1, 2, 3, 4].map((k) => {
          const t = k / 4, ang = t * (Math.PI / 2);
          return [Math.cos(a) * Math.cos(ang) * (p.domeR + 0.15), 0.7 + p.drumH + Math.sin(ang) * (p.domeH + 0.15), Math.sin(a) * Math.cos(ang) * (p.domeR + 0.15)] as V3;
        });
        for (let k = 0; k < 4; k++) strut(g, pts[k] as V3, pts[k + 1] as V3, 0.16, { color: 'white', cls: 'metal', sides: 3 });
        strut(g, [pts[0]![0], 0.7, pts[0]![2]], pts[0] as V3, 0.16, { color: 'white', cls: 'metal', sides: 3 });
      }
    }
    // two vaulted wings, one each side of the dome
    for (const s of [-1, 1]) glassHall(g, s * (p.domeR + p.wingL / 2 - 1), 0.7, 0, p.wingW, p.wingL, p.wingRise, { wallH: p.wingWall, ribs: 7, yaw: Math.PI / 2 });
    // the porch on the south face, with steps
    box(g, 0, 0.7, p.domeR + 2, p.porchW, 4.4, 4.6, { color: 'white', top: true });
    glassHall(g, 0, 0.7 + 4.4, p.domeR + 2, p.porchW - 1, 4, 2.4, { wallH: 0, ribs: 3 });
    stairs(g, 0, 0, p.domeR + 9.5, p.porchW + 1, 4, 0.7, 0.175, { color: 'granite' });
    // lawn and flower beds in front
    flatRect(g, 0, 0.06, p.domeR + 30, p.lawnW, 50, 'lawn');
    const nb = g.rules.count(p.beds, 2);
    for (let i = 0; i < nb; i++) {
      const x = -p.lawnW * 0.3 + ((p.lawnW * 0.6) * i) / Math.max(1, nb - 1);
      flatDisc(g, x, 0.14, p.domeR + 24 + (i % 2) * 8, 5.2, 4, 10, BEDS[i % BEDS.length] as ColorName);
    }
    if (g.rules.detail >= 1) for (const s of [-1, 1]) tree(g, s * (p.lawnW * 0.42), 0, p.domeR + 22, 14, 5);
  },
};
