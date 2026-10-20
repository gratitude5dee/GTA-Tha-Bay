/**
 * lm.transit-center-park: a fictional long transit hub under a rooftop park: a low block wrapped in a pale perforated screen,
 * a green roof with paths, trees, a fountain disc and a lawn terrace, a glass skylight hall and a glass cone atrium at one end.
 * Original geometry from parameters; no name, no lettering. The long axis runs east-west.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { glassHall } from './kit/glasshouse.ts';
import { annulus, flatDisc, flatRect, lampPost, tree } from './kit/landscape.ts';
import { box, frustum, strut, taperTower, type Geo } from './kit/primitives.ts';

export interface TransitParams extends BaseParams {
  length: number;
  width: number;
  blockH: number;
  screenFins: number;
  parkH: number;
  trees: number;
  hallL: number;
  hallW: number;
  coneR: number;
  coneH: number;
  terrace: number;
}

const G = -2;

export const transitCenterPark: RecipeDef<TransitParams> = {
  id: 'lm.transit-center-park',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    length: 210, width: 44, blockH: 17, screenFins: 52, parkH: 1.6, trees: 16, hallL: 36, hallW: 14, coneR: 12, coneH: 34, terrace: 20,
  },
  build(g: Geo, p: TransitParams) {
    const hl = p.length / 2;
    // the block and its screen: tall pale fins standing off the walls
    box(g, 0, G, 0, p.length, p.blockH - G, p.width, { color: 'whiteConcrete', top: false });
    const nf = g.rules.count(p.screenFins, 8);
    for (let i = 0; i < nf; i++) {
      const x = -hl + 1 + ((p.length - 2) * i) / (nf - 1);
      for (const s of [-1, 1]) box(g, x, 1, s * (p.width / 2 + 0.9), 0.7, p.blockH + 3.6, 0.7, { color: 'white', cls: 'metal' });
    }
    if (g.rules.detail >= 1) for (const s of [-1, 1]) box(g, 0, p.blockH + 4.2, s * (p.width / 2 + 0.9), p.length, 0.5, 0.9, { color: 'white', cls: 'metal' });
    // the green roof
    const ry = p.blockH;
    box(g, 0, ry, 0, p.length - 2, p.parkH, p.width - 2, { color: 'lawn' });
    flatRect(g, -hl * 0.25, ry + p.parkH + 0.06, 0, p.length * 0.62, 5, 'sand');
    flatRect(g, hl * 0.2, ry + p.parkH + 0.06, 0, 5, p.width - 8, 'sand');
    flatDisc(g, hl * 0.2, ry + p.parkH + 0.1, 0, 7, 7, 14, 'water', 'glass');
    // a lawn terrace stepping up at the west end
    annulus(g, -hl + 14, 0, 12, 14, ry + p.parkH, 5, 6, ry + p.parkH + 4.5, 14, 'hillGreen', { from: -Math.PI / 2, to: Math.PI / 2 });
    // trees along the park
    const nt = g.rules.count(p.trees, 4);
    for (let i = 0; i < nt; i++) {
      const x = -hl + 24 + ((p.length - 70) * i) / Math.max(1, nt - 1);
      tree(g, x, ry + p.parkH, i % 2 === 0 ? -p.width * 0.28 : p.width * 0.28, 9 + (i % 3), 3.6, { crown: i % 3 === 0 ? 'hillGreen' : 'hedge' });
    }
    // the glass skylight hall on the roof, and the glass cone atrium at the east end
    glassHall(g, hl * 0.2 - 24, ry + p.parkH, 0, p.hallW, p.hallL, 4.6, { wallH: 1.6, ribs: 9, yaw: Math.PI / 2 });
    const cx = hl - p.coneR - 4;
    frustum(g, cx, G, 0, p.coneR, p.coneR * 0.45, p.coneH - G, 16, { color: 'glassLight', cls: 'glass', smooth: true, capEnd: false });
    if (g.rules.detail >= 1) {
      const nr = g.rules.count(12, 4);
      for (let i = 0; i < nr; i++) {
        const a = (i / nr) * Math.PI * 2;
        strut(g, [cx + Math.cos(a) * p.coneR, G, Math.sin(a) * p.coneR], [cx + Math.cos(a) * p.coneR * 0.45, p.coneH, Math.sin(a) * p.coneR * 0.45], 0.28, { color: 'white', cls: 'metal', sides: 3 });
      }
    }
    taperTower(g, cx, p.coneH, 0, p.coneR * 0.9, p.coneR * 0.9, 0.4, 0.4, 5, { color: 'white', cls: 'metal', round: 1 });
    if (g.rules.detail >= 1) {
      lampPost(g, -hl * 0.25 + 12, ry + p.parkH, 3.4, 4.2);
      lampPost(g, -hl * 0.25 - 12, ry + p.parkH, 3.4, 4.2);
    }
  },
};
