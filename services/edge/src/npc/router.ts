import type { GovLevel } from '@dv/shared';
import type { ModelTier } from '@dv/shared/contracts/c10-npc';

/**
 * ModelRouter (04-npc.md section 5.3). Pure.
 *
 *  - default named NPCs, user NPCs and intents: Haiku 5.5, thinking disabled, effort low.
 *  - a hero (`roles.hero` and `dialogue.modelTier = sonnet`): Sonnet 5.5 with `between_tools` thinking, effort low, and the server-side
 *    fallback beta (`fallbacks: 'default'`, Claude API only). At governor level 1 or with `ks:anthropic:sonnet` a hero is routed to Haiku
 *    with the same system blocks (a separate cache entry).
 *  - governor level 3, `ks:anthropic` or `ks:genai:all`: no call at all (`budget_offline`).
 * No `temperature`, `top_p` or `top_k`, no prefill, and no `fallbacks` on Haiku (F-036).
 */
export type ModelId = 'claude-haiku-5-5' | 'claude-sonnet-5-5';

export interface RoutedModel {
  model: ModelId;
  tier: ModelTier;
}

export interface RoutableSoul {
  roles: { hero: boolean };
  dialogue: { modelTier: ModelTier };
}

export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const MAX_TOKENS_CAP = 512;

export function offlineReason(gov: GovLevel, ks: ReadonlySet<string>): 'budget' | 'kill_switch' | null {
  if (ks.has('ks:anthropic') || ks.has('ks:genai:all')) return 'kill_switch';
  if (gov >= 3) return 'budget';
  return null;
}

export function routeModel(soul: RoutableSoul, gov: GovLevel, ks: ReadonlySet<string>): RoutedModel {
  const hero = soul.roles.hero && soul.dialogue.modelTier === 'sonnet';
  if (hero && gov < 1 && !ks.has('ks:anthropic:sonnet')) return { model: 'claude-sonnet-5-5', tier: 'sonnet' };
  return { model: 'claude-haiku-5-5', tier: 'haiku' };
}

/** The model fields of the request body for a routed model. */
export function modelFields(r: RoutedModel, format: Record<string, unknown>): { fields: Record<string, unknown>; betas: string[] } {
  const outputConfig = { effort: 'low', format };
  if (r.model === 'claude-sonnet-5-5') {
    return {
      fields: { model: r.model, thinking: { type: 'between_tools' }, output_config: outputConfig, fallbacks: 'default' },
      betas: [SERVER_FALLBACK_BETA],
    };
  }
  return { fields: { model: r.model, thinking: { type: 'disabled' }, output_config: outputConfig }, betas: [] };
}

/** `max_tokens` the Worker sends: the client's value clamped to 512. */
export const clampMaxTokens = (n: number): number => Math.min(MAX_TOKENS_CAP, Math.max(1, Math.trunc(Number.isFinite(n) ? n : MAX_TOKENS_CAP)));
