/**
 * lm.pier-39: a timber pier reaching north into the bay, two rows of low gabled shop buildings around a central promenade, a
 * round carousel pavilion, floating docks on the west side and flag masts. Original geometry from parameters; no signs, no
 * lettering, no animals. The pier runs along -Z (north) from the landing at the origin.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof, windowBands } from './kit/facade.ts';
import { flatRect, lampPost } from './kit/landscape.ts';
import { box, frustum, pole, strut, type Geo } from './kit/primitives.ts';
import type { ColorName } from './kit/palette.ts';

export interface PierParams extends BaseParams {
  length: number;
  width: number;
  deckH: number;
  shops: number;
  shopW: number;
  shopD: number;
  shopH: number;
  promenade: number;
  carouselR: number;
  docks: number;
  dockW: number;
  dockL: number;
  masts: number;
  mastH: number;
}

const G = -2;
const WALLS: readonly ColorName[] = ['paintBlue', 'paintCream', 'paintSage', 'timber', 'paintYellow', 'paintTeal'];

export const pier39: RecipeDef<PierParams> = {
  id: 'lm.pier-39',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    length: 190, width: 76, deckH: 1.8, shops: 10, shopW: 15, shopD: 11, shopH: 6.5, promenade: 16, carouselR: 7, docks: 6, dockW: 5, dockL: 14, masts: 4, mastH: 17,
  },
  build(g: Geo, p: PierParams) {
    const z0 = 24, z1 = z0 - p.length;
    // the deck on piles
    box(g, 0, G, (z0 + z1) / 2, p.width, p.deckH - G, p.length, { color: 'timber' });
    if (g.rules.detail >= 1) {
      const nl = g.rules.count(20, 4);
      for (let i = 0; i < nl; i++) {
        const z = z0 - (p.length * (i + 0.5)) / nl;
        for (const s of [-1, 1]) strut(g, [s * (p.width / 2 + 0.3), -3, z], [s * (p.width / 2 + 0.3), p.deckH + 0.6, z], 0.35, { color: 'woodDark', sides: 3 });
      }
    }
    // the promenade down the middle
    flatRect(g, 0, p.deckH + 0.05, (z0 + z1) / 2, p.promenade, p.length - 8, 'sand');
    // shops: two rows facing the promenade
    const n = g.rules.count(p.shops, 4);
    const rows = Math.ceil(n / 2);
    for (let r = 0; r < rows; r++) {
      const z = z0 - 20 - (r * (p.length - 50)) / Math.max(1, rows - 1);
      for (const s of [-1, 1]) {
        const x = s * (p.promenade / 2 + p.shopD / 2 + 1.2);
        const k = r * 2 + (s > 0 ? 1 : 0);
        if (k >= n) continue;
        const col = WALLS[k % WALLS.length] as ColorName;
        box(g, x, p.deckH, z, p.shopD, p.shopH, p.shopW, { color: col, top: false });
        roof(g, x, p.deckH + p.shopH, z, p.shopD + 1, p.shopW + 1, 3.6, { color: k % 2 === 0 ? 'terracotta' : 'slate', ridgeAlongX: false, overhang: 0.3 });
        if (g.rules.detail >= 1) windowBands(g, x, p.deckH + 0.8, z, p.shopD, p.shopW, 1, 4.2, { color: 'glassDark', sides: [s > 0 ? 'x-' : 'x+'], frac: 0.78, height: 0.62, proud: 0.3 });
        if (g.rules.detail >= 2) box(g, x - s * (p.shopD / 2 + 1.1), p.deckH + 3.4, z, 2.2, 0.35, p.shopW * 0.8, { color: 'paintRose' });
      }
    }
    // the carousel pavilion at the head of the promenade
    const cz = z0 - 20 - (p.length - 50) * 0.5;
    frustum(g, 0, p.deckH, cz, p.carouselR, p.carouselR, 0.5, 14, { color: 'concrete', smooth: true });
    for (let i = 0; i < g.rules.count(8, 4); i++) {
      const a = (i / g.rules.count(8, 4)) * Math.PI * 2;
      pole(g, Math.cos(a) * (p.carouselR - 0.6), p.deckH, cz + Math.sin(a) * (p.carouselR - 0.6), 0.25, 0.2, 4.6, { color: 'white', sides: 4 });
    }
    frustum(g, 0, p.deckH + 4.6, cz, p.carouselR + 0.8, 0.5, 3.4, 14, { color: 'redLacquer', smooth: false });
    pole(g, 0, p.deckH + 8, cz, 0.2, 0.1, 2.2, { color: 'gold', cls: 'metal', sides: 4 });
    // floating docks along the west edge
    const nd = g.rules.count(p.docks, 3);
    for (let i = 0; i < nd; i++) {
      const z = z0 - 30 - (i * (p.length - 70)) / Math.max(1, nd - 1);
      box(g, -p.width / 2 - 2 - p.dockW / 2, 0.1, z, p.dockW, 0.55, p.dockL, { color: 'woodDark' });
    }
    // flag masts and lamps down the edges
    const nm = g.rules.count(p.masts, 2);
    for (let i = 0; i < nm; i++) {
      const z = z0 - 6 - (i * (p.length - 20)) / Math.max(1, nm - 1);
      pole(g, p.width / 2 - 2, p.deckH, z, 0.22, 0.14, p.mastH, { color: 'white', cls: 'metal', sides: 4 });
      box(g, p.width / 2 - 2 + 1.4, p.deckH + p.mastH - 1.4, z, 2.4, 1.5, 0.1, { color: 'bridgeRed' });
    }
    if (g.rules.detail >= 1) for (let i = 0; i < g.rules.count(8, 2); i++) lampPost(g, 0, p.deckH, z0 - 10 - i * 22, 4.6);
  },
};
