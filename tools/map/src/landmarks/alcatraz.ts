/**
 * lm.alcatraz: the buildings of a rocky island prison as architecture only: a long cell block with a lighthouse tower on its roof,
 * a water tower, a power-house chimney, a barracks row, a guard tower and a landing dock, on a rock apron. Original geometry from
 * parameters; no signage, no inscriptions. The island itself is terrain.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof, windowBands } from './kit/facade.ts';
import { box, frustum, hillMound, pole, stairs, strut, taperTower, type Geo } from './kit/primitives.ts';

export interface AlcatrazParams extends BaseParams {
  blockLength: number;
  blockDepth: number;
  blockH: number;
  floors: number;
  lightH: number;
  tankR: number;
  tankH: number;
  legH: number;
  chimneyH: number;
  chimneyR: number;
  rowCount: number;
  rowLength: number;
  apronRx: number;
  apronRz: number;
  dockLength: number;
}

const G = -2;

export const alcatraz: RecipeDef<AlcatrazParams> = {
  id: 'lm.alcatraz',
  defaults: {
    yawDeg: 20, anchor: 'ground',
    blockLength: 110, blockDepth: 30, blockH: 22, floors: 4, lightH: 16, tankR: 5.5, tankH: 7, legH: 18, chimneyH: 34, chimneyR: 2.0,
    rowCount: 3, rowLength: 46, apronRx: 150, apronRz: 70, dockLength: 60,
  },
  build(g: Geo, p: AlcatrazParams) {
    // the rock apron, sunk so it only shows where the ground falls away
    hillMound(g, 0, 0, 0, p.apronRx, p.apronRz, 1.5, 24, 3, 9, { color: 'rock' });
    // the cell block
    box(g, 0, G, 0, p.blockLength, p.blockH - G, p.blockDepth, { color: 'concrete' });
    box(g, 0, p.blockH, 0, p.blockLength + 1.2, 1.0, p.blockDepth + 1.2, { color: 'whiteConcrete' });
    roof(g, 0, p.blockH + 1, 0, p.blockLength - 4, p.blockDepth - 4, 4, { color: 'roofGrey', ridgeAlongX: true, inset: 3 });
    windowBands(g, 0, 0, 0, p.blockLength, p.blockDepth, p.floors, p.blockH / p.floors, { color: 'glassDark', frac: 0.92, height: 0.42 });
    // the lighthouse tower at one end of the block
    const lx = -p.blockLength / 2 + 8;
    taperTower(g, lx, p.blockH + 1, 0, 8, 8, 5.5, 5.5, p.lightH, { color: 'plaster', slices: 1 });
    frustum(g, lx, p.blockH + 1 + p.lightH, 0, 3.4, 3.4, 4, 8, { color: 'glassTeal', cls: 'glass', smooth: false });
    frustum(g, lx, p.blockH + 5 + p.lightH, 0, 3.8, 1.2, 2.4, 8, { color: 'slate', smooth: false });
    pole(g, lx, p.blockH + 7.4 + p.lightH, 0, 0.25, 0.08, 3, { color: 'steelGrey', cls: 'metal' });
    // the water tower: four legs, a tank and a cone
    const wx = p.blockLength / 2 + 16, wz = -18;
    for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [2.2, 2.2], [-2.2, 2.2]] as const) strut(g, [wx + dx, 0, wz + dz], [wx + dx * 0.8, p.legH, wz + dz * 0.8], 0.35, { color: 'darkSteel', cls: 'metal' });
    frustum(g, wx, p.legH, wz, p.tankR, p.tankR, p.tankH, 12, { color: 'rock', smooth: true, capStart: true });
    frustum(g, wx, p.legH + p.tankH, wz, p.tankR + 0.3, 0.4, 2.6, 12, { color: 'slate', smooth: true });
    // the power house and chimney
    box(g, -p.blockLength / 2 - 28, G, 24, 30, 12 - G, 16, { color: 'concrete' });
    roof(g, -p.blockLength / 2 - 28, 12, 24, 31, 17, 3, { color: 'roofGrey', ridgeAlongX: true });
    taperTower(g, -p.blockLength / 2 - 20, 0, 36, p.chimneyR * 2, p.chimneyR * 2, p.chimneyR * 1.3, p.chimneyR * 1.3, p.chimneyH, { color: 'concrete', round: 1, slices: 2 });
    // officers' row: a few small houses with pitched roofs
    for (let i = 0; i < p.rowCount; i++) {
      const x = -p.rowLength + i * 28, z = -40;
      box(g, x, G, z, 22, 10 - G, 12, { color: 'plaster' });
      roof(g, x, 10, z, 23, 13, 4, { color: 'terracotta', ridgeAlongX: true, overhang: 0.4 });
      windowBands(g, x, 1.5, z, 22, 12, 2, 4, { color: 'glassDark', sides: ['z+'], frac: 0.7, height: 0.45 });
    }
    // guard tower
    taperTower(g, p.blockLength / 2 + 4, G, 22, 5, 5, 4, 4, 22 - G, { color: 'concrete' });
    box(g, p.blockLength / 2 + 4, 20, 22, 6.5, 3.2, 6.5, { color: 'glassDark', cls: 'glass' });
    roof(g, p.blockLength / 2 + 4, 23.2, 22, 7.5, 7.5, 2, { color: 'slate', ridgeAlongX: true, inset: 3 });
    // landing dock and ramp
    box(g, p.blockLength / 2 + 40, 0.2, 40 + p.dockLength / 2, 8, 1.0, p.dockLength, { color: 'timber' });
    if (g.rules.detail >= 1) {
      const piles = g.rules.count(10, 3);
      for (let i = 0; i < piles; i++) for (const s of [-1, 1]) strut(g, [p.blockLength / 2 + 40 + s * 3.6, -2, 44 + (p.dockLength - 8) * (i / (piles - 1))], [p.blockLength / 2 + 40 + s * 3.6, 1.2, 44 + (p.dockLength - 8) * (i / (piles - 1))], 0.3, { color: 'timber', sides: 3 });
    }
    stairs(g, p.blockLength / 2 + 40, 0, 38, 8, 6, 1.2, 0.2, { color: 'concrete', yaw: 0 });
  },
};
