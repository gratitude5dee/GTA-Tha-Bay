/**
 * Stage 5, `rig`: the chosen mesh through the rigger, gate A4 on the result, ready for H4. If the rigger answers 422 the run falls to the
 * second mesh candidate (spec section 1); if both are refused, H4 decides between a Blender repair and a `fictionalized` redesign.
 * The vendor's output shape is not verified (U-AST-1): every GLB it returns is read, the one with the most joints is the rigged model and
 * the animations of the others are merged onto it by node name.
 */
import type { GenJob } from '../../../../packages/shared/src/genai/types.ts';
import rigJson from '../../../../packages/shared/src/rig/bay_rig_v1.json';
import { checkA4Rig, type RigFamily } from '../../../../packages/shared/src/assets/gates/index.ts';
import { BASE_CLIP_IDS, stageDir, type StageResult } from '../../../../services/pipeline/src/steps/character.ts';
import { gateReport, type GateReport } from '../../../../services/pipeline/src/steps/gates.ts';
import { inspectRig, mergeAnimations, readGlb, writeGlb, jointNodes } from '../../src/glb-inspect.ts';
import type { CallFile, Loaded, StageContext } from './context.ts';
import { sha256 } from './context.ts';
import type { MeshOutcome } from './mesh.ts';

export const BAY_RIG: RigFamily = rigJson as unknown as RigFamily;

export type RigOutcome =
  | { kind: 'ok'; job: GenJob; result: StageResult; rigged: Uint8Array; riggedSha256: string; candidate: number; fellBack: boolean; clips: string[]; reports: GateReport[]; meshSha256: string }
  | { kind: 'refused'; detail: string }
  | { kind: 'failed'; detail: string }
  | { kind: 'needs-human'; detail: string };

/** Clips the A4 gate expects: the Standard rig asks for the base set (plus soul moves when funded); the Lean rig returns walk and run. */
export function expectedClips(ctx: StageContext): number {
  const { subject, cfg } = ctx.deps;
  return subject.pipeline === 'lean' ? 2 : BASE_CLIP_IDS.length + (cfg.withMoves === true ? subject.moves.length : 0);
}

export async function runRig(ctx: StageContext, mesh: Extract<MeshOutcome, { kind: 'ok' }>, pick: number): Promise<RigOutcome> {
  const order = [pick, pick === 0 ? 1 : 0];
  let fellBack = false;
  for (const cand of order) {
    const c = mesh.candidates[cand];
    if (c === null || c === undefined || !c.usable || c.glb === null) continue;
    if (ctx.run.rigRejected.includes(cand)) {
      fellBack = cand !== pick;
      continue;
    }
    const model: CallFile = { role: 'model', bytes: c.glb.bytes, contentType: 'model/gltf-binary', origin: 'first_party_generated' };
    const call = await ctx.callPaid('rig', [model], { candidate: cand, extra: { model_url: c.glb.sourceUrl } });
    if (call.kind === 'refused' || call.kind === 'failed') return { kind: call.kind, detail: call.detail };
    if (call.kind === 'vendor-refused') {
      if (!ctx.run.rigRejected.includes(cand)) ctx.run.rigRejected.push(cand);
      ctx.log(`rig: the rigger refused mesh candidate ${cand + 1} (${call.error.type}); falling to the other candidate`);
      fellBack = true;
      continue;
    }
    return finishRig(ctx, call.job, call.result, call.files, cand, cand !== pick || fellBack, c.glb);
  }
  return { kind: 'needs-human', detail: `H4: the rigger refused ${ctx.run.rigRejected.length} mesh candidate(s) and no other usable candidate is left; choose a Blender repair of the mesh or a fictionalized redesign (a new seed from stage 2), then re-run` };
}

async function finishRig(ctx: StageContext, job: GenJob, result: StageResult, files: Loaded[], candidate: number, fellBack: boolean, meshGlb: Loaded): Promise<RigOutcome> {
  const glbs = files.filter((f) => f.contentType === 'model/gltf-binary' || f.file.endsWith('.glb'));
  if (glbs.length === 0) return { kind: 'failed', detail: 'rig: the vendor returned no GLB' };
  const scored = await Promise.all(glbs.map(async (g) => ({ g, doc: await readGlb(g.bytes) })));
  scored.sort((a, b) => jointNodes(b.doc).length - jointNodes(a.doc).length);
  const model = scored[0];
  if (model === undefined || jointNodes(model.doc).length === 0) return { kind: 'failed', detail: 'rig: none of the returned GLBs has a skin' };
  for (const other of scored.slice(1)) mergeAnimations(model.doc, other.doc);
  const rigged = await writeGlb(model.doc);
  const riggedSha = sha256(rigged);
  await ctx.putFile(`${stageDir(ctx.subject.slug, 'rig', job.jobKey)}/rigged.glb`, rigged);
  const { stats } = await inspectRig(rigged, BAY_RIG);
  const rep = gateReport('A4', 'rig', 'rigged.glb', checkA4Rig('rigged.glb', stats, BAY_RIG, expectedClips(ctx)), ctx.now(), [`${stats.boneNames.length} bones, ${stats.clipCount} clips, ${stats.maxInfluences} influences`]);
  await ctx.writeReport(rep, 'rig-A4');
  if (rep.status === 'fail') {
    return { kind: 'failed', detail: `rig: gate A4 failed: ${rep.findings.map((f) => `${f.rule} (${f.detail})`).join('; ')}. Run assets:verify --probe-bones to propose bone aliases, review them, then re-run.` };
  }
  const clips = model.doc.getRoot().listAnimations().map((a) => a.getName());
  return { kind: 'ok', job, result, rigged, riggedSha256: riggedSha, candidate, fellBack, clips, reports: [rep], meshSha256: meshGlb.sha256 };
}
