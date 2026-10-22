import turnSchema from '@dv/shared/schemas/npc/npc-turn-1.0.schema.json' with { type: 'json' };
import { modelFields, type RoutedModel } from './router.ts';

/**
 * PromptAssembler (04-npc.md section 5.2): the cache-ordered request body.
 *
 *   system[0]  block A, global rules                  cache_control {ephemeral, 1h}
 *   system[1]  block B, the compiled soul (exact bytes) cache_control {ephemeral, 1h}
 *   messages   the server-held history, verbatim; after 8 turns one explicit 5 m breakpoint on the last assistant message
 *   last user  the volatile scene (rendered by renderScene)
 *   top level  cache_control {ephemeral} (automatic caching, 5 m)
 *   output_config.format = npc-turn-1.0, identical for every NPC and model (a different format would split the cache)
 *
 * At most four breakpoints in all (A, B, history, automatic). Nothing earlier in the prompt is ever edited, and no sampling parameter or
 * prefill is sent (F-036). The assembled body is pure data: the same inputs give the same bytes.
 */
export const HISTORY_BREAKPOINT_AFTER_TURNS = 8;

/** `npc-turn-1.0` as `output_config.format` wants it: the schema without its `$schema` and `$id`, key order unchanged. */
export const NPC_TURN_FORMAT: Record<string, unknown> = (() => {
  const { $schema: _s, $id: _i, ...schema } = turnSchema as Record<string, unknown>;
  return { type: 'json_schema', schema };
})();

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PromptInput {
  blockA: string;
  /** `soul.prompt.txt` bytes, as stored in PRIVATE. */
  blockB: string;
  history: readonly HistoryMessage[];
  /** The volatile user message of this turn. */
  userMessage: string;
  routed: RoutedModel;
  maxTokens: number;
}

export interface AssembledPrompt {
  body: Record<string, unknown>;
  betas: string[];
}

const ONE_HOUR = { type: 'ephemeral', ttl: '1h' } as const;
const FIVE_MIN = { type: 'ephemeral' } as const;

export function assemblePrompt(input: PromptInput): AssembledPrompt {
  const turns = Math.floor(input.history.length / 2);
  const lastAssistant = turns >= HISTORY_BREAKPOINT_AFTER_TURNS ? input.history.length - 1 : -1;
  const messages: Record<string, unknown>[] = input.history.map((m, i) =>
    i === lastAssistant && m.role === 'assistant'
      ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: FIVE_MIN }] }
      : { role: m.role, content: m.content },
  );
  messages.push({ role: 'user', content: input.userMessage });
  const { fields, betas } = modelFields(input.routed, NPC_TURN_FORMAT);
  const body: Record<string, unknown> = {
    ...fields,
    max_tokens: input.maxTokens,
    system: [
      { type: 'text', text: input.blockA, cache_control: ONE_HOUR },
      { type: 'text', text: input.blockB, cache_control: ONE_HOUR },
    ],
    messages,
    cache_control: FIVE_MIN,
  };
  return { body, betas };
}

/**
 * The same request as Haiku with the same system blocks, for a Sonnet hero request that the gateway answered with 429 (its Sonnet
 * spend rule; there is no Dynamic Route, DL-545 b): Haiku model, thinking disabled, no `fallbacks` and no fallback beta.
 */
export function asHaikuRequest(a: AssembledPrompt): AssembledPrompt {
  const { fields } = modelFields({ model: 'claude-haiku-5-5', tier: 'haiku' }, NPC_TURN_FORMAT);
  const body: Record<string, unknown> = { ...a.body, model: fields['model'], thinking: fields['thinking'] };
  delete body['fallbacks'];
  return { body, betas: [] };
}
