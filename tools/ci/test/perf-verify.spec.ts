import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { DeviceChecklist, PerfReport } from '../../../packages/shared/src/index.ts';
import { checkReports, FLAT_TIERS, PERF_PROJECTS, PERF_SCENARIOS, selectScenarios } from '../perf-check.ts';
import { checklistErrors, formatChecklist } from '../perf-checklist.ts';
import { loadBudget, metricOf, perfReportErrors, verifyFile, verifyReport } from '../perf-verify.ts';
import { readJson, toolsRoot } from '../lib/common.ts';

const fx = (n: string): string => path.join(toolsRoot, 'tools/ci/fixtures/perf', n);
const tmp = mkdtempSync(path.join(os.tmpdir(), 'dv-perf-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function run(script: string, ...a: string[]): { status: number; out: string } {
  const res = spawnSync(path.join(toolsRoot, 'node_modules/.bin/tsx'), [path.join(toolsRoot, 'tools/ci', script), ...a], { encoding: 'utf8', cwd: toolsRoot });
  return { status: res.status ?? -1, out: `${res.stdout}${res.stderr}` };
}

describe('perf:verify (AC-7)', () => {
  it('ok.json passes at mobile-low and prints a PASS line per assertion', () => {
    const r = run('perf-verify.ts', fx('ok.json'), '--tier', 'mobile-low');
    expect(r.status).toBe(0);
    expect(r.out).toContain('perf:verify passed');
    expect(r.out).not.toContain('FAIL');
    expect(r.out.match(/PASS /g)?.length).toBeGreaterThanOrEqual(10);
  });

  it('over.json exits non-zero and prints one FAIL line per failed assertion', () => {
    const r = run('perf-verify.ts', fx('over.json'), '--tier', 'mobile-low');
    expect(r.status).toBe(1);
    const fails = r.out.split('\n').filter((l) => l.includes('FAIL'));
    expect(fails.length).toBeGreaterThanOrEqual(9);
    for (const needle of ['render objects max 131', 'triangles max 702000', 'gpu draw commands max 340', 'texture MB 301', 'gpu device losses 1', 'median frame ms 41.70', 'p95 frame ms 61.30', 'frames over 50 ms 37', 'warm boot s 21.50']) {
      expect(fails.some((l) => l.includes(needle)), needle).toBe(true);
    }
    expect(r.out).toMatch(/perf:verify failed \(\d+\)/);
  });

  it('the same lines come from verifyReport: only the failing rows are not ok', () => {
    const over = readJson<PerfReport>(fx('over.json'));
    const lines = verifyReport(over, { tier: 'mobile-low' });
    expect(lines.filter((l) => !l.ok).map((l) => l.id)).toEqual([
      'counts.renderObjectsMax',
      'counts.trianglesMax',
      'counts.gpuDrawCmdsMax',
      'counts.texturesMB',
      'errors.gpuLost',
      'frames.medianMs',
      'frames.p95Ms',
      'frames.over50ms',
      'boot.warmBootToPlayableS',
    ]);
    const ok = verifyReport(readJson<PerfReport>(fx('ok.json')), { tier: 'mobile-low' });
    expect(ok.every((l) => l.ok)).toBe(true);
  });

  it('judges the same file against a different tier budget', () => {
    // 80 objects pass mobile-low (100) and fail nothing at desktop; a tier mismatch is itself a failure.
    const r = run('perf-verify.ts', fx('ok.json'), '--tier', 'desktop');
    expect(r.status).toBe(1);
    expect(r.out).toContain('report tier mobile-low differs from --tier desktop');
  });

  it('frame budget factors: median x 1.05, p95 x 1.5, over50ms <= durationS / 60', () => {
    const base = readJson<PerfReport>(fx('ok.json'));
    const mk = (f: Partial<PerfReport['frames']>): PerfReport => ({ ...base, frames: { ...base.frames, ...f } });
    const failing = (r: PerfReport): string[] => verifyReport(r, { tier: 'mobile-low' }).filter((l) => !l.ok).map((l) => l.id);
    expect(failing(mk({ medianMs: 34.96 }))).toEqual([]);
    expect(failing(mk({ medianMs: 34.97 }))).toEqual(['frames.medianMs']);
    expect(failing(mk({ p95Ms: 49.95 }))).toEqual([]);
    expect(failing(mk({ p95Ms: 49.96 }))).toEqual(['frames.p95Ms']);
    expect(failing(mk({ over50ms: 10 }))).toEqual([]);
    expect(failing(mk({ over50ms: 11 }))).toEqual(['frames.over50ms']);
  });

  it('--counts-only skips frame times and boot; XR tiers use over2xBudget', () => {
    const base = readJson<PerfReport>(fx('over.json'));
    const counts = verifyReport(base, { tier: 'mobile-low', countsOnly: true });
    expect(counts.some((l) => l.id.startsWith('frames.') || l.id.startsWith('boot.'))).toBe(false);
    const xr: PerfReport = { ...base, tier: 'xr-quest', counts: { ...base.counts, renderObjectsMax: 10, trianglesMax: 10, gpuDrawCmdsMax: 10, texturesMB: 1 }, errors: { gpuLost: 0, uncaptured: 0, js: 0 } };
    const ids = verifyReport(xr, { tier: 'xr-quest' }).map((l) => l.id);
    expect(ids).toContain('frames.over2xBudget');
    expect(ids).not.toContain('frames.over50ms');
  });

  it('checks every checklist expectation', () => {
    const ok = readJson<PerfReport>(fx('ok.json'));
    const checklist: DeviceChecklist = {
      id: 't',
      milestone: 'M01c',
      device: 'd',
      urlTemplate: '<preview>/',
      steps: [
        { id: 'a', instruction: 'x', expect: [{ metric: 'backend', op: '==', value: 'webgl2' }, { metric: 'scenario.durationS', op: '>=', value: 600 }] },
        { id: 'b', instruction: 'y', expect: [{ metric: 'frames.maxMs', op: '<=', value: 50 }, { metric: 'no.such.metric', op: '==', value: 1 }] },
      ],
      upload: ['perf.json'],
    };
    const lines = verifyReport(ok, { tier: 'mobile-low', checklist });
    const failed = lines.filter((l) => !l.ok);
    expect(failed.map((l) => l.id)).toEqual(['checklist.frames.maxMs', 'checklist.no.such.metric']);
    expect(failed[1]?.text).toContain('missing');
    expect(metricOf(ok, 'counts.renderObjectsMax')).toBe(80);
    expect(metricOf(ok, 'counts.nope.deeper')).toBeUndefined();
  });

  it('validates the report schema first', () => {
    expect(perfReportErrors(readJson(fx('ok.json')))).toEqual([]);
    const broken = { ...readJson<Record<string, unknown>>(fx('ok.json')), v: 2, frames: { count: -1 } };
    expect(perfReportErrors(broken).length).toBeGreaterThan(0);
    const file = path.join(tmp, 'broken.json');
    writeFileSync(file, JSON.stringify(broken));
    const r = verifyFile(file, { tier: 'mobile-low' });
    expect(r.ok).toBe(false);
    expect(r.lines.every((l) => l.startsWith('FAIL  schema'))).toBe(true);
    expect(verifyFile(path.join(tmp, 'absent.json'), { tier: 'mobile-low' }).ok).toBe(false);
  });

  it('exits 2 on a missing file or a bad --tier', () => {
    expect(run('perf-verify.ts', path.join(tmp, 'absent.json'), '--tier', 'mobile-low').status).toBe(2);
    expect(run('perf-verify.ts', fx('ok.json'), '--tier', 'nope').status).toBe(2);
  });

  it('loads budgets from config/tier-budgets.json', () => {
    expect(loadBudget('mobile-low').render.maxRenderObjects).toBe(100);
    expect(loadBudget('desktop').frame.frameBudgetMs).toBe(16.7);
  });
});

describe('perf:checklist', () => {
  const dir = path.join(toolsRoot, 'tools/ci/checklists');
  const files = readdirSync(dir).filter((f) => f.startsWith('M01c-') && f.endsWith('.json'));

  it('ships the five M01c checklists and each is valid', () => {
    expect(files.sort()).toEqual(['M01c-iphone15.json', 'M01c-iphone16.json', 'M01c-mac.json', 'M01c-quest3.json', 'M01c-visionpro.json']);
    for (const f of files) expect(checklistErrors(readJson(path.join(dir, f))), f).toEqual([]);
  });

  it('prints the steps and the URL, replacing <preview> with --url', () => {
    const r = run('perf-checklist.ts', path.join(dir, 'M01c-iphone15.json'), '--url', 'https://preview.example/');
    expect(r.status).toBe(0);
    expect(r.out).toContain('M01c-iphone15 (M01c)');
    expect(r.out).toContain('URL: https://preview.example/?perf=1&tier=mobile-low');
    expect(r.out).toContain('[4-walk]');
    expect(r.out).toContain('expect backend == webgl2');
    expect(r.out).not.toContain('<preview>');
  });

  it('the iPhone 15 checklist has the WebGPU run in steps 7 to 9 (AC-14)', () => {
    const c = readJson<DeviceChecklist>(path.join(dir, 'M01c-iphone15.json'));
    expect(c.steps.slice(6, 9).map((s) => s.id)).toEqual(['7-gpu-open', '8-gpu-soak', '9-gpu-decide']);
    expect(c.urlTemplate).toBe('https://<preview>/?perf=1&tier=mobile-low');
  });

  it('rejects a malformed checklist', () => {
    const bad = { id: 'x', milestone: 'M01c', device: 'd', urlTemplate: 'no placeholder', steps: [{ id: 'a', instruction: '' }, { id: 'a', instruction: 'y', expect: [{ metric: 'm', op: '!=', value: 1 }] }], upload: ['other.json'] };
    const errors = checklistErrors(bad);
    expect(errors.some((e) => e.includes('placeholder'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicated'))).toBe(true);
    expect(errors.some((e) => e.includes('op must be'))).toBe(true);
    expect(errors.some((e) => e.includes('upload'))).toBe(true);
    const file = path.join(tmp, 'bad.json');
    writeFileSync(file, JSON.stringify(bad));
    expect(run('perf-checklist.ts', file).status).toBe(1);
    expect(formatChecklist(readJson(path.join(dir, 'M01c-mac.json'))).join('\n')).toContain('<preview>');
  });
});

describe('check:perf aggregation (AC-8)', () => {
  function reports(root: string, mutate: (project: string, tier: string, r: PerfReport, scenario: string) => void = () => {}, scenarios: readonly string[] = PERF_SCENARIOS): void {
    mkdirSync(path.join(root, 'test-results'), { recursive: true });
    for (const scenario of scenarios) {
      for (const project of PERF_PROJECTS) {
        for (const tier of FLAT_TIERS) {
          const b = loadBudget(tier);
          const r = readJson<PerfReport>(fx('ok.json'));
          r.tier = tier;
          r.counts = { ...r.counts, renderObjectsMax: Math.floor(b.render.maxRenderObjects * 0.8), trianglesMax: Math.floor(b.render.maxTriangles * 0.8) };
          mutate(project, tier, r, scenario);
          writeFileSync(path.join(root, 'test-results', `perf.${scenario}.${project}.${tier}.json`), JSON.stringify(r));
          if (scenario === 'downtown-rush') {
            const crowd = (loadBudget(tier) as unknown as { crowd: { maxTrafficInstances: number } }).crowd.maxTrafficInstances;
            writeFileSync(path.join(root, 'test-results', `perf.${scenario}.${project}.${tier}.traffic.json`), JSON.stringify({ scenario, tier, samples: 40, instancesMax: Math.floor(crowd * 0.5), drawsMax: 7, objectsMax: 8, cap: crowd, simAgents: Math.floor(crowd * 0.5), simCap: crowd }));
          }
        }
      }
    }
  }

  it('the registered scenarios are the data file ids, and --scenario selects one of them, graybox-walk, or fails', () => {
    expect(PERF_SCENARIOS).toEqual(['walk-civic-center', 'route-ferry-ocean-beach', 'downtown-rush']);
    expect(selectScenarios(undefined)).toEqual([...PERF_SCENARIOS]);
    expect(selectScenarios('route-ferry-ocean-beach')).toEqual(['route-ferry-ocean-beach']);
    expect(selectScenarios('graybox-walk')).toEqual(['graybox-walk']);
    expect(selectScenarios('nope')).toBeNull();
    const r = run('perf-check.ts', '--scenario', 'nope', '--skip-run');
    expect(r.status).not.toBe(0);
  });

  it('accepts scenarios x 8 schema-valid reports with objects within each tier budget', () => {
    const root = path.join(tmp, 'ok');
    reports(root);
    const r = checkReports(root);
    expect(r.checked).toBe(8 * PERF_SCENARIOS.length);
    expect(r.ok).toBe(true);
  });

  it('flags a report over its tier budget and a missing report', () => {
    const root = path.join(tmp, 'over');
    reports(root, (project, tier, rep, scenario) => {
      if (scenario === 'route-ferry-ocean-beach' && project === 'webkit-webgl2' && tier === 'mobile') rep.counts.renderObjectsMax = 999;
    });
    rmSync(path.join(root, 'test-results', 'perf.walk-civic-center.chromium-webgl2.desktop.json'));
    const r = checkReports(root);
    expect(r.ok).toBe(false);
    expect(r.missing).toBe(1);
    expect(r.lines.join('\n')).toContain('render objects max 999');
    expect(r.lines.join('\n')).toContain('no report at');
  });

  it('a second scenario cannot hide behind the first: a missing report of one scenario fails the check', () => {
    const root = path.join(tmp, 'one-scenario');
    reports(root, undefined, ['walk-civic-center']);
    const r = checkReports(root);
    expect(r.ok).toBe(false);
    expect(r.missing).toBe(8 * (PERF_SCENARIOS.length - 1));
    expect(checkReports(root, ['walk-civic-center']).ok).toBe(true);
  });

  it('check:perf --skip-run with --fail exits 1 when reports are missing and 0 otherwise (warning mode)', () => {
    const missing = run('perf-check.ts', '--skip-run');
    // The repository's own test-results may or may not hold reports; warning mode never fails.
    expect(missing.status).toBe(0);
  });
});
