/**
 * lm.sutro-tower: a three-legged steel lattice broadcast mast on a hilltop, original geometry from parameters. Three tapering
 * legs on a triangular plan, braced in panels, two platforms, an antenna mast, painted in alternating bands. No markings.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { box, pole, strut, type Geo, type V3 } from './kit/primitives.ts';

export interface SutroParams extends BaseParams {
  baseR: number;
  waistR: number;
  waistH: number;
  topR: number;
  legsH: number;
  mastH: number;
  panels: number;
  legR: number;
  braceR: number;
  platforms: number[];
  platformR: number;
  bandEvery: number;
  footW: number;
}

const G = -2;

export const sutroTower: RecipeDef<SutroParams> = {
  id: 'lm.sutro-tower',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    baseR: 42, waistR: 17, waistH: 120, topR: 8, legsH: 180, mastH: 298, panels: 12, legR: 1.9, braceR: 0.7, platforms: [96, 142, 176], platformR: 14, bandEvery: 2, footW: 7,
  },
  build(g: Geo, p: SutroParams) {
    const n = g.rules.count(p.panels, 4);
    const radiusAt = (y: number): number => (y <= p.waistH ? p.baseR + (p.waistR - p.baseR) * (y / p.waistH) : p.waistR + (p.topR - p.waistR) * Math.min(1, (y - p.waistH) / (p.legsH - p.waistH)));
    const ys = Array.from({ length: n + 1 }, (_, i) => (p.legsH * i) / n);
    const angle = (k: number): number => -Math.PI / 2 + (k * Math.PI * 2) / 3;
    const pt = (k: number, y: number): V3 => [Math.cos(angle(k)) * radiusAt(y), y, Math.sin(angle(k)) * radiusAt(y)];
    const paint = (i: number): 'bridgeRed' | 'white' => (Math.floor(i / p.bandEvery) % 2 === 0 ? 'bridgeRed' : 'white');
    // feet
    for (let k = 0; k < 3; k++) {
      const f = pt(k, 0);
      box(g, f[0], G, f[2], p.footW, 2 - G, p.footW, { color: 'concrete' });
    }
    // legs, one strut per panel
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < n; i++) strut(g, pt(k, ys[i] as number), pt(k, ys[i + 1] as number), p.legR, { color: paint(i), cls: 'metal', sides: g.rules.detail >= 1 ? 4 : 3 });
    }
    // rings and diagonals
    for (let i = 1; i <= n; i++) {
      for (let k = 0; k < 3; k++) {
        const k2 = (k + 1) % 3;
        strut(g, pt(k, ys[i] as number), pt(k2, ys[i] as number), p.braceR, { color: paint(i), cls: 'metal', sides: 3 });
        if (i > 0 && g.rules.detail >= 1) {
          const lo = ys[i - 1] as number, hi = ys[i] as number;
          strut(g, pt(k, lo), pt(k2, hi), p.braceR * 0.8, { color: 'white', cls: 'metal', sides: 3 });
          if (g.rules.detail >= 2) strut(g, pt(k2, lo), pt(k, hi), p.braceR * 0.8, { color: 'white', cls: 'metal', sides: 3 });
        }
      }
    }
    // platforms
    for (const y of p.platforms) {
      const r = Math.min(p.platformR, radiusAt(y) + 5);
      const a: V3[] = [0, 1, 2].map((k) => [Math.cos(angle(k)) * r, y, Math.sin(angle(k)) * r] as V3);
      g.poly([a[0] as V3, a[2] as V3, a[1] as V3].map((q) => [q[0], q[1] + 0.9, q[2]] as V3), [0, 1, 0], 'steelGrey', 'metal');
      g.poly([a[0] as V3, a[1] as V3, a[2] as V3], [0, -1, 0], 'darkSteel', 'metal');
      for (let k = 0; k < 3; k++) {
        const b = a[k] as V3, c = a[(k + 1) % 3] as V3;
        g.poly([b, c, [c[0], c[1] + 0.9, c[2]], [b[0], b[1] + 0.9, b[2]]], [(b[0] + c[0]) / 2, 0, (b[2] + c[2]) / 2], 'white', 'metal');
      }
    }
    // antenna mast on the top ring, with a stepped upper section
    const topY = p.legsH;
    pole(g, 0, topY - 20, 0, 2.2, 1.0, p.mastH - topY + 20, { color: 'white', cls: 'metal', sides: g.rules.detail >= 1 ? 6 : 4 });
    const m = p.mastH - topY;
    for (let k = 0; k < 3; k++) {
      const a = angle(k);
      strut(g, pt(k, topY), [Math.cos(a) * 1.2, topY + m * 0.55, Math.sin(a) * 1.2], p.legR * 0.5, { color: 'bridgeRed', cls: 'metal', sides: 3 });
    }
  },
};
