/**
 * lm.china-basin-ballpark: a fictional baseball park beside a cove: a brick outer wall with an arcaded front, a seating bowl in
 * two decks, a grass field with a dirt infield, tall light masts and a corner tower. Original geometry from parameters; it
 * stands for no club and carries no mark, no scoreboard text and no statue. The front (the arcade and the tower) faces south.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof } from './kit/facade.ts';
import { annulus, flat, flatDisc, flatRect, lampPost, local } from './kit/landscape.ts';
import { arcade, box, circleRing, frustum, pole, skin, taperTower, type Geo, type V3 } from './kit/primitives.ts';

export interface BallparkParams extends BaseParams {
  rx: number;
  rz: number;
  wallH: number;
  lowerH: number;
  upperH: number;
  fieldRx: number;
  fieldRz: number;
  diamond: number;
  masts: number;
  mastH: number;
  frontBays: number;
  towerW: number;
  towerH: number;
  coveW: number;
}

const G = -2;

export const chinaBasinBallpark: RecipeDef<BallparkParams> = {
  id: 'lm.china-basin-ballpark',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    rx: 108, rz: 92, wallH: 26, lowerH: 9, upperH: 20, fieldRx: 66, fieldRz: 62, diamond: 27, masts: 6, mastH: 46, frontBays: 18, towerW: 12, towerH: 44, coveW: 40,
  },
  build(g: Geo, p: BallparkParams) {
    const n = 40;
    // the outer wall: a brick ring, open at the top; the roof of the upper deck leans in from it
    const outer = (rx: number, rz: number, y: number): V3[] => circleRing(0, 0, rx, rz, g.rules.segs(n)).map(([x, z]) => [x, y, z] as V3);
    skin(g, [outer(p.rx, p.rz, G), outer(p.rx, p.rz, p.wallH)], { color: 'brick', smooth: true, capEnd: false });
    annulus(g, 0, 0, p.rx, p.rz, p.wallH, p.rx - 9, p.rz - 8, p.wallH + 2.2, n, 'darkSteel', { cls: 'metal' });
    // the seating bowl: lower deck, a concourse band, upper deck
    annulus(g, 0, 0, p.fieldRx + 6, p.fieldRz + 6, 1.2, p.fieldRx + 32, p.fieldRz + 28, p.lowerH, n, 'seatBlue');
    annulus(g, 0, 0, p.fieldRx + 32, p.fieldRz + 28, p.lowerH, p.fieldRx + 36, p.fieldRz + 32, p.lowerH + 0.4, n, 'concrete');
    annulus(g, 0, 0, p.fieldRx + 36, p.fieldRz + 32, p.lowerH + 0.4, p.rx - 10, p.rz - 9, p.upperH, n, 'seatGreen');
    // the field, the infield dirt and the diamond
    flatDisc(g, 0, 1.0, 0, p.fieldRx, p.fieldRz, n, 'field');
    flat(g, [[0, p.diamond * 0.1], [p.diamond, -p.diamond * 0.9], [0, -p.diamond * 1.9], [-p.diamond, -p.diamond * 0.9]].map(([x, z]) => local(0, p.fieldRz * 0.28, x as number, z as number, 0)), 1.06, 'dirt');
    flatDisc(g, 0, 1.1, p.fieldRz * 0.28 - p.diamond * 0.1, 3.4, 3.4, 8, 'dirt');
    // the outfield wall: a low blue band along the far side of the field
    if (g.rules.detail >= 1) {
      const a = circleRing(0, 0, p.fieldRx, p.fieldRz, g.rules.segs(n));
      skin(g, [a.map(([x, z]) => [x, 1, z] as V3), a.map(([x, z]) => [x, 3.4, z] as V3)], { color: 'seatGreen', smooth: true, capEnd: false });
    }
    // the front: an arcaded brick face on the south side, a corner tower, an entrance plaza
    const fz = p.rz - 1;
    arcade(g, -p.rx * 0.34, 0, fz + 5, p.rx * 0.34, fz + 5, { color: 'brick', bays: p.frontBays, pierW: 1.6, depth: 3.4, pierH: 5.2, openingW: 3.6, archT: 0.7, wallColor: 'sandstone' });
    box(g, 0, 8.4, fz + 5, p.rx * 0.68 + 1.5, 1.2, 4.2, { color: 'sandstone' });
    taperTower(g, -p.rx * 0.34 - 10, G, fz + 5, p.towerW, p.towerW, p.towerW * 0.82, p.towerW * 0.82, p.towerH - G, { color: 'brick' });
    roof(g, -p.rx * 0.34 - 10, p.towerH, fz + 5, p.towerW, p.towerW, 6, { color: 'copperGreen', ridgeAlongX: true, inset: 4 });
    box(g, -p.rx * 0.34 - 10, p.towerH - 14, fz + 5 + p.towerW / 2 + 0.2, 4.2, 5, 0.5, { color: 'glassDark', cls: 'glass' });
    flatRect(g, 0, 0.05, fz + 22, p.rx * 0.9, 32, 'granite');
    // light masts around the rim, each a pole with a bank of lamps
    const nm = g.rules.count(p.masts, 4);
    for (let i = 0; i < nm; i++) {
      const a = (i / nm) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * (p.rx - 4), z = Math.sin(a) * (p.rz - 4);
      pole(g, x, p.wallH - 4, z, 1.0, 0.6, p.mastH - p.wallH + 4, { color: 'steelGrey', cls: 'metal', sides: g.rules.detail >= 1 ? 6 : 4 });
      box(g, x, p.mastH, z, 9, 4.4, 1.6, { color: 'lamp', cls: 'glass', yaw: -a });
    }
    // the cove on the east side: water behind the right-field wall
    flat(g, circleRing(p.rx + p.coveW * 0.62, 12, p.coveW * 0.75, p.coveW * 0.9, g.rules.segs(18)), 0.12, 'water', 'glass');
    if (g.rules.detail >= 2) {
      frustum(g, 0, 1, 0, 0.7, 0.5, 0.25, 6, { color: 'trimWhite', smooth: false });
      lampPost(g, -p.rx * 0.34, 0, fz + 24, 5);
      lampPost(g, p.rx * 0.34, 0, fz + 24, 5);
    }
  },
};
