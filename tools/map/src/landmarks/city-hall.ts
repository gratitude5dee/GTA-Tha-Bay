/**
 * lm.city-hall: a domed civic hall on a podium, original geometry from parameters. The facade faces east (+X); the long axis runs
 * north-south. A central pavilion with a pedimented portico and a grand stair, two end pavilions, a mansard band, and a dome on a
 * colonnaded drum with a lantern and a spire. No sculpture, no inscriptions, no reliefs.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof, windowBands } from './kit/facade.ts';
import { box, circleRing, colonnade, dome, frustum, pole, prism, stairs, type Geo, type V3 } from './kit/primitives.ts';

export interface CityHallParams extends BaseParams {
  length: number;
  depth: number;
  wingH: number;
  baseH: number;
  mansardH: number;
  podiumH: number;
  centerW: number;
  porticoProj: number;
  columns: number;
  endW: number;
  endProj: number;
  drumR: number;
  drumH: number;
  domeR: number;
  domeH: number;
  lanternH: number;
  floors: number;
}

const G = -2;

/** A pediment: a triangular gable over the width w (along Z) projecting d (along X), apex rise r, at y. */
function pediment(g: Geo, cx: number, y: number, cz: number, d: number, w: number, rise: number, color: 'limestone' | 'cream'): void {
  const t = 1.2;
  const a: V3 = [cx - d / 2, y, cz - w / 2], b: V3 = [cx - d / 2, y, cz + w / 2], c: V3 = [cx - d / 2, y + rise, cz];
  const a2: V3 = [cx + d / 2, y, cz - w / 2], b2: V3 = [cx + d / 2, y, cz + w / 2], c2: V3 = [cx + d / 2, y + rise, cz];
  g.poly([a2, b2, c2], [1, 0, 0], color);
  g.poly([a, b, c], [-1, 0, 0], color);
  g.poly([a, a2, c2, c], [0, 0.6, -1], color);
  g.poly([b2, b, c, c2], [0, 0.6, 1], color);
  void t;
}

export const cityHall: RecipeDef<CityHallParams> = {
  id: 'lm.city-hall',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    length: 124, depth: 52, wingH: 27, baseH: 9, mansardH: 5, podiumH: 2.2, centerW: 46, porticoProj: 9, columns: 10,
    endW: 26, endProj: 4, drumR: 15, drumH: 18, domeR: 13.5, domeH: 20, lanternH: 11, floors: 4,
  },
  build(g: Geo, p: CityHallParams) {
    const hl = p.length / 2;
    // podium
    box(g, 0, G, 0, p.depth + 8, p.podiumH - G, p.length + 8, { color: 'granite' });
    const y0 = p.podiumH;
    // main block: a rusticated base and the upper stories
    box(g, 0, y0, 0, p.depth, p.baseH, p.length, { color: 'granite', top: false });
    box(g, 0, y0 + p.baseH, 0, p.depth - 0.8, p.wingH - p.baseH, p.length - 0.8, { color: 'limestone' });
    const eave = y0 + p.wingH;
    box(g, 0, eave, 0, p.depth + 1.2, 1.0, p.length + 1.2, { color: 'cream' });
    // mansard band and its roof
    box(g, 0, eave + 1, 0, p.depth - 5, p.mansardH, p.length - 5, { color: 'slate' });
    roof(g, 0, eave + 1 + p.mansardH, 0, p.depth - 5, p.length - 5, 2.5, { color: 'slate', ridgeAlongX: false });
    // windows
    windowBands(g, 0, y0 + 1, 0, p.depth, p.length, p.floors, (p.wingH - 1) / p.floors, { color: 'glassDark', sides: ['x-', 'z+', 'z-'], frac: 0.9 });
    windowBands(g, p.depth / 2 - 0.2, y0 + 1, 0, 0.6, p.length, p.floors, (p.wingH - 1) / p.floors, { color: 'glassDark', sides: ['x+'], frac: 0.9 });
    // end pavilions
    for (const s of [-1, 1]) {
      const z = s * (hl - p.endW / 2);
      box(g, p.depth / 2 + p.endProj / 2 - 0.4, y0, z, p.endProj + 0.8, p.wingH + 1.5, p.endW, { color: 'limestone' });
      roof(g, p.depth / 2 + p.endProj / 2 - 0.4, y0 + p.wingH + 1.5, z, p.endProj + 1.2, p.endW + 1.2, 2.2, { color: 'slate', ridgeAlongX: false });
    }
    // central pavilion with the portico
    const pcx = p.depth / 2 + p.porticoProj / 2;
    box(g, pcx - 0.5, y0, 0, p.porticoProj + 1, p.wingH + 3, p.centerW, { color: 'cream' });
    // the columns of the portico along the front
    const cols = g.rules.count(p.columns, 4);
    const colH = p.wingH - 2;
    for (let i = 0; i < cols; i++) {
      const z = -p.centerW / 2 + 2 + ((p.centerW - 4) * i) / (cols - 1);
      frustum(g, p.depth / 2 + p.porticoProj + 0.8, y0, z, 1.0, 0.9, colH, g.rules.detail >= 2 ? 10 : 6, { color: 'limestone', smooth: g.rules.detail >= 1 });
    }
    box(g, p.depth / 2 + p.porticoProj + 0.2, y0 + colH, 0, 3, 2.4, p.centerW + 2, { color: 'cream' });
    pediment(g, p.depth / 2 + p.porticoProj, y0 + colH + 2.4, 0, 3.4, p.centerW + 2, 6.5, 'limestone');
    stairs(g, p.depth / 2 + p.porticoProj + 8, y0 - 0.0, 0, p.centerW * 0.7, 8, 1.1, (y0) / 8, { color: 'granite', yaw: Math.PI / 2 });
    // drum, colonnade, dome, lantern
    const dBase = eave + 1 + p.mansardH + 2.5;
    prism(g, circleRing(0, 0, p.drumR + 4.2, p.drumR + 4.2, g.rules.segs(24)), eave - 1, dBase, { color: 'cream' });
    frustum(g, 0, dBase, 0, p.drumR, p.drumR, p.drumH, 24, { color: 'limestone', smooth: true, capStart: false });
    colonnade(g, 0, dBase, 0, p.drumR + 1.6, { color: 'limestone', from: 0, to: Math.PI * 2, count: 24, columnR: 0.55, height: p.drumH * 0.7, beam: 1.2, beamColor: 'cream' });
    const dTop = dBase + p.drumH;
    frustum(g, 0, dTop - 0.2, 0, p.drumR + 0.8, p.drumR + 0.8, 1.2, 24, { color: 'cream', smooth: true, capStart: false });
    dome(g, 0, dTop + 1, 0, p.domeR, p.domeR, p.domeH, 24, 10, { color: 'copperGreen', cls: 'metal' });
    const lTop = dTop + 1 + p.domeH;
    frustum(g, 0, lTop - 0.5, 0, 2.6, 2.1, p.lanternH * 0.55, 8, { color: 'gold', cls: 'metal', smooth: false });
    dome(g, 0, lTop - 0.5 + p.lanternH * 0.55, 0, 2.3, 2.3, 2.2, 8, 3, { color: 'gold', cls: 'metal' });
    pole(g, 0, lTop - 0.5 + p.lanternH * 0.55 + 2, 0, 0.4, 0.1, p.lanternH * 0.5, { color: 'gold', cls: 'metal', sides: 4 });
  },
};
