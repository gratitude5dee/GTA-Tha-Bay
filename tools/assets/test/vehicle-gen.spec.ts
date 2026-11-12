/** M10d1 AC-7: the fal half of `assets:vehicle`: SKIP without a key or a live spike, refused inputs, the caps and the ledger. */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lineCapMicros } from '../../../packages/shared/src/genai/lines.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import {
  EMPTY_LEDGER, FAL_BODIES, FAL_BODIES_CAP_MICROS, falPlan, falRefusals, ledgerFindings, LEDGER_FILE, provenanceCostMicros, type FalJob, type LedgerFile,
} from '../src/vehicle-gen.ts';

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

function repoWithLedger(l: LedgerFile): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dv-vgen-'));
  tmp.push(root);
  cpSync(path.join(toolsRoot, 'assets/provenance'), path.join(root, 'assets/provenance'), { recursive: true });
  cpSync(path.join(toolsRoot, 'assets/genai'), path.join(root, 'assets/genai'), { recursive: true });
  writeFileSync(path.join(root, LEDGER_FILE), `${JSON.stringify(l, null, 2)}\n`);
  return root;
}

describe('the fal bodies of assets:vehicle', () => {
  it('plans at most two bodies at exactly the cap of 1,704,000 micros, inside the vehiclesProps line', () => {
    const jobs = falPlan();
    expect(FAL_BODIES).toHaveLength(2);
    expect(jobs.reduce((a, j) => a + j.usdMicros, 0)).toBe(FAL_BODIES_CAP_MICROS);
    expect(FAL_BODIES_CAP_MICROS).toBe(1_704_000);
    expect(FAL_BODIES_CAP_MICROS).toBeLessThan(lineCapMicros('vehiclesProps'));
    expect(falRefusals(jobs)).toEqual([]);
  });

  it('refuses an input that this milestone\'s recipes did not render', () => {
    const jobs: FalJob[] = [...falPlan(), { ref: 'vehicle/traffic.sedan', endpoint: 'google/nano-banana-2.1/edit', usdMicros: 0, inputs: ['file:target-image.png'] }];
    expect(falRefusals(jobs).some((r) => r.includes('not rendered by the M10d1 recipes'))).toBe(true);
  });

  it('refuses a job past 1,704,000 micros, and one past the line cap', () => {
    const more: FalJob[] = [...falPlan(), { ref: 'vehicle/traffic.van', endpoint: 'tripo3d/h3.1/multiview-to-3d', usdMicros: 1, inputs: ['recipe:vehicle/traffic.van'] }];
    expect(falRefusals(more).some((r) => r.includes('over the 1704000'))).toBe(true);
    expect(falRefusals(falPlan(), lineCapMicros('vehiclesProps')).some((r) => r.includes('line cap'))).toBe(true);
  });

  it('keeps a ledger that equals the provenance costs', () => {
    expect(EMPTY_LEDGER.totalMicros).toBe(0);
    expect(ledgerFindings(toolsRoot)).toEqual([]);
    expect(provenanceCostMicros(toolsRoot)).toBe(0);
    const ledger: LedgerFile = {
      ...EMPTY_LEDGER, totalMicros: 252_000, entries: [{ ref: 'vehicle/traffic.sedan', endpoint: 'google/nano-banana-2.1/edit', usdMicros: 252_000, requestId: 'r1', at: '2026-10-29T00:00:00Z' }],
    };
    const root = repoWithLedger(ledger);
    expect(ledgerFindings(root).map((f) => f.rule)).toEqual(['ledger-provenance']);
    const over: LedgerFile = { ...ledger, totalMicros: 2_000_000, entries: [{ ...(ledger.entries[0] as LedgerFile['entries'][number]), usdMicros: 2_000_000 }] };
    expect(ledgerFindings(repoWithLedger(over)).map((f) => f.rule)).toContain('ledger-over-cap');
    const wrong: LedgerFile = { ...ledger, totalMicros: 1 };
    expect(ledgerFindings(repoWithLedger(wrong)).map((f) => f.rule)).toContain('ledger-total');
  });

  it('prints SKIP and exits 0 for --live without FAL_KEY', () => {
    const env = { ...process.env };
    delete env['FAL_KEY'];
    const r = spawnSync('pnpm', ['exec', 'tsx', 'tools/assets/src/vehicle-gen.ts', '--live'], { cwd: toolsRoot, env, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SKIP assets:vehicle --live');
  }, 60_000);

  it('prints SKIP for --live with a key but no live spike ledger entry (0 micros)', () => {
    expect(JSON.parse(readFileSync(path.join(toolsRoot, 'research/genai-spike/ledger.json'), 'utf8')).totalMicros).toBe(0);
    const r = spawnSync('pnpm', ['exec', 'tsx', 'tools/assets/src/vehicle-gen.ts', '--live'], { cwd: toolsRoot, env: { ...process.env, FAL_KEY: 'test-only-not-a-key' }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SKIP assets:vehicle --live: the M00c spike ledger shows no live run');
  }, 60_000);
});
