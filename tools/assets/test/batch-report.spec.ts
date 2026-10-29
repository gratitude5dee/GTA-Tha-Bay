/** The M10a2 batch report: the committed file is current, the renderer is deterministic, and a tree with spend, decisions and a reconcile shows them (AC-8). */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../ci/run.ts';
import { useTempDirs } from '../../ci/test-tmp.ts';
import { REPORT_FILE, batchReportCommand, collectBatch } from '../gen/batch-report.ts';
import { renderBatchReport, type BatchReportInput } from '../src/report.ts';

const tempDir = useTempDirs();

describe('docs/runbooks/reports/M10a2-batch.md', () => {
  it('is current: it equals a fresh render of the repository state (regenerate with pnpm assets:gen -- batch-report)', async () => {
    const logs: string[] = [];
    expect(await batchReportCommand(['--check'], repoRoot, {}, (l) => logs.push(l)), logs.join('\n')).toBe(0);
  });

  it('names the batch, the blocked slugs with their reserved estimates, the room on the line, the fallback moves and the six Coast rows', () => {
    const text = readFileSync(path.join(repoRoot, REPORT_FILE), 'utf8');
    expect(text).toMatch(/^# Roster batch report \(M10a2\)/);
    expect(text).toMatch(/pc-coast \| standard \| ok \| \$3\.67/);
    expect(text).toMatch(/blocked:research/);
    expect(text).toMatch(/room for 7 more Lean models/);
    expect(text).toMatch(/\| rap_new_wave \| 17 \| 0 \|/);
    for (const row of ['body-coast', 'face-coast', 'hair-coast', 'top-coast-hoodie', 'bottom-coast-jeans', 'shoes-coast-sneakers']) expect(text).toContain(`| ${row} |`);
    expect(text).toMatch(/Reconcile with the fal dashboard: not done yet/);
  });
});

describe('renderBatchReport', () => {
  const base: BatchReportInput = {
    slugs: [
      { slug: 'pc-coast', pipeline: 'standard', status: 'ok', reason: '', estimateMicros: 3_666_590, stages: [{ stage: 'sheet', endpointId: 'x/y', units: 3, totalMicros: 260_000 }], published: true,
        decisions: [{ gate: 'H1', by: 'owner', decision: 'approve', choose: 2 }, { gate: 'H3', by: 'owner', decision: 'approve', choose: 1 }], spentByStage: { sheet: 270_000, mesh: 2_400_000 } },
      { slug: 'rap-lyricist', pipeline: 'standard', status: 'blocked', reason: 'blocked:research (RAP_LYRICIST: reserved)', estimateMicros: 3_666_590, stages: [], decisions: [], spentByStage: {}, published: false },
    ],
    lineCapMicros: 42_000_000, ledgerMicros: 2_670_000, roomMicros: 30_000_000, leanMicros: 1_052_000,
    reconcile: { dashboardMicros: 2_700_000, note: 'dashboard 30 000 micros above the ledger (rounding of the sheet calls)' },
    fallbacks: [{ kit: 'rap_new_wave', moves: [{ id: '5L', clip: 'jab.0' }], authored: 16 }],
    coast: [{ row: 'body-coast', slot: 'body', model: 'character/pc-body-coast', portrait: 'portrait/pc-body-coast' }, { row: 'hair-coast', slot: 'hair', model: null, portrait: null }],
    notRun: null,
  };

  it('shows spend per stage, the decisions, the reconcile and the linked rows', () => {
    const t = renderBatchReport(base);
    expect(t).toMatch(/Published \(in `assets\/assets.lock.json`\): 1 \(pc-coast\)/);
    expect(t).toMatch(/- pc-coast: \$2\.67 \(mesh \$2\.40, sheet \$0\.27\)/);
    expect(t).toMatch(/\| H1 \| owner \| approve \| 2 \|/);
    expect(t).toMatch(/dashboard \$2\.70 against ledger \$2\.67: dashboard 30 000 micros above/);
    expect(t).toMatch(/\| body-coast \| body \| character\/pc-body-coast \| portrait\/pc-body-coast \|/);
    expect(t).toMatch(/\| hair-coast \| hair \| none \(mannequin\) \| none \|/);
    expect(t).toMatch(/\| rap_new_wave \| 1 \| 16 \|/);
    expect(t).not.toMatch(/Live batch:/);
  });

  it('is deterministic: the same input gives the same bytes, with no clock in the text', () => {
    expect(renderBatchReport(base)).toBe(renderBatchReport(structuredClone(base)));
    expect(renderBatchReport(base)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('collectBatch on a tree with spend and decisions', () => {
  it('reads the ledger by slug and stage, the run record decisions, the lock and the reconcile file', async () => {
    const root = tempDir('dv-batch-report-');
    const put = (rel: string, text: string): void => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), text);
    };
    for (const f of ['config/genai-endpoints.json', 'content/npcs/roster.json', 'content/characters/pc-coast/subject.json', 'content/fighter/roster.json', 'content/fighter/clip-fallbacks.json', 'content/ui/creator/catalog.json']) {
      mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      cpSync(path.join(repoRoot, f), path.join(root, f));
    }
    put('assets/assets.lock.json', JSON.stringify({ schema: 'asset-lock/1', entries: { 'character/pc-coast': { rev: 1, variants: {} } } }));
    put('assets/ledger/fal-spend.jsonl', `${JSON.stringify({ schema: 'fal-spend/1', kind: 'settle', at: '2026-10-28T10:00:00Z', line: 'characters', usdMicros: 260_000, ref: 'k1', slug: 'pc-coast', stage: 'sheet' })}\n`);
    put('assets/ledger/reconcile.json', JSON.stringify({ dashboardMicros: 260_000, note: 'equal' }));
    put('.genai/work/character/pc-coast/run.json', JSON.stringify({ schema: 'char-run/1', runId: 'pc-coast-00000000', slug: 'pc-coast', tier: 'standard', soulVersion: 1, jobs: {}, rigRejected: [], updatedAt: '2026-10-28T10:00:00Z',
      review: [{ gate: 'H0', by: 'art-lead', decision: 'approve', choose: 1, at: '2026-10-28T10:01:00Z' }, { gate: 'H1', by: 'owner', decision: 'approve', choose: 2, at: '2026-10-28T10:02:00Z' }] }));
    const input = await collectBatch(root, {});
    const coast = input.slugs.find((s) => s.slug === 'pc-coast')!;
    expect(coast.published).toBe(true);
    expect(coast.spentByStage).toEqual({ sheet: 260_000 });
    expect(coast.decisions).toEqual([{ gate: 'H0', by: 'art-lead', decision: 'approve', choose: 1 }, { gate: 'H1', by: 'owner', decision: 'approve', choose: 2 }]);
    expect(input.ledgerMicros).toBe(260_000);
    expect(input.reconcile).toEqual({ dashboardMicros: 260_000, note: 'equal' });
    expect(input.notRun).toBeNull();
    // pc-coast is published; the souls are not in this tree, so the roster slugs plan as blocked:soul with nothing reserved, and only the seven fighter slots keep an estimate
    expect(input.roomMicros).toBe(42_000_000 - 260_000 - 3_666_590 * 7);
  });
});
