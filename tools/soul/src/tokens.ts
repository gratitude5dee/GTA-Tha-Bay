/**
 * Token bounds for lint L4 (spec/domains/04-npc-contracts.md section B8, M06a2 "L4 token bounds without the model").
 *  - ANTHROPIC_API_KEY unset: deterministic byte-bound estimate, upper = ceil(utf8Bytes / 3), lower = floor(utf8Bytes / 5).
 *  - ANTHROPIC_API_KEY set: messages.count_tokens on claude-haiku-5-5, cached in content/npcs/<id>/tokens.json by prompt sha256.
 * `CompiledSoul.prompt.tokens` takes the cached count, else the upper estimate. The live call is UNVERIFIED (U-NPC-12: cost and
 * limits) and was not run in the session that wrote it; any failure falls back to the estimate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const TOKEN_MODEL = 'claude-haiku-5-5';
const COUNT_URL = 'https://api.anthropic.com/v1/messages/count_tokens';
const API_VERSION = '2023-06-01';

export interface TokenBounds {
  lower: number;
  upper: number;
  /** The counted value, or null when only the estimate is available. */
  exact: number | null;
}

export function estimateTokens(text: string): { lower: number; upper: number } {
  const bytes = Buffer.byteLength(text, 'utf8');
  return { lower: Math.floor(bytes / 5), upper: Math.ceil(bytes / 3) };
}

/** The number that goes into CompiledSoul.prompt.tokens. */
export const promptTokens = (b: TokenBounds): number => b.exact ?? b.upper;

type Cache = Record<string, { tokens: number; model: string }>;

const cachePath = (root: string, id: string): string => path.join(root, 'content', 'npcs', id, 'tokens.json');

export function readTokenCache(root: string, id: string): Cache {
  const p = cachePath(root, id);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Cache) : {};
}

function writeTokenCache(root: string, id: string, cache: Cache): void {
  const p = cachePath(root, id);
  mkdirSync(path.dirname(p), { recursive: true });
  const sorted: Cache = {};
  for (const k of Object.keys(cache).sort()) sorted[k] = cache[k] as Cache[string];
  writeFileSync(p, `${JSON.stringify(sorted, null, 2)}\n`);
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export async function countTokensLive(text: string, apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<number> {
  const res = await fetchImpl(COUNT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
    body: JSON.stringify({ model: TOKEN_MODEL, messages: [{ role: 'user', content: text }] }),
  });
  if (!res.ok) throw new Error(`count_tokens answered HTTP ${res.status}`);
  const body = (await res.json()) as { input_tokens?: unknown };
  if (typeof body.input_tokens !== 'number' || !Number.isInteger(body.input_tokens) || body.input_tokens < 0) {
    throw new Error('count_tokens returned no integer input_tokens');
  }
  return body.input_tokens;
}

export interface ResolveOptions {
  root: string;
  id: string;
  text: string;
  sha256: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  /** Do not write tokens.json (tests, fixtures outside content/npcs). */
  noWrite?: boolean;
  log?: (line: string) => void;
}

let skipPrinted = false;

export async function resolveTokenBounds(o: ResolveOptions): Promise<TokenBounds> {
  const est = estimateTokens(o.text);
  const cache = readTokenCache(o.root, o.id);
  const hit = cache[o.sha256];
  if (hit) return { ...est, exact: hit.tokens };
  const key = (o.env ?? process.env).ANTHROPIC_API_KEY;
  const log = o.log ?? ((l: string) => console.log(l));
  if (!key) {
    if (!skipPrinted) {
      log('SKIP npc tokens: ANTHROPIC_API_KEY not set (using the byte-bound estimate: upper ceil(bytes/3), lower floor(bytes/5))');
      skipPrinted = true;
    }
    return { ...est, exact: null };
  }
  try {
    const tokens = await countTokensLive(o.text, key, o.fetchImpl);
    if (!o.noWrite) {
      cache[o.sha256] = { tokens, model: TOKEN_MODEL };
      writeTokenCache(o.root, o.id, cache);
    }
    return { ...est, exact: tokens };
  } catch (e) {
    log(`WARN npc tokens: ${(e as Error).message}; using the byte-bound estimate`);
    return { ...est, exact: null };
  }
}

/** Test hook: lets a test see the SKIP line again. */
export const resetSkipNotice = (): void => {
  skipPrinted = false;
};
