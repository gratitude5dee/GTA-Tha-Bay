/**
 * lm.palace-fine-arts: a domed rotunda on a terrace, a curved colonnade around its back, two straight pergola wings and a lagoon in
 * front, original geometry from parameters. The lagoon side faces east (+X). No statues, urns, reliefs or inscriptions.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { box, circleRing, colonnade, dome, frustum, prism, stairs, type Geo, type V2 } from './kit/primitives.ts';

export interface PalaceParams extends BaseParams {
  rotundaR: number;
  rotundaH: number;
  domeH: number;
  terraceR: number;
  terraceH: number;
  colonnadeR: number;
  colonnadeH: number;
  colonnadeSpan: number;
  colonnadeCount: number;
  columnR: number;
  wingLength: number;
  wingSpacing: number;
  wingCount: number;
  lagoonRx: number;
  lagoonRz: number;
  lagoonX: number;
}

const G = -2;

export const palaceFineArts: RecipeDef<PalaceParams> = {
  id: 'lm.palace-fine-arts',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    rotundaR: 17, rotundaH: 26, domeH: 12, terraceR: 27, terraceH: 1.4, colonnadeR: 38, colonnadeH: 14, colonnadeSpan: 3.6, colonnadeCount: 34,
    columnR: 0.9, wingLength: 120, wingSpacing: 34, wingCount: 22, lagoonRx: 70, lagoonRz: 48, lagoonX: 100,
  },
  build(g: Geo, p: PalaceParams) {
    // terrace and rotunda
    prism(g, circleRing(0, 0, p.terraceR, p.terraceR, g.rules.segs(28)), G, p.terraceH, { color: 'sandstone' });
    const y0 = p.terraceH;
    frustum(g, 0, y0, 0, p.rotundaR + 1.5, p.rotundaR + 1.5, 2.2, 16, { color: 'limestone', smooth: false });
    frustum(g, 0, y0 + 2.2, 0, p.rotundaR, p.rotundaR, p.rotundaH - 2.2, 16, { color: 'plaster', smooth: false, capStart: false });
    // a colonnade ring around the rotunda drum
    colonnade(g, 0, y0 + 2.2, 0, p.rotundaR + 1.6, { color: 'limestone', from: 0, to: Math.PI * 2, count: 16, columnR: 0.7, height: p.rotundaH - 6, beam: 1.3, beamColor: 'cream' });
    const cornice = y0 + p.rotundaH;
    frustum(g, 0, cornice - 1.4, 0, p.rotundaR + 1.4, p.rotundaR + 1.4, 1.8, 16, { color: 'cream', smooth: false });
    dome(g, 0, cornice + 0.4, 0, p.rotundaR - 1.5, p.rotundaR - 1.5, p.domeH, 20, 8, { color: 'copperGreen', cls: 'metal' });
    // steps toward the lagoon
    stairs(g, p.terraceR - 2, G + 2, 0, 26, 8, 1.1, 0.18, { color: 'sandstone', yaw: Math.PI / 2 });
    // the curved colonnade behind the rotunda
    colonnade(g, 0, 0, 0, p.colonnadeR, {
      color: 'limestone', from: Math.PI - p.colonnadeSpan / 2, to: Math.PI + p.colonnadeSpan / 2, count: p.colonnadeCount, columnR: p.columnR, height: p.colonnadeH, beam: 1.8, beamColor: 'cream',
    });
    // two straight pergola wings reaching toward the lagoon
    for (const s of [-1, 1]) {
      const z = s * p.wingSpacing;
      const cols = g.rules.count(p.wingCount, 4);
      for (let i = 0; i < cols; i++) {
        const x = 8 + (p.wingLength * i) / (cols - 1);
        frustum(g, x, 0, z, p.columnR, p.columnR * 0.9, p.colonnadeH * 0.8, g.rules.detail >= 1 ? 6 : 4, { color: 'limestone', smooth: false });
      }
      box(g, 8 + p.wingLength / 2, p.colonnadeH * 0.8, z, p.wingLength + 3, 1.2, 3.6, { color: 'cream' });
      if (g.rules.detail >= 1) box(g, 8 + p.wingLength / 2, G, z, p.wingLength + 5, -G + 0.3, 6, { color: 'sandstone' });
    }
    // lagoon: a thin disc just above the ground
    const lagoon: V2[] = circleRing(p.lagoonX, 0, p.lagoonRx, p.lagoonRz, g.rules.segs(32));
    g.poly(lagoon.map(([x, z]) => [x, 0.15, z] as [number, number, number]), [0, 1, 0], 'water', 'glass');
  },
};
