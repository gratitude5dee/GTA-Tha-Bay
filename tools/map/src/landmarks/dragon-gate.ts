/**
 * lm.dragon-gate: a three-opening ceremonial street gateway: stone-footed red pillars, a stack of lintels and three tiers of
 * green tiled roofs with lifted corners, spanning a short stretch of paving. Generic architecture: no figures, no carving and no
 * inscriptions. The street runs east-west through the central opening (the gate faces +Z / -Z).
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { tiledRoof } from './kit/eaves.ts';
import { flatRect, lampPost } from './kit/landscape.ts';
import { box, frustum, type Geo } from './kit/primitives.ts';

export interface GateParams extends BaseParams {
  span: number;
  sideSpan: number;
  pillarH: number;
  pillarR: number;
  sideH: number;
  roofW: number;
  roofRise: number;
  curl: number;
  paving: number;
  footW: number;
}

const G = -2;

export const dragonGate: RecipeDef<GateParams> = {
  id: 'lm.dragon-gate',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    span: 10, sideSpan: 5.6, pillarH: 9.5, pillarR: 0.55, sideH: 6.8, roofW: 12.4, roofRise: 2.6, curl: 0.9, paving: 30, footW: 2.0,
  },
  build(g: Geo, p: GateParams) {
    const hs = p.span / 2;
    const xs = [-hs - p.sideSpan, -hs, hs, hs + p.sideSpan];
    const heights = [p.sideH, p.pillarH, p.pillarH, p.sideH];
    // paving across the street
    flatRect(g, 0, 0.04, 0, p.paving + p.span, p.paving * 0.5, 'granite');
    // pillars: a stone foot and a red round column each
    xs.forEach((x, i) => {
      box(g, x, G, 0, p.footW, 1.4 - G, p.footW, { color: 'granite' });
      frustum(g, x, 1.4, 0, p.pillarR, p.pillarR * 0.92, (heights[i] as number) - 1.4, 8, { color: 'redLacquer', smooth: true });
    });
    // lintels: a main beam across the middle pair and a lower beam across all four, with a plain panel between
    box(g, 0, p.pillarH - 1.2, 0, p.span + p.footW, 1.0, 1.1, { color: 'redLacquer' });
    box(g, 0, p.pillarH - 3.4, 0, p.span + p.footW, 0.7, 0.9, { color: 'redLacquer' });
    if (g.rules.detail >= 1) box(g, 0, p.pillarH - 2.7, 0, p.span - 1.2, 1.3, 0.5, { color: 'tileGreen' });
    for (const s of [-1, 1]) {
      const x = s * (hs + p.sideSpan / 2);
      box(g, x, p.sideH - 1.0, 0, p.sideSpan + 0.9, 0.9, 1.0, { color: 'redLacquer' });
      tiledRoof(g, x, p.sideH, 0, p.sideSpan + 2.4, 3.6, 1.6, { color: 'tileGreen', curl: 0.45, ridge: p.sideSpan - 0.6 });
    }
    // the three roofs of the main opening: a tall central one and two lower ones beside it
    tiledRoof(g, 0, p.pillarH, 0, p.roofW, 4.2, p.roofRise, { color: 'tileGreen', curl: p.curl, ridge: p.roofW - 4.6 });
    if (g.rules.detail >= 1) {
      for (const s of [-1, 1]) tiledRoof(g, s * (hs - 0.1), p.pillarH - 1.6, 0, 4.6, 3.4, 1.4, { color: 'tileGreen', curl: p.curl * 0.6, ridge: 0.6 });
      box(g, 0, p.pillarH + p.roofRise - 0.2, 0, p.roofW - 4.2, 0.5, 0.8, { color: 'gold', cls: 'metal' });
    }
    lampPost(g, -hs - p.sideSpan - 3.5, 0, 3, 4.8);
    lampPost(g, hs + p.sideSpan + 3.5, 0, 3, 4.8);
  },
};
