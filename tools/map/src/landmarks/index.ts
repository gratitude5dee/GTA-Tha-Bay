/**
 * The twelve recipes of M02d1, in the order of the section 7 table of 02-world-bake.md.
 */
import type { RecipeDef } from './kit/build.ts';
import { alcatraz } from './alcatraz.ts';
import { bayBridgeYbi } from './bay-bridge-ybi.ts';
import { cityHall } from './city-hall.ts';
import { coitTower } from './coit-tower.ts';
import { crownTower } from './crown-tower.ts';
import { ferryBuilding } from './ferry-building.ts';
import { goldenGateBridge } from './golden-gate-bridge.ts';
import { palaceFineArts } from './palace-fine-arts.ts';
import { lombardCrooked } from './lombard-crooked.ts';
import { pyramidTower } from './pyramid-tower.ts';
import { sutroTower } from './sutro-tower.ts';
import { twinPeaks } from './twin-peaks.ts';

export const RECIPES: readonly RecipeDef<never>[] = [
  cityHall,
  goldenGateBridge,
  bayBridgeYbi,
  coitTower,
  ferryBuilding,
  pyramidTower,
  crownTower,
  sutroTower,
  palaceFineArts,
  alcatraz,
  twinPeaks,
  lombardCrooked,
] as unknown as readonly RecipeDef<never>[];

export const recipeById = (id: string): RecipeDef<never> | undefined => RECIPES.find((r) => r.id === id);
