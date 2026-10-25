import { assembleSoul, deriveInk, lintBuilderSoul, writeSoulMd, type BuilderLintEnv, type BuilderServerFields, type LlmSoul } from '@dv/shared/npc';
import type { LintIssue } from '@dv/shared/npc';
import { validateSoulLlm, formatIssue } from '@dv/shared/npc';

/**
 * The model's answer to soul.md and its fallback ink (04-npc-builder.md section C4, "Derived output"). The shape of the answer is checked against the generated
 * LLM schema, the server-owned fields are merged in, the bytes are written by the deterministic writer of @dv/shared, and the lints run on the written file,
 * exactly as they will read it later.
 */
export interface BuiltSoul {
  md: string;
  ink: string;
  issues: LintIssue[];
  front?: ReturnType<typeof lintBuilderSoul>['front'];
  sections?: Record<string, string>;
}

export function buildSoul(raw: Record<string, unknown> | null, server: BuilderServerFields, env: BuilderLintEnv): BuiltSoul {
  if (raw === null) return { md: '', ink: '', issues: [{ rule: 'schema', path: '', message: 'The answer was not a JSON object.' }] };
  const shape = validateSoulLlm(raw);
  if (shape.length > 0) return { md: '', ink: '', issues: shape.slice(0, 12).map((i) => ({ rule: 'schema', path: i.path, message: formatIssue(i) })) };
  const { front, sections } = assembleSoul(server, raw as unknown as LlmSoul);
  const md = writeSoulMd(front, sections);
  const r = lintBuilderSoul(md, env);
  return { md, ink: deriveInk(sections['Example lines'] ?? ''), issues: r.issues, ...(r.front === undefined ? {} : { front: r.front }), ...(r.sections === undefined ? {} : { sections: r.sections }) };
}

/** The error list a repair call carries: rule, place and message, one per line, at most 20. No text of the player's is in it. */
export function repairNote(issues: readonly LintIssue[]): string {
  return issues
    .slice(0, 20)
    .map((i) => `- ${i.rule}${i.path === '' ? '' : ` at ${i.path}`}: ${i.message}`)
    .join('\n');
}
