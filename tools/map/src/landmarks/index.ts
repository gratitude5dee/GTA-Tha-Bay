/**
 * The 37 recipes (M02d1: rows 1 to 12, M02d2: rows 13 to 37), in the order of the section 7 table of 02-world-bake.md.
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
import { paintedLadies } from './painted-ladies.ts';
import { chinaBasinBallpark } from './china-basin-ballpark.ts';
import { missionBayArena } from './mission-bay-arena.ts';
import { pier39 } from './pier-39.ts';
import { fortPoint } from './fort-point.ts';
import { graceCathedral } from './grace-cathedral.ts';
import { dragonGate } from './dragon-gate.ts';
import { transitCenterPark } from './transit-center-park.ts';
import { huntersPointYard } from './hunters-point-yard.ts';
import { mountDavidsonCross } from './mount-davidson-cross.ts';
import { doloresPark } from './dolores-park.ts';
import { haightAshbury } from './haight-ashbury.ts';
import { flowerConservatory } from './flower-conservatory.ts';
import { parkBandshell } from './park-bandshell.ts';
import { cliffHouse } from './cliff-house.ts';
import { crissyField } from './crissy-field.ts';
import { powellTurntable } from './powell-turntable.ts';
import { landsEndLookout } from './lands-end-lookout.ts';
import { candlestickPoint } from './candlestick-point.ts';
import { treasureIsland } from './treasure-island.ts';
import { unPlaza } from './un-plaza.ts';
import { railTerminus } from './rail-terminus.ts';
import { peacePagoda } from './peace-pagoda.ts';
import { operaHouse } from './opera-house.ts';
import { saintMaryCathedral } from './saint-mary-cathedral.ts';

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
  paintedLadies,
  chinaBasinBallpark,
  missionBayArena,
  pier39,
  fortPoint,
  graceCathedral,
  dragonGate,
  transitCenterPark,
  huntersPointYard,
  mountDavidsonCross,
  doloresPark,
  haightAshbury,
  flowerConservatory,
  parkBandshell,
  cliffHouse,
  crissyField,
  powellTurntable,
  landsEndLookout,
  candlestickPoint,
  treasureIsland,
  unPlaza,
  railTerminus,
  peacePagoda,
  operaHouse,
  saintMaryCathedral,
] as unknown as readonly RecipeDef<never>[];

export const recipeById = (id: string): RecipeDef<never> | undefined => RECIPES.find((r) => r.id === id);
