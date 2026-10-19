/**
 * npc:summarize <id> --fixture <recorded.json>. Proposes the `## Identity` summary of a soul from its `## Backstory` for
 * human review (spec/domains/04-npc-contracts.md section B3). M06a2 runs against recorded model output only; the live call
 * and the research layer arrive with M10c (Q-19, Q-25). The recorded file is checked against the Backstory it was made from.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sha256Hex } from '../../../packages/shared/src/hash.ts';
import { findContactInfo } from '../../../packages/shared/src/npc/pii.ts';
import { BACKSTORY_SECTION, parseSoul } from '../../../packages/shared/src/npc/parse.ts';
import { soulPathFor } from './compile.ts';
import { estimateTokens } from './tokens.ts';

export interface RecordedSummary { model: string; recordedAt: string; backstorySha256: string; summary: string }

export const SUMMARY_TOKEN_LIMIT = 300;

/** True when `summary` repeats a run of `window` characters of `source` word for word. */
export function copiesSource(summary: string, source: string, window = 60): boolean {
  const s = summary.replace(/\s+/g, ' ');
  const src = source.replace(/\s+/g, ' ');
  for (let i = 0; i + window <= src.length; i += 10) if (s.includes(src.slice(i, i + window))) return true;
  return false;
}

export function summarize(root: string, idOrPath: string, fixturePath: string | undefined, out: string, log: (l: string) => void): { ok: boolean; problems: string[] } {
  const parsed = parseSoul(readFileSync(soulPathFor(root, idOrPath), 'utf8'));
  const backstory = parsed.sections[BACKSTORY_SECTION];
  if (!backstory) return { ok: false, problems: [`${parsed.front.id}: the soul has no "## ${BACKSTORY_SECTION}" section to summarize`] };
  if (!fixturePath) {
    log('SKIP npc:summarize live call: needs ANTHROPIC_API_KEY and the research layer (M10c, Q-19); pass --fixture <recorded.json>');
    return { ok: true, problems: [] };
  }
  const rec = JSON.parse(readFileSync(path.resolve(root, fixturePath), 'utf8')) as RecordedSummary;
  const problems: string[] = [];
  if (rec.backstorySha256 !== sha256Hex(backstory)) problems.push('the recording was made from a different Backstory (sha256 differs); record it again');
  if (typeof rec.summary !== 'string' || rec.summary.trim() === '') problems.push('the recording has no summary');
  else {
    if (estimateTokens(rec.summary).upper > SUMMARY_TOKEN_LIMIT) problems.push(`the summary may exceed ${SUMMARY_TOKEN_LIMIT} tokens`);
    for (const c of findContactInfo(rec.summary)) problems.push(`the summary contains a ${c.kind}`);
    if (copiesSource(rec.summary, backstory)) problems.push('the summary repeats the Backstory verbatim; it must be a paraphrase');
  }
  if (problems.length) return { ok: false, problems };
  const dir = path.resolve(root, out, 'summaries');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${parsed.front.id}.md`);
  writeFileSync(file, `## Identity (proposed, for human review)\n${rec.summary.trim()}\n`);
  log(`npc:summarize: ${parsed.front.id}: proposed Identity summary written to ${path.relative(root, file)} (model ${rec.model}, recorded ${rec.recordedAt}); a human reviews it before it enters soul.md`);
  return { ok: true, problems: [] };
}
