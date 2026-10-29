/** Stage 7, `optimize` (local): the rigged GLB to three fidelities and an animation asset, gates A6 (budget) and A7 (turntable SSIM). */
import { checkA7Visual, frameStats, ssim, type FrameStats } from '../../../../packages/shared/src/assets/gates/index.ts';
import { gateReport, type GateReport } from '../../../../services/pipeline/src/steps/gates.ts';
import { luma } from '../../src/image.ts';
import { readGlb } from '../../src/glb-inspect.ts';
import { optimizeCharacter, FIDELITIES, FIDELITY_VARIANT, type OptimizeResult } from '../../src/optimize.ts';
import { frameOf, turntable } from '../../src/turntable.ts';
import type { StageContext } from './context.ts';
import type { RigOutcome } from './rig.ts';

export type OptOutcome =
  | { kind: 'ok'; result: OptimizeResult; a6: GateReport; a7: GateReport; dir: string; ssimMid: number; ssimLo: number }
  | { kind: 'failed'; detail: string };

export async function runOptimize(ctx: StageContext, rig: Extract<RigOutcome, { kind: 'ok' }>): Promise<OptOutcome> {
  const { cfg, subject } = ctx.deps;
  const result = await optimizeCharacter({ glb: rig.rigged, slug: subject.slug, rig: cfg.rig, limits: cfg.limits, ktx: cfg.ktx ?? null });
  const dir = `work/character/${subject.slug}/optimize/${rig.riggedSha256.slice(0, 12)}`;
  for (const v of result.variants) await ctx.putFile(`${dir}/${FIDELITY_VARIANT[v.fidelity]}.glb`, v.glb);
  if (result.anim !== null) await ctx.putFile(`${dir}/anim.base.glb`, result.anim);
  const a6 = gateReport('A6', 'optimize', `${subject.slug}`, result.findings, ctx.now(), result.notes);
  await ctx.writeReport(a6, 'optimize-A6');

  // A7: the same framing for all three, so the comparison sees only what the simplification changed.
  const docs = await Promise.all(result.variants.map((v) => readGlb(v.glb)));
  const hiDoc = docs[FIDELITIES.indexOf('hi')];
  if (hiDoc === undefined) return { kind: 'failed', detail: 'optimize: no hi variant' };
  const frame = frameOf(hiDoc);
  const views = docs.map((d) => turntable(d, frame));
  const hi = views[FIDELITIES.indexOf('hi')] ?? [];
  const mean = (idx: number): number => {
    const v = views[idx] ?? [];
    let s = 0;
    v.forEach((r, k) => {
      const base = hi[k];
      s += base === undefined ? 0 : ssim(luma(base), luma(r), r.width, r.height);
    });
    return v.length === 0 ? 0 : s / v.length;
  };
  const ssimMid = mean(FIDELITIES.indexOf('mid'));
  const ssimLo = mean(FIDELITIES.indexOf('lo'));
  const frames: FrameStats[] = hi.map((r) => frameStats(luma(r)));
  const a7 = gateReport('A7', 'optimize', subject.slug, checkA7Visual(`${subject.slug}`, { ssimMid, ssimLo, frames }), ctx.now(), [`SSIM mid ${ssimMid.toFixed(3)}, lo ${ssimLo.toFixed(3)} (software turntable, 3 views)`]);
  await ctx.writeReport(a7, 'optimize-A7');
  const failing = [...a6.findings, ...a7.findings];
  if (failing.length > 0) return { kind: 'failed', detail: `optimize: ${failing.map((f) => `${f.gate} ${f.rule} (${f.detail})`).join('; ')}; the run returns to H4 or stage 4 with the rejected candidate kept` };
  return { kind: 'ok', result, a6, a7, dir, ssimMid, ssimLo };
}
