/**
 * lm.mount-davidson-cross: the summit of the city's highest hill: a plain geometric concrete cross on a stepped plinth with a
 * paved viewing ring, a low retaining wall, a stair down the slope and a stand of eucalyptus-like trees. The cross is two
 * plain bars: no inscription, no relief, no sculpture. The hill itself is terrain; the mound only shows where it is flatter.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { annulus, fence, flatDisc, tree } from './kit/landscape.ts';
import { box, hillMound, prism, circleRing, stairs, type Geo } from './kit/primitives.ts';

export interface CrossParams extends BaseParams {
  crossH: number;
  armSpan: number;
  barW: number;
  barD: number;
  plinthW: number;
  plinthH: number;
  ringR: number;
  moundR: number;
  moundH: number;
  trees: number;
  treeH: number;
}

const G = -2;

export const mountDavidsonCross: RecipeDef<CrossParams> = {
  id: 'lm.mount-davidson-cross',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    crossH: 31, armSpan: 15, barW: 3.4, barD: 3.4, plinthW: 12, plinthH: 3.2, ringR: 20, moundR: 70, moundH: 6, trees: 14, treeH: 22,
  },
  build(g: Geo, p: CrossParams) {
    hillMound(g, 0, 0, 0, p.moundR, p.moundR * 0.9, p.moundH, 20, 4, 4, { color: 'dryGrass' });
    // the viewing ring and the stepped plinth
    prism(g, circleRing(0, 0, p.ringR, p.ringR, g.rules.segs(20)), G, 0.7, { color: 'granite' });
    annulus(g, 0, 0, p.ringR - 1.2, p.ringR - 1.2, 0.7, p.ringR - 2.4, p.ringR - 2.4, 0.9, 20, 'concrete');
    box(g, 0, 0.7, 0, p.plinthW + 4, 1.0, p.plinthW + 4, { color: 'concrete' });
    box(g, 0, 1.7, 0, p.plinthW, p.plinthH, p.plinthW, { color: 'whiteConcrete' });
    // the cross: an upright and a crossbar, plain boxes
    const y0 = 1.7 + p.plinthH;
    box(g, 0, y0, 0, p.barW, p.crossH, p.barD, { color: 'whiteConcrete' });
    box(g, 0, y0 + p.crossH * 0.62, 0, p.armSpan, p.barW, p.barD, { color: 'whiteConcrete' });
    // a stair down the slope to the south, with a low retaining wall each side
    stairs(g, 0, 0.7, p.ringR + 16, 5, 16, 1.0, 0.04, { color: 'concrete' });
    if (g.rules.detail >= 1) for (const s of [-1, 1]) box(g, s * 3.4, 0, p.ringR + 8, 0.9, 1.4, 16, { color: 'granite' });
    // a ring of railing along the edge of the paving
    if (g.rules.detail >= 1) {
      const n = g.rules.count(10, 5);
      for (let i = 0; i < n; i++) {
        const a0 = Math.PI * 0.2 + (Math.PI * 1.6 * i) / n, a1 = Math.PI * 0.2 + (Math.PI * 1.6 * (i + 0.7)) / n;
        fence(g, Math.cos(a0) * (p.ringR - 0.5), 0.7, Math.sin(a0) * (p.ringR - 0.5), Math.cos(a1) * (p.ringR - 0.5), Math.sin(a1) * (p.ringR - 0.5), 1.1, 2.4);
      }
    }
    // tall trees around the summit
    const nt = g.rules.count(p.trees, 4);
    for (let i = 0; i < nt; i++) {
      const a = (i / nt) * Math.PI * 2 + 0.4;
      const r = p.ringR + 14 + (i % 3) * 7;
      tree(g, Math.cos(a) * r, 0, Math.sin(a) * r, p.treeH - (i % 4) * 2.2, 4.4, { crown: 'hedge', cone: i % 2 === 0 });
    }
    flatDisc(g, 0, 0.8, p.ringR + 6, 5, 3, 8, 'sand');
  },
};
