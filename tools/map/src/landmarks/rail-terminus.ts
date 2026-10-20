/**
 * lm.rail-terminus: a fictional commuter-rail terminus: a stone headhouse across the end of the tracks with a clock-less central
 * gable and a rank of arched openings, behind it a long barrel-vaulted train shed over four tracks and platforms with canopy
 * posts, buffer stops and light poles. Original geometry from parameters; no name, no lettering, no clock numerals. The tracks run
 * east-west and end at the headhouse on the west.
 */
import type { BaseParams, RecipeDef } from './kit/build.ts';
import { roof, windowBands } from './kit/facade.ts';
import { flatRect, lampPost } from './kit/landscape.ts';
import { vault } from './kit/glasshouse.ts';
import { arcade, box, pole, taperTower, type Geo } from './kit/primitives.ts';

export interface TerminusParams extends BaseParams {
  headL: number;
  headD: number;
  headH: number;
  bays: number;
  towerW: number;
  towerH: number;
  shedL: number;
  shedW: number;
  shedWall: number;
  shedRise: number;
  tracks: number;
  trackGap: number;
  canopyL: number;
}

const G = -2;

export const railTerminus: RecipeDef<TerminusParams> = {
  id: 'lm.rail-terminus',
  defaults: {
    yawDeg: 0, anchor: 'ground',
    headL: 70, headD: 18, headH: 17, bays: 9, towerW: 8, towerH: 32, shedL: 110, shedW: 40, shedWall: 8, shedRise: 8, tracks: 4, trackGap: 7.5, canopyL: 60,
  },
  build(g: Geo, p: TerminusParams) {
    // the headhouse across the end of the tracks (long axis north-south, at the west end)
    const hx = 0;
    box(g, hx, G, 0, p.headD, p.headH - G, p.headL, { color: 'sandstone', top: false });
    box(g, hx, p.headH, 0, p.headD + 1.4, 1.0, p.headL + 1.4, { color: 'cream' });
    roof(g, hx, p.headH + 1, 0, p.headD, p.headL, 5, { color: 'slate', ridgeAlongX: false, inset: 0, overhang: 0.3 });
    arcade(g, p.headD / 2 + 1.2, 0, -p.headL / 2 + 6, p.headD / 2 + 1.2, p.headL / 2 - 6, { color: 'limestone', bays: p.bays, pierW: 1.6, depth: 2.4, pierH: 5.2, openingW: 5.4, archT: 0.7, wallColor: 'cream' });
    windowBands(g, hx, 8.2, 0, p.headD, p.headL, 2, 4, { color: 'glassDark', sides: ['x+'], frac: 0.84, height: 0.5, proud: 0.3 });
    // the central tower with a plain blank disc face on each side, and a pyramid cap
    box(g, hx, G, 0, p.towerW + 2, p.headH - G + 4, p.towerW + 2, { color: 'sandstone', top: false });
    box(g, hx, p.headH + 4, 0, p.towerW, p.towerH - p.headH - 4, p.towerW, { color: 'sandstone' });
    taperTower(g, hx, p.towerH, 0, p.towerW + 1.4, p.towerW + 1.4, 0.4, 0.4, 9, { color: 'copperGreen', capTint: 1 });
    for (const s of [-1, 1]) box(g, hx + s * (p.towerW / 2 + 0.1), p.towerH - 7, 0, 0.2, 4.4, 4.4, { color: 'white', cls: 'glass' });
    // the train shed behind: a barrel vault in steel and glass over the tracks, open at the far end
    const sx = p.headD / 2 + 4 + p.shedL / 2;
    vault(g, sx, 0, 0, p.shedW, p.shedL, p.shedRise, { color: 'glassLight', cls: 'glass', wallH: p.shedWall, yaw: Math.PI / 2, caps: false, segs: 8 });
    if (g.rules.detail >= 1) {
      const nr = g.rules.count(9, 3);
      for (let i = 0; i < nr; i++) {
        const x = sx - p.shedL / 2 + (p.shedL * i) / (nr - 1);
        for (const s of [-1, 1]) pole(g, x, 0, s * (p.shedW / 2), 0.35, 0.3, p.shedWall, { color: 'darkSteel', cls: 'metal', sides: 4 });
      }
    }
    // tracks, ballast, platforms
    flatRect(g, sx, 0.05, 0, p.shedL + 30, p.shedW + 6, 'asphalt');
    const nt = Math.max(2, p.tracks);
    for (let t = 0; t < nt; t++) {
      const z = (t - (nt - 1) / 2) * p.trackGap;
      for (const s of [-1, 1]) box(g, sx + 8, 0.06, z + s * 0.72, p.shedL + 16, 0.22, 0.14, { color: 'steelGrey', cls: 'metal' });
      box(g, p.headD / 2 + 4.6, 0.05, z, 1.6, 0.9, 1.9, { color: 'darkSteel', cls: 'metal' });
    }
    for (let t = 0; t + 1 < nt; t += 2) {
      const z = (t - (nt - 1) / 2 + 0.5) * p.trackGap + p.trackGap / 2 - p.trackGap / 2;
      box(g, sx + 10, 0.05, z + p.trackGap / 2, p.shedL - 10, 0.7, 3.2, { color: 'concrete' });
      // canopy posts and a canopy over the platform
      box(g, sx + 14, 4.6, z + p.trackGap / 2, p.canopyL, 0.4, 5, { color: 'white', cls: 'metal' });
      for (let i = 0; i < g.rules.count(6, 2); i++) pole(g, sx - 16 + i * (p.canopyL / 5), 0.75, z + p.trackGap / 2, 0.2, 0.16, 3.9, { color: 'darkSteel', cls: 'metal', sides: 4 });
    }
    if (g.rules.detail >= 1) {
      lampPost(g, sx + p.shedL / 2 + 8, 0, -p.shedW / 2 - 2, 6);
      lampPost(g, sx + p.shedL / 2 + 8, 0, p.shedW / 2 + 2, 6);
    }
  },
};
