/**
 * lm.park-bandshell: an open-air concert shell: a ribbed half-dome of pale concrete over a raised stage, a sunken oval lawn of
 * curved seating terraces in front, a low colonnade of pergolas along the long sides and a ring of trees. Original geometry from
 * parameters; no plaques, no lettering, no sculpture. The shell opens to the east (+X).
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { annulus, flatDisc, tree } from './kit/landscape.ts';
import { box, circleRing, frustum, prism, skin, stairs, strut, type Geo, type V3 } from './kit/primitives.ts';

export interface ShellParams extends BaseParams {
  shellR: number;
  shellH: number;
  stageD: number;
  stageH: number;
  ovalRx: number;
  ovalRz: number;
  terraces: number;
  ribs: number;
  pergolaL: number;
  columns: number;
  trees: number;
}

const G = -2;

export const parkBandshell: RecipeDef<ShellParams> = {
  id: 'lm.park-bandshell',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    shellR: 17, shellH: 15, stageD: 16, stageH: 1.6, ovalRx: 56, ovalRz: 34, terraces: 4, ribs: 10, pergolaL: 80, columns: 14, trees: 14,
  },
  build(g: Geo, p: ShellParams) {
    // the stage: a raised half-disc in front of the shell
    prism(g, [[-p.shellR - 1, -p.shellR - 2], [p.stageD, -p.shellR - 2], [p.stageD + 5, -p.shellR * 0.5], [p.stageD + 5, p.shellR * 0.5], [p.stageD, p.shellR + 2], [-p.shellR - 1, p.shellR + 2]], G, p.stageH, { color: 'concrete' });
    // the shell: a half-dome around the vertical axis, open toward +X; two faces so it reads from both sides
    const m = g.rules.segs(9);
    const k = Math.max(3, g.rules.segs(8));
    const meridian = (a: number): V3[] => Array.from({ length: k + 1 }, (_, i) => {
      const t = i / k;
      const ang = t * (Math.PI / 2);
      const r = Math.cos(ang) * p.shellR;
      return [-Math.cos(a) * r, p.stageH + Math.sin(ang) * p.shellH, Math.sin(a) * r] as V3;
    });
    // `a` runs from -90 to +90 degrees: the half of the circle behind the stage opening (x <= 0)
    const rings: V3[][] = [];
    for (let i = 0; i <= m; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / m;
      rings.push(meridian(a));
    }
    skin(g, rings, { color: 'whiteConcrete', smooth: true, open: true, capEnd: false });
    // inner face: the same surface a hair inside, in a darker tone, facing the audience
    const inner = rings.map((r) => r.map((q) => [q[0] * 0.985, q[1] - 0.2, q[2] * 0.985] as V3));
    skin(g, inner.slice().reverse(), { color: 'sand', smooth: true, open: true, capEnd: false });
    // ribs on the face of the shell, and the back wall
    if (g.rules.detail >= 1) {
      const nr = g.rules.count(p.ribs, 4);
      for (let i = 0; i <= nr; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / nr;
        const pts = meridian(a);
        for (let j = 0; j + 1 < pts.length; j++) strut(g, [pts[j]![0] * 0.99, pts[j]![1] + 0.1, pts[j]![2] * 0.99], [pts[j + 1]![0] * 0.99, pts[j + 1]![1] + 0.1, pts[j + 1]![2] * 0.99], 0.25, { color: 'granite', sides: 3 });
      }
    }
    box(g, 0, G, 0, 1.0, p.stageH + 2 - G, p.shellR * 2, { color: 'concrete' });
    // the oval lawn in front, stepping down in curved terraces
    const cx = p.stageD + 5 + p.ovalRx;
    flatDisc(g, cx, 0.05, 0, p.ovalRx + 6, p.ovalRz + 6, 28, 'granite');
    const nt = g.rules.count(p.terraces, 2);
    for (let i = 0; i < nt; i++) {
      const f0 = 1 - i / nt, f1 = 1 - (i + 1) / nt;
      annulus(g, cx - p.ovalRx * 0.1, 0, p.ovalRx * f0, p.ovalRz * f0, 0.15 + (nt - i) * 0.12, p.ovalRx * f1, p.ovalRz * f1, 0.15 + (nt - i - 1) * 0.12, 28, i % 2 === 0 ? 'lawn' : 'hillGreen', { from: -Math.PI * 0.62, to: Math.PI * 0.62 });
    }
    stairs(g, p.stageD + 8, 0, 0, 12, 4, 0.8, p.stageH / 4, { color: 'concrete', yaw: -Math.PI / 2 });
    // pergola colonnades along the long sides
    const nc = g.rules.count(p.columns, 4);
    for (const s of [-1, 1]) {
      for (let i = 0; i < nc; i++) {
        const x = p.stageD + 6 + ((p.pergolaL - 6) * i) / (nc - 1);
        frustum(g, x, 0, s * (p.ovalRz + 12), 0.5, 0.45, 5.2, 6, { color: 'limestone', smooth: false });
      }
      box(g, p.stageD + 6 + p.pergolaL / 2, 5.2, s * (p.ovalRz + 12), p.pergolaL + 1, 0.7, 2.6, { color: 'cream' });
    }
    // the ring of trees beyond
    const n = g.rules.count(p.trees, 5);
    for (const [x, z] of circleRing(cx, 0, p.ovalRx + 22, p.ovalRz + 26, n)) tree(g, x, 0, z, 13, 4.6, { crown: 'hedge' });
  },
};
