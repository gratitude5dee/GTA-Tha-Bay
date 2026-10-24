/**
 * lm.treasure-island: the island's civic waterfront: a curved Art Deco administration block with a stepped central tower, a wing
 * pair, a long barrel-roofed hangar behind it, a ferry quay with a canopy, a small marina breakwater and one gantry crane on
 * the quay. Original geometry from parameters; no inscriptions, no relief carving, no signs. The skyline view is to the west.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { windowBands } from './kit/facade.ts';
import { gantryCrane } from './kit/gantry.ts';
import { vault } from './kit/glasshouse.ts';
import { annulus, flatDisc, flatRect, lampPost, palm } from './kit/landscape.ts';
import { box, setbacks, type Geo } from './kit/primitives.ts';

export interface IslandParams extends BaseParams {
  wingL: number;
  wingD: number;
  wingH: number;
  curve: number;
  towerW: number;
  towerStep: number;
  hangarL: number;
  hangarW: number;
  hangarH: number;
  hangarRise: number;
  quayL: number;
  quayW: number;
  canopyL: number;
  craneH: number;
  palms: number;
}

const G = -2;

export const treasureIsland: RecipeDef<IslandParams> = {
  id: 'lm.treasure-island',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    wingL: 44, wingD: 15, wingH: 14, curve: 0.36, towerW: 20, towerStep: 3.4, hangarL: 120, hangarW: 44, hangarH: 12, hangarRise: 9, quayL: 70, quayW: 16, canopyL: 24, craneH: 26, palms: 8,
  },
  build(g: Geo, p: IslandParams) {
    // the curved block: the two wings swing back from the central tower along an arc
    for (const s of [-1, 1]) {
      const yaw = s * p.curve;
      const x = s * (p.towerW / 2 + p.wingL * 0.45), z = -Math.abs(Math.sin(p.curve)) * p.wingL * 0.45;
      box(g, x, G, z, p.wingL, p.wingH - G, p.wingD, { color: 'plaster', top: true, yaw: -yaw });
      box(g, x, p.wingH, z, p.wingL + 1, 0.9, p.wingD + 1, { color: 'whiteConcrete', yaw: -yaw });
      windowBands(g, x, 1.2, z, p.wingL, p.wingD, 3, 4.2, { color: 'glassDark', sides: ['z+'], frac: 0.9, height: 0.42, proud: 0.3 });
    }
    const top = setbacks(g, 0, G, -2, p.towerW, p.wingD + 4, [{ h: p.wingH + 2 - G, inset: 0 }, { h: 10, inset: p.towerStep }, { h: 8, inset: p.towerStep }, { h: 6, inset: p.towerStep * 0.8 }], { color: 'plaster' });
    box(g, 0, top, -2, 3, 5, 3, { color: 'gold', cls: 'metal' });
    if (g.rules.detail >= 1) windowBands(g, 0, 2, -2, p.towerW, p.wingD + 4, 4, 4.5, { color: 'glassDark', sides: ['z+'], frac: 0.5, height: 0.5, proud: 0.3 });
    // the forecourt: a paved arc with palms
    annulus(g, 0, -2, 14, 14, 0.05, 40, 40, 0.07, 20, 'granite', { from: 0, to: Math.PI });
    for (let i = 0; i < g.rules.count(p.palms, 3); i++) {
      const a = (i / Math.max(1, p.palms - 1)) * Math.PI;
      palm(g, Math.cos(a) * 36, 0.1, 6 + Math.sin(a) * 34, 14 + (i % 2) * 2);
    }
    // the hangar behind the block
    box(g, 0, G, -p.wingD - p.hangarW / 2 - 14, p.hangarL, p.hangarH - G, p.hangarW, { color: 'steelGrey', top: false });
    vault(g, 0, p.hangarH, -p.wingD - p.hangarW / 2 - 14, p.hangarW, p.hangarL, p.hangarRise, { color: 'roofGrey', cls: 'metal', yaw: Math.PI / 2, caps: false });
    // the ferry quay to the west with a canopy and one crane
    box(g, -p.towerW - p.quayL / 2 - 20, G, 40, p.quayL, 0.8 - G, p.quayW, { color: 'concrete' });
    box(g, -p.towerW - p.quayL / 2 - 20, 4.4, 40, p.canopyL, 0.5, p.quayW * 0.6, { color: 'white', cls: 'metal' });
    if (g.rules.detail >= 1) for (const s of [-1, 1]) box(g, -p.towerW - p.quayL / 2 - 20 + s * (p.canopyL / 2 - 1), 0.8, 40, 0.5, 3.6, 0.5, { color: 'white', cls: 'metal' });
    gantryCrane(g, -p.towerW - 20 - p.quayL + 10, 0.8, 40 + p.quayW / 2 - 3, { gauge: 9, legH: p.craneH, boom: 22, boomRise: 4, back: 9, yaw: Math.PI, color: 'paintTeal', accent: 'white' });
    // a marina breakwater and water
    flatRect(g, -p.towerW - p.quayL - 36, 0.1, 62, 48, 26, 'water', { cls: 'glass' });
    box(g, -p.towerW - p.quayL - 36, 0, 76, 52, 1.2, 3, { color: 'rock' });
    flatDisc(g, 0, 0.09, -2 + 46, 3, 3, 8, 'water', 'glass');
    if (g.rules.detail >= 1) for (let i = 0; i < g.rules.count(6, 2); i++) lampPost(g, -6 + i * 8, 0.1, 22, 5);
  },
};
