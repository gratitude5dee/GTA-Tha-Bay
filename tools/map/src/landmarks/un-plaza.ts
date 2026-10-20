/**
 * lm.un-plaza: a long civic plaza over a transit station: paved paving with rows of street trees, two shallow fountain basins, a
 * pergola colonnade down one side, a glass-vaulted station headhouse with stairs going down and a rank of flag poles. Original
 * geometry from parameters; no signs, no lettering, no sculpture, no flags with emblems. The long axis runs north-south.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { glassHall } from './kit/glasshouse.ts';
import { flatDisc, flatRect, lampPost, tree } from './kit/landscape.ts';
import { box, frustum, pole, prism, rectRing, stairs, type Geo } from './kit/primitives.ts';

export interface PlazaParams extends BaseParams {
  length: number;
  width: number;
  rows: number;
  treesPerRow: number;
  basinR: number;
  pergolaL: number;
  columns: number;
  hallL: number;
  hallW: number;
  flags: number;
  flagH: number;
}

const G = -2;

export const unPlaza: RecipeDef<PlazaParams> = {
  id: 'lm.un-plaza',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    length: 150, width: 46, rows: 2, treesPerRow: 10, basinR: 8, pergolaL: 90, columns: 14, hallL: 22, hallW: 10, flags: 8, flagH: 14,
  },
  build(g: Geo, p: PlazaParams) {
    const hl = p.length / 2, hw = p.width / 2;
    flatRect(g, 0, 0.05, 0, p.width, p.length, 'granite');
    prism(g, rectRing(0, 0, p.width - 2, p.length - 2, 0), G, 0.08, { color: 'limestone', top: false });
    // two fountain basins on the axis
    for (const z of [-hl * 0.3, hl * 0.3]) {
      frustum(g, 0, 0.05, z, p.basinR, p.basinR, 0.5, 18, { color: 'concrete', smooth: true });
      flatDisc(g, 0, 0.56, z, p.basinR - 0.7, p.basinR - 0.7, 18, 'water', 'glass');
      if (g.rules.detail >= 1) pole(g, 0, 0.5, z, 0.25, 0.12, 2.4, { color: 'white', cls: 'metal', sides: 4 });
    }
    // rows of trees along both long edges
    const nt = g.rules.count(p.treesPerRow, 3);
    for (let r = 0; r < p.rows; r++) for (let i = 0; i < nt; i++) {
      const z = -hl + 8 + ((p.length - 16) * i) / Math.max(1, nt - 1);
      for (const s of [-1, 1]) tree(g, s * (hw - 4 - r * 5), 0.08, z, 10, 3.6, { crown: r === 0 ? 'hedge' : 'hillGreen' });
    }
    // the pergola colonnade on the west side
    const nc = g.rules.count(p.columns, 4);
    for (let i = 0; i < nc; i++) {
      const z = -p.pergolaL / 2 + (p.pergolaL * i) / (nc - 1);
      for (const x of [-hw + 1.2, -hw + 5.2]) pole(g, x, 0.08, z, 0.28, 0.24, 4.6, { color: 'concrete', sides: 4 });
    }
    box(g, -hw + 3.2, 4.6, 0, 5.8, 0.45, p.pergolaL + 1, { color: 'whiteConcrete' });
    // the station headhouse: a glass vault with a stair down beside it
    glassHall(g, 0, 0.08, hl - 22, p.hallW, p.hallL, 3.6, { wallH: 2.4, ribs: 6, yaw: Math.PI / 2 });
    stairs(g, hw - 8, 0.08, -hl * 0.65, 5, 8, 0.7, 0.1, { color: 'concrete' });
    // flag poles along the east edge, plain pennants in plain colours
    const nf = g.rules.count(p.flags, 3);
    for (let i = 0; i < nf; i++) {
      const z = -hl + 10 + ((p.length - 20) * i) / Math.max(1, nf - 1);
      pole(g, hw - 1.5, 0.08, z, 0.16, 0.1, p.flagH, { color: 'white', cls: 'metal', sides: 4 });
      box(g, hw - 1.5 - 1.4, 0.08 + p.flagH - 1.8, z, 2.6, 1.6, 0.06, { color: i % 2 === 0 ? 'glassBlue' : 'white' });
    }
    if (g.rules.detail >= 1) for (let i = 0; i < g.rules.count(8, 3); i++) lampPost(g, hw - 4, 0.08, -hl + 10 + i * (p.length - 20) / 7, 5.2);
  },
};
