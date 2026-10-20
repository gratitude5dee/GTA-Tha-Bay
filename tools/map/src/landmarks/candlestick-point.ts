/**
 * lm.candlestick-point: a vast paved lot beside the bay where a stadium once stood: a curved concrete grandstand ramp, a ring of
 * tall light masts, chain-link fence runs, dark tyre-mark circles on the asphalt, a ticket booth and a few barriers. Original
 * geometry from parameters; no signs, no logos, no lettering. It is a sideshow lot: the open pavement is the point.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { annulus, fence, flatDisc, flatRect, lampPost } from './kit/landscape.ts';
import { box, circleRing, pole, prism, type Geo } from './kit/primitives.ts';

export interface LotParams extends BaseParams {
  lotW: number;
  lotD: number;
  standR: number;
  standH: number;
  masts: number;
  mastH: number;
  marks: number;
  markR: number;
  barriers: number;
  boothW: number;
}

const G = -2;

export const candlestickPoint: RecipeDef<LotParams> = {
  id: 'lm.candlestick-point',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    lotW: 190, lotD: 140, standR: 70, standH: 16, masts: 8, mastH: 34, marks: 5, markR: 11, barriers: 14, boothW: 4,
  },
  build(g: Geo, p: LotParams) {
    const hw = p.lotW / 2, hd = p.lotD / 2;
    flatRect(g, 0, 0.05, 0, p.lotW, p.lotD, 'asphalt');
    // the grandstand: a curved terraced concrete bowl on the west side, open toward the lot
    const cx = -hw + 10;
    annulus(g, cx, 0, p.standR * 0.55, p.standR * 0.55, 0.2, p.standR, p.standR, p.standH, 20, 'concrete', { from: -Math.PI / 2, to: Math.PI / 2 });
    annulus(g, cx, 0, p.standR, p.standR, p.standH, p.standR + 2, p.standR + 2, p.standH + 0.6, 20, 'whiteConcrete', { from: -Math.PI / 2, to: Math.PI / 2 });
    annulus(g, cx, 0, p.standR, p.standR, G, p.standR, p.standR, p.standH, 20, 'concrete', { from: -Math.PI / 2, to: Math.PI / 2, down: true });
    if (g.rules.detail >= 1) {
      const n = g.rules.count(18, 4);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.PI * (i + 0.5)) / n;
        box(g, cx + Math.cos(a) * (p.standR + 3.4), G, Math.sin(a) * (p.standR + 3.4), 3, p.standH + 2 - G, 3, { color: 'concrete', yaw: -a });
      }
    }
    // the dark circles: tyre marks laid down by years of sideshows
    for (let i = 0; i < g.rules.count(p.marks, 2); i++) {
      const x = -hw * 0.2 + ((i * 41) % 90) - 20, z = -hd * 0.5 + ((i * 29) % 70);
      flatDisc(g, x, 0.09, z, p.markR + (i % 3) * 3, p.markR * 0.8 + (i % 2) * 3, 14, 'tyre');
      flatDisc(g, x, 0.1, z, p.markR * 0.55, p.markR * 0.42, 12, 'asphalt');
    }
    // light masts around the lot
    for (let i = 0; i < g.rules.count(p.masts, 4); i++) {
      const a = (i / p.masts) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * hw * 0.92, z = Math.sin(a) * hd * 0.92;
      pole(g, x, 0, z, 0.55, 0.32, p.mastH, { color: 'steelGrey', cls: 'metal', sides: 6 });
      box(g, x, p.mastH, z, 5.6, 1.6, 1.1, { color: 'lamp', cls: 'glass', yaw: -a });
    }
    // fence runs, barriers and the booth at the entrance on the east edge
    fence(g, hw, 0, -hd, hw, hd * 0.2, 2.4, 3.2);
    fence(g, hw, 0, hd * 0.55, hw, hd, 2.4, 3.2);
    for (let i = 0; i < g.rules.count(p.barriers, 3); i++) box(g, hw - 6 - i * 2.4, 0.05, hd * 0.37, 1.8, 1.0, 0.6, { color: i % 2 === 0 ? 'bridgeRed' : 'white' });
    box(g, hw - 8, 0.05, hd * 0.37 + 4, p.boothW, 2.8, p.boothW, { color: 'paintCream' });
    prism(g, circleRing(-hw * 0.5, hd * 0.55, 3, 3, g.rules.segs(8)), 0.05, 0.4, { color: 'concrete' });
    if (g.rules.detail >= 1) lampPost(g, hw - 12, 0, hd * 0.37 - 4, 5.5);
  },
};
