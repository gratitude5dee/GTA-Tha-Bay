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
import { EXTRA_SCENARIOS, FLAT_TIERS, PERF_PROJECTS, PERF_SCENARIOS, TRAFFIC_SCENARIOS, NEAR_PED_CAP, checkReports, reportPath, selectScenarios, trafficPath, verifyPeds, verifyTraffic } from '../perf-check.ts';

const tmp = mkdtempSync(path.join(tmpdir(), 'dv-perf-check-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const fixture = JSON.parse(readFileSync(path.join(repoRoot, 'tools', 'ci', 'fixtures', 'perf', 'ok.json'), 'utf8')) as PerfReport;
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'config', 'tier-budgets.json'), 'utf8')) as { tiers: Record<string, { render: { maxRenderObjects: number; maxTriangles: number } }> };

const crowd = (tier: string): number => (JSON.parse(readFileSync(path.join(repoRoot, 'config', 'tier-budgets.json'), 'utf8')) as { tiers: Record<string, { crowd: { maxTrafficInstances: number } }> }).tiers[tier]?.crowd.maxTrafficInstances ?? 0;
const pedCrowd = (tier: string): number => (JSON.parse(readFileSync(path.join(repoRoot, 'config', 'tier-budgets.json'), 'utf8')) as { tiers: Record<string, { crowd: { maxPedInstances: number } }> }).tiers[tier]?.crowd.maxPedInstances ?? 0;
const pedsOf = (tier: string, share: number): Record<string, unknown> => ({ samples: 40, instancesMax: Math.floor(pedCrowd(tier) * share), nearMax: Math.floor((NEAR_PED_CAP[tier] ?? 0) * share), drawsMax: 8, objectsMax: 9, cap: pedCrowd(tier), nearCap: NEAR_PED_CAP[tier] ?? 0, busesMax: 2, carsPlusBusesMax: Math.floor(crowd(tier) * share), simPeds: Math.floor(pedCrowd(tier) * share), simCap: pedCrowd(tier) });
const trafficOf = (tier: string, share: number): Record<string, unknown> => ({ scenario: 'downtown-rush', tier, samples: 40, instancesMax: Math.floor(crowd(tier) * share), drawsMax: 1, objectsMax: 1, cap: crowd(tier), simAgents: Math.floor(crowd(tier) * share), simCap: crowd(tier), peds: pedsOf(tier, share) });

