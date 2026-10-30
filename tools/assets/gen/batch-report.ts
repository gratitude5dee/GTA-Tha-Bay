/**
 * assets:gen batch-report [--out <file>] [--check] (M10a2): gathers the plan, the run records under `.genai/`, the spend ledger, the lock, the
 * clip fallbacks and the Coast catalog rows, and writes `docs/runbooks/reports/M10a2-batch.md` (`tools/assets/src/report.ts` renders it).
 * `--check` compares the file with a fresh render and exits 1 on a difference, so the committed report cannot go stale. Reads files only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runKey, type RunRecord } from '../../../services/pipeline/src/steps/character.ts';
import { glbJson, isGraybox } from '../src/moves-check.ts';
import { renderBatchReport, type BatchDecision, type BatchReportInput, type BatchSlug, type CoastRow, type FallbackKit } from '../src/report.ts';
import { readCards } from './subject-card.ts';
import { DEFAULT_CAPS, LEDGER_FILE, readLedger, totals } from './ledger.ts';
import { loadWorld, planBatch } from './plan.ts';

export const REPORT_FILE = 'docs/runbooks/reports/M10a2-batch.md';
export const RECONCILE_FILE = 'assets/ledger/reconcile.json';
const WORK = '.genai';

const readJsonIf = <T>(file: string): T | null => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null);

export async function collectBatch(root: string, env: NodeJS.ProcessEnv): Promise<BatchReportInput> {
  const abs = (p: string): string => path.resolve(root, p);
  const w = loadWorld(root);
  const plan = await planBatch({
    entries: w.entries, tier: 'all', registry: w.registry, ledgerRows: w.ledgerRows, reservedSlots: w.reservedSlots, progress: w.progress, realNames: w.realNames,
    gate: { falMode: 'mock', environment: 'dev', registry: w.registry },
  });
  const ledger = readLedger(abs(LEDGER_FILE));
  const lock = readJsonIf<{ entries: Record<string, unknown> }>(abs('assets/assets.lock.json'))?.entries ?? {};
  const slugs: BatchSlug[] = plan.rows.map((r) => {
    const run = readJsonIf<RunRecord>(abs(`${WORK}/${runKey(r.slug)}`));
    const decisions: BatchDecision[] = run === null ? [] : run.review.map((d) => ({ gate: d.gate, by: d.by, decision: d.decision, ...(d.choose !== undefined ? { choose: d.choose } : {}) }));
    const spentByStage: Record<string, number> = {};
    for (const l of ledger) if (l.slug === r.slug) spentByStage[l.stage ?? 'unknown'] = (spentByStage[l.stage ?? 'unknown'] ?? 0) + l.usdMicros;
    return {
      slug: r.slug, pipeline: r.pipeline, status: r.status, reason: r.reason, estimateMicros: r.estimateMicros,
      stages: r.stages.map((s) => ({ stage: s.stage, endpointId: s.endpointId, units: s.units, totalMicros: s.totalMicros })), decisions, spentByStage,
      published: lock[`character/${r.slug}`] !== undefined,
    };
  });
  const fb = readJsonIf<{ kits: Record<string, Record<string, string>> }>(abs('content/fighter/clip-fallbacks.json'));
  // A kit whose moves file is baked (not the gray-box timing set) plays its own clips; only the moves without one play a library clip.
  const roster = readJsonIf<{ kit: string; assets: { animMoves: string } }[]>(abs('content/fighter/roster.json')) ?? [];
  const bakedClips = (kit: string): Set<string> => {
    const ref = roster.find((r) => r.kit === kit)?.assets.animMoves;
    if (ref === undefined || isGraybox(ref)) return new Set();
    const file = abs(`assets/src/anim/${ref.slice(ref.indexOf('/') + 1)}/default.glb`);
    return existsSync(file) ? new Set((glbJson(new Uint8Array(readFileSync(file))).animations ?? []).map((a) => a.name ?? '')) : new Set();
  };
  const fallbacks: FallbackKit[] = Object.entries(fb?.kits ?? {}).map(([kit, moves]) => {
    const own = bakedClips(kit);
    return { kit, moves: Object.entries(moves).filter(([id]) => !own.has(id)).map(([id, clip]) => ({ id, clip })), authored: Object.keys(moves).filter((id) => own.has(id)).length };
  });
  const catalog = readJsonIf<{ slots: Record<string, { id: string; model?: string; portrait?: string }[]> }>(abs('content/ui/creator/catalog.json'));
  const card = readCards(root).cards.find((c) => c.id === 'pc-coast');
  const coast: CoastRow[] = (card?.parts ?? []).map((p) => {
    const row = (catalog?.slots[p.slot] ?? []).find((x) => x.id === p.row);
    return { row: p.row, slot: p.slot, model: row?.model ?? null, portrait: row?.portrait ?? null };
  });
  const rec = readJsonIf<{ dashboardMicros: number; note: string }>(abs(RECONCILE_FILE));
  const t = totals(ledger);
  const anyLive = ledger.some((l) => l.kind === 'settle');
  void env;
  return {
    slugs, lineCapMicros: DEFAULT_CAPS.lines.characters, ledgerMicros: t.characters, roomMicros: plan.roomMicros, leanMicros: plan.leanMicros, reconcile: rec, fallbacks, coast,
    notRun: anyLive ? null : 'not run: the build container holds no FAL_KEY and no R2 keys, so no stage called fal and nothing was published (the operator runs the commands of `docs/runbooks/roster-batch.md`, Q-17)',
  };
}

export async function batchReportCommand(argv: readonly string[], root: string, env: NodeJS.ProcessEnv, log: (l: string) => void): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: { out: { type: 'string', default: REPORT_FILE }, check: { type: 'boolean', default: false } } });
  const text = `${renderBatchReport(await collectBatch(root, env)).replace(/\n+$/, '')}\n`;
  const file = path.resolve(root, values.out as string);
  if (values.check) {
    const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (have !== text) {
      log(`assets:gen batch-report: ${values.out} is out of date: run pnpm assets:gen -- batch-report`);
      return 1;
    }
    log(`assets:gen batch-report: ${values.out} is current`);
    return 0;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  log(`assets:gen batch-report: wrote ${values.out}`);
  return 0;
}
