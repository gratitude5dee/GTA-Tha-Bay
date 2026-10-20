/**
 * lm.fort-point: a brick coastal fort of three tiers of arched gun openings around a parade ground, with a stair to the flat
 * roof, a seawall and a steel arch rising over it. Original geometry from parameters; no plaques, no lettering. The seaward face
 * (the arches) is the west side (-X).
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { flatRect } from './kit/landscape.ts';
import { arcade, box, stairs, strut, tube, type Geo, type V3 } from './kit/primitives.ts';

export interface FortParams extends BaseParams {
  w: number;
  d: number;
  wallT: number;
  tiers: number;
  tierH: number;
  bays: number;
  openingW: number;
  archSpan: number;
  archRise: number;
  archR: number;
  seawall: number;
  courtDrop: number;
}

const G = -2;

export const fortPoint: RecipeDef<FortParams> = {
  id: 'lm.fort-point',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    w: 58, d: 70, wallT: 9, tiers: 3, tierH: 6.4, bays: 9, openingW: 3.2, archSpan: 104, archRise: 26, archR: 1.4, seawall: 14, courtDrop: 1.2,
  },
  build(g: Geo, p: FortParams) {
    const top = p.tiers * p.tierH;
    const hw = p.w / 2, hd = p.d / 2;
    // four walls around a parade ground
    box(g, -hw + p.wallT / 2, G, 0, p.wallT, top - G, p.d, { color: 'brick' });
    box(g, hw - p.wallT / 2, G, 0, p.wallT, top - G, p.d, { color: 'brick' });
    box(g, 0, G, -hd + p.wallT / 2, p.w - 2 * p.wallT, top - G, p.wallT, { color: 'brick' });
    box(g, 0, G, hd - p.wallT / 2, p.w - 2 * p.wallT, top - G, p.wallT, { color: 'brick' });
    // the cornice and the parapet of the roof
    for (const s of [-1, 1]) {
      box(g, s * (hw - 0.5), top, 0, 1.4, 1.5, p.d + 1.4, { color: 'sandstone' });
      box(g, 0, top, s * (hd - 0.5), p.w - 2, 1.5, 1.4, { color: 'sandstone' });
    }
    flatRect(g, 0, p.courtDrop, 0, p.w - 2 * p.wallT, p.d - 2 * p.wallT, 'dirt');
    // tiers of arches on the seaward (west) face and the two short faces
    const bays = (face: number) => (face === 0 ? p.bays : Math.max(3, Math.round(p.bays * 0.55)));
    for (let t = 0; t < p.tiers; t++) {
      const y = t * p.tierH;
      arcade(g, -hw - 0.9, y, -hd + 4, -hw - 0.9, hd - 4, { color: 'sandstone', bays: bays(0), pierW: 1.5, depth: 1.8, pierH: p.tierH * 0.42, openingW: p.openingW, archT: 0.5, wallColor: 'brick' });
      for (const s of [-1, 1]) arcade(g, -hw + 5, y, s * (hd + 0.9), hw - 5, y, { color: 'sandstone', bays: bays(1), pierW: 1.5, depth: 1.8, pierH: p.tierH * 0.42, openingW: p.openingW, archT: 0.5, wallColor: 'brick' });
      if (t > 0) box(g, -hw - 0.5, y - 0.3, 0, 1.4, 0.6, p.d, { color: 'sandstone' });
    }
    // the stair to the roof, in the parade ground
    stairs(g, hw - p.wallT - 0.2, p.courtDrop, 0, 4.4, 16, 0.5, (top - p.courtDrop) / 16, { color: 'granite', yaw: Math.PI / 2 });
    // the seawall in front of the fort
    box(g, -hw - p.seawall, G, 0, 3.0, 4 - G, p.d + 24, { color: 'concrete' });
    // the steel arch over the fort: two ribs with a deck truss between, springing from the stone abutments
    const half = p.archSpan / 2;
    const segs = g.rules.segs(14);
    for (const x of [-10, 10]) {
      const pts = Array.from({ length: segs + 1 }, (_, i) => {
        const a = Math.PI * (i / segs);
        return [x, Math.sin(a) * p.archRise + top + 6, Math.cos(a) * half] as V3;
      });
      tube(g, pts, p.archR, 4, { color: 'bridgeRed', cls: 'metal' });
    }
    box(g, 0, G, -half, 26, top + 6 - G, 6, { color: 'concrete' });
    box(g, 0, G, half, 26, top + 6 - G, 6, { color: 'concrete' });
    if (g.rules.detail >= 1) {
      // cross ties between the two ribs
      for (const t of [0.25, 0.5, 0.75]) {
        const a = Math.PI * t;
        strut(g, [-10, Math.sin(a) * p.archRise + top + 6, Math.cos(a) * half], [10, Math.sin(a) * p.archRise + top + 6, Math.cos(a) * half], 0.4, { color: 'bridgeRed', cls: 'metal', sides: 3 });
      }
    }
  },
};
