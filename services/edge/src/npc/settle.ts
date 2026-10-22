/**
 * Settlement of a dialogue turn (04-npc.md section 5.1 step 9). The cost in USD micros is computed from the `usage` of the response at the
 * F-034 prices of the model the response names (the `model` field, not the model that was asked for). A model that is not in the table, or
 * a response without a `model`, is charged at the highest F-034 rates (Opus 5.5) and the caller writes the log line `genai.cost.unpriced`
 * (a hero turn may be served by an unpublished server-side fallback model, U-NPC-13, DL-551).
 *
 * Prices are USD micros per million tokens: $0.10 per million is 100,000. The result is one rounded-up integer, never a fraction.
 */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  /** Tokens written to the 5 minute cache. */
  cacheWrite5m: number;
  /** Tokens written to the 1 hour cache (block A and B). */
  cacheWrite1h: number;
}

export interface PriceRow {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/** F-034 (research/INDEX.md): Haiku 5.5, Sonnet 5.5, Opus 5.5, prompts of at most 100K tokens. */
export const PRICES = {
  'claude-haiku-5-5': { input: 100_000, output: 500_000, cacheRead: 10_000, cacheWrite5m: 125_000, cacheWrite1h: 200_000 },
  'claude-sonnet-5-5': { input: 2_000_000, output: 10_000_000, cacheRead: 100_000, cacheWrite5m: 2_500_000, cacheWrite1h: 4_000_000 },
  'claude-opus-5-5': { input: 4_000_000, output: 20_000_000, cacheRead: 200_000, cacheWrite5m: 5_000_000, cacheWrite1h: 8_000_000 },
} as const satisfies Record<string, PriceRow>;

/** What an unlisted model is charged: the highest F-034 row. */
export const UNPRICED_ROW: PriceRow = PRICES['claude-opus-5-5'];

export type PricedModel = keyof typeof PRICES;

export interface PricedUsage {
  micros: number;
  /** False when the model was not found in the table and the Opus row was used. */
  priced: boolean;
  /** The model name used for the telemetry point: a table key, or `other`. */
  label: PricedModel | 'other';
}

/** `claude-haiku-5-5` or the same with a dated suffix (`claude-haiku-5-5-20261007`). */
export function priceKey(model: string | undefined): PricedModel | null {
  if (model === undefined) return null;
  for (const key of Object.keys(PRICES) as PricedModel[]) {
    if (model === key || model.startsWith(`${key}-`)) return key;
  }
  return null;
}

export function costMicros(usage: Usage, model: string | undefined): PricedUsage {
  const key = priceKey(model);
  const row: PriceRow = key === null ? UNPRICED_ROW : PRICES[key];
  const total =
    (usage.input * row.input + usage.output * row.output + usage.cacheRead * row.cacheRead + usage.cacheWrite5m * row.cacheWrite5m + usage.cacheWrite1h * row.cacheWrite1h) /
    1_000_000;
  return { micros: Math.ceil(total), priced: key !== null, label: key ?? 'other' };
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined);

/**
 * Folds a `usage` object of the stream (from `message_start`, then `message_delta`, whose numbers are cumulative) into `into`.
 * A field that is absent keeps its value. When the response gives no per-TTL breakdown of the cache writes, all of them count as 1 h
 * writes, because every cached block this route sends carries `ttl: 1h` except the one 5 m breakpoint of long encounters.
 */
export function mergeUsage(into: Usage, raw: unknown): Usage {
  if (typeof raw !== 'object' || raw === null) return into;
  const u = raw as Record<string, unknown>;
  const input = num(u['input_tokens']);
  const output = num(u['output_tokens']);
  const read = num(u['cache_read_input_tokens']);
  const writeTotal = num(u['cache_creation_input_tokens']);
  const split = typeof u['cache_creation'] === 'object' && u['cache_creation'] !== null ? (u['cache_creation'] as Record<string, unknown>) : null;
  const w5 = split === null ? undefined : num(split['ephemeral_5m_input_tokens']);
  const w1 = split === null ? undefined : num(split['ephemeral_1h_input_tokens']);
  if (input !== undefined) into.input = input;
  if (output !== undefined) into.output = output;
  if (read !== undefined) into.cacheRead = read;
  if (w5 !== undefined || w1 !== undefined) {
    into.cacheWrite5m = w5 ?? 0;
    into.cacheWrite1h = w1 ?? 0;
  } else if (writeTotal !== undefined) {
    into.cacheWrite5m = 0;
    into.cacheWrite1h = writeTotal;
  }
  return into;
}
