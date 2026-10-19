/**
 * lm.coit-tower: a fluted concrete shaft on a low base with an observation gallery, on a hill (the hill is terrain). Original
 * geometry from parameters; no mural, relief or sculpture.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { windowBands } from './kit/facade.ts';
import { box, circleRing, colonnade, flutedShaft, frustum, prism, stairs, terrace, type Geo } from './kit/primitives.ts';

export interface CoitParams extends BaseParams {
  shaftR: number;
  shaftH: number;
  flutes: number;
  galleryR: number;
  galleryH: number;
  capH: number;
  baseW: number;
  baseD: number;
  baseH: number;
  plazaR: number;
}

const G = -2;

export const coitTower: RecipeDef<CoitParams> = {
  id: 'lm.coit-tower',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    shaftR: 6.2, shaftH: 46, flutes: 12, galleryR: 7.6, galleryH: 7.5, capH: 3.2,
    baseW: 24, baseD: 16, baseH: 7, plazaR: 24,
  },
  build(g: Geo, p: CoitParams) {
    // plaza and low base
    prism(g, circleRing(0, 0, p.plazaR, p.plazaR, g.rules.segs(20)), G, 0.35, { color: 'granite' });
    box(g, 0, G, 0, p.baseW, p.baseH - G, p.baseD, { color: 'whiteConcrete' });
    box(g, 0, p.baseH, 0, p.baseW - 2, 0.8, p.baseD - 2, { color: 'concrete' });
    stairs(g, 0, 0.35, p.baseD / 2 + 2, 10, 5, 0.9, 0.3, { color: 'granite', yaw: Math.PI });
    if (g.rules.detail >= 1) {
      windowBands(g, 0, 0.5, 0, p.baseW, p.baseD, 1, p.baseH - 1, { color: 'glassDark', frac: 0.5, height: 0.5 });
    }
    // the shaft, fluted, rising from the base
    const y0 = p.baseH;
    flutedShaft(g, 0, y0, 0, p.shaftR, p.shaftH, g.rules.segs(p.flutes), 0.08, { color: 'whiteConcrete', rTop: p.shaftR * 0.97 });
    // gallery: a drum slightly wider than the shaft with an arcade of dark openings
    const gy = y0 + p.shaftH;
    frustum(g, 0, gy, 0, p.galleryR, p.galleryR, p.galleryH, 20, { color: 'whiteConcrete', smooth: true, capStart: true });
    if (g.rules.detail >= 1) {
      colonnade(g, 0, gy + 1.2, 0, p.galleryR - 0.6, { color: 'glassDark', cls: 'glass', from: 0, to: Math.PI * 2, count: 16, columnR: 0.45, height: p.galleryH - 3, beam: 0.2 });
    }
    // cap
    frustum(g, 0, gy + p.galleryH, 0, p.galleryR + 0.5, p.galleryR - 1.2, p.capH, 20, { color: 'plaster', smooth: true });
    terrace(g, 0, gy + p.galleryH + p.capH, 0, 4, 4, 0.8, 0, { color: 'concrete' });
  },
};
