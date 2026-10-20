/**
 * lm.cliff-house: a pale three-storey seaside building on a rocky headland above the beach: a long ocean-facing glass front
 * with open terraces, a flat roof with a small cupola, a stair down to the rocks, a parking apron and a flag mast, with a few
 * rock stacks in the surf. Original geometry from parameters; no signs, no lettering. The ocean is to the west (-X).
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { windowBands } from './kit/facade.ts';
import { fence, flatRect, lampPost } from './kit/landscape.ts';
import { box, frustum, hillMound, pole, stairs, taperTower, type Geo } from './kit/primitives.ts';

export interface CliffParams extends BaseParams {
  w: number;
  d: number;
  floors: number;
  floorH: number;
  terrace: number;
  cliffR: number;
  cliffH: number;
  stacks: number;
  stackR: number;
  cupolaW: number;
  apron: number;
}

const G = -2;

export const cliffHouse: RecipeDef<CliffParams> = {
  id: 'lm.cliff-house',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    w: 22, d: 52, floors: 3, floorH: 4.2, terrace: 8, cliffR: 60, cliffH: 7, stacks: 4, stackR: 8, cupolaW: 6, apron: 40,
  },
  build(g: Geo, p: CliffParams) {
    const H = p.floors * p.floorH;
    // the headland under the building and the rock stacks offshore
    hillMound(g, -p.w * 0.35, 0, 0, p.cliffR, p.cliffR * 0.85, p.cliffH, 18, 3, 6, { color: 'rock' });
    for (let i = 0; i < g.rules.count(p.stacks, 2); i++) {
      const z = -30 + i * 22;
      hillMound(g, -p.cliffR - 26 - (i % 2) * 14, 0, z, p.stackR - i, p.stackR - i, 6 + (i % 3) * 3, 8, 2, 4, { color: 'rock' });
    }
    // the main block, stepped back on the ocean side by a terrace at each upper floor
    box(g, 0, G, 0, p.w, H - G, p.d, { color: 'plaster', top: false });
    box(g, 0, H, 0, p.w + 1.2, 0.8, p.d + 1.2, { color: 'whiteConcrete' });
    box(g, -p.w / 2 - p.terrace / 2, p.floorH - 0.4, 0, p.terrace, 0.6, p.d - 6, { color: 'limestone' });
    if (g.rules.detail >= 1) {
      fence(g, -p.w / 2 - p.terrace, p.floorH + 0.2, -p.d / 2 + 3, -p.w / 2 - p.terrace, p.d / 2 - 3, 1.1, 3);
      fence(g, -p.w / 2 - p.terrace, p.floorH + 0.2, -p.d / 2 + 3, -p.w / 2, -p.d / 2 + 3, 1.1, 3);
      fence(g, -p.w / 2 - p.terrace, p.floorH + 0.2, p.d / 2 - 3, -p.w / 2, p.d / 2 - 3, 1.1, 3);
    }
    windowBands(g, 0, 1, 0, p.w, p.d, p.floors, p.floorH, { color: 'glassBlue', sides: ['x-'], frac: 0.9, height: 0.62, proud: 0.4 });
    windowBands(g, 0, 1, 0, p.w, p.d, p.floors, p.floorH, { color: 'glassDark', sides: ['z+', 'z-', 'x+'], frac: 0.55, height: 0.45, proud: 0.3 });
    // a cupola on the roof: a small box with a pyramid cap and a pole
    box(g, p.w * 0.1, H + 0.8, -p.d * 0.3, p.cupolaW, 3.4, p.cupolaW, { color: 'paintCream' });
    taperTower(g, p.w * 0.1, H + 4.2, -p.d * 0.3, p.cupolaW + 1, p.cupolaW + 1, 0.3, 0.3, 3.4, { color: 'slate', capTint: 1 });
    // a stair down the headland toward the sea and the flag mast
    stairs(g, -p.w / 2 - p.terrace - 1, 0, p.d * 0.1, 3, 18, 0.9, 0.12, { color: 'concrete', yaw: Math.PI / 2 });
    pole(g, -p.w / 2 - p.terrace + 1, p.floorH + 0.2, -p.d / 2 + 4, 0.2, 0.12, 12, { color: 'white', cls: 'metal', sides: 4 });
    // the parking apron on the land side
    flatRect(g, p.w / 2 + p.apron / 2 + 2, 0.06, 0, p.apron, p.d + 24, 'asphalt');
    if (g.rules.detail >= 1) for (let i = 0; i < g.rules.count(5, 2); i++) lampPost(g, p.w / 2 + 6, 0, -p.d / 2 + 4 + i * (p.d / 4), 5.2);
    frustum(g, p.w / 2 + 14, 0, -p.d / 2 - 6, 1.4, 1.4, 1.1, 8, { color: 'hedge', smooth: false });
  },
};
