/**
 * lm.opera-house: a Beaux-Arts opera house in pale stone: a long arcaded front of tall arched openings under a colonnaded upper
 * floor, a balustraded cornice and hipped roof, two end pavilions, a taller stage house behind and a flight of entry steps. Original
 * geometry from parameters; no sculpture, no lettering, no relief. The front faces east (+X).
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof, windowBands } from './kit/facade.ts';
import { lampPost } from './kit/landscape.ts';
import { arcade, box, frustum, stairs, type Geo } from './kit/primitives.ts';

export interface OperaParams extends BaseParams {
  length: number;
  depth: number;
  frontH: number;
  bays: number;
  stageL: number;
  stageD: number;
  stageH: number;
  pavD: number;
  pavProj: number;
  colonnade: number;
  steps: number;
}

const G = -2;

export const operaHouse: RecipeDef<OperaParams> = {
  id: 'lm.opera-house',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    length: 76, depth: 34, frontH: 24, bays: 9, stageL: 50, stageD: 40, stageH: 36, pavD: 14, pavProj: 3.4, colonnade: 14, steps: 12,
  },
  build(g: Geo, p: OperaParams) {
    const hl = p.length / 2;
    // the main block with a heavy base course, a cornice and a hipped roof
    box(g, 0, G, 0, p.depth, p.frontH - G, p.length, { color: 'limestone', top: false });
    box(g, 0, 0, 0, p.depth + 1.2, 1.4, p.length + 1.2, { color: 'granite' });
    box(g, 0, p.frontH - 1.6, 0, p.depth + 2.2, 1.6, p.length + 2.2, { color: 'cream' });
    roof(g, 0, p.frontH, 0, p.depth, p.length, 6.5, { color: 'slate', ridgeAlongX: false, inset: 8 });
    // the ground-floor arcade of tall arches along the east face and the colonnade of the upper floor
    arcade(g, p.depth / 2 + 1.6, 1.4, -hl + p.pavD, p.depth / 2 + 1.6, hl - p.pavD, { color: 'limestone', bays: p.bays, pierW: 1.8, depth: 3.2, pierH: 4.2, openingW: 4.6, archT: 0.8, wallColor: 'cream' });
    box(g, p.depth / 2 + 1.6, 9.6, 0, 3.2, 0.9, p.length - 2 * p.pavD + 2, { color: 'cream' });
    const nc = g.rules.count(p.colonnade, 5);
    for (let i = 0; i < nc; i++) {
      const z = -hl + p.pavD + 3 + ((p.length - 2 * p.pavD - 6) * i) / (nc - 1);
      frustum(g, p.depth / 2 + 1.6, 10.5, z, 0.6, 0.54, 9.4, g.rules.detail >= 1 ? 8 : 5, { color: 'whiteConcrete', smooth: g.rules.detail >= 1 });
    }
    box(g, p.depth / 2 + 1.6, 19.9, 0, 3.0, 1.2, p.length - 2 * p.pavD + 1.2, { color: 'cream' });
    windowBands(g, 0, 10, 0, p.depth, p.length - 2 * p.pavD, 1, 8, { color: 'glassDark', sides: ['x+'], frac: 0.86, height: 0.58, proud: 0.2 });
    // the two end pavilions, slightly proud, with their own roofs
    for (const s of [-1, 1]) {
      const z = s * (hl - p.pavD / 2);
      box(g, p.pavProj / 2, G, z, p.depth + p.pavProj, p.frontH + 2 - G, p.pavD, { color: 'sandstone', top: false });
      roof(g, p.pavProj / 2, p.frontH + 2, z, p.depth + p.pavProj + 0.8, p.pavD + 0.8, 5, { color: 'slate', ridgeAlongX: true, inset: 4 });
      windowBands(g, p.pavProj / 2, 1.8, z, p.depth + p.pavProj, p.pavD, 3, 7, { color: 'glassDark', sides: ['x+'], frac: 0.5, height: 0.55, proud: 0.2 });
    }
    // the stage house behind: a tall plain block with a shallow roof
    box(g, -p.depth / 2 - p.stageD / 2 + 4, G, 0, p.stageD, p.stageH - G, p.stageL, { color: 'plaster' });
    box(g, -p.depth / 2 - p.stageD / 2 + 4, p.stageH, 0, p.stageD + 1, 0.7, p.stageL + 1, { color: 'roofGrey' });
    // the entry steps and lamps
    stairs(g, p.depth / 2 + 5 + p.steps * 0.55, 0, 0, 22, p.steps, 0.55, 1.4 / p.steps, { color: 'granite', yaw: Math.PI / 2 });
    for (const z of [-hl + 6, hl - 6]) lampPost(g, p.depth / 2 + 14, 0, z, 6);
  },
};
