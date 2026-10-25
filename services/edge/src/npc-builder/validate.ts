import { NPC_GUARDRAILS } from '@dv/shared';
import type { ModerationSignalInput, NpcDraftRow } from '@dv/shared/data-port';
import type { DraftFields, Verdict } from '@dv/shared/npc';
import { now } from '../clock.ts';
import { uuidv7 } from '../uuidv7.ts';
import { classifyText, sheetOf, type ClassifierResult } from './classifier.ts';
import { BUILDER, realNameMatchers } from './data.ts';
import { setJobState, stepEvent, type JobCtx } from './jobs.ts';
import { llamaGuard, type GuardVerdict } from './moderation-llamaguard.ts';
import { openaiModerate, type TextScores } from './moderation-openai.ts';
import { move } from './states.ts';
import type { StoredModeration } from './view.ts';

/**
 * Text validation of a draft (04-npc-builder.md section C5.1; M06b1). Order, with a stop the moment a stage blocks (nothing is sent to another vendor
 * after a block, and nothing at all after suspected CSAM text):
 *   1. names lint: the name, pitch and backstory against the real-side names and aliases (PRIVATE `names/real.json`);
 *   2. OpenAI `omni-moderation-latest`, or Llama Guard 3 when OpenAI is switched off in config, has no key, or fails;
 *   3. the Haiku classifier.
 * Combination: any block gives `rejected_auto`; `sexual/minors` at 0.20 or more (or Llama Guard S4) blocks and opens a P0 CSAM-text case; a
 * classifier `explicit` real person blocks; a possible real person, an alias hit, a named real person or a `review` verdict make the draft
 * non-publishable (private use stays allowed). The signals go to `moderation_signal`; the draft keeps verdicts and numbers, never text.
 */
const MINORS_MILLI = NPC_GUARDRAILS.builder.sexualMinorsMilli;
const per = (m: number): number => m / 1000;

/** OpenAI categories that block outright at the given score, and the ones that send a draft to review (a 17+ game has no sexual UGC). */
const OPENAI_BLOCK: Readonly<Record<string, number>> = {
  sexual: 0.5,
  hate: 0.5,
  'hate/threatening': 0.3,
  'harassment/threatening': 0.5,
  'violence/graphic': 0.85,
  'illicit/violent': 0.8,
  'self-harm/instructions': 0.5,
};
const OPENAI_REVIEW: Readonly<Record<string, number>> = { sexual: 0.2, harassment: 0.6, violence: 0.7, 'self-harm/intent': 0.5, 'self-harm': 0.6, illicit: 0.7 };
/** Llama Guard 3 hazards that mean review (defamation, specialised advice, privacy, IP, elections); S4 is CSAM; the rest block. */
const GUARD_REVIEW: ReadonlySet<string> = new Set(['S5', 'S6', 'S7', 'S8', 'S13']);

export interface TextVerdict {
  verdict: 'allow' | 'review' | 'block';
  csam: boolean;
  reasons: string[];
}

/** Reads the OpenAI scores into a verdict. */
export function judgeOpenAi(s: TextScores): TextVerdict {
  const reasons: string[] = [];
  const csam = (s.scores['sexual/minors'] ?? 0) >= per(MINORS_MILLI);
  if (csam) reasons.push('Content involving minors in a sexual context is not allowed.');
  let block = csam;
  let review = false;
  for (const [cat, limit] of Object.entries(OPENAI_BLOCK)) {
    if ((s.scores[cat] ?? 0) >= limit) {
      block = true;
      if (!csam) reasons.push(`The text was blocked by the content check (${cat}).`);
    }
  }
  for (const [cat, limit] of Object.entries(OPENAI_REVIEW)) {
    if (!block && (s.scores[cat] ?? 0) >= limit) {
      review = true;
      reasons.push(`The text needs a human look (${cat}).`);
    }
  }
  return { verdict: block ? 'block' : review ? 'review' : 'allow', csam, reasons: [...new Set(reasons)] };
}

