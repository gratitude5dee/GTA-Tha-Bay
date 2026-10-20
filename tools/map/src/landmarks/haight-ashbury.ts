/**
 * lm.haight-ashbury: two street corners of the Victorian shopping blocks: three-storey painted corner buildings with bay
 * windows, a rounded corner turret, plain awnings over the ground-floor shopfronts (no signs, no lettering, no murals), street
 * lamps and a few street trees. The two streets meet at the origin; the buildings stand in the north-east and south-west quarters.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof, windowBands } from './kit/facade.ts';
import { flatRect, lampPost, tree } from './kit/landscape.ts';
import { box, frustum, taperTower, type Geo } from './kit/primitives.ts';
import type { ColorName } from './kit/palette.ts';

export interface HaightParams extends BaseParams {
  streetW: number;
  blockW: number;
  blockD: number;
  floors: number;
  floorH: number;
  shops: number;
  turretR: number;
  bayW: number;
  awning: number;
  trees: number;
}

const G = -2;
const PAINT: readonly ColorName[] = ['paintLilac', 'paintTeal', 'paintRose', 'paintYellow', 'paintBlue', 'paintSage'];

export const haightAshbury: RecipeDef<HaightParams> = {
  id: 'lm.haight-ashbury',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    streetW: 16, blockW: 50, blockD: 15, floors: 3, floorH: 3.7, shops: 6, turretR: 3.4, bayW: 3.2, awning: 1.8, trees: 6,
  },
  build(g: Geo, p: HaightParams) {
    const H = p.floors * p.floorH;
    const hs = p.streetW / 2;
    flatRect(g, 0, 0.04, 0, p.streetW, 2 * (p.blockW + hs + 6), 'asphalt');
    flatRect(g, 0, 0.05, 0, 2 * (p.blockW + hs + 6), p.streetW, 'asphalt');
    const wing = (sx: number, sz: number, alongX: boolean, col0: number): void => {
      // a row of shopfronts along one street, set back by the half street width
      const n = g.rules.count(p.shops, 3);
      const unit = p.blockW / p.shops;
      for (let i = 0; i < n; i++) {
        const t = hs + 1 + (i + 0.5) * (p.blockW / n);
        const px = alongX ? sx * t : sx * (hs + p.blockD / 2 + 1);
        const pz = alongX ? sz * (hs + p.blockD / 2 + 1) : sz * t;
        const col = PAINT[(col0 + i) % PAINT.length] as ColorName;
        const w = alongX ? p.blockW / n : p.blockD, d = alongX ? p.blockD : p.blockW / n;
        box(g, px, G, pz, w, H - G, d, { color: col, top: false });
        const hip = (i % 2 === 0);
        roof(g, px, H, pz, w + 0.4, d + 0.4, 2.2 + (hip ? 0.8 : 0), { color: 'slate', ridgeAlongX: alongX ? false : true, overhang: 0.2, ...(hip ? { inset: 1.4 } : {}) });
        // the shopfront awning on the street face and a bay above it
        const fx = alongX ? px : px - sx * (w / 2 + p.awning / 2), fz = alongX ? pz - sz * (d / 2 + p.awning / 2) : pz;
        box(g, fx, 3.1, fz, alongX ? w * 0.86 : p.awning, 0.35, alongX ? p.awning : d * 0.86, { color: i % 2 === 0 ? 'bridgeRed' : 'seatBlue' });
        if (g.rules.detail >= 1) {
          const bx = alongX ? px : px - sx * (w / 2 + 0.7), bz = alongX ? pz - sz * (d / 2 + 0.7) : pz;
          box(g, bx, p.floorH + 0.6, bz, alongX ? p.bayW : 1.4, p.floorH * 2 - 1.4, alongX ? 1.4 : p.bayW, { color: col });
          windowBands(g, px, 0.9, pz, w, d, 1, 3.0, { color: 'glassDark', sides: alongX ? [sz > 0 ? 'z-' : 'z+'] : [sx > 0 ? 'x-' : 'x+'], frac: 0.8, height: 0.7, proud: 0.2 });
          windowBands(g, px, p.floorH + 1.0, pz, w, d, 2, p.floorH, { color: 'glassDark', sides: alongX ? [sz > 0 ? 'z-' : 'z+'] : [sx > 0 ? 'x-' : 'x+'], frac: 0.7, height: 0.45, proud: 0.2 });
        }
        void unit;
      }
    };
    // north-east corner and south-west corner: both streets, with a rounded turret at the corner
    for (const [sx, sz] of [[1, -1], [-1, 1]] as const) {
      wing(sx, sz, true, sx > 0 ? 0 : 2);
      wing(sx, sz, false, sx > 0 ? 3 : 1);
      const cx = sx * (hs + p.turretR + 0.6), cz = sz * (hs + p.turretR + 0.6);
      frustum(g, cx, G, cz, p.turretR, p.turretR, H + 2 - G, 12, { color: 'paintCream', smooth: true });
      taperTower(g, cx, H + 2, cz, p.turretR * 2.2, p.turretR * 2.2, 0.4, 0.4, 5.5, { color: 'copperGreen', round: 1, slices: 1, capTint: 1 });
      if (g.rules.detail >= 1) windowBands(g, cx, 1.2, cz, p.turretR * 1.6, p.turretR * 1.6, 3, p.floorH, { color: 'glassDark', frac: 0.5, height: 0.5, proud: 0.2 });
    }
    // corner lamps and street trees
    for (const [sx, sz] of [[1, 1], [-1, -1]] as const) lampPost(g, sx * (hs + 1), 0, sz * (hs + 1), 5.4);
    const nt = g.rules.count(p.trees, 2);
    for (let i = 0; i < nt; i++) {
      const t = hs + 12 + i * 8;
      tree(g, (i % 2 === 0 ? 1 : -1) * t, 0, (i % 2 === 0 ? -1 : 1) * (hs - 1.4), 8.5, 3.0);
    }
  },
};
