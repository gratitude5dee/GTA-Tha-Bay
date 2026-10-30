/**
 * Stages 3b and 3c, `portrait` and `mouth_atlas` (Standard only): two 1024 px portraits and two 3 x 3 mouth atlases from the front crop,
 * A2 on each, the atlas sliced into nine 341 px cells. H2 picks one of each.
 */
import { evaluateA2, type GateReport } from '../../../../services/pipeline/src/steps/gates.ts';
import { decodePng, encodePng, sliceGrid } from '../../src/image.ts';
import type { CropsOutcome } from './crops.ts';
import type { CallFile, Loaded, StageContext } from './context.ts';
import type { StageResult } from '../../../../services/pipeline/src/steps/character.ts';
import type { GenJob } from '../../../../packages/shared/src/genai/types.ts';

export type PaidOk = { kind: 'ok'; job: GenJob; result: StageResult; files: Loaded[]; reports: GateReport[] };
export type PaidOutcome = PaidOk | { kind: 'refused' | 'failed'; detail: string };

/** Edge of one mouth cell of the 1024 px atlas: nine cells in Rhubarb order (A to H, X), as the atlas prompt lists them. */
export const MOUTH_CELL_SIZE = 341;

async function frontOnly(ctx: StageContext, crops: Extract<CropsOutcome, { kind: 'ok' }>, stage: 'portrait' | 'mouth_atlas'): Promise<PaidOutcome> {
  const front = crops.crops[0];
  if (front === undefined) return { kind: 'failed', detail: `${stage}: no front crop` };
  const file: CallFile = { role: 'crop-front', bytes: front.bytes, contentType: 'image/png', origin: 'first_party_generated' };
  const call = await ctx.callPaid(stage, [file]);
  if (call.kind === 'refused' || call.kind === 'failed') return { kind: call.kind, detail: call.detail };
  if (call.kind === 'vendor-refused') return { kind: 'failed', detail: `${stage}: the vendor refused the input: ${call.error.type} ${call.error.message}` };
  const images = call.files.filter((f) => f.contentType.startsWith('image/'));
  if (images.length === 0) return { kind: 'failed', detail: `${stage}: the vendor returned no image` };
  const reports: GateReport[] = [];
  for (const [i, f] of images.entries()) {
    const label = `${stage}-${i + 1}`;
    const v = await ctx.deps.ports.vision.check('A2', [f.bytes], { slug: ctx.subject.slug, label });
    const a2 = evaluateA2(label, stage, v, ctx.deps.cfg.textLint, ctx.now());
    await ctx.writeReport(a2, `${label}-A2`);
    reports.push(a2);
    if (stage === 'mouth_atlas' && f.contentType === 'image/png') {
      const cells = sliceGrid(decodePng(f.bytes), 3, 3);
      for (const [k, c] of cells.entries()) {
        await ctx.putFile(`work/character/${ctx.subject.slug}/mouth_atlas/${f.sha256.slice(0, 12)}/cell-${k + 1}.png`, encodePng(c));
      }
    }
  }
  return { kind: 'ok', job: call.job, result: call.result, files: images, reports };
}

export const runPortrait = (ctx: StageContext, crops: Extract<CropsOutcome, { kind: 'ok' }>): Promise<PaidOutcome> => frontOnly(ctx, crops, 'portrait');
export const runMouthAtlas = (ctx: StageContext, crops: Extract<CropsOutcome, { kind: 'ok' }>): Promise<PaidOutcome> => frontOnly(ctx, crops, 'mouth_atlas');
