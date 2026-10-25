import type { Env } from '../env.ts';

/**
 * OpenAI `omni-moderation-latest` over `POST https://api.openai.com/v1/moderations` (M06b1; research/gap-trust-safety-tooling.md section 2.1:
 * free, text categories `sexual/minors`, `hate`, `harassment/threatening`, `self-harm/intent`, ...). Used on text that no OpenAI model wrote:
 * the explicit permission for that is UNVERIFIED (U-NPC-07), so `config/npc.json#builder.moderation.openai = "off"` moves the whole chain to
 * Llama Guard. `MODERATION_MODE` is `live` or `fixture` (anything else is fixture); production must say `live` (check:prod-routes).
 * Both functions return null (never throw) when the vendor is unavailable, so the caller can fall back. No text is logged.
 */
export type ModerationMode = 'live' | 'fixture';
export const moderationMode = (env: Pick<Env, 'MODERATION_MODE'>): ModerationMode => (env.MODERATION_MODE === 'live' ? 'live' : 'fixture');

export interface TextScores {
  /** `category_scores` of the first result, by category name. */
  scores: Record<string, number>;
  flagged: boolean;
}

/** Test seam: the body (or an error) a fixture-mode call answers with, per vendor. Null restores the default (all scores 0). */
export type ModerationFixture = (text: string, vendor: 'openai' | 'llama_guard') => string | Error;
let fixtureSource: ModerationFixture | null = null;
export function setModerationFixtureForTests(fn: ModerationFixture | null): void {
  fixtureSource = fn;
}
/** What fixture mode answers for a vendor when no test chose one. */
export const DEFAULT_OPENAI_BODY = JSON.stringify({ id: 'modr-fixture', model: 'omni-moderation-latest', results: [{ flagged: false, categories: {}, category_scores: {} }] });
export const DEFAULT_GUARD_BODY = JSON.stringify({ response: { safe: true, categories: [] } });

export function fixtureAnswer(text: string, vendor: 'openai' | 'llama_guard'): string | Error {
  if (fixtureSource !== null) return fixtureSource(text, vendor);
  return vendor === 'openai' ? DEFAULT_OPENAI_BODY : DEFAULT_GUARD_BODY;
}

/** Reads the scores out of a `/v1/moderations` body, or null when the body is not one. */
export function parseOpenAiBody(body: unknown): TextScores | null {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0] as { flagged?: unknown; category_scores?: unknown };
  if (typeof first.category_scores !== 'object' || first.category_scores === null) return null;
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(first.category_scores as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) scores[k] = v;
  return { scores, flagged: first.flagged === true };
}

export async function openaiModerate(env: Pick<Env, 'MODERATION_MODE' | 'OPENAI_MODERATION_API_KEY'>, model: string, text: string, fetchImpl: typeof fetch = fetch): Promise<TextScores | null> {
  try {
    if (moderationMode(env) === 'fixture') {
      const a = fixtureAnswer(text, 'openai');
      return a instanceof Error ? null : parseOpenAiBody(JSON.parse(a));
    }
    const key = env.OPENAI_MODERATION_API_KEY;
    if (key === undefined || key === '') return null;
    const res = await fetchImpl('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return parseOpenAiBody(await res.json());
  } catch {
    return null;
  }
}
