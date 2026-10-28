/**
 * `assets:verify --slug <slug> --probe-bones` (M10a1): reads the first rigged output of a character from the work directory (or `--in`),
 * proposes the `bay_rig_v1` alias table with `probe-bones.ts`, and writes it into `packages/shared/src/rig/bay_rig_v1.json` for review in the PR.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RigFamily } from '../../../packages/shared/src/assets/gates/index.ts';
import { probeBones, withProbedAliases } from './probe-bones.ts';

export const RIG_FILE = 'packages/shared/src/rig/bay_rig_v1.json';

/** The newest `rigged.glb` under `.genai/work/character/<slug>/rig/`. */
export function newestRigged(root: string, slug: string): string | null {
  const dir = path.join(root, '.genai', 'work', 'character', slug, 'rig');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .map((d) => path.join(dir, d, 'rigged.glb'))
    .filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

export async function runProbeBones(root: string, slug: string, inFile: string | undefined, log: (l: string) => void): Promise<number> {
  const file = inFile !== undefined ? path.resolve(root, inFile) : newestRigged(root, slug);
  if (file === null || !existsSync(file)) {
    log(`assets:verify --probe-bones: no rigged output for ${slug} (run the rig stage, or pass --in <rigged.glb>)`);
    return 1;
  }
  const table = JSON.parse(readFileSync(path.join(root, RIG_FILE), 'utf8')) as Record<string, unknown>;
  const probe = await probeBones(new Uint8Array(readFileSync(file)), table as unknown as RigFamily);
  log(`probe of ${path.relative(root, file)}: ${probe.found.length} bones, ${Object.keys(probe.aliases).length} aliases proposed, ${probe.extra.length} extra, ${probe.missing.length} required bones still unplaced`);
  for (const [vendor, canon] of Object.entries(probe.aliases)) log(`  alias ${vendor} -> ${canon}`);
  if (probe.extra.length > 0) log(`  extra bones (fingers, face, helpers): ${probe.extra.slice(0, 12).join(', ')}${probe.extra.length > 12 ? ', ...' : ''}`);
  if (probe.missing.length > 0) {
    log(`  unplaced required bones: ${probe.missing.join(', ')}; extend packages/shared/src/rig/bay_rig_v1.json by hand after reading the names above`);
  }
  writeFileSync(path.join(root, RIG_FILE), `${JSON.stringify(withProbedAliases(table, probe, path.relative(root, file)), null, 2)}\n`);
  log(`wrote ${RIG_FILE} (probed: true); review the aliases in the PR, A4 never passes on a guessed table`);
  return probe.missing.length > 0 ? 1 : 0;
}
