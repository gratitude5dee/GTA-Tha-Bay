/** Stage 3a, `crops` (local): the chosen sheet cut into four PNGs in the order front, left, back, right (order sensitivity unverified, U2). */
import { evaluateA1Crops } from '../../../../services/pipeline/src/steps/gates.ts';
import { crop, decodePng, encodePng, sliceGrid } from '../../src/image.ts';
import { sha256, type StageContext } from './context.ts';

export const CROP_NAMES = ['front', 'left', 'back', 'right'] as const;

export interface Crop {
  name: (typeof CROP_NAMES)[number];
  bytes: Uint8Array;
  sha256: string;
  width: number;
  height: number;
}

export type CropsOutcome = { kind: 'ok'; sheetSha256: string; crops: Crop[] } | { kind: 'failed'; detail: string };

export async function runCrops(ctx: StageContext, sheet: Uint8Array): Promise<CropsOutcome> {
  const { subject } = ctx.deps;
  let raster;
  try {
    raster = decodePng(sheet);
  } catch (e) {
    return { kind: 'failed', detail: `crops: the chosen sheet is not a PNG: ${(e as Error).message}` };
  }
  const cells = sliceGrid(raster, 2, 2);
  const sheetSha = sha256(sheet);
  const crops: Crop[] = [];
  for (const [i, cell] of cells.entries()) {
    const name = CROP_NAMES[i] as Crop['name'];
    const bytes = encodePng(cell.width === 1280 && cell.height === 720 ? cell : crop(cell, 0, 0, cell.width, cell.height));
    crops.push({ name, bytes, sha256: sha256(bytes), width: cell.width, height: cell.height });
    await ctx.putFile(`work/character/${subject.slug}/crops/${sheetSha.slice(0, 12)}/${name}.png`, bytes);
  }
  const expect = subject.pipeline === 'standard' ? { width: 1280, height: 720 } : { width: crops[0]?.width ?? 0, height: crops[0]?.height ?? 0 };
  const rep = evaluateA1Crops(crops.map((c) => ({ name: `${c.name}.png`, width: c.width, height: c.height })), ctx.now(), expect);
  await ctx.writeReport(rep, 'crops-A1');
  if (rep.status === 'fail') return { kind: 'failed', detail: `crops: ${rep.findings.map((f) => f.detail).join('; ')}` };
  return { kind: 'ok', sheetSha256: sheetSha, crops };
}
