/** Stage 2, `sheet`: the turnaround sheets (3 for Standard, 4 for Lean) with gates A1 and A2 on each, ready for H1. */
import type { GenJob } from '../../../../packages/shared/src/genai/types.ts';
import type { StageResult } from '../../../../services/pipeline/src/steps/character.ts';
import { evaluateA1Sheet, evaluateA2, type GateReport, type VisionVerdict } from '../../../../services/pipeline/src/steps/gates.ts';
import { cellStats, decodePng, sliceGrid } from '../../src/image.ts';
import type { CallFile, Loaded, StageContext } from './context.ts';

export type SheetOutcome =
  | { kind: 'ok'; files: number; summary: string; usable: boolean[]; sheets: Uint8Array[]; job: GenJob; result: StageResult; loaded: Loaded[]; reports: GateReport[] }
  | { kind: 'refused' | 'failed'; detail: string };

export const REF_LIMIT = 3;

export async function runSheet(ctx: StageContext): Promise<SheetOutcome> {
  const { cfg, subject } = ctx.deps;
  const inputs: CallFile[] = [];
  if (subject.pipeline === 'standard' && cfg.styleBible !== null) inputs.push({ role: 'style-bible', bytes: cfg.styleBible.bytes, contentType: 'image/png', origin: 'first_party_generated' });
  for (const [i, ref] of cfg.refs.slice(0, REF_LIMIT).entries()) inputs.push({ role: `ref-${i + 1}`, bytes: ref, contentType: 'image/png', origin: 'first_party_authored' });
  const call = await ctx.callPaid('sheet', inputs);
  if (call.kind === 'refused' || call.kind === 'failed') return { kind: call.kind, detail: call.detail };
  if (call.kind === 'vendor-refused') return { kind: 'failed', detail: `sheet: the vendor refused the input: ${call.error.type} ${call.error.message}` };

  const sheets: Uint8Array[] = [];
  const usable: boolean[] = [];
  const reports: GateReport[] = [];
  const images = call.files.filter((f) => f.contentType.startsWith('image/'));
  const bad: string[] = [];
  for (const [i, f] of images.entries()) {
    sheets.push(f.bytes);
    const label = `sheet-${i + 1}`;
    let a1: GateReport;
    if (f.contentType !== 'image/png') {
      a1 = { schema: 'char-gate-report/1', gate: 'A1', stage: 'sheet', target: label, status: 'fail', findings: [{ gate: 'A1', file: label, rule: 'format', detail: `${f.contentType} is not PNG` }], notes: [], at: ctx.now() };
    } else {
      const raster = decodePng(f.bytes);
      const cells = sliceGrid(raster, 2, 2).map(cellStats);
      const v: VisionVerdict = await ctx.deps.ports.vision.check('A1', [f.bytes], { slug: subject.slug, label });
      a1 = evaluateA1Sheet(label, { width: raster.width, height: raster.height, cols: 2, rows: 2 }, cells, v, ctx.now(), subject.pipeline);
    }
    const v2 = await ctx.deps.ports.vision.check('A2', [f.bytes], { slug: subject.slug, label });
    const a2 = evaluateA2(label, 'sheet', v2, cfg.textLint, ctx.now());
    await ctx.writeReport(a1, `${label}-A1`);
    await ctx.writeReport(a2, `${label}-A2`);
    reports.push(a1, a2);
    const ok = a1.status !== 'fail' && a2.status !== 'fail';
    usable.push(ok);
    if (!ok) bad.push(`${label}: ${[...a1.findings, ...a2.findings].map((x) => x.rule).join(', ')}`);
  }
  if (images.length === 0) return { kind: 'failed', detail: 'sheet: the vendor returned no image' };
  const held = reports.some((r) => r.status === 'held');
  const summary = `${usable.filter(Boolean).length} of ${images.length} usable${held ? ', vision checks held for the human gate' : ''}${bad.length > 0 ? `; failed: ${bad.join(' | ')}` : ''}`;
  return { kind: 'ok', files: images.length, summary, usable, sheets, job: call.job, result: call.result, loaded: images, reports };
}
