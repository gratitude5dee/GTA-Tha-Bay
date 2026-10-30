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
import { BOOT_SCENARIOS, EXTRA_SCENARIOS, FLAT_TIERS, NPC_SCENARIOS, PERF_PROJECTS, PERF_SCENARIOS, TRAFFIC_SCENARIOS, NEAR_PED_CAP, checkReports, reportPath, selectScenarios, trafficPath, verifyBoot, verifyNpc, verifyPeds, verifyTraffic } from '../perf-check.ts';

const tmp = mkdtempSync(path.join(tmpdir(), 'dv-perf-check-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const fixture = JSON.parse(readFileSync(path.join(repoRoot, 'tools', 'ci', 'fixtures', 'perf', 'ok.json'), 'utf8')) as PerfReport;
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'config', 'tier-budgets.json'), 'utf8')) as { tiers: Record<string, { render: { maxRenderObjects: number; maxTriangles: number } }> };

const crowd = (tier: string): number => (JSON.parse(readFileSync(path.join(repoRoot, 'config', 'tier-budgets.json'), 'utf8')) as { tiers: Record<string, { crowd: { maxTrafficInstances: number } }> }).tiers[tier]?.crowd.maxTrafficInstances ?? 0;
const pedCrowd = (tier: string): number => (JSON.parse(readFileSync(path.join(repoRoot, 'config', 'tier-budgets.json'), 'utf8')) as { tiers: Record<string, { crowd: { maxPedInstances: number } }> }).tiers[tier]?.crowd.maxPedInstances ?? 0;
const pedsOf = (tier: string, share: number): Record<string, unknown> => ({ samples: 40, instancesMax: Math.floor(pedCrowd(tier) * share), nearMax: Math.floor((NEAR_PED_CAP[tier] ?? 0) * share), drawsMax: 8, objectsMax: 9, cap: pedCrowd(tier), nearCap: NEAR_PED_CAP[tier] ?? 0, busesMax: 2, carsPlusBusesMax: Math.floor(crowd(tier) * share), simPeds: Math.floor(pedCrowd(tier) * share), simCap: pedCrowd(tier) });
const trafficOf = (tier: string, share: number): Record<string, unknown> => ({ scenario: 'downtown-rush', tier, samples: 40, instancesMax: Math.floor(crowd(tier) * share), drawsMax: 1, objectsMax: 1, cap: crowd(tier), simAgents: Math.floor(crowd(tier) * share), simCap: crowd(tier), peds: pedsOf(tier, share) });

/** A boot block that passes `verifyBoot` for the fixture's device class (`iphone`: lane sum 18). */
const bootOf = (): NonNullable<PerfReport['boot']> => ({ warmBootToPlayableS: null, coldDownloadMB: 1.23, requests: 6, bytes: 1_230_000, revealMs: 1500, waves: 2, inflightPeak: 5 });

/** The brain figures of the scenario `npc-mission-crowd` that pass `verifyNpc` for a tier: LOD A at its cap. */
const npcCap = (tier: string): number => (JSON.parse(readFileSync(path.join(repoRoot, 'config', 'npc.json'), 'utf8')) as { caps: { lodABrains: Record<string, number> } }).caps.lodABrains[tier] ?? 0;
const npcCounts = (tier: string): Partial<PerfReport['counts']> => ({ npcBrainsAMax: npcCap(tier), npcBrainsBMax: 5, npcBrainMsMean: 0.04, npcBrainMsMax: 0.3, npcBrainTicks: 120 });

