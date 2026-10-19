/**
 * check:perf with several scenarios (M02b1 AC-12, DL-656 part 4): reports are keyed `perf.<scenario>.<project>.<tier>.json`, the
 * default selection is the data file `config/perf/scenarios.json`, `--scenario` is validated, and a missing report of one scenario
 * is a miss that fails under `--fail` and does not hide behind another scenario's reports.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { PerfReport } from '../../../packages/shared/src/index.ts';
import { repoRoot } from '../run.ts';
import { EXTRA_SCENARIOS, FLAT_TIERS, PERF_PROJECTS, PERF_SCENARIOS, checkReports, reportPath, selectScenarios } from '../perf-check.ts';

const tmp = mkdtempSync(path.join(tmpdir(), 'dv-perf-check-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const fixture = JSON.parse(readFileSync(path.join(repoRoot, 'tools', 'ci', 'fixtures', 'perf', 'ok.json'), 'utf8')) as PerfReport;
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'config', 'tier-budgets.json'), 'utf8')) as { tiers: Record<string, { render: { maxRenderObjects: number; maxTriangles: number } }> };

function write(root: string, scenarios: readonly string[]): void {
  mkdirSync(path.join(root, 'test-results'), { recursive: true });
  for (const scenario of scenarios) {
    for (const project of PERF_PROJECTS) {
      for (const tier of FLAT_TIERS) {
        const b = budgets.tiers[tier]?.render as { maxRenderObjects: number; maxTriangles: number };
        const r: PerfReport = { ...fixture, tier, counts: { ...fixture.counts, renderObjectsMax: Math.floor(b.maxRenderObjects * 0.5), trianglesMax: Math.floor(b.maxTriangles * 0.5) } };
        writeFileSync(reportPath(root, scenario, project, tier), JSON.stringify(r));
      }
    }
  }
}

describe('config/perf/scenarios.json and PERF_SCENARIOS', () => {
  const file = JSON.parse(readFileSync(path.join(repoRoot, 'config', 'perf', 'scenarios.json'), 'utf8')) as string[];

  it('holds unique kebab-case ids without graybox-walk, and PERF_SCENARIOS equals it', () => {
    expect(Array.isArray(file)).toBe(true);
    expect(new Set(file).size).toBe(file.length);
    for (const id of file) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(file).not.toContain('graybox-walk');
    expect(file).toEqual(expect.arrayContaining(['walk-civic-center', 'route-ferry-ocean-beach']));
    expect([...PERF_SCENARIOS]).toEqual(file);
    expect(EXTRA_SCENARIOS).toEqual(['graybox-walk']);
  });

  it('every registered scenario has a path file in config/perf/paths', () => {
    for (const id of file) expect(() => readFileSync(path.join(repoRoot, 'config', 'perf', 'paths', `${id}.json`), 'utf8')).not.toThrow();
  });
});

describe('--scenario selection (AC-12)', () => {
  it('selects one registered id, graybox-walk by name, the whole list without the flag, and rejects an unknown id', () => {
    expect(selectScenarios('route-ferry-ocean-beach')).toEqual(['route-ferry-ocean-beach']);
    expect(selectScenarios('graybox-walk')).toEqual(['graybox-walk']);
    expect(selectScenarios(undefined)).toEqual([...PERF_SCENARIOS]);
    expect(selectScenarios('no-such-scenario')).toBeNull();
  });

  it('perf-check --scenario <unknown> exits non-zero and names the known ids', () => {
    const bad = spawnSync(process.execPath, ['--import', 'tsx', path.join(repoRoot, 'tools', 'ci', 'perf-check.ts'), '--scenario', 'no-such-scenario', '--skip-run'], { cwd: repoRoot, encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('unknown scenario');
    expect(bad.stderr).toContain('route-ferry-ocean-beach');
  });
});

describe('checkReports with two scenarios (AC-12)', () => {
  it('the reports of both scenarios coexist: 2 scenarios x 2 projects x 4 tiers = 16 reports are expected and found', () => {
    const root = path.join(tmp, 'both');
    write(root, ['walk-civic-center', 'route-ferry-ocean-beach']);
    const r = checkReports(root);
    expect(r.checked).toBe(16);
    expect(r.missing).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('deleting one walk-civic-center report counts a miss that fails', () => {
    const root = path.join(tmp, 'one-gone');
    write(root, ['walk-civic-center', 'route-ferry-ocean-beach']);
    rmSync(reportPath(root, 'walk-civic-center', 'webkit-webgl2', 'mobile'));
    const r = checkReports(root);
    expect(r.checked).toBe(15);
    expect(r.missing).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('walk-civic-center webkit-webgl2 mobile: no report at');
  });

  it("a selected scenario is judged alone: the other scenario's reports are not needed", () => {
    const root = path.join(tmp, 'alone');
    write(root, ['route-ferry-ocean-beach']);
    expect(checkReports(root, ['route-ferry-ocean-beach']).ok).toBe(true);
    expect(checkReports(root).ok).toBe(false);
  });
});