/** Reads a Llama Guard answer into a verdict. */
export function judgeGuard(g: GuardVerdict): TextVerdict {
  if (g.safe) return { verdict: 'allow', csam: false, reasons: [] };
  const csam = g.categories.includes('S4');
  const hard = g.categories.filter((c) => !GUARD_REVIEW.has(c));
  const reasons = csam ? ['Content involving minors in a sexual context is not allowed.'] : hard.length > 0 ? [`The text was blocked by the content check (${hard.join(', ')}).`] : [`The text needs a human look (${g.categories.join(', ')}).`];
  return { verdict: csam || hard.length > 0 || g.categories.length === 0 ? 'block' : 'review', csam, reasons };
}

/** Reads the classifier answer. `csam` is the classifier's own minors flag. */
export function judgeClassifier(c: ClassifierResult): TextVerdict & { realPerson: 'none' | 'possible' | 'explicit'; named: number } {
  const reasons: string[] = [];
  const csam = c.sexual_minors;
  let verdict: TextVerdict['verdict'] = c.verdict;
  if (csam) reasons.push('Content involving minors in a sexual context is not allowed.');
  if (c.real_person_risk === 'explicit') {
    verdict = 'block';
    reasons.push('The character is a real person; characters must be original.');
  }
  if (c.verdict === 'block' && !csam && c.real_person_risk !== 'explicit') reasons.push('The text was blocked by the content check.');
  if (csam) verdict = 'block';
  return { verdict, csam, reasons, realPerson: c.real_person_risk, named: c.named_real_people.length };
}

const record = async (jc: JobCtx, itemId: string, s: ModerationSignalInput): Promise<void> => {
  await jc.port.moderation.recordSignals(itemId, [s]);
};

