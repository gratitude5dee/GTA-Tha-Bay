/**
 * npc:normalize <slug> --fixture <recorded.json>. Turns a recorded structured model output (research layer to soul draft) into a
 * soul.md draft under <out>/normalize/<slug>/ and lints it. M06a2 runs against recorded output only: the research layer
 * (research/characters/<slug>/) is not supplied (Q-19) and real-derived souls stay in content-private/ (Q-25).
 * The draft is always `status: draft`, unreviewed, and never written into content/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { SECTION_ORDER } from '../../../packages/shared/src/npc/parse.ts';
import { formatIssue, validateSoul } from '../../../packages/shared/src/npc/validate.ts';
import { buildLintEnv, lintSoul } from './lint.ts';

export interface RecordedNormalize {
  model: string;
  recordedAt: string;
  frontmatter: Record<string, unknown>;
  sections: Record<string, string>;
}

export function renderSoulMd(front: Record<string, unknown>, sections: Record<string, string>): string {
  const names = [...SECTION_ORDER.filter((n) => sections[n] !== undefined), ...Object.keys(sections).filter((n) => !(SECTION_ORDER as readonly string[]).includes(n)).sort()];
  const yaml = stringify(front, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${names.map((n) => `## ${n}\n${(sections[n] as string).trim()}\n`).join('\n')}`;
}

export async function normalize(
  root: string,
  slug: string,
  fixturePath: string | undefined,
  out: string,
  log: (l: string) => void,
): Promise<{ ok: boolean; problems: string[] }> {
  if (!fixturePath) {
    log('SKIP npc:normalize live call: the research layer is not supplied (Q-19) and needs ANTHROPIC_API_KEY; pass --fixture <recorded.json>');
    return { ok: true, problems: [] };
  }
  const rec = JSON.parse(readFileSync(path.resolve(root, fixturePath), 'utf8')) as RecordedNormalize;
  const front: Record<string, unknown> = {
    ...rec.frontmatter,
    status: 'draft',
    provenance: {
      ...((rec.frontmatter.provenance as Record<string, unknown> | undefined) ?? {}),
      generatedBy: { model: rec.model, date: rec.recordedAt },
      reviewedBy: null,
      reviewedAt: null,
    },
  };
  const issues = validateSoul(front);
  if (issues.length) return { ok: false, problems: issues.map((i) => `schema: ${formatIssue(i)}`) };
  const md = renderSoulMd(front, rec.sections);
  const dir = path.resolve(root, out, 'normalize', slug);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'soul.md');
  writeFileSync(file, md);
  const env = buildLintEnv({ root, extraRosterIds: [String(front.id)], noTokenWrite: true, log });
  const res = await lintSoul(path.relative(root, file), md, env);
  const problems = res.issues.map((i) => `${i.rule}: ${i.message}`);
  log(`npc:normalize: ${slug}: draft written to ${path.relative(root, file)} (status draft, unreviewed); ${problems.length ? `${problems.length} lint issues` : 'lint clean'}`);
  return { ok: true, problems };
}
