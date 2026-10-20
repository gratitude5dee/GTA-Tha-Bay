/**
 * lm.peace-pagoda: a five-tier concrete pagoda on a stepped square plaza with a reflecting pool, a low surrounding wall and a ring
 * of blossom trees. Generic architecture: no inscriptions, no lanterns, no carving, no sculpture. The tiers narrow upward and end
 * in a plain finial pole.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { tiers } from './kit/eaves.ts';
import { flatDisc, flatRect, lampPost, tree } from './kit/landscape.ts';
import { box, frustum, pole, stairs, type Geo } from './kit/primitives.ts';

export interface PagodaParams extends BaseParams {
  plazaW: number;
  baseW: number;
  baseH: number;
  tierW: number;
  tierCount: number;
  tierH: number;
  roofRise: number;
  curl: number;
  overhang: number;
  shrink: number;
  poolW: number;
  trees: number;
}

const G = -2;

export const peacePagoda: RecipeDef<PagodaParams> = {
  id: 'lm.peace-pagoda',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    plazaW: 56, baseW: 17, baseH: 3.4, tierW: 11.5, tierCount: 5, tierH: 4.6, roofRise: 2.1, curl: 0.55, overhang: 1.5, shrink: 0.82, poolW: 14, trees: 10,
  },
  build(g: Geo, p: PagodaParams) {
    // the plaza, the pool in front and the stepped plinth
    flatRect(g, 0, 0.05, 0, p.plazaW, p.plazaW, 'granite');
    flatRect(g, 0, 0.1, p.baseW / 2 + 12, p.poolW, 11, 'water', { cls: 'glass' });
    box(g, 0, G, 0, p.baseW + 6, 1.0 - G, p.baseW + 6, { color: 'concrete' });
    box(g, 0, 1.0, 0, p.baseW + 2, 0.8, p.baseW + 2, { color: 'whiteConcrete' });
    box(g, 0, 1.8, 0, p.baseW - 2, p.baseH - 1.8, p.baseW - 2, { color: 'concrete' });
    for (const [x, z, yaw] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]] as const) {
      stairs(g, x * (p.baseW / 2 + 5), 0, z * (p.baseW / 2 + 5), 5, 5, 0.9, 0.2, { color: 'granite', yaw });
    }
    // the five tiers: plain square rooms with lifted-corner roofs, each narrower than the last
    const y0 = p.baseH;
    const top = tiers(g, 0, y0, 0, { wall: 'whiteConcrete', roof: 'slate', w: p.tierW, shrink: p.shrink, tiers: Math.max(2, g.rules.count(p.tierCount, 3)), tierH: p.tierH, roofRise: p.roofRise, curl: p.curl, overhang: p.overhang });
    frustum(g, 0, top, 0, 0.9, 0.5, 2.4, 8, { color: 'gold', cls: 'metal', smooth: true });
    pole(g, 0, top + 2.4, 0, 0.18, 0.06, 7, { color: 'gold', cls: 'metal', sides: 4 });
    // a low wall around the plaza and the trees outside it
    if (g.rules.detail >= 1) {
      for (const s of [-1, 1]) {
        box(g, 0, 0, s * (p.plazaW / 2 - 0.4), p.plazaW, 1.0, 0.8, { color: 'whiteConcrete' });
        box(g, s * (p.plazaW / 2 - 0.4), 0, 0, 0.8, 1.0, p.plazaW - 1.6, { color: 'whiteConcrete' });
      }
    }
    for (let i = 0; i < g.rules.count(p.trees, 4); i++) {
      const a = (i / p.trees) * Math.PI * 2 + 0.3;
      const k = p.plazaW * 0.5 + 6;
      tree(g, Math.max(-k, Math.min(k, Math.cos(a) * k * 1.3)), 0, Math.max(-k, Math.min(k, Math.sin(a) * k * 1.3)), 8.5, 3.6, { crown: 'blossom' });
    }
    flatDisc(g, 0, 0.12, -p.baseW / 2 - 12, 4, 4, 10, 'sand');
    if (g.rules.detail >= 1) {
      lampPost(g, p.plazaW / 2 - 4, 0.05, p.plazaW / 2 - 4, 4.6);
      lampPost(g, -p.plazaW / 2 + 4, 0.05, p.plazaW / 2 - 4, 4.6);
    }
  },
};
