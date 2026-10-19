/**
 * `requireBake(area)` (M02a1, DL-545 (a)): a suite that reads a finished bake under dist/world calls this first.
 * With no bake it prints `SKIP <suite>: no bake in dist/world` and returns null, so the suite passes without baking the
 * full `synth` world inside a unit test; with DV_REQUIRE_BAKE=1 it throws instead. Proofs that need the bake run
 * `pnpm map:build -- --area <area>` first and set DV_REQUIRE_BAKE=1.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toolsRoot } from '../../tools/ci/lib/common.ts';

export interface FoundBake { bakeId: string; dir: string; area: string }

export function requireBake(area: string, suite: string, env: NodeJS.ProcessEnv = process.env, root = path.join(toolsRoot, 'dist', 'world')): FoundBake | null {
  const pointer = path.join(root, `latest-${area}.json`);
  if (existsSync(pointer)) {
    const { bakeId } = JSON.parse(readFileSync(pointer, 'utf8')) as { bakeId: string };
    const dir = path.join(root, bakeId);
    if (existsSync(path.join(dir, 'bake-report.json'))) return { bakeId, dir, area };
  }
  const msg = `${suite}: no bake in dist/world (run pnpm map:build -- --area ${area})`;
  if (env['DV_REQUIRE_BAKE'] === '1') throw new Error(`${msg}; DV_REQUIRE_BAKE=1 forbids skipping`);
  console.log(`SKIP ${msg}`);
  return null;
}
