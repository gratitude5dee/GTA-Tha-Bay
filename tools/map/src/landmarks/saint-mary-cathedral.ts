/**
 * lm.saint-mary-cathedral: a modern cathedral whose tall roof is four sweeping concave surfaces rising from a square plan to a
 * high central point, with a cross of clear glass running up each face, a low podium, a detached square bell tower and a wide
 * plaza with steps. Original geometry from parameters; no cross figure, no sculpture, no inscriptions. The roof silhouette is the
 * landmark.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { flatRect, lampPost, tree } from './kit/landscape.ts';
import { box, pole, skin, stairs, taperTower, type Geo, type V3 } from './kit/primitives.ts';

export interface SaintMaryParams extends BaseParams {
  plan: number;
  podiumH: number;
  roofH: number;
  curve: number;
  slices: number;
  glassW: number;
  topPlan: number;
  towerW: number;
  towerH: number;
  plazaW: number;
  steps: number;
  trees: number;
}

const G = -2;

export const saintMaryCathedral: RecipeDef<SaintMaryParams> = {
  id: 'lm.saint-mary-cathedral',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    plan: 74, podiumH: 3.2, roofH: 56, curve: 1.9, slices: 14, glassW: 3.2, topPlan: 3.6, towerW: 7, towerH: 30, plazaW: 130, steps: 9, trees: 8,
  },
  build(g: Geo, p: SaintMaryParams) {
    const hp = p.plan / 2;
    flatRect(g, 0, 0.05, 0, p.plazaW, p.plazaW, 'granite');
    // podium and a drum of concrete wall under the roof
    box(g, 0, G, 0, p.plan + 8, p.podiumH - G, p.plan + 8, { color: 'whiteConcrete' });
    box(g, 0, p.podiumH, 0, p.plan - 2, 5, p.plan - 2, { color: 'concrete', top: false });
    // the roof: a square section whose half-width falls along a concave curve from the walls to the crown
    const y0 = p.podiumH + 5;
    const n = g.rules.count(p.slices, 4);
    const half = (t: number): number => (hp - 1) * (1 - t) ** p.curve + (p.topPlan / 2) * t;
    const ring = (t: number): V3[] => {
      const h = half(t), y = y0 + p.roofH * t;
      return [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h]];
    };
    const rings: V3[][] = [];
    for (let i = 0; i <= n; i++) rings.push(ring(i / n));
    skin(g, rings, { color: 'whiteConcrete', smooth: false, capEnd: true });
    // a band of clear glass up the middle of each face: four thin strips following the curve
    if (g.rules.detail >= 1) {
      const gw = p.glassW / 2;
      for (const [ax, az, nx, nz] of [[1, 0, 0, 1], [-1, 0, 0, -1], [0, 1, -1, 0], [0, -1, 1, 0]] as const) {
        const strip: V3[][] = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n, h = half(t) + 0.15, y = y0 + p.roofH * t;
          const w = gw * (1 - t * 0.7);
          // face centre is at (ax*h, az*h); the strip runs sideways along (nx, nz)
          strip.push([[ax * h + nx * -w, y, az * h + nz * -w], [ax * h + nx * w, y, az * h + nz * w]]);
        }
        for (let i = 0; i < n; i++) {
          const a = strip[i] as V3[], b = strip[i + 1] as V3[];
          g.poly([a[0] as V3, a[1] as V3, b[1] as V3, b[0] as V3], [ax, 0.5, az], 'glassBlue', 'glass');
        }
      }
    }
    // the crown: a slim pole at the apex
    pole(g, 0, y0 + p.roofH, 0, 0.5, 0.15, 7, { color: 'steelGrey', cls: 'metal', sides: 4 });
    // the detached bell tower in front of the plan, a plain square shaft with a slotted top
    const tx = hp + 18, tz = -hp * 0.2;
    taperTower(g, tx, G, tz, p.towerW, p.towerW, p.towerW * 0.85, p.towerW * 0.85, p.towerH - G, { color: 'whiteConcrete' });
    box(g, tx, p.towerH - 6, tz + p.towerW / 2 - 0.2, 2.2, 5, 0.5, { color: 'glassDark', cls: 'glass' });
    // steps down to the plaza on the south side and a few trees at the corners
    stairs(g, 0, 0, hp + 6 + p.steps * 0.6, 26, p.steps, 0.6, p.podiumH / p.steps, { color: 'granite' });
    for (const [x, z] of [[-1, -1], [1, 1], [-1, 1], [1, -1]] as const) tree(g, x * (p.plazaW / 2 - 8), 0.05, z * (p.plazaW / 2 - 8), 9, 3.6);
    if (g.rules.detail >= 1) for (let i = 0; i < g.rules.count(p.trees, 2); i++) lampPost(g, -hp + i * (p.plan / Math.max(1, p.trees - 1)), 0.05, hp + 14, 5);
  },
};
