/**
 * lm.lands-end-lookout: a cliff-top trail overlook: a timber viewing deck with railings on a rocky headland, a switchback path of
 * timber steps down the slope, benches, a low stone wall, wind-bent cypress trees and a few rock outcrops. Original geometry from
 * parameters; no markers, no signs, no stone-arrangement art. The sea is to the north-west.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { fence, flat, lampPost, tree } from './kit/landscape.ts';
import { box, hillMound, pole, stairs, type Geo } from './kit/primitives.ts';

export interface LookoutParams extends BaseParams {
  deckW: number;
  deckD: number;
  deckH: number;
  headR: number;
  headH: number;
  flights: number;
  flightRun: number;
  benches: number;
  cypress: number;
  outcrops: number;
}

export const landsEndLookout: RecipeDef<LookoutParams> = {
  id: 'lm.lands-end-lookout',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    deckW: 16, deckD: 10, deckH: 1.1, headR: 40, headH: 9, flights: 4, flightRun: 11, benches: 4, cypress: 10, outcrops: 5,
  },
  build(g: Geo, p: LookoutParams) {
    hillMound(g, 0, 0, 0, p.headR, p.headR * 0.8, p.headH, 16, 3, 5, { color: 'dryGrass', yaw: 0.5 });
    for (let i = 0; i < g.rules.count(p.outcrops, 2); i++) {
      const a = -Math.PI * 0.9 + i * 0.7;
      hillMound(g, Math.cos(a) * (p.headR * 0.8), 0, Math.sin(a) * (p.headR * 0.62), 6 + (i % 3) * 2, 5 + (i % 2) * 2, 4 + (i % 3) * 2, 7, 2, 2, { color: 'rock' });
    }
    // the deck on posts with a rail on three sides
    const y = p.headH * 0.55;
    box(g, 0, y, 0, p.deckW, p.deckH, p.deckD, { color: 'timber' });
    if (g.rules.detail >= 1) {
      for (const s of [-1, 1]) for (const t of [-1, 1]) pole(g, s * (p.deckW / 2 - 0.5), y - 4, t * (p.deckD / 2 - 0.5), 0.3, 0.25, 4 + p.deckH, { color: 'woodDark', sides: 4 });
    }
    fence(g, -p.deckW / 2, y + p.deckH, -p.deckD / 2, p.deckW / 2, -p.deckD / 2, 1.1, 2.4, { color: 'woodDark' });
    fence(g, -p.deckW / 2, y + p.deckH, -p.deckD / 2, -p.deckW / 2, p.deckD / 2, 1.1, 2.4, { color: 'woodDark' });
    fence(g, p.deckW / 2, y + p.deckH, -p.deckD / 2, p.deckW / 2, p.deckD / 2, 1.1, 2.4, { color: 'woodDark' });
    // benches on the deck
    for (let i = 0; i < g.rules.count(p.benches, 2); i++) box(g, -p.deckW / 2 + 3 + i * 3.4, y + p.deckH, p.deckD / 2 - 1.2, 2.4, 0.5, 0.7, { color: 'woodDark' });
    // the switchback path of timber steps: flights alternating direction down the slope
    const nf = g.rules.count(p.flights, 2);
    for (let i = 0; i < nf; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const z = p.deckD / 2 + 3 + i * 4.2;
      stairs(g, dir * -p.flightRun / 2, y - (i * y) / (nf + 1), z, 2.6, 10, p.flightRun / 10, 0.08, { color: 'timber', yaw: dir > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
    flat(g, [[-3, p.deckD / 2], [3, p.deckD / 2], [4, p.deckD / 2 + 4 * nf + 6], [-4, p.deckD / 2 + 4 * nf + 6]], 0.2, 'sand');
    // wind-bent cypress behind the deck
    for (let i = 0; i < g.rules.count(p.cypress, 3); i++) {
      const a = Math.PI * 0.1 + i * 0.44;
      tree(g, Math.cos(a) * (p.headR * 0.55), 0, Math.sin(a) * (p.headR * 0.5), 12 + (i % 3) * 3, 4.6, { cone: true, crown: i % 2 === 0 ? 'hedge' : 'hillGreen' });
    }
    if (g.rules.detail >= 1) lampPost(g, p.deckW / 2 + 4, 0.5, p.deckD / 2 + 3, 4.2);
    box(g, p.deckW / 2 + 8, 0, 6, 8, 0.9, 0.8, { color: 'granite' });
  },
};
