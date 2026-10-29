/**
 * pnpm assets:retarget -- --rig bay_rig_v1 --clips <glb> --to <slug> [--target <glb>] [--height <m>] [--out <file>] [--fps 30] (M10a1)
 *
 * Bakes the authored clips of `--clips` (keyed once on the mannequin) onto the skeleton of `--to` and writes the animation-only GLB
 * `anim/<slug>.moves` (clip name = move id, frame count in each clip's extras). `--target` defaults to the character's `desktop` file in
 * `assets/src/character/<slug>/`; `--height` defaults to the `heightM` of its spec. Gate A5 judges every clip.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { RigFamily } from '../../../packages/shared/src/assets/gates/index.ts';
import { formatFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import rigJson from '../../../packages/shared/src/rig/bay_rig_v1.json';
import { args, repoRoot } from '../../ci/run.ts';
import { RETARGET_FPS, retargetClips } from './retarget.ts';

export async function retargetCommand(argv: readonly string[], root: string, log: (l: string) => void): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: { rig: { type: 'string' }, clips: { type: 'string' }, to: { type: 'string' }, target: { type: 'string' }, height: { type: 'string' }, out: { type: 'string' }, fps: { type: 'string' } } });
  if (values.rig !== 'bay_rig_v1' || !values.clips || !values.to) {
    log('usage: pnpm assets:retarget -- --rig bay_rig_v1 --clips <glb> --to <slug> [--target <glb>] [--height <m>] [--out <file>] [--fps 30]');
    return 2;
  }
  const specFile = path.join(root, 'assets/src/character', values.to, 'asset.json');
  const spec = existsSync(specFile) ? (JSON.parse(readFileSync(specFile, 'utf8')) as { extras?: { heightM?: number } }) : null;
  const target = path.resolve(root, values.target ?? path.join('assets/src/character', values.to, 'desktop.glb'));
  const height = values.height !== undefined ? Number(values.height) : spec?.extras?.heightM;
  if (!existsSync(target) || height === undefined || !Number.isFinite(height)) {
    log(`assets:retarget: need the target skeleton (${path.relative(root, target)}) and a height (--height <m> or the spec's heightM)`);
    return 1;
  }
  const r = await retargetClips({
    clipsGlb: new Uint8Array(readFileSync(path.resolve(root, values.clips))), targetGlb: new Uint8Array(readFileSync(target)), slug: values.to, heightM: height,
    rig: rigJson as unknown as RigFamily, fps: values.fps !== undefined ? Number(values.fps) : RETARGET_FPS,
  });
  const out = path.resolve(root, values.out ?? path.join('assets/src/anim', `${values.to}.moves`, 'default.glb'));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, r.glb);
  for (const c of r.clips) log(`${c.name.padEnd(24)} ${String(c.frames).padStart(4)} frames, hip drift ${(c.stats.hipDriftM * 100).toFixed(1)} cm, end pose ${(c.stats.endPoseDistM * 100).toFixed(2)} cm`);
  for (const f of r.findings) log(formatFinding(f));
  log(r.findings.length > 0 ? `assets:retarget ${values.to}: FAIL (${r.findings.length} findings), written to ${path.relative(root, out)}` : `assets:retarget ${values.to}: ${r.clips.length} clips ok, written to ${path.relative(root, out)}`);
  return r.findings.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  retargetCommand(args(), repoRoot, (l) => console.log(l)).then((c) => process.exit(c), (e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
