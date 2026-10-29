/**
 * Stage 4, `mesh`: two candidates from the four crops (front, left, back, right), each through gate A3 and a three-view turntable through
 * A2, ready for H3. Meshy built-in rigging is off here so a rejected mesh never wastes the rig fee (spec section 1).
 */
import type { GenJob } from '../../../../packages/shared/src/genai/types.ts';
import { checkA3Mesh } from '../../../../packages/shared/src/assets/gates/index.ts';
import { targetTris } from '../../../../services/pipeline/src/steps/character.ts';
import { evaluateA2, gateReport, type GateReport } from '../../../../services/pipeline/src/steps/gates.ts';
import { encodePng } from '../../src/image.ts';
import { inspectMesh } from '../../src/glb-inspect.ts';
import { turntable } from '../../src/turntable.ts';
import type { CropsOutcome } from './crops.ts';
import type { CallFile, Loaded, StageContext } from './context.ts';
import type { StageResult } from '../../../../services/pipeline/src/steps/character.ts';

export interface MeshCandidate {
  index: number;
  job: GenJob;
  result: StageResult;
  glb: Loaded | null;
  usable: boolean;
  reports: GateReport[];
  note: string;
}

export type MeshOutcome =
  | { kind: 'ok'; candidates: (MeshCandidate | null)[]; usable: boolean[]; summary: string }
  | { kind: 'refused' | 'failed'; detail: string };

export async function runMesh(ctx: StageContext, crops: Extract<CropsOutcome, { kind: 'ok' }>): Promise<MeshOutcome> {
  const files: CallFile[] = crops.crops.map((c) => ({ role: `crop-${c.name}`, bytes: c.bytes, contentType: 'image/png', origin: 'first_party_generated' }));
  const limit = Math.max(1, ctx.deps.cfg.concurrency ?? 2);
  const indices = [0, 1];
  const out: ({ cand: MeshCandidate } | { err: { kind: 'refused' | 'failed'; detail: string } } | { skip: string })[] = [];
  for (let i = 0; i < indices.length; i += limit) {
    const batch = indices.slice(i, i + limit);
    out.push(...(await Promise.all(batch.map((index) => one(ctx, files, index)))));
  }
  const candidates: (MeshCandidate | null)[] = out.map((o) => ('cand' in o ? o.cand : null));
  const errs = out.flatMap((o) => ('err' in o ? [o.err] : []));
  const skips = out.flatMap((o) => ('skip' in o ? [o.skip] : []));
  const usable = candidates.map((c) => c?.usable === true);
  if (!usable.some(Boolean)) {
    const first = errs[0];
    if (first !== undefined && candidates.every((c) => c === null)) return first;
    return { kind: 'failed', detail: `mesh: no candidate passed A3 (${candidates.map((c, i) => `#${i + 1}: ${c?.note ?? errs[i]?.detail ?? skips[i] ?? 'no output'}`).join(' | ')})` };
  }
  const summary = candidates.map((c, i) => `#${i + 1} ${c === null ? 'none' : c.usable ? 'A3 pass' : `A3 fail (${c.note})`}`).join(', ');
  return { kind: 'ok', candidates, usable, summary };
}

async function one(ctx: StageContext, files: CallFile[], index: number): Promise<{ cand: MeshCandidate } | { err: { kind: 'refused' | 'failed'; detail: string } } | { skip: string }> {
  const call = await ctx.callPaid('mesh', files, { candidate: index });
  if (call.kind === 'refused' || call.kind === 'failed') return { err: { kind: call.kind, detail: call.detail } };
  if (call.kind === 'vendor-refused') return { err: { kind: 'failed', detail: `mesh #${index + 1}: the vendor refused the input: ${call.error.type} ${call.error.message}` } };
  const glb = call.files.find((f) => f.contentType === 'model/gltf-binary' || f.file.endsWith('.glb')) ?? null;
  if (glb === null) return { err: { kind: 'failed', detail: `mesh #${index + 1}: the vendor returned no GLB` } };
  const label = `mesh-${index + 1}`;
  const reports: GateReport[] = [];
  let note = '';
  let usable = false;
  try {
    const { stats, doc, validatorMessages } = await inspectMesh(glb.bytes);
    const findings = checkA3Mesh(`${label}.glb`, stats, { targetTris: targetTris(ctx.subject.hero) });
    const rep = gateReport('A3', 'mesh', label, findings, ctx.now(), [`triangles ${stats.triangles}, height ${stats.heightM} m, texture ${stats.maxTexPx}px`, ...validatorMessages.slice(0, 5)]);
    await ctx.writeReport(rep, `${label}-A3`);
    reports.push(rep);
    const views = turntable(doc);
    const pngs = views.map(encodePng);
    for (const [k, p] of pngs.entries()) await ctx.putFile(`work/character/${ctx.subject.slug}/mesh/turntable-${index + 1}-${k + 1}.png`, p);
    const v = await ctx.deps.ports.vision.check('A2', pngs, { slug: ctx.subject.slug, label: `${label}-turntable` });
    const a2 = evaluateA2(`${label}-turntable`, 'mesh', v, ctx.deps.cfg.textLint, ctx.now());
    await ctx.writeReport(a2, `${label}-A2`);
    reports.push(a2);
    usable = rep.status !== 'fail' && a2.status !== 'fail';
    note = [...rep.findings, ...a2.findings].map((f) => f.rule).join(', ');
  } catch (e) {
    note = `could not inspect: ${(e as Error).message}`;
  }
  return { cand: { index, job: call.job, result: call.result, glb, usable, reports, note } };
}
