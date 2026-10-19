/**
 * lm.bay-bridge-ybi: the east portal of a tunnel through an island, and a self-anchored suspension span with one tall bundled
 * tower and side-by-side decks that run out over the water on piers. Authored along +X (toward the east shore); y = 0 is the water
 * (`anchor: 'sea'`). Original geometry from parameters, no markings.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { archRing, box, strut, taperTower, type Geo, type V3 } from './kit/primitives.ts';
import { cable, catenary, hangers, pier, slab } from './kit/spans.ts';

export interface BayBridgeParams extends BaseParams {
  portalW: number;
  portalH: number;
  portalD: number;
  deckW: number;
  deckGap: number;
  deckThick: number;
  deckStartY: number;
  deckEndY: number;
  length: number;
  towerX: number;
  towerY: number;
  openingH: number;
  towerH: number;
  towerLegs: number;
  legPitch: number;
  legR: number;
  cableR: number;
  cableSag: number;
  westBack: number;
  eastSpan: number;
  pierEvery: number;
}

export const bayBridgeYbi: RecipeDef<BayBridgeParams> = {
  id: 'lm.bay-bridge-ybi',
  defaults: {
    yawDeg: 0, anchor: 'sea',
    portalW: 78, portalH: 34, portalD: 14, deckW: 24, deckGap: 6, deckThick: 5, deckStartY: 12, deckEndY: 24, length: 900, towerY: 50, openingH: 6,
    towerX: 260, towerH: 160, towerLegs: 4, legPitch: 5, legR: 1.7, cableR: 0.8, cableSag: 60, westBack: 150, eastSpan: 385, pierEvery: 58,
  },
  build(g: Geo, p: BayBridgeParams) {
    const lane = p.deckW + p.deckGap;
    const deckAt = (x: number): number =>
      x <= p.towerX ? p.deckStartY + (p.towerY - p.deckStartY) * (x / p.towerX) : p.towerY + (p.deckEndY - p.towerY) * Math.min(1, (x - p.towerX) / (p.length - p.towerX));
    // the tunnel portal: a concrete face with two arched openings and a hood
    box(g, -4, -3, 0, p.portalD, p.portalH + 3, p.portalW, { color: 'concrete' });
    box(g, -4, p.portalH, 0, p.portalD + 3, 2.2, p.portalW + 4, { color: 'whiteConcrete' });
    const face = p.portalD / 2 - 4;
    for (const s of [-1, 1]) {
      const zc = s * (lane / 2), r = p.deckW * 0.45, y0 = p.openingH;
      archRing(g, face - 0.2, y0, zc, r, 2.6, 2.5, Math.PI / 2, { color: 'granite' });
      const pts: V3[] = [[face + 0.1, 0, zc - r]];
      const m = Math.max(4, g.rules.segs(10));
      for (let k = 0; k <= m; k++) {
        const a = (k / m) * Math.PI;
        pts.push([face + 0.1, y0 + Math.sin(a) * r, zc - Math.cos(a) * r]);
      }
      pts.push([face + 0.1, 0, zc + r]);
      g.poly(pts, [1, 0, 0], 'glassDark', 'glass');
    }
    // two decks side by side, rising over the island and easing down to the east
    const n = g.rules.count(48, 12);
    for (const s of [-1, 1]) {
      const z = s * (lane / 2);
      const path: V3[] = [];
      for (let i = 0; i <= n; i++) {
        const x = (p.length * i) / n;
        path.push([x, deckAt(x), z]);
      }
      slab(g, path, p.deckW, p.deckThick, { color: 'concrete' });
      // edge rails
      if (g.rules.detail >= 1) slab(g, path.map((q) => [q[0], q[1] + 1.1, z + s * (p.deckW / 2 - 0.2)] as V3), 0.35, 1.1, { color: 'steelGrey', cls: 'metal' });
    }
    // piers
    const nPiers = g.rules.count(Math.floor(p.length / p.pierEvery), 5);
    for (let i = 1; i <= nPiers; i++) {
      const x = (p.length * i) / (nPiers + 1);
      if (Math.abs(x - p.towerX) < 12) continue;
      for (const s of [-1, 1]) pier(g, x, -4, s * (lane / 2), 4.5, 7, deckAt(x) - p.deckThick + 4, { color: 'concrete' });
    }
    // the tower: bundled shafts with shear links
    const legs = p.towerLegs;
    for (let i = 0; i < legs; i++) {
      const x = p.towerX + (i - (legs - 1) / 2) * p.legPitch;
      taperTower(g, x, -4, 0, p.legR * 2, p.legR * 2, p.legR * 1.3, p.legR * 1.3, p.towerH + 4, { color: 'steelGrey', cls: 'metal', round: g.rules.detail >= 1 ? 1 : 0, slices: 2 });
    }
    const links = g.rules.count(8, 3);
    for (let k = 0; k < links; k++) {
      const y = 18 + ((p.towerH - 40) * k) / links;
      for (let i = 0; i + 1 < legs; i++) {
        const x = p.towerX + (i - (legs - 1) / 2 + 0.5) * p.legPitch;
        box(g, x, y, 0, p.legPitch - p.legR * 2, 2.4, 2.2, { color: 'darkSteel', cls: 'metal' });
      }
    }
    box(g, p.towerX, p.towerH - 2, 0, legs * p.legPitch, 3, 4, { color: 'darkSteel', cls: 'metal' });
    // cables: from the west end of the deck over the tower, down to the east end; one per deck, with hangers
    const sides = g.rules.detail >= 2 ? 5 : 4;
    for (const s of [-1, 1]) {
      const z = s * (lane / 2);
      const top: V3 = [p.towerX, p.towerH - 4, s * 1.2];
      const west: V3 = [p.towerX - p.westBack, deckAt(p.towerX - p.westBack) + 1, z];
      const east: V3 = [p.towerX + p.eastSpan, deckAt(p.towerX + p.eastSpan) + 1, z];
      const cw = catenary(top, west, 18, g.rules.count(18, 6));
      const ce = catenary(top, east, p.cableSag, g.rules.count(36, 10));
      cable(g, cw, p.cableR, sides, { color: 'steelGrey', cls: 'metal' });
      cable(g, ce, p.cableR, sides, { color: 'steelGrey', cls: 'metal' });
      hangers(g, ce, (i) => deckAt(ce[i]![0]) + 1, 2, 0.16, { color: 'steelGrey', cls: 'metal' });
      hangers(g, cw, (i) => deckAt(cw[i]![0]) + 1, 2, 0.16, { color: 'steelGrey', cls: 'metal' });
      strut(g, top, [top[0], top[1], z], 0.5, { color: 'steelGrey', cls: 'metal' });
    }
  },
};
