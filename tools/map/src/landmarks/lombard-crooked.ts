/**
 * lm.lombard-crooked: one steep city block of a street that drops through eight hairpin turns: a terraced embankment, the brick
 * roadway zig-zagging down it between planted beds, stairs along both sides and a row of narrow houses at each edge. Original
 * geometry from parameters. The slope descends toward +Z (south); the embankment is sunk so it meets the terrain on a real hill.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof, windowBands } from './kit/facade.ts';
import { box, pole, stairs, type Geo, type V3 } from './kit/primitives.ts';
import { slab } from './kit/spans.ts';

export interface LombardParams extends BaseParams {
  length: number;
  width: number;
  drop: number;
  turns: number;
  roadW: number;
  swing: number;
  sink: number;
  houses: number;
  houseW: number;
  houseD: number;
  houseH: number;
  bedH: number;
}

export const lombardCrooked: RecipeDef<LombardParams> = {
  id: 'lm.lombard-crooked',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    length: 150, width: 26, drop: 20, turns: 8, roadW: 4.2, swing: 9.5, sink: 3, houses: 6, houseW: 8.5, houseD: 13, houseH: 11, bedH: 0.9,
  },
  build(g: Geo, p: LombardParams) {
    const z0 = -p.length / 2, z1 = p.length / 2;
    const yAt = (z: number): number => p.drop * (1 - (z - z0) / p.length);
    // the embankment: a sloped slab
    const top = (z: number): number => yAt(z);
    const steps = g.rules.count(p.turns * 2, 4);
    const hw = p.width / 2;
    const pts = Array.from({ length: steps + 1 }, (_, i) => z0 + (p.length * i) / steps);
    for (let i = 0; i < steps; i++) {
      const za = pts[i] as number, zb = pts[i + 1] as number;
      g.quad([-hw, top(za), za], [hw, top(za), za], [hw, top(zb), zb], [-hw, top(zb), zb], [0, 1, 0], 'hedge');
    }
    const lowZ = z1;
    for (const s of [-1, 1]) {
      const poly: V3[] = [[s * hw, -p.sink, z0], [s * hw, -p.sink, z1], ...pts.slice().reverse().map((z) => [s * hw, top(z), z] as V3)];
      g.poly(poly, [s, 0, 0], 'rock');
    }
    g.quad([-hw, -p.sink, z0], [hw, -p.sink, z0], [hw, top(z0), z0], [-hw, top(z0), z0], [0, 0, -1], 'rock');
    g.quad([-hw, -p.sink, lowZ], [hw, -p.sink, lowZ], [hw, top(lowZ), lowZ], [-hw, top(lowZ), lowZ], [0, 0, 1], 'rock');
    // the road: control points zig-zag across the swing, rounded by two Chaikin passes
    let ctrl: V3[] = [[0, 0, z0]];
    for (let i = 0; i <= p.turns; i++) {
      const z = z0 + ((i + 0.5) / (p.turns + 1)) * p.length;
      ctrl.push([(i % 2 === 0 ? -1 : 1) * p.swing, 0, z]);
    }
    ctrl.push([0, 0, z1]);
    for (let pass = 0; pass < 1; pass++) {
      const next: V3[] = [ctrl[0] as V3];
      for (let i = 0; i + 1 < ctrl.length; i++) {
        const a = ctrl[i] as V3, b = ctrl[i + 1] as V3;
        next.push([a[0] * 0.75 + b[0] * 0.25, 0, a[2] * 0.75 + b[2] * 0.25], [a[0] * 0.25 + b[0] * 0.75, 0, a[2] * 0.25 + b[2] * 0.75]);
      }
      next.push(ctrl[ctrl.length - 1] as V3);
      ctrl = next;
    }
    const road: V3[] = ctrl.map((c) => [c[0], yAt(c[2]) + 0.25, c[2]] as V3);
    slab(g, road, p.roadW, 0.4, { color: 'brick' });
    // planted beds beside each run of road (every other point), flowers on top
    const stride = g.rules.detail >= 1 ? 2 : 4;
    for (let i = 2; i + 1 < road.length - 2; i += stride) {
      const r = road[i] as V3;
      const side = r[0] >= 0 ? 1 : -1;
      box(g, r[0] - side * (p.roadW * 0.5 + 2.2), r[1] - 0.2, r[2], 3.2, p.bedH, 3.2, { color: 'hedge' });
      if (g.rules.detail >= 2) box(g, r[0] - side * (p.roadW * 0.5 + 2.2), r[1] + p.bedH - 0.2, r[2], 2.4, 0.3, 2.4, { color: 'flower' });
    }
    // stairs down both edges
    for (const s of [-1, 1]) stairs(g, s * (hw - 1.2), 0, z1 - 1, 1.8, 20, p.length / 20, p.drop / 20, { color: 'concrete', yaw: 0 });
    // houses along both edges of the block
    const n = g.rules.count(p.houses, 2);
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < n; i++) {
        const z = z0 + ((i + 0.5) * p.length) / n;
        const x = s * (hw + p.houseD / 2 + 1);
        const base = yAt(z) - 1;
        box(g, x, -p.sink, z, p.houseD, base + p.houseH + p.sink, p.houseW, { color: i % 2 === 0 ? 'plaster' : 'sandstone' });
        roof(g, x, base + p.houseH, z, p.houseD + 0.6, p.houseW + 0.6, 2.6, { color: 'terracotta', ridgeAlongX: true });
        windowBands(g, x, base + 1.5, z, p.houseD, p.houseW, 2, 4.2, { color: 'glassDark', sides: [s > 0 ? 'x-' : 'x+'], frac: 0.7, height: 0.45 });
      }
    }
    // lamp posts down the middle
    if (g.rules.detail >= 1) {
      const nl = g.rules.count(6, 2);
      for (let i = 0; i < nl; i++) {
        const z = z0 + ((i + 0.5) * p.length) / nl;
        pole(g, 0, yAt(z), z, 0.14, 0.1, 4.6, { color: 'darkSteel', cls: 'metal', sides: 4 });
      }
    }
  },
};
