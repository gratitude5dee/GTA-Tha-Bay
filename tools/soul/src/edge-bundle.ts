/**
 * npc:edge-bundle (M06a3). Writes `services/edge/src/generated/npc-fixtures.json`: block A (the public example rules) and the compiled
* `npc_test` soul (M06a4 adds the original voiced hero `ro-batista`, so a Preview can speak with Aura), so the dialogue Worker has something to talk to where the PRIVATE bucket holds no souls (local runs, Workers
 * Previews, the Workers-runtime tests). The Worker reads this file only while `ANTHROPIC_MODE` is not `live`; a live Worker reads
 * block A and every soul from PRIVATE (`prompts/npc/rules@<n>.md`, `souls/<id>/<ver>/...`). `npc_test` is an original public
 * character (content/npcs/npc_test), so bundling it exposes nothing private.
 *
 *   tsx tools/soul/src/cli.ts edge-bundle [--check]
 *
 * `--check` fails when the committed file is not what the current sources produce (the drift guard of tools/soul/test/edge-bundle.spec.ts).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRules } from './common.ts';
import { compileToFiles } from './compile.ts';

export const EDGE_BUNDLE_PATH = 'services/edge/src/generated/npc-fixtures.json';
/** compiledAt of the bundled soul: fixed, so the file only changes when the sources do. */
const FIXED_COMPILED_AT = Date.UTC(2026, 9, 22);
export const BUNDLED_SOUL_IDS = ['npc_test', 'ro-batista'] as const;

export interface EdgeBundle {
  schema: 'npc-edge-fixtures/1';
  rules: { version: number; text: string };
  souls: Record<string, { soulVersion: number; promptSha256: string; prompt: string; compiled: unknown }>;
}

export async function buildEdgeBundle(root: string): Promise<EdgeBundle> {
  const rules = loadRules(root);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'npc-edge-'));
  try {
    const souls: EdgeBundle['souls'] = {};
    for (const id of BUNDLED_SOUL_IDS) {
      const c = await compileToFiles(root, id, { out: tmp, rules, nowMs: FIXED_COMPILED_AT, noTokenWrite: true, env: {} });
      souls[id] = {
        soulVersion: c.soulVersion,
        promptSha256: c.promptSha256,
        prompt: readFileSync(path.join(c.dir, 'soul.prompt.txt'), 'utf8'),
        compiled: JSON.parse(readFileSync(path.join(c.dir, 'soul.compiled.json'), 'utf8')) as unknown,
      };
    }
    return { schema: 'npc-edge-fixtures/1', rules: { version: rules.version, text: rules.text }, souls };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export const renderEdgeBundle = (b: EdgeBundle): string => `${JSON.stringify(b, null, 2)}\n`;

export async function runEdgeBundle(root: string, check: boolean): Promise<{ ok: boolean; message: string }> {
  const file = path.join(root, EDGE_BUNDLE_PATH);
  const text = renderEdgeBundle(await buildEdgeBundle(root));
  if (check) {
    const have = existsSync(file) ? readFileSync(file, 'utf8') : null;
    return have === text
      ? { ok: true, message: `npc:edge-bundle: ${EDGE_BUNDLE_PATH} is current` }
      : { ok: false, message: `npc:edge-bundle: ${EDGE_BUNDLE_PATH} is stale; run pnpm npc:edge-bundle` };
  }
  writeFileSync(file, text);
  return { ok: true, message: `npc:edge-bundle: wrote ${EDGE_BUNDLE_PATH} (${text.length} bytes)` };
}
