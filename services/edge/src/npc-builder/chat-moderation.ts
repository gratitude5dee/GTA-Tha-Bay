import { NPC_GUARDRAILS } from '@dv/shared';
import { uuidv7 } from '../uuidv7.ts';
import type { ModerationInput } from '../npc/safety.ts';
import type { AppDeps } from '../deps.ts';
import { BUILDER } from './bundle.ts';
import { llamaGuard } from './moderation-llamaguard.ts';
import { openaiModerate } from './moderation-openai.ts';
import { builderPort } from './port.ts';

/**
 * Asynchronous moderation of the player's text in a dialogue (04-npc.md section 5.4.2; research/gap-trust-safety-tooling.md section 6.4, "NPC chat"). It
 * runs after the stream has started, so it never delays a line. The text goes to OpenAI `omni-moderation-latest` (Llama Guard 3 when OpenAI is off,
 * has no key or fails):
 *  - `sexual/minors` at or above 0.20, or Llama Guard S4: the encounter ends and a P0 CSAM-text case opens (the case holds ids and scores, never text);
 *  - `self-harm/intent` at or above 0.50, or Llama Guard S11: the encounter's next `meta` carries `safety: 'crisis'` once (C10 1.1, DL-226).
 * Replaces the logging stub of M06a3. A vendor that is unavailable decides nothing (the local prefilter has already run).
 */
export async function moderatePlayerText(deps: Pick<AppDeps, 'data' | 'log'>, input: ModerationInput): Promise<void> {
  const env = input.env;
  if (env === undefined || input.text === '') return;
  const cfg = BUILDER.config.moderation;
  let csam = false;
  let crisis = false;
  let source = '';
  let scores: Record<string, number | string> = {};
  if (cfg.openai === 'on') {
    const r = await openaiModerate(env, cfg.openaiModel, input.text);
    if (r !== null) {
      source = 'openai_omni';
      scores = { 'sexual/minors': r.scores['sexual/minors'] ?? 0, 'self-harm/intent': r.scores['self-harm/intent'] ?? 0 };
      csam = (r.scores['sexual/minors'] ?? 0) >= NPC_GUARDRAILS.builder.sexualMinorsMilli / 1000;
      crisis = (r.scores['self-harm/intent'] ?? 0) >= NPC_GUARDRAILS.builder.selfHarmIntentMilli / 1000;
    }
  }
  if (source === '') {
    const g = await llamaGuard(env, cfg.llamaGuardModel, input.text);
    if (g === null) return;
    source = 'llama_guard';
    scores = { unsafe: g.safe ? 0 : 1, categories: g.categories.join(',') };
    csam = g.categories.includes('S4');
    crisis = g.categories.includes('S11');
  }
  if (crisis) await input.flagCrisis();
  if (!csam) return;
  const p = builderPort(env, deps);
  if (p !== null && input.profileId !== undefined) {
    try {
      const subject = `${input.encounterId ?? 'unknown'}:${input.turnIndex ?? 0}`;
      const itemId = await p.port.moderation.ensureItem({ kind: 'chat_turn', id: subject, ownerProfileId: input.profileId, newId: uuidv7() });
      await p.port.moderation.recordSignals(itemId, [{ source, sourceVersion: source === 'openai_omni' ? cfg.openaiModel : cfg.llamaGuardModel, verdict: 'quarantine', scores }]);
      await p.port.moderation.openCase({
        id: uuidv7(),
        itemId,
        queue: 'P0_CSAM',
        reason: 'chat_text_csam',
        openedBy: `auto:${source}`,
        snapshot: { encounterId: input.encounterId ?? null, turnIndex: input.turnIndex ?? null, npcId: input.npcId, ownerProfileId: input.profileId, source, scores },
      });
      await p.port.moderation.setItemState(itemId, 'quarantined');
    } catch {
      deps.log(JSON.stringify({ event: 'moderation.case.failed' }));
    }
  }
  await input.closeEncounter?.();
}
