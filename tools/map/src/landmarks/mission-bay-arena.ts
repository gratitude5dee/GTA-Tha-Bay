/**
 * lm.mission-bay-arena: a fictional indoor arena: a wide low oval of glass and pale concrete under a shallow ribbed dome, ringed
 * by a plaza with entry canopies and four corner pylons. Original geometry from parameters; no name, no logo, no screen text.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { annulus, flatDisc, lampPost, tree } from './kit/landscape.ts';
import { box, circleRing, dome, frustum, pole, prism, stairs, strut, type Geo, type V3 } from './kit/primitives.ts';

export interface ArenaParams extends BaseParams {
  rx: number;
  rz: number;
  podiumH: number;
  glassH: number;
  domeH: number;
  ribs: number;
  canopies: number;
  canopyW: number;
  plazaRx: number;
  plazaRz: number;
  pylonH: number;
  trees: number;
}

const G = -2;

export const missionBayArena: RecipeDef<ArenaParams> = {
  id: 'lm.mission-bay-arena',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    rx: 66, rz: 50, podiumH: 4, glassH: 15, domeH: 15, ribs: 16, canopies: 4, canopyW: 20, plazaRx: 112, plazaRz: 92, pylonH: 38, trees: 14,
  },
  build(g: Geo, p: ArenaParams) {
    const n = 36;
    // plaza and podium
    flatDisc(g, 0, 0.05, 0, p.plazaRx, p.plazaRz, 32, 'granite');
    frustum(g, 0, G, 0, p.rx + 8, p.rx + 8, p.podiumH - G, n, { color: 'concrete', smooth: true, rz0: p.rz + 8, rz1: p.rz + 8 });
    annulus(g, 0, 0, p.rx + 8, p.rz + 8, p.podiumH, p.rx + 1, p.rz + 1, p.podiumH + 0.3, n, 'whiteConcrete');
    // the oval wall: a band of dark glass between two pale spandrels
    frustum(g, 0, p.podiumH, 0, p.rx, p.rx, 3, n, { color: 'whiteConcrete', smooth: true, rz0: p.rz, rz1: p.rz });
    frustum(g, 0, p.podiumH + 3, 0, p.rx, p.rx - 2, p.glassH - 6, n, { color: 'glassDark', cls: 'glass', smooth: true, rz0: p.rz, rz1: p.rz - 1.5 });
    frustum(g, 0, p.podiumH + p.glassH - 3, 0, p.rx - 2, p.rx - 3, 3, n, { color: 'whiteConcrete', smooth: true, rz0: p.rz - 1.5, rz1: p.rz - 2.5 });
    // the shallow dome and its ribs
    const yTop = p.podiumH + p.glassH;
    dome(g, 0, yTop, 0, p.rx - 3, p.rz - 2.5, p.domeH, n, 6, { color: 'steelGrey', cls: 'metal' });
    if (g.rules.detail >= 1) {
      const nr = g.rules.count(p.ribs, 6);
      for (let i = 0; i < nr; i++) {
        const a = (i / nr) * Math.PI;
        const mk = (t: number): V3 => [Math.cos(a) * (p.rx - 3) * Math.cos(t * Math.PI / 2), yTop + 0.5 + Math.sin(t * Math.PI / 2) * (p.domeH + 0.5), Math.sin(a) * (p.rz - 2.5) * Math.cos(t * Math.PI / 2)];
        for (let k = 0; k < 4; k++) {
          const t0 = k / 4, t1 = (k + 1) / 4;
          const a0 = mk(t0), a1 = mk(t1);
          strut(g, a0, a1, 0.35, { color: 'white', cls: 'metal', sides: 3 });
          strut(g, [-a0[0], a0[1], -a0[2]], [-a1[0], a1[1], -a1[2]], 0.35, { color: 'white', cls: 'metal', sides: 3 });
        }
      }
    }
    // entry canopies at the four compass points with a stair each
    const nc = g.rules.count(p.canopies, 2);
    for (let i = 0; i < nc; i++) {
      const a = (i / nc) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * (p.rx + 10), z = Math.sin(a) * (p.rz + 10);
      box(g, x, p.podiumH + 5.5, z, p.canopyW, 0.8, 12, { color: 'steelGrey', cls: 'metal', yaw: -a });
      if (g.rules.detail >= 1) {
        for (const s of [-1, 1]) pole(g, x - Math.sin(a) * s * (p.canopyW / 2 - 1), p.podiumH, z + Math.cos(a) * s * (p.canopyW / 2 - 1), 0.4, 0.3, 5.5, { color: 'white', cls: 'metal', sides: 4 });
      }
      stairs(g, Math.cos(a) * (p.rx + 20), 0, Math.sin(a) * (p.rz + 20), p.canopyW * 0.7, 5, 1.0, p.podiumH / 5, { color: 'concrete', yaw: Math.PI / 2 - a });
    }
    // four slender corner pylons
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      pole(g, sx * (p.rx * 0.78), G, sz * (p.rz * 0.92 + 12), 1.1, 0.5, p.pylonH - G, { color: 'white', cls: 'metal', sides: 4 });
      box(g, sx * (p.rx * 0.78), p.pylonH, sz * (p.rz * 0.92 + 12), 1.6, 1.0, 1.6, { color: 'lamp', cls: 'glass' });
    }
    prism(g, circleRing(0, 0, 6, 6, g.rules.segs(10)), 0.05, 0.5, { color: 'water', cls: 'glass' });
    if (g.rules.detail >= 1) {
      const nt = g.rules.count(p.trees, 4);
      for (let i = 0; i < nt; i++) {
        const a = (i / nt) * Math.PI * 2;
        tree(g, Math.cos(a) * (p.plazaRx - 8), 0, Math.sin(a) * (p.plazaRz - 8), 9, 3.2);
      }
      lampPost(g, p.rx * 0.5, 0, p.rz + 24, 5.5);
      lampPost(g, -p.rx * 0.5, 0, p.rz + 24, 5.5);
    }
  },
};
