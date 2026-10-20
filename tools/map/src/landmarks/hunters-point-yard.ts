/**
 * lm.hunters-point-yard: a shipyard on a point: a flooded dry dock holding a hull, a quay with four portal gantry cranes on rails,
 * a long shed with a barrel roof, stacks of containers and a few light masts. Original geometry from parameters; no hull
 * markings, no names, no lettering. The dock opens to the east.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { gantryCrane } from './kit/gantry.ts';
import { flatRect, lampPost } from './kit/landscape.ts';
import { vault } from './kit/glasshouse.ts';
import { box, pole, prism, type Geo } from './kit/primitives.ts';
import type { ColorName } from './kit/palette.ts';

export interface YardParams extends BaseParams {
  dockL: number;
  dockW: number;
  quayW: number;
  cranes: number;
  craneGauge: number;
  craneH: number;
  boom: number;
  shedL: number;
  shedW: number;
  shedH: number;
  shedRise: number;
  hullL: number;
  hullW: number;
  hullH: number;
  stacks: number;
}

const G = -2;
const BOX: readonly ColorName[] = ['bridgeRed', 'paintBlue', 'paintSage', 'paintYellow', 'steelGrey', 'terracotta'];

export const huntersPointYard: RecipeDef<YardParams> = {
  id: 'lm.hunters-point-yard',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    dockL: 150, dockW: 34, quayW: 22, cranes: 4, craneGauge: 12, craneH: 34, boom: 38, shedL: 120, shedW: 40, shedH: 12, shedRise: 8, hullL: 120, hullW: 24, hullH: 11, stacks: 14,
  },
  build(g: Geo, p: YardParams) {
    // the apron and the dry dock: a quay either side of a strip of water
    const total = p.dockW + 2 * p.quayW;
    box(g, 0, G, 0, p.dockL, 0.6 - G, total, { color: 'concrete' });
    flatRect(g, 0, 0.7, 0, p.dockL - 4, p.dockW, 'water', { cls: 'glass' });
    // the hull in the dock: a tapered prism with a bow, a deckhouse and a funnel
    const hx = -4;
    box(g, hx, 0.5, 0, p.hullL, p.hullH, p.hullW, { color: 'darkSteel', cls: 'metal' });
    prism(g, [[hx + p.hullL / 2, -p.hullW / 2], [hx + p.hullL / 2, p.hullW / 2], [hx + p.hullL / 2 + p.hullW * 1.1, 0]], 0.5, 0.5 + p.hullH, { color: 'darkSteel', cls: 'metal' });
    box(g, hx - p.hullL * 0.3, 0.5 + p.hullH, 0, p.hullL * 0.16, 9, p.hullW * 0.6, { color: 'white', cls: 'metal' });
    box(g, hx - p.hullL * 0.3, 0.5 + p.hullH + 9, 0, p.hullL * 0.12, 3.2, p.hullW * 0.5, { color: 'glassDark', cls: 'glass' });
    pole(g, hx - p.hullL * 0.36, 0.5 + p.hullH + 9, 0, 1.8, 1.3, 7, { color: 'bridgeRed', cls: 'metal', sides: 6 });
    // cranes on both quays, booms over the dock
    const nc = g.rules.count(p.cranes, 2);
    for (let i = 0; i < nc; i++) {
      const x = -p.dockL / 2 + 22 + ((p.dockL - 44) * i) / Math.max(1, nc - 1);
      const side = i % 2 === 0 ? -1 : 1;
      gantryCrane(g, x, 0.6, side * (p.dockW / 2 + p.quayW / 2), { gauge: p.craneGauge, legH: p.craneH, boom: p.boom, boomRise: 5, back: 14, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, color: 'bridgeRed', accent: 'white' });
    }
    // the long shed behind the quay
    const sz = p.dockW / 2 + p.quayW + p.shedW / 2 + 6;
    box(g, 0, G, sz, p.shedL, p.shedH - G, p.shedW, { color: 'steelGrey', top: false });
    vault(g, 0, p.shedH, sz, p.shedW, p.shedL, p.shedRise, { color: 'roofGrey', cls: 'metal', yaw: Math.PI / 2, caps: false });
    // stacked containers on the far side
    const ns = g.rules.count(p.stacks, 4);
    for (let i = 0; i < ns; i++) {
      const x = -p.dockL / 2 + 8 + ((p.dockL - 16) * i) / Math.max(1, ns - 1);
      const h = 2.6 * (1 + (i % 3));
      box(g, x, 0.6, -(p.dockW / 2 + p.quayW - 5), 12, h, 2.6, { color: BOX[i % BOX.length] as ColorName, cls: 'metal' });
    }
    if (g.rules.detail >= 1) for (let i = 0; i < g.rules.count(6, 2); i++) lampPost(g, -p.dockL / 2 + 10 + i * 26, 0.6, sz - p.shedW / 2 - 3, 9);
  },
};
