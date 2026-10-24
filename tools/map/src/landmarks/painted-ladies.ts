/**
 * lm.painted-ladies: a row of tall, narrow wooden houses with bay windows and gabled roofs, each in its own pastel, facing a park
 * across a street. The facades face east (+X), the row runs north-south. Original geometry from parameters; no signs, no numbers.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof, windowBands } from './kit/facade.ts';
import { flatDisc, flatRect, lampPost, tree } from './kit/landscape.ts';
import { box, stairs, type Geo } from './kit/primitives.ts';
import type { ColorName } from './kit/palette.ts';

export interface LadiesParams extends BaseParams {
  houses: number;
  houseW: number;
  houseD: number;
  wallH: number;
  roofRise: number;
  bayW: number;
  bayProj: number;
  streetW: number;
  parkR: number;
  trees: number;
}

const G = -2;
const PAINT: readonly ColorName[] = ['paintBlue', 'paintCream', 'paintSage', 'paintRose', 'paintYellow', 'paintTeal', 'paintLilac'];

export const paintedLadies: RecipeDef<LadiesParams> = {
  id: 'lm.painted-ladies',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    houses: 7, houseW: 6.6, houseD: 15, wallH: 9.2, roofRise: 5.2, bayW: 3.4, bayProj: 1.4, streetW: 10, parkR: 52, trees: 9,
  },
  build(g: Geo, p: LadiesParams) {
    const pitch = p.houseW + 0.7;
    const n = g.rules.count(p.houses, 3);
    const span = pitch * (p.houses - 1);
    for (let i = 0; i < n; i++) {
      const z = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
      const col = PAINT[i % PAINT.length] as ColorName;
      const x = 0;
      // the body, then the gabled roof with its ridge running east-west (the gable faces the street)
      box(g, x, G, z, p.houseD, p.wallH - G, p.houseW, { color: col, top: false });
      roof(g, x, p.wallH, z, p.houseD + 0.5, p.houseW + 0.5, p.roofRise, { color: i % 2 === 0 ? 'slate' : 'roofGrey', ridgeAlongX: true, overhang: 0.2 });
      // the street-side gable: a cream triangle under the roof edge
      box(g, x + p.houseD / 2 - 0.1, p.wallH - 0.4, z, 0.4, 0.8, p.houseW + 0.4, { color: 'trimWhite' });
      // the two-storey bay, with its own small roof
      const bx = p.houseD / 2 + p.bayProj / 2 - 0.1;
      box(g, bx, 0.6, z, p.bayProj, p.wallH * 0.62, p.bayW, { color: col });
      roof(g, bx, p.wallH * 0.62 + 0.6, z, p.bayProj + 0.5, p.bayW + 0.5, 1.5, { color: 'trimWhite', ridgeAlongX: false });
      if (g.rules.detail >= 1) {
        windowBands(g, x, 1.2, z, p.houseD + 0.2, p.houseW, 2, 4.0, { color: 'glassDark', sides: ['x+'], frac: 0.78, height: 0.5, proud: 0.3 });
        windowBands(g, x, 2.0, z, p.houseD, p.houseW, 1, 4.0, { color: 'glassDark', sides: ['z+', 'z-'], frac: 0.5, height: 0.5, proud: 0.2 });
      }
      // the stoop
      if (g.rules.detail >= 1) stairs(g, p.houseD / 2 + 1.8, 0, z + p.houseW * 0.28, 1.4, 4, 0.6, 0.22, { color: 'concrete', yaw: -Math.PI / 2 });
    }
    // the street and the park across it
    const sx = p.houseD / 2 + p.bayProj + 3 + p.streetW / 2;
    flatRect(g, sx, 0.05, 0, p.streetW, span + 30, 'asphalt');
    flatDisc(g, sx + p.streetW / 2 + p.parkR * 0.55, 0.08, 0, p.parkR * 0.85, p.parkR, 24, 'lawn');
    if (g.rules.detail >= 1) {
      const nt = g.rules.count(p.trees, 3);
      for (let i = 0; i < nt; i++) {
        const a = (i / nt) * Math.PI * 1.6 - Math.PI * 0.8;
        tree(g, sx + p.streetW / 2 + 8 + Math.cos(a) * p.parkR * 0.55, 0, Math.sin(a) * p.parkR * 0.8, 12 + (i % 3) * 2.5, 4.2, { crown: i % 2 === 0 ? 'hedge' : 'hillGreen' });
      }
      lampPost(g, sx - p.streetW / 2 - 0.8, 0, -span * 0.3, 5.5);
      lampPost(g, sx - p.streetW / 2 - 0.8, 0, span * 0.3, 5.5);
    }
  },
};