function write(root: string, scenarios: readonly string[]): void {
  mkdirSync(path.join(root, 'test-results'), { recursive: true });
  for (const scenario of scenarios) {
    for (const project of PERF_PROJECTS) {
      for (const tier of FLAT_TIERS) {
        const b = budgets.tiers[tier]?.render as { maxRenderObjects: number; maxTriangles: number };
        const r: PerfReport = { ...fixture, tier, counts: { ...fixture.counts, renderObjectsMax: Math.floor(b.maxRenderObjects * 0.5), trianglesMax: Math.floor(b.maxTriangles * 0.5) } };
        if (BOOT_SCENARIOS.includes(scenario)) r.boot = { ...r.boot, ...bootOf() };
        if (NPC_SCENARIOS.includes(scenario)) r.counts = { ...r.counts, ...npcCounts(tier) };
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
    // BD-FIX-CI-PERFSPLIT-01: a comma-separated group, in its order and once; one unknown or empty id rejects the whole group.
    expect(selectScenarios('story-chase,fight-stage')).toEqual(['story-chase', 'fight-stage']);
    expect(selectScenarios('fight-stage, story-chase,fight-stage')).toEqual(['fight-stage', 'story-chase']);
    expect(selectScenarios('story-chase,no-such-scenario')).toBeNull();
    expect(selectScenarios('story-chase,')).toBeNull();
    expect(selectScenarios('')).toBeNull();
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

describe('the boot scenario (M02f1, AC-4)', () => {
  const put = (name: string, over: Partial<NonNullable<PerfReport['boot']>> | null, deviceClass: PerfReport['device']['class'] = 'iphone', drop: string[] = []): string => {
    const file = path.join(tmp, 'boot', `${name}.json`);
    mkdirSync(path.dirname(file), { recursive: true });
    const boot: Record<string, unknown> = { ...bootOf(), ...(over ?? {}) };
    for (const k of drop) delete boot[k];
    writeFileSync(file, JSON.stringify({ ...fixture, device: { ...fixture.device, class: deviceClass }, boot }));
    return file;
  };

  it('boot-cityhall is registered, with a path file, and is the one boot scenario', () => {
    expect(PERF_SCENARIOS).toContain('boot-cityhall');
    expect(BOOT_SCENARIOS).toEqual(['boot-cityhall']);
    const p = JSON.parse(readFileSync(path.join(repoRoot, 'config', 'perf', 'paths', 'boot-cityhall.json'), 'utf8')) as Record<string, unknown>;
    expect(p).toMatchObject({ id: 'boot-cityhall', kind: 'route', speedMps: 1.5, durationS: 20, warmupS: 2, density: 'off', seed: 0xb007 });
  });

  it('passes a report with all five figures within bounds', () => {
    expect(verifyBoot(put('ok', null), 'mobile')).toEqual([]);
    const root = path.join(tmp, 'boot-all');
    write(root, ['boot-cityhall']);
    expect(checkReports(root, ['boot-cityhall']).ok).toBe(true);
  });

  it('fails a report missing a figure, and names it', () => {
    for (const k of ['requests', 'bytes', 'revealMs', 'waves', 'inflightPeak']) {
      expect(verifyBoot(put(`missing-${k}`, null, 'iphone', [k]), 'mobile').join('\n')).toContain(k);
    }
    const root = path.join(tmp, 'boot-missing');
    write(root, ['boot-cityhall']);
    const f = reportPath(root, 'boot-cityhall', 'chromium-webgl2', 'mobile');
    const r = JSON.parse(readFileSync(f, 'utf8')) as PerfReport;
    delete (r.boot as Record<string, unknown>)['waves'];
    writeFileSync(f, JSON.stringify(r));
    const res = checkReports(root, ['boot-cityhall']);
    expect(res.ok).toBe(false);
    expect(res.lines.join('\n')).toContain('boot figures missing: waves');
  });

  it('fails a peak above the lane sum of the device class (18 off the desktop, 26 on it) and below 1', () => {
    expect(verifyBoot(put('peak19', { inflightPeak: 19 }), 'mobile').join('\n')).toContain('inflightPeak 19');
    expect(verifyBoot(put('peak18', { inflightPeak: 18 }), 'mobile')).toEqual([]);
    expect(verifyBoot(put('peak26', { inflightPeak: 26 }, 'desktop'), 'mobile')).toEqual([]);
    expect(verifyBoot(put('peak27', { inflightPeak: 27 }, 'desktop'), 'mobile').join('\n')).toContain('1..26');
    expect(verifyBoot(put('peak0', { inflightPeak: 0 }), 'mobile').join('\n')).toContain('inflightPeak 0');
  });

  it('fails mismatched bytes, too few requests, no reveal time and no wave', () => {
    expect(verifyBoot(put('bytes', { bytes: 1_300_000 }), 'mobile').join('\n')).toContain('coldDownloadMB');
    expect(verifyBoot(put('null-mb', { coldDownloadMB: null }), 'mobile').join('\n')).toContain('coldDownloadMB');
    expect(verifyBoot(put('req', { requests: 1 }), 'mobile').join('\n')).toContain('requests 1');
    expect(verifyBoot(put('ms', { revealMs: 0 }), 'mobile').join('\n')).toContain('revealMs');
    expect(verifyBoot(put('wave', { waves: 0 }), 'mobile').join('\n')).toContain('waves 0');
    expect(verifyBoot(put('nobytes', { bytes: 0, coldDownloadMB: 0 }), 'mobile').join('\n')).toContain('bytes 0');
  });
});

describe('verifyNpc (M06c AC-9)', () => {
  const put = (name: string, counts: Record<string, unknown>): string => {
    const f = path.join(tmp, name);
    writeFileSync(f, JSON.stringify({ ...fixture, counts: { ...fixture.counts, ...counts } }));
    return f;
  };

  it('registers the scenario and passes brains at the tier cap', () => {
    expect(NPC_SCENARIOS).toEqual(['npc-mission-crowd']);
    expect(PERF_SCENARIOS).toContain('npc-mission-crowd');
    for (const tier of FLAT_TIERS) expect(verifyNpc(put(`npc-ok-${tier}.json`, npcCounts(tier)), tier)).toEqual([]);
  });

  it('fails a LOD-A count over the tier cap, no brain at A, missing or non-finite figures and an unmeasured run', () => {
    expect(verifyNpc(put('npc-over.json', { ...npcCounts('mobile-low'), npcBrainsAMax: npcCap('mobile-low') + 1 }), 'mobile-low').join('\n')).toMatch(/> the mobile-low cap 3/);
    expect(verifyNpc(put('npc-none.json', { ...npcCounts('desktop'), npcBrainsAMax: 0 }), 'desktop').join('\n')).toMatch(/no NPC brain ran at LOD A/);
    expect(verifyNpc(put('npc-missing.json', { npcBrainsAMax: 2 }), 'desktop').join('\n')).toMatch(/figures missing/);
    expect(verifyNpc(put('npc-nan.json', { ...npcCounts('desktop'), npcBrainMsMean: null }), 'desktop').join('\n')).toMatch(/npcBrainMsMean/);
    expect(verifyNpc(put('npc-zero.json', { ...npcCounts('desktop'), npcBrainTicks: 0 }), 'desktop').join('\n')).toMatch(/0 ticks/);
  });
});
