import type { CompiledSoul } from '@dv/shared/contracts/c10-npc';
import { NPC_GUARDRAILS } from '@dv/shared';
import { now } from '../clock.ts';
import type { Env } from '../env.ts';
import bundled from '../generated/npc-fixtures.json' with { type: 'json' };
import { anthropicMode } from './upstream.ts';

/**
 * Where the dialogue route gets its soul and block A (04-npc.md section 5.2, spec/domains/04-npc-contracts.md section B9).
 *
 * PRIVATE keys: `souls/index.json` (active version per id), `souls/<id>/<ver>/soul.prompt.txt` (block B, exact bytes),
 * `souls/<id>/<ver>/soul.compiled.json`, and `prompts/npc/rules@<n>.md` (block A, the text between `<rules>` markers, as
 * tools/soul/src/common.ts loadRules reads it). The Worker keeps the last 64 souls in an isolate LRU (a version's bytes never change) and
 * the index for 10 s.
 *
 * Where `ANTHROPIC_MODE` is not `live`, a soul or rules file missing from PRIVATE falls back to the bundled test fixtures
 * (`generated/npc-fixtures.json`, written by `pnpm npc:edge-bundle`): the public rules example and the original character `npc_test`.
 * A live Worker never reads them.
 */
export interface LoadedSoul {
  id: string;
  version: number;
  compiled: CompiledSoul;
  /** Block B. */
  prompt: string;
}

interface BundledSoul {
  soulVersion: number;
  prompt: string;
  compiled: CompiledSoul;
}
const BUNDLE = bundled as unknown as { rules: { version: number; text: string }; souls: Record<string, BundledSoul> };

const LRU_MAX = 64;
const lru = new Map<string, LoadedSoul>();
let indexCache: { at: number; versions: Map<string, number> } | null = null;
const rulesCache = new Map<number, string>();

/** Drops this isolate's caches (tests call it between cases). */
export function dropSoulCache(): void {
  lru.clear();
  indexCache = null;
  rulesCache.clear();
}

const fixturesAllowed = (env: Pick<Env, 'ANTHROPIC_MODE'>): boolean => anthropicMode(env) === 'fixture';

/** Active soul versions by id from PRIVATE `souls/index.json`, plus the bundled fixtures outside live mode. */
async function activeVersions(env: Pick<Env, 'PRIVATE' | 'ANTHROPIC_MODE'>): Promise<Map<string, number>> {
  const t = now();
  if (indexCache !== null && t - indexCache.at < NPC_GUARDRAILS.roster.isolateCacheMs && t >= indexCache.at) return indexCache.versions;
  const versions = new Map<string, number>();
  const obj = await env.PRIVATE.get('souls/index.json');
  if (obj !== null) {
    const doc = JSON.parse(await obj.text()) as { souls?: Record<string, { soulVersion?: number }> };
    for (const [id, s] of Object.entries(doc.souls ?? {})) if (typeof s.soulVersion === 'number') versions.set(id, s.soulVersion);
  }
  if (fixturesAllowed(env)) for (const [id, s] of Object.entries(BUNDLE.souls)) if (!versions.has(id)) versions.set(id, s.soulVersion);
  indexCache = { at: t, versions };
  return versions;
}

/** The active version of `npcId`, or null when the roster of souls does not hold it. Throws when PRIVATE cannot be read. */
export async function activeSoulVersion(env: Pick<Env, 'PRIVATE' | 'ANTHROPIC_MODE'>, npcId: string): Promise<number | null> {
  return (await activeVersions(env)).get(npcId) ?? null;
}

/** The soul at `(id, version)`, or null when neither PRIVATE nor (outside live mode) the fixtures hold it. Throws when PRIVATE cannot be read. */
export async function loadSoul(env: Pick<Env, 'PRIVATE' | 'ANTHROPIC_MODE'>, npcId: string, version: number): Promise<LoadedSoul | null> {
  const key = `souls/${npcId}/${version}`;
  const hit = lru.get(key);
  if (hit !== undefined) {
    lru.delete(key);
    lru.set(key, hit);
    return hit;
  }
  let loaded: LoadedSoul | null = null;
  const [promptObj, compiledObj] = await Promise.all([env.PRIVATE.get(`${key}/soul.prompt.txt`), env.PRIVATE.get(`${key}/soul.compiled.json`)]);
  if (promptObj !== null && compiledObj !== null) {
    loaded = { id: npcId, version, prompt: await promptObj.text(), compiled: JSON.parse(await compiledObj.text()) as CompiledSoul };
  } else if (fixturesAllowed(env)) {
    const b = BUNDLE.souls[npcId];
    if (b !== undefined && b.soulVersion === version) loaded = { id: npcId, version, prompt: b.prompt, compiled: b.compiled };
  }
  if (loaded === null) return null;
  lru.set(key, loaded);
  while (lru.size > LRU_MAX) lru.delete(lru.keys().next().value as string);
  return loaded;
}

/** Block A for a rules version: PRIVATE `prompts/npc/rules@<n>.md`, else (outside live mode) the bundled public example. Null in live mode when PRIVATE has none. */
export async function loadBlockA(env: Pick<Env, 'PRIVATE' | 'ANTHROPIC_MODE'>, rulesVersion: number): Promise<string | null> {
  const cached = rulesCache.get(rulesVersion);
  if (cached !== undefined) return cached;
  const obj = await env.PRIVATE.get(`prompts/npc/rules@${rulesVersion}.md`);
  let text: string | null = null;
  if (obj !== null) {
    const raw = await obj.text();
    const m = /<rules>\n([\s\S]*?)\n<\/rules>/.exec(raw);
    text = (m ? (m[1] as string) : raw).trim();
  } else if (fixturesAllowed(env)) {
    text = BUNDLE.rules.text;
  }
  if (text !== null) rulesCache.set(rulesVersion, text);
  return text;
}

/**
 * The temperament the executor needs for `attack` and `call_police`. CompiledSoul (C10 1.1) does not carry `personality`, so this reads it
 * if a later contract version adds it, else treats a soul tagged `volatile` as volatile, else `calm`. See Builder decision BD-M06a3-05.
 */
export function temperamentOf(c: CompiledSoul): 'calm' | 'volatile' | 'warm' | 'cold' {
  const p = (c as unknown as { personality?: { temperament?: string } }).personality?.temperament;
  if (p === 'volatile' || p === 'warm' || p === 'cold' || p === 'calm') return p;
  return c.tags.includes('volatile') ? 'volatile' : 'calm';
}
