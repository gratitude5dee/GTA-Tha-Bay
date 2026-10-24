/**
 * `docs/releases/<tag>/cutscenes.md` (M05c3): which Act 1 refs ship a generated clip and which stay in-engine. Deterministic:
 * no timestamps, so a rerun with the same state writes the same bytes.
 */
export interface ReportRow {
  ref: string;
  key: string;
  generated: boolean;
  /** Why a ref is in-engine; empty for a generated one. */
  note: string;
}

export interface ReportInput {
  release: string;
  /** Registry provider key, or null when none was cleared. */
  provider: string | null;
  rows: readonly ReportRow[];
  /** Ledger delta (kind `cutscene`) of the live run in USD micros, or null when not measured. */
  deltaMicros: number | null;
}

export function renderReport(i: ReportInput): string {
  const generated = i.rows.filter((r) => r.generated).length;
  const lines = [
    `# Cutscenes in release ${i.release}`,
    '',
    'Written by `pnpm assets:gen prewarm -- --report`. Do not edit by hand; see `docs/releases/README.md`.',
    '',
    `- Provider: ${i.provider ?? 'none cleared (ADR-GENAI-01); Act 1 ships fallback-only'}`,
    `- Generated clips: ${generated} of ${i.rows.length}`,
    `- In-engine (DirectorScript with subtitles): ${i.rows.length - generated} of ${i.rows.length}`,
    `- Ledger delta of the last live run (kind cutscene): ${i.deltaMicros === null ? 'not measured' : `${i.deltaMicros} micros`}`,
    '',
    '| Ref | Key | Plays | Note |',
    '|---|---|---|---|',
    ...i.rows.map((r) => `| ${r.ref} | ${r.key.slice(0, 12)} | ${r.generated ? 'generated clip' : 'in-engine'} | ${r.note} |`),
    '',
  ];
  return lines.join('\n');
}
