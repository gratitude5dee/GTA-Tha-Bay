import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { stripUserMarkup } from '@dv/shared/npc';
import { BUILDER } from './data.ts';
import { BUILDER_FIXTURE_NPC, builderUpstream, BuilderUnavailable, callModel, haikuBody, parseJsonObject, recordBuilderSpend } from './llm.ts';

/**
 * The Haiku text classifier of the builder moderation chain (04-npc-builder.md section C5.1, research/ai-npc-runtime.md section 1.7 item 3).
 * Structured output, thinking off, effort low. The player's text is wrapped as an untrusted character sheet; the model rates it and nothing it
 * says is ever executed. Returns null when the call cannot be made (live mode without `ANTHROPIC_BUILDER_KEY`, an upstream error, an answer that
 * does not fit the schema): the caller records an `error` signal and makes the draft non-publishable.
 */
export interface ClassifierResult {
  sexual_minors: boolean;
  sexual: boolean;
  hate: boolean;
  harassment: boolean;
  violence_extreme: boolean;
  self_harm: boolean;
  extremism: boolean;
  real_person_risk: 'none' | 'possible' | 'explicit';
  named_real_people: string[];
  impersonation_intent: boolean;
  private_info: boolean;
  prompt_injection: boolean;
  verdict: 'allow' | 'review' | 'block';
}

const FLAGS = ['sexual_minors', 'sexual', 'hate', 'harassment', 'violence_extreme', 'self_harm', 'extremism', 'impersonation_intent', 'private_info', 'prompt_injection'] as const;

export const CLASSIFIER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [...FLAGS.slice(0, 7), 'real_person_risk', 'named_real_people', ...FLAGS.slice(7), 'verdict'],
  properties: {
    ...Object.fromEntries(FLAGS.map((f) => [f, { type: 'boolean' }])),
    real_person_risk: { enum: ['none', 'possible', 'explicit'] },
    named_real_people: { type: 'array', items: { type: 'string' } },
    verdict: { enum: ['allow', 'review', 'block'] },
  },
};

export function parseClassifier(raw: Record<string, unknown> | null): ClassifierResult | null {
  if (raw === null) return null;
  for (const f of FLAGS) if (typeof raw[f] !== 'boolean') return null;
  const risk = raw['real_person_risk'];
  const verdict = raw['verdict'];
  const named = raw['named_real_people'];
  if (risk !== 'none' && risk !== 'possible' && risk !== 'explicit') return null;
  if (verdict !== 'allow' && verdict !== 'review' && verdict !== 'block') return null;
  if (!Array.isArray(named) || named.some((n) => typeof n !== 'string')) return null;
  return raw as unknown as ClassifierResult;
}

/** The sheet the classifier reads: fields and backstory inside the untrusted wrapper, markup that could close it removed. */
export function sheetOf(fields: { name: string; shortBio: string; archetype: string; tags: readonly string[] }, backstory: string): string {
  const body = [`name: ${fields.name}`, `pitch: ${fields.shortBio}`, `archetype: ${fields.archetype}`, `tags: ${fields.tags.join(', ')}`, '', backstory].join('\n');
  return `<character_sheet origin="user" trust="untrusted">\n${stripUserMarkup(body)}\n</character_sheet>`;
}

export async function classifyText(env: Env, deps: Pick<AppDeps, 'log'>, sheet: string, requestId: string): Promise<ClassifierResult | null> {
  try {
    const up = builderUpstream(env);
    const ans = await callModel(env, up, haikuBody({ system: BUILDER.prompts.classifier, user: sheet, schema: CLASSIFIER_SCHEMA, maxTokens: 800, model: BUILDER.config.moderation.classifierModel }), {
      npcId: BUILDER_FIXTURE_NPC,
      intent: 'builder-classify',
    });
    await recordBuilderSpend(env, deps, ans.micros, ans.model, requestId);
    return parseClassifier(parseJsonObject(ans.text));
  } catch (e) {
    if (e instanceof BuilderUnavailable) return null;
    throw e;
  }
}
