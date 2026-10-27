/**
 * M05c3 AC-2: every G1 estimate is the section D9.1 formula to the micro, and the running total stays inside the line.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CutsceneRequest } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import type { GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';
import { DEFAULT_CAP_MICROS, KEYFRAME_MICROS, estimateRequest, recipeOf, usd } from '../gen/estimate.ts';
import { buildPlan, groupRefs } from '../gen/prewarm.ts';
import { EMPTY_SHEETS, type SheetsLock } from '../gen/gates.ts';

const fx = (f: string): string => path.join(import.meta.dirname, 'fixtures', f);
const requests = (JSON.parse(readFileSync(fx('act1-requests.json'), 'utf8')) as { requests: CutsceneRequest[] }).requests;
const cleared = JSON.parse(readFileSync(fx('registry-cleared.json'), 'utf8')) as GenAiRegistry;
const allSheets: SheetsLock = {
  schema: 'sheets-lock/1',
  sheets: Object.fromEntries(requests.flatMap((r) => r.characters.map((c) => [c.id, { approved: true, crops: ['a'.repeat(64)] }] as const))),
};
const notReady = (): Promise<boolean> => Promise.resolve(false);

describe('estimate (section D9.1)', () => {
  it('the Act 1 group is the nine m.a1 refs, 102 seconds', () => {
    const g1 = groupRefs(requests, 1);
    expect(g1).toHaveLength(9);
    expect(g1.reduce((n, r) => n + r.shots.reduce((m, s) => m + s.durationS, 0), 0)).toBe(102);
  });

  it('matches the formula by hand for a one-shot and a two-shot ref (h3.partner, $0.06/s)', () => {
    const p = cleared.videoProviders['h3.partner']!;
    const one = requests.find((r) => r.shots.length === 1)!;
    const two = requests.find((r) => r.shots.length === 2)!;
    // 8 s x 60,000 micros x 1.5 + 1 keyframe x 1.5 x 39,600
    expect(estimateRequest(one, p).totalMicros).toBe(8 * 60_000 * 1.5 + 1.5 * KEYFRAME_MICROS);
    expect(estimateRequest(one, p).totalMicros).toBe(779_400);
    // 14 s x 60,000 x 1.5 + 2 x 1.5 x 39,600
    expect(estimateRequest(two, p).totalMicros).toBe(14 * 60_000 * 1.5 + 2 * 1.5 * KEYFRAME_MICROS);
    expect(estimateRequest(two, p).totalMicros).toBe(1_378_800);
  });

  it('the whole of G1 on each priced provider matches the table of section D9.1', () => {
    const g1 = groupRefs(requests, 1);
    const sum = (usdPerS: number): number => g1.reduce((n, r) => n + estimateRequest(r, { price: { usdPerS, resolution: '768P', checkedAt: '' } }).totalMicros, 0);
    expect(usd(sum(0.06))).toBe('$10.01'); // h3.partner
    expect(usd(sum(0.09))).toBe('$14.60'); // ltx25.fast
    expect(usd(sum(0.1))).toBe('$16.13'); // gemini.omniFlash11
    expect(sum(0.06)).toBe(10_011_600);
  });

  it('recipe R carries no keyframe', () => {
    const r = { ...requests[0]!, keyInput: { ...requests[0]!.keyInput, endpoint: 'minimax/h3/reference-to-video@unpinned' as const } };
    expect(recipeOf(r)).toBe('R');
    const e = estimateRequest(r, cleared.videoProviders['h3.partner']!);
    expect(e.keyframeMicros).toBe(0);
    expect(e.totalMicros).toBe(8 * 60_000 * 1.5);
  });
});

describe('plan against the line (AC-2)', () => {
  it('plans all nine refs under the default line with every estimate equal to the formula', async () => {
    const plan = await buildPlan({ requests: groupRefs(requests, 1), registry: cleared, sheets: allSheets, capMicros: DEFAULT_CAP_MICROS, isReady: notReady, status: null, offline: false });
    const p = cleared.videoProviders['h3.partner']!;
    expect(plan.rows.every((r) => r.status === 'planned')).toBe(true);
    for (const row of plan.rows) expect(row.estimateMicros).toBe(estimateRequest(requests.find((q) => q.key === row.key)!, p).totalMicros);
    expect(plan.totalMicros).toBe(10_011_600);
    expect(plan.totalMicros).toBeLessThanOrEqual(DEFAULT_CAP_MICROS);
    // running totals accumulate in index order
    let run = 0;
    for (const row of plan.rows) {
      run += row.estimateMicros;
      expect(row.runningMicros).toBe(run);
    }
  });

  it('stops before the running total would pass the line: the rest is over_line', async () => {
    const cap = 5_000_000;
    const plan = await buildPlan({ requests: groupRefs(requests, 1), registry: cleared, sheets: allSheets, capMicros: cap, isReady: notReady, status: null, offline: false });
    const planned = plan.rows.filter((r) => r.status === 'planned');
    const over = plan.rows.filter((r) => r.status === 'over_line');
    expect(planned.length + over.length).toBe(9);
    expect(over.length).toBeGreaterThan(0);
    expect(plan.totalMicros).toBeLessThanOrEqual(cap);
    // once one ref is over the line, every later ref that would be planned is over it too
    const firstOver = plan.rows.findIndex((r) => r.status === 'over_line');
    expect(plan.rows.slice(firstOver).every((r) => r.status === 'over_line')).toBe(true);
    // the next ref would indeed have passed the line
    expect(plan.totalMicros + plan.rows[firstOver]!.estimateMicros).toBeGreaterThan(cap);
  });

  it('a zero line plans nothing', async () => {
    const plan = await buildPlan({ requests: groupRefs(requests, 1), registry: cleared, sheets: allSheets, capMicros: 0, isReady: notReady, status: null, offline: false });
    expect(plan.totalMicros).toBe(0);
    expect(plan.rows.every((r) => r.status === 'over_line')).toBe(true);
  });

  it('an index built for another provider is stale_endpoint at $0', async () => {
    const reg: GenAiRegistry = JSON.parse(JSON.stringify(cleared)) as GenAiRegistry;
    reg.videoProviders['h3.partner']!.endpoints = { i2v: 'minimax/h3-other/image-to-video' };
    const plan = await buildPlan({ requests: groupRefs(requests, 1), registry: reg, sheets: allSheets, capMicros: DEFAULT_CAP_MICROS, isReady: notReady, status: null, offline: false });
    expect(plan.rows.every((r) => r.status === 'stale_endpoint' && r.estimateMicros === 0)).toBe(true);
  });

  it('with no sheets at all, every ref that names a character is sheet_missing and the cast-free ones plan', async () => {
    const plan = await buildPlan({ requests: groupRefs(requests, 1), registry: cleared, sheets: EMPTY_SHEETS, capMicros: DEFAULT_CAP_MICROS, isReady: notReady, status: null, offline: false });
    for (const row of plan.rows) {
      const r = requests.find((q) => q.key === row.key)!;
      expect(row.status).toBe(r.characters.length > 0 ? 'sheet_missing' : 'planned');
    }
  });
});
