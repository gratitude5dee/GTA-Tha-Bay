/**
 * `check:assets` rules for the shipped cutscene index (M05b2): the file parses, has the right schema, is sorted, carries no prompt,
 * URL or `previs/` reference, and every entry has a fallback and unique refs. Absent index: nothing to check.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { finding, type GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import type { CutsceneIndex } from '../../../packages/shared/src/contracts/c09-cutscene.ts';

const GATE = 'check:assets';
export const INDEX_PATH = 'assets/src/data/cutscene-index/index.json';
const KEY = /^[0-9a-f]{64}$/;

export function cutsceneIndexFindings(root: string): { findings: GateFinding[]; scanned: number } {
  const file = path.join(root, INDEX_PATH);
  if (!existsSync(file)) return { findings: [], scanned: 0 };
  const out: GateFinding[] = [];
  const add = (rule: string, detail: string): void => void out.push(finding(GATE, INDEX_PATH, rule, detail));
  let index: CutsceneIndex;
  try {
    index = JSON.parse(readFileSync(file, 'utf8')) as CutsceneIndex;
  } catch (e) {
    add('cutscene-index-unreadable', (e as Error).message);
    return { findings: out, scanned: 1 };
  }
  if (index.schema !== 'cutscene-index/1') add('cutscene-index-schema', `schema is ${String(index.schema)}`);
  const text = readFileSync(file, 'utf8');
  if (/previs\//.test(text)) add('cutscene-index-previs', 'the index references previs/');
  if (/https?:\/\//.test(text)) add('cutscene-index-url', 'the index holds a URL; it is public data without URLs');
  if (/"(?:prompt|keyframePrompt|shots)"/.test(text)) add('cutscene-index-prompt', 'the index holds prompt data; prompts live in the private requests file');
  const seen = new Set<string>();
  let last = '';
  for (const e of index.entries ?? []) {
    if (!KEY.test(e.key)) add('cutscene-index-key', `${e.ref}: key is not SHA-256 hex`);
    if (!e.fallback) add('cutscene-index-fallback', `${e.ref}: no fallback DirectorScript`);
    if (seen.has(e.ref)) add('cutscene-index-duplicate', `${e.ref} appears twice`);
    seen.add(e.ref);
    if (e.ref < last) add('cutscene-index-order', `${e.ref} is out of order`);
    last = e.ref;
  }
  return { findings: out, scanned: 1 };
}
