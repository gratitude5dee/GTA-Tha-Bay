/**
 * lm.twin-peaks: an overlook on a saddle between two grassy summits: a paved terrace with a low wall and a lookout plaza, stairs
 * to the summit path and light poles, and the two summits as hill mounds sunk into the terrain. Original geometry from parameters.
 * The terrain is baked from the elevation data; the mounds only show where it is flatter than the real hills.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { box, circleRing, hillMound, pole, prism, stairs, terrace, type Geo } from './kit/primitives.ts';

export interface TwinPeaksParams extends BaseParams {
  peakAx: number;
  peakAz: number;
  peakAH: number;
  peakAR: number;
  peakBx: number;
  peakBz: number;
  peakBH: number;
  peakBR: number;
  sink: number;
  terraceW: number;
  terraceD: number;
  plazaR: number;
  poles: number;
  stairRun: number;
}

const G = -2;

export const twinPeaks: RecipeDef<TwinPeaksParams> = {
  id: 'lm.twin-peaks',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    peakAx: -95, peakAz: 160, peakAH: 28, peakAR: 115, peakBx: 85, peakBz: 185, peakBH: 24, peakBR: 105, sink: 5, terraceW: 62, terraceD: 26, plazaR: 20, poles: 8, stairRun: 22,
  },
  build(g: Geo, p: TwinPeaksParams) {
    // the two summits
    hillMound(g, p.peakAx, 0, p.peakAz, p.peakAR, p.peakAR * 0.85, p.peakAH, 24, 6, p.sink, { color: 'dryGrass', yaw: 0.4 });
    hillMound(g, p.peakBx, 0, p.peakBz, p.peakBR, p.peakBR * 0.9, p.peakBH, 24, 6, p.sink, { color: 'hillGreen', yaw: -0.3 });
    // the overlook terrace with a wall at its edge
    terrace(g, 0, G, 0, p.terraceW, p.terraceD, 0.8 - G, 1.0, { color: 'granite' });
    // the lookout plaza: a disc with a low ring wall
    prism(g, circleRing(0, -p.terraceD / 2 - 12, p.plazaR, p.plazaR, g.rules.segs(20)), G, 1.0, { color: 'sandstone' });
    if (g.rules.detail >= 1) {
      const n = g.rules.count(16, 6);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        box(g, Math.cos(a) * (p.plazaR - 0.8), 1.0, -p.terraceD / 2 - 12 + Math.sin(a) * (p.plazaR - 0.8), 1.6, 1.2, 1.6, { color: 'granite' });
      }
    }
    // stairs up toward the summits
    stairs(g, 0, 0.8, p.terraceD / 2 + 0.5, 12, 14, p.stairRun / 14, 0.5, { color: 'granite', yaw: Math.PI });
    // path to the nearer summit: a pale strip
    box(g, -10, 0, p.terraceD / 2 + p.stairRun + 20, 5, 0.3, 40, { color: 'sand' });
    // light poles along the terrace edge
    const np = g.rules.count(p.poles, 3);
    for (let i = 0; i < np; i++) {
      const x = -p.terraceW / 2 + (p.terraceW * i) / (np - 1);
      pole(g, x, 0.8, -p.terraceD / 2 + 0.7, 0.18, 0.12, 5.5, { color: 'darkSteel', cls: 'metal', sides: 4 });
      box(g, x, 6.3, -p.terraceD / 2 + 0.7, 0.9, 0.3, 0.9, { color: 'lamp', cls: 'glass' });
    }
  },
};
