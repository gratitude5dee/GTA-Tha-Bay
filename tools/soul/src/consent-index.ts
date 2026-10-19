/**
 * npc:consent-index. Writes config/consent-index.json from content-private/consents/*.json when the private mount is
 * present, otherwise an empty index (spec/domains/04-npc-contracts.md section B9; the DB export arrives with M10c).
 * likeness:gate reads the result. Only ids, scopes and term_end are exported, never names.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ConsentEntry, ConsentIndex } from '../../../packages/shared/src/assets/gates/likeness.ts';
import { privateMounted } from './common.ts';

export const CONSENT_INDEX_PATH = 'config/consent-index.json';

interface ConsentFile { id?: unknown; subject_id?: unknown; subjectId?: unknown; scopes?: unknown; term_end?: unknown; termEnd?: unknown }

export function buildConsentIndex(root: string): { index: ConsentIndex; source: 'content-private' | 'empty'; problems: string[] } {
  const problems: string[] = [];
  const dir = path.join(root, 'content-private', 'consents');
  if (!privateMounted(root) || !existsSync(dir)) return { index: { schema: 'consent-index/1', entries: [] }, source: 'empty', problems };
  const entries: ConsentEntry[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    let j: ConsentFile;
    try {
      j = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as ConsentFile;
    } catch (e) {
      problems.push(`${name}: ${(e as Error).message}`);
      continue;
    }
    const subject = j.subject_id ?? j.subjectId ?? null;
    const term = j.term_end ?? j.termEnd ?? null;
    if (typeof j.id !== 'string' || !Array.isArray(j.scopes) || !j.scopes.every((s) => typeof s === 'string')) {
      problems.push(`${name}: needs a string id and a string[] scopes`);
      continue;
    }
    if ((subject !== null && typeof subject !== 'string') || (term !== null && typeof term !== 'string')) {
      problems.push(`${name}: subject_id and term_end are strings or null`);
      continue;
    }
    entries.push({ id: j.id, subject_id: subject, scopes: [...(j.scopes as string[])].sort(), term_end: term });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { index: { schema: 'consent-index/1', entries }, source: 'content-private', problems };
}

export function writeConsentIndex(root: string): { path: string; entries: number; source: string; problems: string[] } {
  const { index, source, problems } = buildConsentIndex(root);
  const p = path.join(root, CONSENT_INDEX_PATH);
  if (!problems.length) writeFileSync(p, `${JSON.stringify(index, null, 2)}\n`);
  return { path: CONSENT_INDEX_PATH, entries: index.entries.length, source, problems };
}
