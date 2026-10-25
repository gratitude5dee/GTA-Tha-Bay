import type { Env } from '../env.ts';
import { fixtureAnswer, moderationMode } from './moderation-openai.ts';

/**
 * Llama Guard 3 on Workers AI (`@cf/meta/llama-guard-3-8b` through the `AI` binding; $0.484/M input tokens), the fallback text classifier when OpenAI is
 * unavailable or switched off (M06b1). Input is `{ messages: [{ role: 'user', content }] }`. The shape of the answer is UNVERIFIED (the model page
 * lists a `response` field and does not show it): `parseGuardAnswer` therefore reads the three forms the model family is known to produce, a string
 * (`safe` or `unsafe` then a line of `S<n>` codes) or an object with `safe` and `categories` (or only `categories`). Returns null on any failure.
 */
export interface GuardVerdict {
  safe: boolean;
  /** Hazard codes in upper case, `S1` ... `S14`. */
  categories: string[];
}

const codesOf = (s: string): string[] => [...new Set((s.toUpperCase().match(/S\d{1,2}/g) ?? []).map((c) => c))];

export function parseGuardAnswer(raw: unknown): GuardVerdict | null {
  const r = typeof raw === 'object' && raw !== null && 'response' in raw ? (raw as { response: unknown }).response : raw;
  if (typeof r === 'string') {
    const t = r.trim().toLowerCase();
    if (t.startsWith('safe')) return { safe: true, categories: [] };
    if (t.startsWith('unsafe')) return { safe: false, categories: codesOf(r) };
    return null;
  }
  if (typeof r === 'object' && r !== null) {
    const o = r as { safe?: unknown; categories?: unknown };
    const cats = Array.isArray(o.categories) ? o.categories.filter((c): c is string => typeof c === 'string').flatMap(codesOf) : [];
    if (typeof o.safe === 'boolean') return { safe: o.safe, categories: o.safe ? [] : [...new Set(cats)] };
    if (Array.isArray(o.categories)) return { safe: cats.length === 0, categories: [...new Set(cats)] };
  }
  return null;
}

export async function llamaGuard(env: Pick<Env, 'MODERATION_MODE' | 'AI'>, model: string, text: string): Promise<GuardVerdict | null> {
  try {
    if (moderationMode(env) === 'fixture') {
      const a = fixtureAnswer(text, 'llama_guard');
      if (a instanceof Error) return null;
      let parsed: unknown = a;
      try {
        parsed = JSON.parse(a);
      } catch {
        // a plain-text fixture such as "unsafe\nS4"
      }
      return parseGuardAnswer(parsed);
    }
    if (env.AI === undefined) return null;
    const out = await Promise.race([
      (env.AI as unknown as { run(m: string, i: Record<string, unknown>): Promise<unknown> }).run(model, { messages: [{ role: 'user', content: text }] }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    return parseGuardAnswer(out);
  } catch {
    return null;
  }
}
