/**
 * lm.dolores-park: a sloping city park: a tilted lawn between two streets with a row of tall palms along the street, a tennis
 * court with a fence, a playground of coloured blocks, curving paths, a small low clubhouse and scattered trees. Original
 * geometry from parameters; no sculpture, no signs. The park rises toward the west (-X); the palm street is on the east side.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof } from './kit/facade.ts';
import { fence, flat, flatRect, lampPost, palm, tree } from './kit/landscape.ts';
import { box, type Geo, type V3 } from './kit/primitives.ts';
import type { ColorName } from './kit/palette.ts';

export interface DoloresParams extends BaseParams {
  w: number;
  d: number;
  rise: number;
  palms: number;
  palmH: number;
  trees: number;
  courtW: number;
  courtD: number;
  blocks: number;
  hutW: number;
  hutD: number;
  cells: number;
}

const G = -2;
const BLOCK: readonly ColorName[] = ['bridgeRed', 'paintYellow', 'paintBlue', 'paintSage', 'flower'];

export const doloresPark: RecipeDef<DoloresParams> = {
  id: 'lm.dolores-park',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    w: 96, d: 118, rise: 5, palms: 12, palmH: 19, trees: 12, courtW: 18, courtD: 36, blocks: 7, hutW: 14, hutD: 8, cells: 6,
  },
  build(g: Geo, p: DoloresParams) {
    const hw = p.w / 2, hd = p.d / 2;
    const yAt = (x: number): number => 0.3 + p.rise * (1 - (x + hw) / p.w); // high at the west edge, level with the street at the east
    // the lawn: a tilted sheet cut into cells so the slope reads
    const n = g.rules.count(p.cells, 2);
    for (let i = 0; i < n; i++) {
      const x0 = -hw + (p.w * i) / n, x1 = -hw + (p.w * (i + 1)) / n;
      const q: V3[] = [[x0, yAt(x0), -hd], [x1, yAt(x1), -hd], [x1, yAt(x1), hd], [x0, yAt(x0), hd]];
      g.poly(q, [0, 1, 0], i % 2 === 0 ? 'lawn' : 'hillGreen');
    }
    // the retaining slope under the west edge and the street along the east edge
    g.poly([[-hw, G, -hd], [-hw, G, hd], [-hw, yAt(-hw), hd], [-hw, yAt(-hw), -hd]], [-1, 0, 0], 'rock');
    flatRect(g, hw + 8, 0.05, 0, 12, p.d + 20, 'asphalt');
    // a diagonal path across the park
    flat(g, [[-hw * 0.9, 0], [-hw * 0.9 + 3, 0], [hw * 0.9, hd * 0.8], [hw * 0.9 - 3, hd * 0.8]].map(([x, z]) => [x as number, z as number] as [number, number]), 0.5 + p.rise * 0.45, 'sand');
    // tennis court
    flatRect(g, -hw * 0.45, yAt(-hw * 0.45) + 0.05, -hd * 0.45, p.courtW, p.courtD, 'seatGreen');
    if (g.rules.detail >= 1) {
      const x = -hw * 0.45, z = -hd * 0.45, y = yAt(x);
      fence(g, x - p.courtW / 2 - 1, y, z - p.courtD / 2 - 1, x + p.courtW / 2 + 1, z - p.courtD / 2 - 1, 3.4, 3);
      fence(g, x - p.courtW / 2 - 1, y, z + p.courtD / 2 + 1, x + p.courtW / 2 + 1, z + p.courtD / 2 + 1, 3.4, 3);
      fence(g, x - p.courtW / 2 - 1, y, z - p.courtD / 2 - 1, x - p.courtW / 2 - 1, z + p.courtD / 2 + 1, 3.4, 3);
      fence(g, x + p.courtW / 2 + 1, y, z - p.courtD / 2 - 1, x + p.courtW / 2 + 1, z + p.courtD / 2 + 1, 3.4, 3);
    }
    // the playground
    const nb = g.rules.count(p.blocks, 3);
    for (let i = 0; i < nb; i++) {
      const x = hw * 0.1 + (i % 4) * 4.5, z = hd * 0.5 + Math.floor(i / 4) * 5;
      box(g, x, yAt(x), z, 3 + (i % 2), 1.6 + (i % 3) * 0.7, 3, { color: BLOCK[i % BLOCK.length] as ColorName });
    }
    // the clubhouse
    const hx = hw * 0.3, hz = -hd * 0.35;
    box(g, hx, yAt(hx) - 0.2, hz, p.hutW, 4.6, p.hutD, { color: 'paintCream' });
    roof(g, hx, yAt(hx) + 4.4, hz, p.hutW + 1, p.hutD + 1, 2.2, { color: 'terracotta', ridgeAlongX: true, overhang: 0.2 });
    // palms along the east street
    const np = g.rules.count(p.palms, 4);
    for (let i = 0; i < np; i++) palm(g, hw - 2, 0.2, -hd + 4 + ((p.d - 8) * i) / Math.max(1, np - 1), p.palmH - (i % 3));
    // scattered trees on the slope
    const nt = g.rules.count(p.trees, 3);
    for (let i = 0; i < nt; i++) {
      const x = -hw + 8 + ((i * 37) % 70), z = -hd + 10 + ((i * 53) % 98);
      tree(g, x, yAt(x), z, 10 + (i % 3) * 2, 4, { crown: i % 2 === 0 ? 'hedge' : 'hillGreen' });
    }
    if (g.rules.detail >= 1) for (let i = 0; i < g.rules.count(5, 2); i++) lampPost(g, hw - 5, 0.2, -hd * 0.8 + i * hd * 0.4, 4.6);
  },
};
