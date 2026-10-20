/**
 * lm.golden-gate-bridge: a long-span suspension bridge from parameters: two portal towers, main and side-span cables with hangers,
 * a stiffened deck, two anchorages and approach viaducts. Authored along +X (south end at -X) and turned by `yawDeg` so the bridge
 * runs north-south; y = 0 is the water (`anchor: 'sea'`). Original geometry, no markings.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { box, strut, type Geo, type V3 } from './kit/primitives.ts';
import { cable, catenary, hangers, pier, slab, suspensionTower } from './kit/spans.ts';

export interface GoldenGateParams extends BaseParams {
  mainSpan: number;
  sideSpan: number;
  approach: number;
  towerH: number;
  deckY: number;
  deckW: number;
  deckThick: number;
  legGap: number;
  legW: number;
  legD: number;
  towerTaper: number;
  portals: number[];
  cableR: number;
  cableTopY: number;
  mainSag: number;
  sideSag: number;
  anchorY: number;
  hangerEvery: number;
  trussBay: number;
  approachEndY: number;
}

export const goldenGateBridge: RecipeDef<GoldenGateParams> = {
  id: 'lm.golden-gate-bridge',
  defaults: {
    yawDeg: 90, anchor: 'sea',
    mainSpan: 1280, sideSpan: 343, approach: 260, towerH: 227, deckY: 67, deckW: 27, deckThick: 7, legGap: 13.5, legW: 11, legD: 7.5, towerTaper: 0.62,
    portals: [0.2, 0.3, 0.42, 0.54, 0.66, 0.77, 0.87, 0.95], cableR: 0.7, cableTopY: 221, mainSag: 146, sideSag: 14, anchorY: 58, hangerEvery: 2, trussBay: 15.5,
    approachEndY: 38,
  },
  build(g: Geo, p: GoldenGateParams) {
    const half = p.mainSpan / 2;
    const xAnchor = half + p.sideSpan;
    const xEnd = xAnchor + p.approach;
    const rust = 'bridgeRed' as const;
    const steel = 'darkSteel' as const;

    // deck: level over the three spans, easing down along the approaches
    const nDeck = g.rules.count(96, 24);
    const deckPath: V3[] = [];
    for (let i = 0; i <= nDeck; i++) {
      const x = -xEnd + (2 * xEnd * i) / nDeck;
      const ax = Math.abs(x);
      const y = ax <= xAnchor ? p.deckY : p.deckY + (p.approachEndY - p.deckY) * ((ax - xAnchor) / p.approach);
      deckPath.push([x, y, 0]);
    }
    slab(g, deckPath, p.deckW, p.deckThick, { color: 'darkSteel' });
    // railings: two thin walls along the deck edges at the detail levels
    if (g.rules.detail >= 1) {
      for (const s of [-1, 1]) {
        slab(g, deckPath.map((q) => [q[0], q[1] + 1.4, s * (p.deckW / 2 - 0.3)] as V3), 0.4, 1.4, { color: rust, cls: 'metal' });
      }
    }
    // stiffening truss under the deck at the highest fidelity
    if (g.rules.detail >= 1) {
      const bays = g.rules.count(Math.floor((2 * xAnchor) / p.trussBay), 20);
      for (const s of [-1, 1]) {
        for (let i = 0; i < bays; i++) {
          const x0 = -xAnchor + ((2 * xAnchor) / bays) * i, x1 = -xAnchor + ((2 * xAnchor) / bays) * (i + 1);
          const z = s * (p.deckW / 2 - 0.5);
          strut(g, [x0, p.deckY - p.deckThick, z], [x1, p.deckY, z], 0.35, { color: rust, cls: 'metal', sides: 3 });
        }
      }
    }
    // approach viaduct piers
    const nPiers = g.rules.count(10, 3);
    for (const s of [-1, 1]) {
      for (let i = 0; i < nPiers; i++) {
        const x = s * (xAnchor + (p.approach * (i + 0.5)) / nPiers);
        const y = p.deckY + (p.approachEndY - p.deckY) * ((Math.abs(x) - xAnchor) / p.approach);
        pier(g, x, -2, 0, 5, p.deckW * 0.5, y - p.deckThick + 2, { color: 'concrete' });
      }
    }

    // towers, each on a pier of its own
    for (const s of [-1, 1]) {
      const x = s * half;
      pier(g, x, -6, 0, 22, p.legGap * 2 + 14, 14, { color: 'concrete' });
      suspensionTower(g, x, 4, 0, p.towerH - 4, { color: rust, cls: 'metal', halfGap: p.legGap, legW: p.legW, legD: p.legD, taper: p.towerTaper, portals: p.portals, portalH: 5.2 });
    }
    // anchorages
    for (const s of [-1, 1]) box(g, s * (xAnchor + 20), -4, 0, 56, p.anchorY + 4 - 8, p.deckW + 24, { color: 'whiteConcrete' });

    // cables: over the towers and down to the anchorages, hangers to the deck
    const sides = g.rules.detail >= 2 ? 6 : g.rules.detail === 1 ? 4 : 3;
    const nMain = g.rules.count(64, 16), nSide = g.rules.count(20, 6);
    for (const z of [-p.deckW / 2 + 0.2, p.deckW / 2 - 0.2]) {
      const top = (x: number): V3 => [x, p.cableTopY, z];
      const main = catenary(top(-half), top(half), p.mainSag, nMain);
      cable(g, main, p.cableR, sides, { color: rust, cls: 'metal' });
      hangers(g, main, () => p.deckY, p.hangerEvery, 0.14, { color: rust, cls: 'metal' });
      for (const s of [-1, 1]) {
        const a = top(s * half), b: V3 = [s * xAnchor, p.anchorY, z];
        const side = catenary(a, b, p.sideSag, nSide);
        cable(g, side, p.cableR, sides, { color: rust, cls: 'metal' });
        hangers(g, side, () => p.deckY, p.hangerEvery + 1, 0.12, { color: rust, cls: 'metal' });
      }
    }
    // cable bands at the tower saddles
    for (const s of [-1, 1]) for (const z of [-p.deckW / 2 + 0.2, p.deckW / 2 - 0.2]) box(g, s * half, p.cableTopY - 2, z, 5, 4, 3, { color: steel, cls: 'metal' });
  },
};