/** Runs the chain for a draft in state `validating`; leaves it in `text_ok` or `rejected_auto`. */
export async function runValidate(jc: JobCtx, draftId: string, jobId: string): Promise<void> {
  const draft = await jc.port.builder.getDraft(draftId);
  if (draft === null || draft.state !== 'validating') return;
  await setJobState(jc.port, draft, { id: jobId, kind: 'validate', state: 'running' });
  const fields = draft.fields as unknown as DraftFields;
  const itemId = await jc.port.moderation.ensureItem({ kind: 'npc_draft', id: draft.id, ownerProfileId: draft.owner_profile_id, newId: uuidv7() });
  const stages: NonNullable<StoredModeration['stages']> = {};
  const reasons: string[] = [];
  let block = false;
  let review = false;
  let csam = false;
  let csamSource = '';
  let realPerson: StoredModeration['realPerson'] = 'none';
  let publishable = true;

  // 1. names lint (layer L1 of research section 3.3)
  const { matchers } = await realNameMatchers(jc.env);
  const texts = [fields.name, fields.shortBio, draft.backstory];
  const hits = new Set(matchers.filter((m) => texts.some((t) => m.re.test(t))).map((m) => m.id));
  stages['names_lint'] = { verdict: hits.size > 0 ? 'review' : 'allow', scores: { hits: hits.size } };
  await record(jc, itemId, { source: 'names_lint', sourceVersion: 'names-registry', verdict: hits.size > 0 ? 'review' : 'allow', scores: { hits: hits.size } });
  if (hits.size > 0) {
    publishable = false;
    realPerson = 'possible';
    reasons.push('A name or alias on the real-name list appears in the text, so the character cannot be published.');
  }

  // 2. OpenAI, else Llama Guard. The text is the whole sheet; the chain stops at the first block.
  const sheet = sheetOf(fields, draft.backstory);
  const cfg = BUILDER.config.moderation;
  let judged: TextVerdict | null = null;
  let source = '';
  if (cfg.openai === 'on') {
    const t0 = now();
    const scores = await openaiModerate(jc.env, cfg.openaiModel, sheet);
    if (scores !== null) {
      source = 'openai_omni';
      judged = judgeOpenAi(scores);
      stages['openai_omni'] = { verdict: judged.verdict, scores: scores.scores };
      await record(jc, itemId, { source, sourceVersion: cfg.openaiModel, verdict: judged.verdict, scores: scores.scores, latencyMs: now() - t0 });
    }
  }
  if (judged === null) {
    const t0 = now();
    const g = await llamaGuard(jc.env, cfg.llamaGuardModel, sheet);
    if (g !== null) {
      source = 'llama_guard';
      judged = judgeGuard(g);
      stages['llama_guard'] = { verdict: judged.verdict, scores: { unsafe: g.safe ? 0 : 1, categories: g.categories.join(',') } };
      await record(jc, itemId, { source, sourceVersion: cfg.llamaGuardModel, verdict: judged.verdict, scores: { unsafe: g.safe ? 0 : 1, categories: g.categories }, latencyMs: now() - t0 });
    } else {
      await record(jc, itemId, { source: 'llama_guard', sourceVersion: cfg.llamaGuardModel, verdict: 'error', scores: {} });
      stages['llama_guard'] = { verdict: 'error', scores: {} };
      review = true;
      reasons.push('The content check could not run, so the character cannot be published yet.');
    }
  }
  if (judged !== null) {
    reasons.push(...judged.reasons);
    if (judged.verdict === 'block') block = true;
    if (judged.verdict === 'review') review = true;
    if (judged.csam) {
      csam = true;
      csamSource = source;
    }
  }

  // 3. the Haiku classifier, unless something already blocked
  if (!block) {
    const c = await classifyText(jc.env, jc.deps, sheet, jc.requestId);
    if (c === null) {
      stages['haiku_text'] = { verdict: 'error', scores: {} };
      await record(jc, itemId, { source: 'haiku_text', sourceVersion: cfg.classifierModel, verdict: 'error', scores: {} });
      review = true;
      reasons.push('The character check could not run, so the character cannot be published yet.');
    } else {
      const j = judgeClassifier(c);
      stages['haiku_text'] = { verdict: j.verdict, scores: { real_person_risk: c.real_person_risk, named_real_people: c.named_real_people.length, verdict: c.verdict } };
      await record(jc, itemId, { source: 'haiku_text', sourceVersion: cfg.classifierModel, verdict: j.verdict, scores: { real_person_risk: c.real_person_risk, named: c.named_real_people.length, impersonation: c.impersonation_intent, injection: c.prompt_injection } });
      reasons.push(...j.reasons);
      if (j.verdict === 'block') block = true;
      if (j.verdict === 'review') review = true;
      if (j.csam) {
        csam = true;
        csamSource ||= 'haiku_text';
      }
      if (j.realPerson === 'explicit') realPerson = 'explicit';
      else if ((j.realPerson === 'possible' || j.named > 0) && realPerson === 'none') realPerson = 'possible';
      if (j.realPerson !== 'none' || j.named > 0 || c.impersonation_intent) {
        publishable = false;
        if (j.realPerson !== 'explicit') reasons.push('The text may be about a real person, so the character cannot be published.');
      }
    }
  }
  if (review) publishable = false;
  if (realPerson === 'explicit') block = true;
  if (block) publishable = false;

  if (csam) {
    // A P0 case with a snapshot that holds ids and verdicts only; the reviewer reads the draft itself.
    await jc.port.moderation.openCase({
      id: uuidv7(),
      itemId,
      queue: 'P0_CSAM',
      reason: 'text_csam',
      openedBy: `auto:${csamSource}`,
      snapshot: { draftId: draft.id, npcId: draft.npc_id, rev: draft.rev, ownerProfileId: draft.owner_profile_id, source: csamSource, stages },
    });
    await jc.port.moderation.setItemState(itemId, 'quarantined');
  } else {
    await jc.port.moderation.setItemState(itemId, block ? 'rejected' : 'auto_allowed');
  }

  const verdict: Verdict = block ? 'block' : review ? 'review' : 'allow';
  const moderation: StoredModeration = { text: verdict, realPerson, publishable, reasons: [...new Set(reasons)], stages };
  const to = block ? move('validating', 'rejected_auto') : move('validating', 'text_ok');
  await jc.port.builder.updateDraft(
    draft.id,
    { state: to, moderation: moderation as unknown as NpcDraftRow['moderation'], publishable },
    { fromStates: ['validating'] },
  );
  const after = await jc.port.builder.getDraft(draft.id);
  if (after !== null) await setJobState(jc.port, after, { id: jobId, kind: 'validate', state: 'done' });
  stepEvent(jc.env, 'validate', !block);
}
