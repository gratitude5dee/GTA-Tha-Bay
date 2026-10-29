/**
 * pnpm assets:optimize -- --slug <slug> [--in <rigged.glb>] [--out <dir>] [--hero | --npc] (M10a1; spec/domains/05-assets-pipeline.md section 3)
 *
 * Reads the rigged GLB of a character (default: the newest `rigged.glb` of its run under `.genai/work/`), writes `desktop.glb`, `mobile.glb`,
 * `mobile-low.glb` and `anim.base.glb` into `--out` (default beside the run), and prints the A6 budget and A7 turntable verdicts. The publish
 * stage of `assets:gen run` calls the same code and writes the specs and provenance; this command is for re-running one slug by hand.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkA7Visual, frameStats, ssim, type FidelityLimits, type RigFamily } from '../../../packages/shared/src/assets/gates/index.ts';
import { formatFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import rigJson from '../../../packages/shared/src/rig/bay_rig_v1.json';
import { args, repoRoot } from '../../ci/run.ts';
import { readGlb } from './glb-inspect.ts';
import { luma } from './image.ts';
import { FIDELITIES, FIDELITY_VARIANT, ktxTool, optimizeCharacter } from './optimize.ts';
import { newestRigged } from './probe-run.ts';
import { frameOf, turntable } from './turntable.ts';

export async function optimizeCommand(argv: readonly string[], root: string, log: (l: string) => void): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: { slug: { type: 'string' }, in: { type: 'string' }, out: { type: 'string' }, hero: { type: 'boolean', default: false }, npc: { type: 'boolean', default: false } } });
  if (!values.slug) {
    log('usage: pnpm assets:optimize -- --slug <slug> [--in <rigged.glb>] [--out <dir>] [--hero | --npc]');
    return 2;
  }
  const input = values.in !== undefined ? path.resolve(root, values.in) : newestRigged(root, values.slug);
  if (input === null) {
    log(`assets:optimize: no rigged output for ${values.slug}; run the rig stage or pass --in <rigged.glb>`);
    return 1;
  }
  const budgets = JSON.parse(readFileSync(path.join(root, 'config/asset-budgets.json'), 'utf8')) as { rows: { id: string; fidelity: Record<'hi' | 'mid' | 'lo', FidelityLimits> }[] };
  const row = budgets.rows.find((r) => r.id === (values.hero ? 'character-hero' : 'character-npc'));
  if (row === undefined) {
    log('assets:optimize: no budget row for the character class');
    return 1;
  }
  const glb = new Uint8Array(readFileSync(input));
  const r = await optimizeCharacter({ glb, slug: values.slug, rig: rigJson as unknown as RigFamily, limits: row.fidelity, ktx: ktxTool() });
  const out = path.resolve(root, values.out ?? path.join('.genai', 'work', 'character', values.slug, 'optimize', createHash('sha256').update(glb).digest('hex').slice(0, 12)));
  mkdirSync(out, { recursive: true });
  for (const v of r.variants) {
    writeFileSync(path.join(out, `${FIDELITY_VARIANT[v.fidelity]}.glb`), v.glb);
    log(`${v.fidelity.padEnd(3)} ${FIDELITY_VARIANT[v.fidelity].padEnd(10)} ${v.stats.tris} tris, ${v.measure.materials} materials, texture ${v.measure.maxTexPx}px, ${v.glb.length} bytes, sha256 ${v.sha256.slice(0, 12)}`);
  }
  if (r.anim !== null) {
    writeFileSync(path.join(out, 'anim.base.glb'), r.anim);
    log(`anim.base  ${r.clips.length} clips (${r.clips.join(', ')}), ${r.anim.length} bytes`);
  }
  for (const n of r.notes) log(n);
  const docs = await Promise.all(r.variants.map((v) => readGlb(v.glb)));
  const hiDoc = docs[FIDELITIES.indexOf('hi')];
  const findings = [...r.findings];
  if (hiDoc !== undefined) {
    const frame = frameOf(hiDoc);
    const views = docs.map((d) => turntable(d, frame));
    const hi = views[0] ?? [];
    const mean = (i: number): number => (views[i] ?? []).reduce((n, v, k) => n + ssim(luma(hi[k] ?? v), luma(v), v.width, v.height), 0) / Math.max(1, hi.length);
    const a7 = { ssimMid: mean(1), ssimLo: mean(2), frames: hi.map((f) => frameStats(luma(f))) };
    findings.push(...checkA7Visual(`${values.slug}`, a7));
    log(`A7 SSIM mid ${a7.ssimMid.toFixed(3)}, lo ${a7.ssimLo.toFixed(3)}`);
  }
  for (const f of findings) log(formatFinding(f));
  log(findings.length > 0 ? `assets:optimize ${values.slug}: FAIL (${findings.length} findings), written to ${path.relative(root, out)}` : `assets:optimize ${values.slug}: ok, written to ${path.relative(root, out)}`);
  return findings.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  optimizeCommand(args(), repoRoot, (l) => console.log(l)).then((c) => process.exit(c), (e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
