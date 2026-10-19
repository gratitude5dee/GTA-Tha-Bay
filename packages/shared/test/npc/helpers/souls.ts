/** Test helpers: repo root, shipped souls, rules block. Not a test file. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RulesBlock } from '../../../src/npc/compile.ts';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
export const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export const SHIPPED_IDS = ['canary-mc', 'npc_test', 'ro-batista', 'standin_founder', 'standin_rapper'] as const;

export const readText = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
export const shippedSoul = (id: string): string => readText(`content/npcs/${id}/soul.md`);
export const fixtureSoul = (rel: string): string => readFileSync(path.join(fixtureDir, rel, 'soul.md'), 'utf8');

/** Block A as the CLI loads it: the text between the <rules> markers of the public example. */
export function rulesBlock(): RulesBlock {
  const name = readdirSync(path.join(repoRoot, 'content/prompts/npc')).find((n) => /^rules@\d+\.example\.md$/.test(n)) as string;
  const text = readText(`content/prompts/npc/${name}`);
  const m = /<rules>\n([\s\S]*?)\n<\/rules>/.exec(text) as RegExpExecArray;
  return { version: Number(/@(\d+)/.exec(name)?.[1]), text: (m[1] as string).trim() };
}
