/**
 * npc:compile <id|path>. Writes soul.prompt.txt and soul.compiled.json to <out>/souls/<id>/<ver>/ (PRIVATE R2 keys
 * souls/<id>/<ver>/..., spec/domains/04-npc-contracts.md section B9). Tokens, the prompt key and compiledAt are added here;
 * compileSoul itself stays pure.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CompiledSoul } from '../../../packages/shared/src/contracts/c10-npc.ts';
import { compileSoul, promptHash } from '../../../packages/shared/src/npc/compile.ts';
import type { CompiledOutputs, RulesBlock } from '../../../packages/shared/src/npc/compile.ts';
import { buildTimeMs, loadRules, PRIVATE_NPC_DIR, PUBLIC_NPC_DIR } from './common.ts';
import { promptTokens, resolveTokenBounds } from './tokens.ts';

export interface CompiledFiles {
  id: string;
  soulVersion: number;
  dir: string;
  promptKey: string;
  promptSha256: string;
  outputs: CompiledOutputs;
  compiledSoul: CompiledSoul;
}

/** `content/npcs/<id>/soul.md` or its private twin; a path ending in .md is used as given. */
export function soulPathFor(root: string, idOrPath: string): string {
  if (idOrPath.endsWith('.md')) return path.isAbsolute(idOrPath) ? idOrPath : path.join(root, idOrPath);
  for (const base of [PUBLIC_NPC_DIR, PRIVATE_NPC_DIR]) {
    const p = path.join(root, base, idOrPath, 'soul.md');
    try {
      readFileSync(p);
      return p;
    } catch {
      /* next */
    }
  }
  throw new Error(`no soul.md for ${idOrPath} under ${PUBLIC_NPC_DIR}/ or ${PRIVATE_NPC_DIR}/`);
}

export async function compileToFiles(
  root: string,
  idOrPath: string,
  o: { out: string; rules?: RulesBlock; env?: NodeJS.ProcessEnv; nowMs?: number; log?: (l: string) => void; noTokenWrite?: boolean },
): Promise<CompiledFiles> {
  const md = readFileSync(soulPathFor(root, idOrPath), 'utf8');
  const outputs = compileSoul(md, o.rules ?? loadRules(root));
  const id = outputs.publicSoul.id;
  const soulVersion = outputs.publicSoul.soulVersion;
  const sha = promptHash(outputs.promptTxt);
  const bounds = await resolveTokenBounds({
    root, id, text: outputs.promptTxt, sha256: sha,
    ...(o.env ? { env: o.env } : {}), ...(o.log ? { log: o.log } : {}), ...(o.noTokenWrite ? { noWrite: true } : {}),
  });
  const promptKey = `souls/${id}/${soulVersion}/soul.prompt.txt`;
  const compiledSoul: CompiledSoul = {
    ...outputs.compiled,
    prompt: { key: promptKey, sha256: sha, tokens: promptTokens(bounds) },
    compiledAt: o.nowMs ?? buildTimeMs(o.env),
  };
  const dir = path.join(o.out, 'souls', id, String(soulVersion));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'soul.prompt.txt'), outputs.promptTxt);
  writeFileSync(path.join(dir, 'soul.compiled.json'), `${JSON.stringify(compiledSoul, null, 2)}\n`);
  return { id, soulVersion, dir, promptKey, promptSha256: sha, outputs, compiledSoul };
}
