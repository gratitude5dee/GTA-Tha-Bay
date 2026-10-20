/**
 * lm.powell-turntable: a street cable-car turntable: a circular steel plate in a paved pit with a timber push-bar, rails entering
 * on one side, a small wooden kiosk, a flower stand, bollards and handrails around the pit and a pair of street lamps. A plain
 * open-sided cable-car body (no numbers, no lettering) sits on the plate. The rails run along local X.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof } from './kit/facade.ts';
import { flatDisc, flatRect, lampPost } from './kit/landscape.ts';
import { box, frustum, pole, strut, type Geo } from './kit/primitives.ts';

export interface TurntableParams extends BaseParams {
  plateR: number;
  pitR: number;
  railL: number;
  gauge: number;
  carL: number;
  carW: number;
  carH: number;
  kioskW: number;
  bollards: number;
  plazaW: number;
}

export const powellTurntable: RecipeDef<TurntableParams> = {
  id: 'lm.powell-turntable',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    plateR: 3.6, pitR: 5.6, railL: 22, gauge: 1.0, carL: 8.4, carW: 2.6, carH: 2.9, kioskW: 3.4, bollards: 12, plazaW: 34,
  },
  build(g: Geo, p: TurntableParams) {
    flatRect(g, 0, 0.04, 0, p.plazaW, p.plazaW * 0.8, 'granite');
    flatDisc(g, 0, 0.08, 0, p.pitR, p.pitR, 18, 'asphalt');
    // the plate: a steel disc a little proud of the pit, with a timber bar across it
    frustum(g, 0, 0.1, 0, p.plateR, p.plateR, 0.3, 16, { color: 'darkSteel', cls: 'metal', smooth: true, capStart: false });
    box(g, 0, 0.4, 0, p.plateR * 2.1, 0.22, 0.36, { color: 'timber' });
    // rails on one side, running into the plate
    for (const s of [-1, 1]) box(g, -p.pitR - p.railL / 2, 0.06, s * p.gauge / 2, p.railL, 0.2, 0.12, { color: 'steelGrey', cls: 'metal' });
    for (let i = 0; i < g.rules.count(9, 3); i++) box(g, -p.pitR - (p.railL * (i + 0.5)) / 9, 0.04, 0, 0.5, 0.12, p.gauge + 1, { color: 'woodDark' });
    // the car: a plain open-sided body on the plate, its roof on posts and a bench along each side
    const cy = 0.55;
    box(g, 0, cy, 0, p.carL, 0.5, p.carW, { color: 'bridgeRed' });
    box(g, -p.carL * 0.38, cy + 0.5, 0, p.carL * 0.2, p.carH * 0.55, p.carW, { color: 'bridgeRed' });
    box(g, p.carL * 0.38, cy + 0.5, 0, p.carL * 0.2, p.carH * 0.55, p.carW, { color: 'bridgeRed' });
    for (const x of [-p.carL * 0.28, p.carL * 0.28]) for (const z of [-p.carW / 2 + 0.1, p.carW / 2 - 0.1]) pole(g, x, cy + 0.5, z, 0.07, 0.06, p.carH, { color: 'woodDark', sides: 3 });
    box(g, 0, cy + p.carH + 0.3, 0, p.carL * 0.7, 0.18, p.carW + 0.3, { color: 'paintCream' });
    if (g.rules.detail >= 1) for (const s of [-1, 1]) box(g, 0, cy + 0.5, s * (p.carW / 2 - 0.3), p.carL * 0.5, 0.45, 0.3, { color: 'woodDark' });
    strut(g, [p.carL * 0.46, cy + 0.5, 0], [p.carL * 0.46, cy + 1.8, 0], 0.08, { color: 'darkSteel', cls: 'metal', sides: 3 });
    // the kiosk and a flower stand
    box(g, 6, 0, -9, p.kioskW, 2.9, p.kioskW, { color: 'paintSage', top: false });
    roof(g, 6, 2.9, -9, p.kioskW + 0.8, p.kioskW + 0.8, 1.2, { color: 'slate', ridgeAlongX: true, overhang: 0.2 });
    box(g, 11, 0, -7, 3.2, 1.0, 1.4, { color: 'timber' });
    for (let i = 0; i < 3; i++) box(g, 10.2 + i * 0.8, 1.0, -7, 0.6, 0.5, 0.9, { color: i % 2 === 0 ? 'flower' : 'paintYellow' });
    // bollards and rails around the pit
    const n = g.rules.count(p.bollards, 4);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 0.18 + (Math.PI * 1.64 * i) / n;
      pole(g, Math.cos(a) * (p.pitR + 1.2), 0.04, Math.sin(a) * (p.pitR + 1.2), 0.17, 0.15, 1.0, { color: 'darkSteel', cls: 'metal', sides: 4 });
    }
    lampPost(g, -8, 0.04, 9, 5.2);
    lampPost(g, 9, 0.04, 9, 5.2);
  },
};
