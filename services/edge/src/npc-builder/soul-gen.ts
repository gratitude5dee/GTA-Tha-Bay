import { NPC_GUARDRAILS } from '@dv/shared';
import type { DraftPatch, NpcDraftRow } from '@dv/shared/data-port';
import type { DraftFields, LintIssue } from '@dv/shared/npc';
import llmSchema from '@dv/shared/schemas/npc/soul-1.0.llm.schema.json' with { type: 'json' };
import { now, utcDay } from '../clock.ts';
import { playerQuota } from '../budget/quota.ts';
import { BUILDER, lintEnvFor, districtPois, realNameMatchers } from './data.ts';
import { BUILDER_FIXTURE_NPC, builderUpstream, BuilderUnavailable, callModel, formatOf, parseJsonObject } from './llm.ts';
import { sheetOf } from './classifier.ts';
import { setJobState, stepEvent, type JobCtx } from './jobs.ts';
import { runProbes } from './probes.ts';
import { move } from './states.ts';
import { buildSoul, repairNote, type BuiltSoul } from './soul-write.ts';
import type { StoredModeration } from './view.ts';

/**
 * Soul generation (04-npc-builder.md section C4; M06b1). Sonnet 5.5 with adaptive thinking and effort `medium`, up to 8,000 output tokens,
 * `output_config.format` = the generated LLM schema, no sampling parameter and no prefill. The player's text is an untrusted character sheet in the
 * user message; the place list, the goal catalog and the voice are server data after it. The merged soul runs the canonical schema and the lints; one
 * repair call at most, then `soul_failed` and the author edits. A reservation (`builder_text`) pays for the run and is settled with the real cost, or
 * given back when no model call was made.
 */
export const SERVER_HEIGHT_M = 1.75;

function userMessage(draft: NpcDraftRow, fields: DraftFields): string {
  const pois = districtPois(fields.district) ?? [];
  return [
    sheetOf(fields, draft.backstory),
    '',
    `District: ${fields.district}`,
    `Places in this district (use only these ids): ${pois.join(', ')}`,
    `Goals (use only these ids): ${BUILDER.goals.join(', ')}`,
  ].join('\n');
}

function body(messages: Record<string, unknown>[]): Record<string, unknown> {
  return {
    model: BUILDER.config.soul.model,
    max_tokens: NPC_GUARDRAILS.builder.soulMaxTokens,
    thinking: { type: BUILDER.config.soul.thinking },
    output_config: { effort: BUILDER.config.soul.effort, format: formatOf(llmSchema as Record<string, unknown>) },
    system: BUILDER.prompts.soul,
    messages,
  };
}

export type SoulOutcome = 'ready' | 'failed' | 'unavailable';