function write(root: string, scenarios: readonly string[]): void {
  mkdirSync(path.join(root, 'test-results'), { recursive: true });
  for (const scenario of scenarios) {
    for (const project of PERF_PROJECTS) {
      for (const tier of FLAT_TIERS) {
        const b = budgets.tiers[tier]?.render as { maxRenderObjects: number; maxTriangles: number };
        const r: PerfReport = { ...fixture, tier, counts: { ...fixture.counts, renderObjectsMax: Math.floor(b.maxRenderObjects * 0.5), trianglesMax: Math.floor(b.maxTriangles * 0.5) } };
        writeFileSync(reportPath(root, scenario, project, tier), JSON.stringify(r));
        if (TRAFFIC_SCENARIOS.includes(scenario)) writeFileSync(trafficPath(root, scenario, project, tier), JSON.stringify(trafficOf(tier, 0.5)));
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
    const r = checkReports(root, ['walk-civic-center', 'route-ferry-ocean-beach']);
    expect(r.checked).toBe(16);
    expect(r.missing).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('deleting one walk-civic-center report counts a miss that fails', () => {
    const root = path.join(tmp, 'one-gone');
    write(root, ['walk-civic-center', 'route-ferry-ocean-beach']);
    rmSync(reportPath(root, 'walk-civic-center', 'webkit-webgl2', 'mobile'));
    const r = checkReports(root, ['walk-civic-center', 'route-ferry-ocean-beach']);
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

describe('the traffic scenario (M03b1, AC-10)', () => {
  it('downtown-rush is registered and is the one traffic scenario', () => {
    expect(PERF_SCENARIOS).toContain('downtown-rush');
    expect(TRAFFIC_SCENARIOS).toEqual(['downtown-rush']);
  });

  it('passes with traffic within each tier crowd row and fails over it, with none drawn, or with a missing traffic report', () => {
    const root = path.join(tmp, 'traffic');
    write(root, ['downtown-rush']);
    expect(checkReports(root, ['downtown-rush']).ok).toBe(true);
    const f = trafficPath(root, 'downtown-rush', 'chromium-webgl2', 'mobile-low');
    writeFileSync(f, JSON.stringify(trafficOf('mobile-low', 1.5)));
    expect(verifyTraffic(f, 'mobile-low').join('\n')).toContain('crowd.maxTrafficInstances');
    expect(checkReports(root, ['downtown-rush']).ok).toBe(false);
    writeFileSync(f, JSON.stringify({ ...trafficOf('mobile-low', 0.5), instancesMax: 0 }));
    expect(verifyTraffic(f, 'mobile-low').join('\n')).toContain('no traffic instance');
    writeFileSync(f, JSON.stringify({ ...trafficOf('mobile-low', 0.5), drawsMax: 20 }));
    expect(verifyTraffic(f, 'mobile-low').join('\n')).toContain('traffic draws');
    rmSync(f);
    const r = checkReports(root, ['downtown-rush']);
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('no traffic report at');
  });
});

describe('the pedestrian half of the traffic scenario (M03b2, AC-9)', () => {
  const put = (root: string, over: Record<string, unknown>): string => {
    write(root, ['downtown-rush']);
    const f = trafficPath(root, 'downtown-rush', 'chromium-webgl2', 'mobile-low');
    writeFileSync(f, JSON.stringify({ ...trafficOf('mobile-low', 0.5), peds: { ...pedsOf('mobile-low', 0.5), ...over } }));
    return f;
  };

  it('the near-LOD caps are the table of living part 4.5: 24, 24, 16, 12, 8, 6', () => {
    expect(NEAR_PED_CAP).toEqual({ 'desktop-ultra': 24, desktop: 24, 'xr-visionpro': 16, mobile: 12, 'xr-quest': 8, 'mobile-low': 6 });
  });

  it('passes within the tier rows and fails over the instance cap, the near cap, the draws, with none drawn, or over the shared car cap', () => {
    const f = put(path.join(tmp, 'peds'), {});
    expect(verifyPeds(f, 'mobile-low')).toEqual([]);
    expect(checkReports(path.join(tmp, 'peds'), ['downtown-rush']).ok).toBe(true);
    expect(verifyPeds(put(path.join(tmp, 'peds2'), { instancesMax: 81 }), 'mobile-low').join('\n')).toContain('crowd.maxPedInstances');
    expect(verifyPeds(put(path.join(tmp, 'peds3'), { nearMax: 7 }), 'mobile-low').join('\n')).toContain('near-LOD skinned');
    expect(verifyPeds(put(path.join(tmp, 'peds4'), { instancesMax: 0 }), 'mobile-low').join('\n')).toContain('no pedestrian instance');
    expect(verifyPeds(put(path.join(tmp, 'peds5'), { drawsMax: 15 }), 'mobile-low').join('\n')).toContain('pedestrian draws');
    expect(verifyPeds(put(path.join(tmp, 'peds6'), { carsPlusBusesMax: 121 }), 'mobile-low').join('\n')).toContain('cars and buses');
    expect(verifyPeds(put(path.join(tmp, 'peds7'), { simPeds: 500 }), 'mobile-low').join('\n')).toContain('sim pedestrians');
    const noBlock = path.join(tmp, 'peds8', 'x.json');
    mkdirSync(path.dirname(noBlock), { recursive: true });
    writeFileSync(noBlock, JSON.stringify({ ...trafficOf('mobile-low', 0.5), peds: undefined }));
    expect(verifyPeds(noBlock, 'mobile-low').join('\n')).toContain('no pedestrian block');
  });
});
