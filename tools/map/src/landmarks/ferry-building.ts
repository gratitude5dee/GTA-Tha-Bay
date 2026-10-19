/**
 * lm.ferry-building: a long waterfront hall with a ground-floor arcade, two end pavilions and a central clock tower, original
 * geometry from parameters. The facade faces east (+X, the water); the long axis runs north-south. The clock faces are blank
 * discs: no numerals, no lettering.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof, windowBands } from './kit/facade.ts';
import { arcade, box, pole, taperTower, type Geo, type V3 } from './kit/primitives.ts';

export interface FerryParams extends BaseParams {
  length: number;
  depth: number;
  hallH: number;
  roofRise: number;
  bays: number;
  endW: number;
  endH: number;
  towerW: number;
  towerBaseH: number;
  towerShaftH: number;
  clockH: number;
  belfryH: number;
  spireH: number;
  seawall: number;
}

const G = -2;

/** A flat disc facing along ±X or ±Z, standing off the wall. */
function disc(g: Geo, x: number, y: number, z: number, r: number, face: 'x+' | 'x-' | 'z+' | 'z-', color: 'white' | 'glassDark'): void {
  const n = Math.max(6, g.rules.segs(16));
  const pts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    pts.push(face === 'x+' || face === 'x-' ? [x, y + v, z + u] : [x + u, y + v, z]);
  }
  const out: V3 = face === 'x+' ? [1, 0, 0] : face === 'x-' ? [-1, 0, 0] : face === 'z+' ? [0, 0, 1] : [0, 0, -1];
  g.poly(pts, out, color, 'glass');
}

export const ferryBuilding: RecipeDef<FerryParams> = {
  id: 'lm.ferry-building',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    length: 200, depth: 32, hallH: 17, roofRise: 6, bays: 40, endW: 28, endH: 21, towerW: 15, towerBaseH: 22, towerShaftH: 24, clockH: 9, belfryH: 10, spireH: 12, seawall: 1,
  },
  build(g: Geo, p: FerryParams) {
    const hl = p.length / 2;
    // the hall and its arcade
    box(g, 0, G, 0, p.depth, p.hallH - G, p.length, { color: 'sandstone', top: false });
    box(g, 0, p.hallH, 0, p.depth + 1.6, 1.0, p.length + 1.6, { color: 'cream' });
    roof(g, 0, p.hallH + 1, 0, p.depth, p.length, p.roofRise, { color: 'terracotta', ridgeAlongX: false, overhang: 0.4 });
    arcade(g, p.depth / 2 + 1.8, 0, -hl + p.endW, p.depth / 2 + 1.8, hl - p.endW, {
      color: 'limestone', bays: p.bays, pierW: 1.6, depth: 3.6, pierH: 4.4, openingW: 3.4, archT: 0.6, wallColor: 'cream',
    });
    box(g, p.depth / 2 + 1.8, 7.2, 0, 3.6, 0.9, p.length - 2 * p.endW + 2, { color: 'cream' });
    windowBands(g, 0, 7.4, 0, p.depth, p.length, 2, 4.2, { color: 'glassDark', sides: ['x+', 'x-'], frac: 0.9, height: 0.55 });
    // end pavilions
    for (const s of [-1, 1]) {
      const z = s * (hl - p.endW / 2);
      box(g, 1.2, G, z, p.depth + 2.4, p.endH - G, p.endW, { color: 'sandstone' });
      roof(g, 1.2, p.endH, z, p.depth + 3.2, p.endW + 0.8, 7, { color: 'terracotta', ridgeAlongX: false, inset: 4 });
      windowBands(g, 1.2, 1.5, z, p.depth + 2.4, p.endW, 4, 4.8, { color: 'glassDark', sides: ['x+', 'z+', 'z-'], frac: 0.7 });
    }
    // seawall in front of the building
    if (p.seawall > 0) box(g, p.depth / 2 + 9, G, 0, 2.2, p.seawall - G, p.length + 20, { color: 'concrete' });
    // the tower, rising from the middle of the facade
    const tx = p.depth / 2 - 6;
    const y1 = p.hallH + 1;
    box(g, tx, G, 0, p.towerW + 2, p.towerBaseH - G, p.towerW + 2, { color: 'sandstone', top: false });
    box(g, tx, p.towerBaseH, 0, p.towerW + 3, 1.0, p.towerW + 3, { color: 'cream' });
    let y = p.towerBaseH + 1;
    taperTower(g, tx, y, 0, p.towerW, p.towerW, p.towerW * 0.88, p.towerW * 0.88, p.towerShaftH, { color: 'sandstone', slices: 1 });
    windowBands(g, tx, y + 3, 0, p.towerW * 0.92, p.towerW * 0.92, 2, 9, { color: 'glassDark', frac: 0.3, height: 0.5, proud: 0.2 });
    y += p.towerShaftH;
    const cw = p.towerW * 0.9;
    box(g, tx, y, 0, cw + 1.4, 0.9, cw + 1.4, { color: 'cream' });
    y += 0.9;
    box(g, tx, y, 0, cw, p.clockH, cw, { color: 'sandstone' });
    for (const [face, dx, dz] of [['x+', cw / 2 + 0.12, 0], ['x-', -cw / 2 - 0.12, 0], ['z+', 0, cw / 2 + 0.12], ['z-', 0, -cw / 2 - 0.12]] as const) {
      disc(g, tx + dx, y + p.clockH / 2, dz, p.clockH * 0.36, face, 'white');
    }
    y += p.clockH;
    box(g, tx, y, 0, cw + 1.6, 0.9, cw + 1.6, { color: 'cream' });
    y += 0.9;
    box(g, tx, y, 0, cw * 0.82, p.belfryH, cw * 0.82, { color: 'limestone' });
    if (g.rules.detail >= 1) {
      windowBands(g, tx, y + 1, 0, cw * 0.82, cw * 0.82, 1, p.belfryH - 1.5, { color: 'glassDark', frac: 0.45, height: 0.8, proud: 0.2 });
    }
    y += p.belfryH;
    taperTower(g, tx, y, 0, cw * 0.92, cw * 0.92, 0.4, 0.4, p.spireH, { color: 'terracotta', capTint: 1 });
    pole(g, tx, y + p.spireH, 0, 0.3, 0.08, 6, { color: 'gold', cls: 'metal' });
    void y1;
  },
};