/** Runs the generation of a draft in state `soul_generating`; leaves it `soul_ready` (and then probes it), or `soul_failed`. */
export async function runSoul(jc: JobCtx, draftId: string, jobId: string, reservationId: string): Promise<SoulOutcome> {
  const draft = await jc.port.builder.getDraft(draftId);
  if (draft === null || draft.state !== 'soul_generating') return 'unavailable';
  const q = playerQuota(jc.env, draft.owner_profile_id);
  await setJobState(jc.port, draft, { id: jobId, kind: 'soul', state: 'running' });
  const fields = draft.fields as unknown as DraftFields;
  const prior = await jc.port.builder.getSoul(draft.npc_id);
  const server = {
    npcId: draft.npc_id,
    soulVersion: (prior?.soul_version ?? 0) + 1,
    ownerProfileId: draft.owner_profile_id,
    name: fields.name,
    archetype: fields.archetype,
    tags: fields.tags,
    district: fields.district,
    voiceRef: fields.voiceRef,
    heightM: SERVER_HEIGHT_M,
    model: BUILDER.config.soul.model,
    date: utcDay(now()),
  };
  const lintEnv = await lintEnvFor(jc.env, fields.district);

  let spent = 0;
  let calls = 0;
  const fail = async (state: 'soul_failed', issues: LintIssue[], released: boolean, md = ''): Promise<SoulOutcome> => {
    if (released) await q.release(reservationId);
    else await q.settle(reservationId, spent, { vendor: 'anthropic', model: BUILDER.config.soul.model });
    const patch: DraftPatch = { state: move('soul_generating', state), lint: issues as unknown as NpcDraftRow['lint'], ...(md === '' ? {} : { soul_md: md }) };
    await jc.port.builder.updateDraft(draft.id, patch, { fromStates: ['soul_generating'] });
    const after = await jc.port.builder.getDraft(draft.id);
    if (after !== null) await setJobState(jc.port, after, { id: jobId, kind: 'soul', state: 'failed' });
    stepEvent(jc.env, 'soul', false);
    return released ? 'unavailable' : 'failed';
  };

  let up;
  try {
    up = builderUpstream(jc.env);
  } catch {
    return fail('soul_failed', [{ rule: 'upstream', path: '', message: 'The writer is not available right now. Try again later.' }], true);
  }

  let built: BuiltSoul | null = null;
  let previous = '';
  let issues: LintIssue[] = [];
  const first = userMessage(draft, fields);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages: Record<string, unknown>[] = [{ role: 'user', content: first }];
      if (attempt === 1) {
        messages.push({ role: 'assistant', content: previous }, { role: 'user', content: `${BUILDER.prompts.repair}\n\nProblems:\n${repairNote(issues)}` });
      }
      const ans = await callModel(jc.env, up, body(messages), { npcId: BUILDER_FIXTURE_NPC, intent: `${attempt === 0 ? 'builder-soul' : 'builder-repair'}:${fields.district}`, hero: true });
      calls++;
      spent += ans.micros;
      previous = ans.text;
      built = buildSoul(parseJsonObject(ans.text), server, lintEnv);
      issues = built.issues;
      if (issues.length === 0) break;
    }
  } catch (e) {
    if (e instanceof BuilderUnavailable) {
      // Nothing usable came back. A call that was made is paid for; one that never started is given back.
      return fail('soul_failed', [{ rule: 'upstream', path: '', message: 'The writer did not finish. Try again later.' }], calls === 0);
    }
    throw e;
  }
  if (built === null || issues.length > 0) return fail('soul_failed', issues, false, built?.md ?? '');

  // Real-person signals the model raised, and real-side names anywhere in the written file, make the character non-publishable (private use stays).
  const raw = parseJsonObject(previous) ?? {};
  const stored = draft.moderation as unknown as Partial<StoredModeration>;
  const reasons = [...(stored.reasons ?? [])];
  let publishable = draft.publishable;
  let realPerson = stored.realPerson ?? 'none';
  const { matchers } = await realNameMatchers(jc.env);
  if (raw['realPersonSuspected'] === true || (Array.isArray(raw['namedPeople']) && raw['namedPeople'].length > 0) || matchers.some((m) => m.re.test(built.md))) {
    publishable = false;
    if (realPerson === 'none') realPerson = 'possible';
    reasons.push('The written character may refer to a real person, so it cannot be published.');
  }
  await q.settle(reservationId, spent, { vendor: 'anthropic', model: BUILDER.config.soul.model });
  const moderation: StoredModeration = { ...(stored as StoredModeration), text: stored.text ?? 'allow', realPerson, publishable, reasons: [...new Set(reasons)] };
  await jc.port.builder.updateDraft(
    draft.id,
    {
      state: move('soul_generating', 'soul_ready'),
      soul_md: built.md,
      lint: [],
      probes: null,
      publishable,
      moderation: moderation as unknown as NpcDraftRow['moderation'],
      soul_version: server.soulVersion,
    },
    { fromStates: ['soul_generating'] },
  );
  const after = await jc.port.builder.getDraft(draft.id);
  if (after !== null) await setJobState(jc.port, after, { id: jobId, kind: 'soul', state: 'done' });
  stepEvent(jc.env, 'soul', true);
  // The probes run after every soul change (section C1: soul_ready -> probing, automatic).
  await runProbes(jc, draft.id);
  return 'ready';
}
