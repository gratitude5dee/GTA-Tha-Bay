/** assets:gen ledger (M10a1 AC-9): per-line totals, the 50, 80 and 100 % alarms, the seed, the import and the refusal rule. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTempDirs } from '../../ci/test-tmp.ts';
import { main } from '../gen/cli.ts';
import { LEDGER_FILE, SPIKE_LEDGER_FILE, alarms, capRefusal, parseLedger, totals, type LedgerRow } from '../gen/ledger.ts';

const tempDir = useTempDirs();

const r = (line: LedgerRow['line'], usdMicros: number, ref: string): LedgerRow => ({ schema: 'fal-spend/1', kind: 'settle', at: '2026-10-27T00:00:00Z', line, usdMicros, ref });
const text = (rows: LedgerRow[]): string => `${rows.map((x) => JSON.stringify(x)).join('\n')}\n`;

function tree(rows: LedgerRow[], spike?: unknown): string {
  const root = tempDir('dv-ledger-');
  mkdirSync(path.join(root, 'assets/ledger'), { recursive: true });
  mkdirSync(path.join(root, 'research/genai-spike'), { recursive: true });
  writeFileSync(path.join(root, LEDGER_FILE), text(rows));
  if (spike !== undefined) writeFileSync(path.join(root, SPIKE_LEDGER_FILE), JSON.stringify(spike));
  return root;
}

async function ledger(root: string, argv: string[]): Promise<{ code: number; out: string }> {
  const logs: string[] = [];
  const code = await main(['ledger', ...argv], {}, fetch, (l) => logs.push(l), { root, now: () => Date.parse('2026-10-27T12:00:00Z') });
  return { code, out: logs.join('\n') };
}

describe('assets:gen ledger', () => {
  it('sums per line and prints the alarm text for lines at or above 50, 80 and 100 %', async () => {
    const root = tree([
      r('spike', 4_000_000, 's1'), r('characters', 21_000_000, 'c1'), r('cutscenes', 30_400_000, 'k1'), r('vehiclesProps', 1_000_000, 'v1'),
    ]);
    const { code, out } = await ledger(root, []);
    expect(code).toBe(0);
    expect(out).toMatch(/spike\s+\$4\.00 of\s+\$4\.00\s+\(100 %\)\s+4,000,000 micros/);
    expect(out).toMatch(/characters\s+\$21\.00 of\s+\$42\.00\s+\(50 %\)/);
    expect(out).toMatch(/cutscenes\s+\$30\.40 of\s+\$38\.00\s+\(80 %\)/);
    expect(out).toMatch(/ALARM 100 %: the spike line at \$4\.00 of \$4\.00 \(hard stop\)/);
    expect(out).toMatch(/ALARM 50 %: the characters line/);
    expect(out).toMatch(/ALARM 80 %: the cutscenes line/);
    expect(out).not.toMatch(/ALARM [0-9]+ %: the vehiclesProps line/);
    expect(out).toMatch(/program\s+\$56\.40 of\s+\$100\.00/);
    expect(out).toMatch(/ALARM 50 %: the program/);
  });

  it('--line shows one line and its alarm only', async () => {
    const root = tree([r('characters', 42_000_000, 'c1'), r('spike', 4_000_000, 's1')]);
    const { out } = await ledger(root, ['--line', 'characters']);
    expect(out).toMatch(/characters/);
    expect(out).not.toMatch(/\bspike\b/);
    expect(out).toMatch(/ALARM 100 %: the characters line/);
  });

  it('totals equal the fixture sums', () => {
    const t = totals([r('characters', 1_000_000, 'a'), r('characters', 2_500_000, 'b'), r('buffer', 7, 'c')]);
    expect(t.characters).toBe(3_500_000);
    expect(t.buffer).toBe(7);
    expect(t.total).toBe(3_500_007);
  });

  it('--seed writes the spike row once from the spike ledger, and --import is idempotent by reference', async () => {
    const root = tree([], { schema: 'spike-ledger/1', capMicros: 10_000_000, totalMicros: 3_760_000, entries: [] });
    expect((await ledger(root, ['--seed'])).out).toMatch(/seed: spike row of \$3\.76 written/);
    expect((await ledger(root, ['--seed'])).out).toMatch(/already in the ledger/);
    const imp = path.join(root, 'm05d-export.json');
    writeFileSync(imp, JSON.stringify({ rows: [{ line: 'cutscenes', usdMicros: 5_000_000, ref: 'm05c3:run-1' }] }));
    expect((await ledger(root, ['--import', 'm05d-export.json'])).out).toMatch(/import: 1 row\(s\) added, 0 already present/);
    const again = await ledger(root, ['--import', 'm05d-export.json']);
    expect(again.out).toMatch(/import: 0 row\(s\) added, 1 already present/);
    const rows = parseLedger(readFileSync(path.join(root, LEDGER_FILE), 'utf8'));
    expect(rows).toHaveLength(2);
    expect(totals(rows).spike).toBe(3_760_000);
    expect(totals(rows).cutscenes).toBe(5_000_000);
  });

  it('refuses a malformed row and a row without a trailing Z', () => {
    expect(() => parseLedger('{"schema":"fal-spend/1"}\n')).toThrow(/not a fal-spend\/1 row/);
    expect(() => parseLedger(`${JSON.stringify({ ...r('spike', 1, 'x'), at: '2026-10-27T00:00:00+00:00' })}\n`)).toThrow(/trailing Z/);
  });

  it('refuses a reservation past a line or past the programme', () => {
    expect(capRefusal(totals([r('characters', 40_000_000, 'a')]), 'characters', 3_000_000)).toMatch(/passes the characters line/);
    expect(capRefusal(totals([r('characters', 40_000_000, 'a')]), 'characters', 2_000_000)).toBeNull();
    const heavy = totals([r('cutscenes', 38_000_000, 'a'), r('vehiclesProps', 14_000_000, 'b'), r('characters', 42_000_000, 'c'), r('spike', 4_000_000, 'd')]);
    expect(capRefusal(heavy, 'buffer', 2_000_001)).toMatch(/passes the buffer line/);
    expect(alarms(heavy).some((a) => /the program/.test(a))).toBe(true);
  });
});
