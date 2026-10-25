import type { NpcDraftRow } from '@dv/shared/data-port';
import { parseSoul, type DraftFields, type DraftView, type LintIssue, type Verdict } from '@dv/shared/npc';

/**
 * `DraftView` (04-npc-builder.md section C3) from a row. Everything an author may see of their own draft; the backstory text itself is not
 * part of the view (only its length), and the per-stage scores of the moderation stay in the row.
 */
export interface StoredModeration {
  text: Verdict | null;
  realPerson: 'none' | 'possible' | 'explicit';
  publishable: boolean;
  reasons: string[];
  /** Per-stage verdicts (`names_lint`, `openai_omni`, `llama_guard`, `haiku_text`); scores are numbers only. */
  stages?: Record<string, { verdict: string; scores: Record<string, number | string | boolean> }>;
}

export interface StoredJob {
  id: string;
  kind: 'validate' | 'soul' | 'images' | 'assets';
  state: 'queued' | 'running' | 'done' | 'failed';
}

export interface StoredProbes {
  passed: number;
  total: 5;
  failures: string[];
  /** One entry per probe: its name, whether it passed, and the character's reply (at most 280 characters). */
  results?: { name: string; ok: boolean; line: string }[];
}

export const EMPTY_MODERATION: StoredModeration = { text: null, realPerson: 'none', publishable: true, reasons: [] };

export function draftView(row: NpcDraftRow, limits: DraftView['limits']): DraftView {
  const stored = row.moderation as unknown as Partial<StoredModeration>;
  let soul: DraftView['soul'] = null;
  if (row.soul_md !== null) {
    try {
      const p = parseSoul(row.soul_md);
      soul = { frontmatter: p.front, sections: p.sections };
    } catch {
      soul = null;
    }
  }
  const probes = row.probes as unknown as StoredProbes | null;
  return {
    id: row.id,
    npcId: row.npc_id,
    rev: row.rev,
    state: row.state as DraftView['state'],
    fields: row.fields as unknown as DraftFields,
    backstoryChars: Array.from(row.backstory).length,
    images: [],
    moderation: {
      text: stored.text ?? null,
      images: null,
      realPerson: stored.realPerson ?? 'none',
      publishable: row.publishable,
      reasons: stored.reasons ?? [],
    },
    soul,
    lint: row.lint as unknown as LintIssue[],
    probes: probes === null ? null : { passed: probes.passed, total: 5, failures: probes.failures },
    publish: { soulVersion: row.soul_version, caseId: null, notes: null },
    jobs: (row.jobs as unknown as StoredJob[]).slice(-10),
    limits,
  };
}
