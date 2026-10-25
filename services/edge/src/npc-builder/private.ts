import { sha256Hex } from '@dv/shared';
import type { CompiledSoul } from '@dv/shared/contracts/c10-npc';
import type { Json, NpcDraftRow, ServerDataPort } from '@dv/shared/data-port';
import { compileSoul, deriveInk, parseSoul } from '@dv/shared/npc';
import { now } from '../clock.ts';
import type { Env } from '../env.ts';
import { loadBlockA } from '../npc/souls.ts';
import { BUILDER } from './data.ts';

/**
 * Private use of a user NPC (04-npc-builder.md section C2; M06b1). When a draft passes its probes the server compiles the soul and writes, to PRIVATE,
 * `souls/<id>/<ver>/soul.prompt.txt` (block B, wrapped as an untrusted character sheet by the compiler), `soul.compiled.json` and `soul.ink`
 * (the fallback lines); then it records `npc_soul` with status `private`. Route 31 serves a `private` soul to its owner only (npc/dialogue.ts).
 */
export const isUserNpcId = (id: string): boolean => /^u_[a-z0-9]{8,32}$/.test(id);

export interface CompiledPrivate {
  promptTxt: string;
  compiled: CompiledSoul;
  ink: string;
}

/** Compiles a draft's soul.md against block A. Null when block A cannot be read (live mode without the PRIVATE rules file). */
export async function compileDraftSoul(env: Pick<Env, 'PRIVATE' | 'ANTHROPIC_MODE'>, md: string, soulVersion: number): Promise<CompiledPrivate | null> {
  const text = await loadBlockA(env, BUILDER.config.rulesVersion);
  if (text === null) return null;
  const out = compileSoul(md, { version: BUILDER.config.rulesVersion, text });
  const key = `souls/${out.compiled.id}/${soulVersion}/soul.prompt.txt`;
  const compiled: CompiledSoul = {
    ...out.compiled,
    soulVersion,
    prompt: { key, sha256: sha256Hex(out.promptTxt), tokens: Math.ceil(new TextEncoder().encode(out.promptTxt).length / 3) },
    compiledAt: now(),
  };
  return { promptTxt: out.promptTxt, compiled, ink: deriveInk(parseSoul(md).sections['Example lines'] ?? '') };
}

/** Writes the three PRIVATE objects of a soul version and the `npc_soul` row (status `private`). */
export async function promoteToPrivate(env: Pick<Env, 'PRIVATE'>, port: ServerDataPort, draft: NpcDraftRow, md: string, c: CompiledPrivate): Promise<number> {
  const version = c.compiled.soulVersion;
  const base = `souls/${draft.npc_id}/${version}`;
  await env.PRIVATE.put(`${base}/soul.prompt.txt`, c.promptTxt);
  await env.PRIVATE.put(`${base}/soul.compiled.json`, JSON.stringify(c.compiled));
  await env.PRIVATE.put(`${base}/soul.ink`, c.ink);
  await port.builder.putSoul({
    npcId: draft.npc_id,
    soulVersion: version,
    ownerProfileId: draft.owner_profile_id,
    soulMd: md,
    compiledJson: c.compiled as unknown as NonNullable<Json>,
    promptR2Key: c.compiled.prompt.key,
    promptSha256: c.compiled.prompt.sha256,
    status: 'private',
  });
  return version;
}

/**
 * The active version of a user NPC for `pid`, or null when `pid` may not talk to it (no such soul, another owner's private soul, or a status that
 * serves nobody). `private` souls answer their owner only; `published` souls (M06b2) answer anyone.
 */
export async function userSoulVersionFor(port: ServerDataPort, pid: string, npcId: string): Promise<number | null> {
  const s = await port.builder.getSoul(npcId);
  if (s === null) return null;
  if (s.status === 'published') return s.soul_version;
  if (s.status === 'private' && s.owner_profile_id === pid) return s.soul_version;
  return null;
}
