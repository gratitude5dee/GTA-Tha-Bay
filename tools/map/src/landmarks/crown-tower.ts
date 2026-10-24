/**
 * lm.crown-tower: a fictional tall tower, a tapering rounded-rectangle shaft in glass bands with an open crown of fins at the top.
 * Original geometry from parameters; it stands for no company and carries no mark.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { box, strut, taperTower, type Geo, type V3 } from './kit/primitives.ts';

export interface CrownParams extends BaseParams {
  baseW: number;
  baseD: number;
  topW: number;
  topD: number;
  bodyH: number;
  crownH: number;
  fins: number;
  finR: number;
  bands: number;
  round: number;
  podiumH: number;
  plazaW: number;
}

const G = -2;

export const crownTower: RecipeDef<CrownParams> = {
  id: 'lm.crown-tower',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    baseW: 56, baseD: 52, topW: 36, topD: 34, bodyH: 290, crownH: 40, fins: 24, finR: 0.7, bands: 40, round: 0.55, podiumH: 6, plazaW: 100,
  },
  build(g: Geo, p: CrownParams) {
    box(g, 0, G, 0, p.plazaW, p.podiumH - G, p.plazaW * 0.8, { color: 'concrete' });
    const y0 = p.podiumH;
    taperTower(g, 0, y0, 0, p.baseW, p.baseD, p.topW, p.topD, p.bodyH, { color: 'steelGrey', round: p.round, slices: 2, cls: 'metal' });
    // glass bands, slightly proud of the shaft
    const n = g.rules.count(p.bands, 8);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.3) / n, t1 = (i + 0.8) / n;
      const w0 = p.baseW + (p.topW - p.baseW) * t + 0.5, d0 = p.baseD + (p.topD - p.baseD) * t + 0.5;
      const w1 = p.baseW + (p.topW - p.baseW) * t1 + 0.5, d1 = p.baseD + (p.topD - p.baseD) * t1 + 0.5;
      taperTower(g, 0, y0 + p.bodyH * t, 0, w0, d0, w1, d1, p.bodyH * (t1 - t), { color: 'glassBlue', cls: 'glass', round: p.round, capTint: 1 });
    }
    // the open crown: slanted fins around the top ring, closing toward a rounded cap
    const fins = g.rules.count(p.fins, 8);
    const yb = y0 + p.bodyH;
    const rx = p.topW / 2, rz = p.topD / 2;
    for (let i = 0; i < fins; i++) {
      const a = (i / fins) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const e = 2 + (1 - p.round) * 6;
      const ex = Math.sign(c) * Math.abs(c) ** (2 / e) * rx, ez = Math.sign(s) * Math.abs(s) ** (2 / e) * rz;
      const bot: V3 = [ex, yb, ez];
      const top: V3 = [ex * 0.8, yb + p.crownH, ez * 0.8];
      strut(g, bot, top, p.finR, { color: 'whiteConcrete', cls: 'metal', sides: 4 });
    }
    box(g, 0, yb + p.crownH, 0, p.topW * 0.7, 1.2, p.topD * 0.7, { color: 'steelGrey', cls: 'metal' });
    for (const [lvl, k] of [[0.45, 1], [0.8, 0.82]] as const) {
      const w = (p.topW + 1) * k, d = (p.topD + 1) * k;
      box(g, 0, yb + p.crownH * lvl, 0, w, 0.9, d, { color: 'whiteConcrete', cls: 'metal' });
    }
  },
};
