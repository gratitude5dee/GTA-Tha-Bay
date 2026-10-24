/**
 * lm.crissy-field: a waterfront park field: a long grass meadow along the bay with a sand promenade, tidal marsh water, wind-swept
 * dune mounds, a small gabled warming hut, two low hangars, a timber jetty with a short white light tower and a flag mast. Original
 * geometry from parameters; no signs, no lettering. The bay is to the north (-Z).
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof } from './kit/facade.ts';
import { flat, flatDisc, flatRect, lampPost, tree } from './kit/landscape.ts';
import { box, circleRing, hillMound, pole, taperTower, type Geo } from './kit/primitives.ts';
import { vault } from './kit/glasshouse.ts';

export interface CrissyParams extends BaseParams {
  fieldW: number;
  fieldD: number;
  beachD: number;
  marshRx: number;
  marshRz: number;
  dunes: number;
  dune: number;
  hutW: number;
  hutD: number;
  hangars: number;
  hangarL: number;
  jetty: number;
  lightH: number;
  trees: number;
}

export const crissyField: RecipeDef<CrissyParams> = {
  id: 'lm.crissy-field',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    fieldW: 190, fieldD: 74, beachD: 20, marshRx: 36, marshRz: 14, dunes: 6, dune: 6, hutW: 12, hutD: 8, hangars: 2, hangarL: 40, jetty: 54, lightH: 11, trees: 8,
  },
  build(g: Geo, p: CrissyParams) {
    const hz = p.fieldD / 2;
    // the meadow, the promenade strip and the beach toward the bay
    flatRect(g, 0, 0.06, 0, p.fieldW, p.fieldD, 'dryGrass');
    flatRect(g, 0, 0.1, -hz * 0.35, p.fieldW - 8, 5, 'sand');
    flatRect(g, 0, 0.07, -hz - p.beachD / 2, p.fieldW, p.beachD, 'sand');
    flatDisc(g, p.fieldW * 0.18, 0.12, hz * 0.4, p.marshRx, p.marshRz, 18, 'water', 'glass');
    // dunes: low mounds scattered along the beach edge
    for (let i = 0; i < g.rules.count(p.dunes, 2); i++) {
      hillMound(g, -p.fieldW * 0.42 + i * (p.fieldW * 0.17), 0, -hz - 4 - (i % 3) * 3, p.dune * 2.2, p.dune * 1.4, p.dune * 0.5, 8, 2, 1.5, { color: 'sand' });
    }
    // the warming hut
    box(g, -p.fieldW * 0.22, 0, -hz * 0.05, p.hutW, 4.2, p.hutD, { color: 'paintCream', top: false });
    roof(g, -p.fieldW * 0.22, 4.2, -hz * 0.05, p.hutW + 0.8, p.hutD + 0.8, 2.2, { color: 'slate', ridgeAlongX: true, overhang: 0.2 });
    box(g, -p.fieldW * 0.22 + p.hutW * 0.5, 0, -hz * 0.05, 2.4, 3.2, 2.4, { color: 'paintBlue' });
    // hangars on the south side
    for (let i = 0; i < g.rules.count(p.hangars, 1); i++) {
      const x = p.fieldW * 0.1 + i * (p.hangarL + 10);
      box(g, x, 0, hz - 8, p.hangarL, 6, 18, { color: 'plaster', top: false });
      vault(g, x, 6, hz - 8, 18, p.hangarL, 5, { color: 'roofGrey', cls: 'metal', yaw: Math.PI / 2, caps: false });
    }
    // the jetty and its light tower
    box(g, p.fieldW * 0.36, 0.2, -hz - p.beachD - p.jetty / 2 + 6, 3.4, 0.7, p.jetty, { color: 'timber' });
    taperTower(g, p.fieldW * 0.36, 0.9, -hz - p.beachD - p.jetty + 8, 3.2, 3.2, 1.8, 1.8, p.lightH, { color: 'white', round: 1 });
    box(g, p.fieldW * 0.36, 0.9 + p.lightH, -hz - p.beachD - p.jetty + 8, 3.0, 1.8, 3.0, { color: 'lamp', cls: 'glass' });
    pole(g, p.fieldW * 0.36 + 2, 0.9, -hz - p.beachD - 8, 0.15, 0.1, 9, { color: 'white', cls: 'metal', sides: 4 });
    // trees at the back, lamps along the promenade
    for (let i = 0; i < g.rules.count(p.trees, 3); i++) tree(g, -p.fieldW * 0.44 + i * (p.fieldW * 0.88) / Math.max(1, p.trees - 1), 0, hz - 3, 11, 4.6, { cone: i % 2 === 0, crown: 'hedge' });
    if (g.rules.detail >= 1) for (let i = 0; i < g.rules.count(7, 3); i++) lampPost(g, -p.fieldW * 0.4 + i * (p.fieldW * 0.8) / 6, 0.1, -hz * 0.35 + 3.4, 4.2);
    flat(g, circleRing(-p.fieldW * 0.3, hz * 0.55, 6, 4, g.rules.segs(8)), 0.13, 'water', 'glass');
  },
};
