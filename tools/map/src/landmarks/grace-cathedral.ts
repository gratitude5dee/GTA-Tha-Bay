/**
 * lm.grace-cathedral: a Gothic-revival cathedral in pale concrete: a tall nave under a steep gable, a transept, two west
 * towers with spires, a blank rose-window disc over the central doors, buttresses and a flight of entry steps. Original geometry
 * from parameters; no glass pictures, no sculpture, no lettering. The front faces south (+Z).
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof } from './kit/facade.ts';
import { archRing, box, pole, stairs, taperTower, type Geo, type V3 } from './kit/primitives.ts';

export interface GraceParams extends BaseParams {
  naveW: number;
  naveL: number;
  naveH: number;
  roofRise: number;
  aisleW: number;
  aisleH: number;
  transeptW: number;
  transeptL: number;
  towerW: number;
  towerH: number;
  spireH: number;
  roseR: number;
  buttresses: number;
  steps: number;
}

const G = -2;

export const graceCathedral: RecipeDef<GraceParams> = {
  id: 'lm.grace-cathedral',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    naveW: 20, naveL: 66, naveH: 26, roofRise: 11, aisleW: 7, aisleH: 15, transeptW: 15, transeptL: 50, towerW: 11, towerH: 44, spireH: 16, roseR: 4.6, buttresses: 8, steps: 12,
  },
  build(g: Geo, p: GraceParams) {
    const z1 = p.naveL / 2;
    // the nave, its steep roof and the two side aisles
    box(g, 0, G, 0, p.naveW, p.naveH - G, p.naveL, { color: 'whiteConcrete', top: false });
    roof(g, 0, p.naveH, 0, p.naveW + 0.6, p.naveL + 0.6, p.roofRise, { color: 'slate', ridgeAlongX: false, overhang: 0.2 });
    for (const s of [-1, 1]) {
      box(g, s * (p.naveW / 2 + p.aisleW / 2), G, 2, p.aisleW, p.aisleH - G, p.naveL - 14, { color: 'limestone', top: false });
      roof(g, s * (p.naveW / 2 + p.aisleW / 2), p.aisleH, 2, p.aisleW + 0.4, p.naveL - 13.6, 3.2, { color: 'roofGrey', ridgeAlongX: false });
    }
    // the transept crossing the nave a little before its middle, with its own gable ends
    box(g, 0, G, -4, p.transeptL, p.naveH * 0.92 - G, p.transeptW, { color: 'whiteConcrete', top: false });
    roof(g, 0, p.naveH * 0.92, -4, p.transeptL + 0.6, p.transeptW + 0.6, p.roofRise * 0.9, { color: 'slate', ridgeAlongX: true, overhang: 0.2 });
    // the flèche over the crossing
    taperTower(g, 0, p.naveH + p.roofRise * 0.55, -4, 3.4, 3.4, 0.2, 0.2, 18, { color: 'slate', capTint: 1 });
    // the front: two towers with belfries and spires, the rose window between them
    for (const s of [-1, 1]) {
      const tx = s * (p.naveW / 2 - p.towerW / 2 + 1.5);
      box(g, tx, G, z1 - p.towerW / 2 + 1, p.towerW, p.towerH - G, p.towerW, { color: 'limestone', top: false });
      box(g, tx, p.towerH, z1 - p.towerW / 2 + 1, p.towerW + 1, 1.2, p.towerW + 1, { color: 'whiteConcrete' });
      taperTower(g, tx, p.towerH + 1.2, z1 - p.towerW / 2 + 1, p.towerW * 0.8, p.towerW * 0.8, 0.5, 0.5, p.spireH, { color: 'copperGreen', capTint: 1 });
      pole(g, tx, p.towerH + 1.2 + p.spireH, z1 - p.towerW / 2 + 1, 0.2, 0.06, 3, { color: 'gold', cls: 'metal', sides: 4 });
      // tall blank louvre slits on each tower
      box(g, tx, p.towerH - 12, z1 + 1.2, 2.2, 8, 0.4, { color: 'glassDark', cls: 'glass' });
    }
    // the rose window: a blank disc ringed by a stone frame, above three pointed doors
    const rx = 0, ry = p.naveH * 0.66, rz = z1 + 0.05;
    const n = Math.max(8, g.rules.segs(20));
    const ring = (r: number): V3[] => Array.from({ length: n }, (_, i) => [rx + Math.cos((i / n) * Math.PI * 2) * r, ry + Math.sin((i / n) * Math.PI * 2) * r, rz] as V3);
    g.poly(ring(p.roseR + 0.9), [0, 0, 1], 'limestone');
    g.poly(ring(p.roseR).map((q) => [q[0], q[1], q[2] + 0.08] as V3), [0, 0, 1], 'glassTeal', 'glass');
    for (const x of [-4.4, 0, 4.4]) archRing(g, x, 6.6, z1 + 0.2, 1.8, 0.6, 1.2, 0, { color: 'limestone' });
    for (const x of [-4.4, 0, 4.4]) box(g, x, 1.3, z1 + 0.35, 3.4, 5.6, 0.3, { color: 'woodDark' });
    // buttresses along both sides of the nave
    const nb = g.rules.count(p.buttresses, 3);
    for (let i = 0; i < nb; i++) {
      const z = -z1 + 8 + ((p.naveL - 18) * i) / Math.max(1, nb - 1);
      for (const s of [-1, 1]) box(g, s * (p.naveW / 2 + p.aisleW + 0.7), G, z, 1.4, p.aisleH + 3 - G, 1.4, { color: 'whiteConcrete' });
    }
    // the steps and the forecourt
    stairs(g, 0, 0, z1 + 0.6 + p.steps * 0.5, 16, p.steps, 0.5, 1.3 / p.steps, { color: 'granite' });
  },
};
