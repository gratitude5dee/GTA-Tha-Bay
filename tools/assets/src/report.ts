/**
 * The M10a2 batch report (`docs/runbooks/reports/M10a2-batch.md`): which slugs the batch holds, how far each one is, who decided each human
 * gate, what each cost from the ledger, which moves still play library clips, and the state of the six Coast rows. Pure and deterministic: no
 * clock and no environment in the text, so a rerun over the same files writes the same bytes. `tools/assets/gen/batch-report.ts` gathers the
 * input from the repository and writes the file.
 */
export interface BatchStage { stage: string; endpointId: string; units: number; totalMicros: number }

export interface BatchDecision { gate: string; by: string; decision: string; choose?: number }

export interface BatchSlug {
  slug: string;
  pipeline: string;
  /** The plan row: `ok`, `blocked` or `refused`, and its reason text. */
  status: string;
  reason: string;
  estimateMicros: number;
  stages: readonly BatchStage[];
  /** Human gate decisions from the run record, in the order recorded. */
  decisions: readonly BatchDecision[];
  /** Ledger rows of the slug by stage, in micros. */
  spentByStage: Readonly<Record<string, number>>;
  /** `character/<slug>` is in the lock. */
  published: boolean;
}

export interface FallbackKit { kit: string; moves: readonly { id: string; clip: string }[]; authored: number }

export interface CoastRow { row: string; slot: string; model: string | null; portrait: string | null }

export interface BatchReportInput {
  slugs: readonly BatchSlug[];
  lineCapMicros: number;
  ledgerMicros: number;
  roomMicros: number;
  leanMicros: number;
  /** The recorded fal dashboard reconcile, or null while the operator has not done it. */
  reconcile: { dashboardMicros: number; note: string } | null;
  fallbacks: readonly FallbackKit[];
  coast: readonly CoastRow[];
  /** Why no live run happened in this build, or null. */
  notRun: string | null;
}

const usd = (m: number): string => `$${(m / 1_000_000).toFixed(2)}`;
const micros = (m: number): string => m.toLocaleString('en-US');

export function renderBatchReport(i: BatchReportInput): string {
  const spent = (s: BatchSlug): number => Object.values(s.spentByStage).reduce((a, b) => a + b, 0);
  const done = i.slugs.filter((s) => s.published);
  const eligible = i.slugs.filter((s) => s.status === 'ok');
  const reserved = i.slugs.filter((s) => s.status === 'blocked');
  const lines: string[] = [
    '# Roster batch report (M10a2)',
    '',
    'Written by `pnpm assets:gen -- batch-report`. Do not edit by hand: regenerate after every ledger or lock change (`docs/runbooks/roster-batch.md`).',
    '',
    `- Slugs in the plan: ${i.slugs.length} (${eligible.length} eligible, ${reserved.length} blocked with their estimate reserved, ${i.slugs.length - eligible.length - reserved.length} refused)`,
    `- Published (in \`assets/assets.lock.json\`): ${done.length}${done.length > 0 ? ` (${done.map((s) => s.slug).join(', ')})` : ''}`,
    `- Characters line: ${usd(i.ledgerMicros)} spent of ${usd(i.lineCapMicros)}; reserved and eligible estimates not yet spent leave ${usd(i.roomMicros)} (${micros(i.roomMicros)} micros), room for ${i.roomMicros > 0 ? Math.floor(i.roomMicros / i.leanMicros) : 0} more Lean models at ${usd(i.leanMicros)}`,
    `- Reconcile with the fal dashboard: ${i.reconcile === null ? 'not done yet (the operator records `assets/ledger/reconcile.json` after comparing the ledger with the dashboard; AC-8)' : `dashboard ${usd(i.reconcile.dashboardMicros)} against ledger ${usd(i.ledgerMicros)}: ${i.reconcile.note}`}`,
    ...(i.notRun !== null ? [`- Live batch: ${i.notRun}`] : []),
    '',
    '## Slugs',
    '',
    '| Slug | Tier | Plan | Estimate | Spent | Gates recorded | Published |',
    '|---|---|---|---|---|---|---|',
    ...i.slugs.map((s) => `| ${s.slug} | ${s.pipeline} | ${s.status === 'ok' ? 'ok' : s.reason.split(' (')[0]} | ${usd(s.estimateMicros)} | ${usd(spent(s))} | ${s.decisions.length === 0 ? 'none' : [...new Set(s.decisions.filter((d) => d.decision === 'approve').map((d) => d.gate))].join(', ') || 'none'} | ${s.published ? 'yes' : 'no'} |`),
    '',
    '## Gate decisions',
    '',
  ];
  const withDecisions = i.slugs.filter((s) => s.decisions.length > 0);
  if (withDecisions.length === 0) lines.push('No human gate has a recorded decision. H1 and H3 of `pc-coast` are signed by `owner` only (the subject card).', '');
  for (const s of withDecisions) {
    lines.push(`### ${s.slug}`, '', '| Gate | By | Decision | Choice |', '|---|---|---|---|', ...s.decisions.map((d) => `| ${d.gate} | ${d.by} | ${d.decision} | ${d.choose ?? ''} |`), '');
  }
  lines.push('## Blocked and reserved', '');
  for (const s of i.slugs.filter((x) => x.status !== 'ok')) lines.push(`- ${s.slug} [${s.pipeline}]: ${s.reason} (${usd(s.estimateMicros)}${s.status === 'blocked' ? ' reserved' : ''})`);
  if (i.slugs.every((x) => x.status === 'ok')) lines.push('Nothing is blocked.');
  lines.push('', '## Cost per slug (ledger rows by stage)', '');
  const spentSlugs = i.slugs.filter((s) => spent(s) > 0);
  if (spentSlugs.length === 0) lines.push('The ledger has no row for any slug of the batch.', '');
  for (const s of spentSlugs) lines.push(`- ${s.slug}: ${usd(spent(s))} (${Object.entries(s.spentByStage).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k} ${usd(v)}`).join(', ')})`);
  if (spentSlugs.length > 0) lines.push('');
  lines.push('## Planned stages', '');
  for (const s of eligible.filter((x) => x.stages.length > 0)) lines.push(`- ${s.slug}: ${s.stages.map((t) => `${t.stage} ${t.units} x ${t.endpointId}`).join('; ')}`);
  if (eligible.every((x) => x.stages.length === 0)) lines.push('Every eligible slug is published: zero outstanding jobs.');
  lines.push('', '## Moves that play library clips', '', 'Until the art lead\'s signature clips are baked (Q-24) every move of a kit plays the procedural library clip below; frame data is unchanged (`content/fighter/clip-fallbacks.json`).', '');
  lines.push('| Kit | Moves on a library clip | Moves on an authored clip | Library clips (move id to clip) |', '|---|---|---|---|');
  for (const k of i.fallbacks) lines.push(`| ${k.kit} | ${k.moves.length} | ${k.authored} | ${k.moves.map((m) => `${m.id} ${m.clip}`).join(', ')} |`);
  lines.push('', '## Coast rows', '', 'The protagonist model is split into six creator rows (`content/characters/pc-coast/subject.json`). A row without a model keeps the mannequin path (DL-737); `assets:coast -- link` sets `model` and `portrait` from the lock once the parts are published.', '');
  lines.push('| Row | Slot | Model | Portrait |', '|---|---|---|---|', ...i.coast.map((r) => `| ${r.row} | ${r.slot} | ${r.model ?? 'none (mannequin)'} | ${r.portrait ?? 'none'} |`), '');
  return lines.join('\n');
}
