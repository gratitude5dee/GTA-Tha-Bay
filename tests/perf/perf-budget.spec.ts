import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { PerfReport, QualityTierId } from '../../packages/shared/src/index.ts';
import { storyChase } from './scenarios/story-chase.ts';

/**
 * check:perf (11-platform-perf.md section 9, spec 8). For each flat tier, run the canned scenario on the QA build and write
 * `test-results/perf.<scenario>.<project>.<tier>.json`. The budgets are judged afterwards by `perf-verify --counts-only` in perf-check.ts (a
 * warning on PRs, a failure with `--fail`); this spec only asserts that a report was produced. SwiftShader frame times are never
 * asserted [research/gap-ci-cd-release-assets.md section 4.1].
 */
const budgets = JSON.parse(readFileSync('config/tier-budgets.json', 'utf8')) as { tiers: Record<QualityTierId, { render: { maxRenderObjects: number; maxTriangles: number; maxGpuDrawCmds: number } }> };
const TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low'];
const SCENARIO = process.env.DV_PERF_SCENARIO ?? 'graybox-walk';
/** Scenarios that show the ambient traffic (M03b1): they also write a `.traffic.json` the counts check judges. */
const TRAFFIC = new Set(['downtown-rush']);
/** Scenarios whose page runs a part of the game (a URL suffix and a setup after the world is up; tests/perf/scenarios/*.ts). */
const PAGE_SCENARIOS: Record<string, { query: string; timeoutMs: number; setup(page: Page): Promise<void> }> = { 'story-chase': storyChase };
const PAGE = PAGE_SCENARIOS[SCENARIO];
const DURATION_S = Number(process.env.DV_PERF_DURATION_S ?? 6);
const WARMUP_S = Number(process.env.DV_PERF_WARMUP_S ?? 2);

for (const tier of TIERS) {
  test(`${SCENARIO} at ${tier} writes its counts report @perf`, async ({ page }, testInfo) => {
    test.setTimeout(PAGE?.timeoutMs ?? 240_000);
    await page.goto(`/?tier=${tier}&perf=1${PAGE ? `&${PAGE.query}` : ''}`);
    await page.waitForFunction(() => (window as unknown as { __dvBridge?: { platform?: unknown } }).__dvBridge?.platform !== undefined, undefined, { timeout: 90_000 });

    // M03b1: the traffic scenario runs at the evening peak (17:00 on a clear weekday, the hour curve's top) with the traffic following the camera.
    if (TRAFFIC.has(SCENARIO)) {
      await page.waitForFunction(() => (window as unknown as { __dvBridge?: { world?: unknown } }).__dvBridge?.world !== undefined, undefined, { timeout: 150_000 });
      await page.evaluate(() => {
        const world = (window as unknown as { __dvBridge: { world: { setHour(h: number, freeze?: boolean): boolean; setWeather(w: string, blendSec?: number): boolean; rain(v: number | null): void } } }).__dvBridge.world;
        world.setHour(17, true);
        world.setWeather('clear', 0);
        world.rain(0);
        // samples of what the traffic costs, taken while the scenario runs
        const w = window as unknown as { __trafficSamples?: unknown[]; __trafficTimer?: number; __dvBridge: { world: { traffic(): unknown } } };
        w.__trafficSamples = [];
        w.__trafficTimer = window.setInterval(() => w.__trafficSamples?.push(w.__dvBridge.world.traffic()), 250);
        // M03b2: the pedestrians and the buses (which share the traffic cap) are sampled with it
        const x = window as unknown as { __pedSamples?: unknown[]; __pedTimer?: number; __dvBridge: { world: { peds(): unknown; transit(): unknown; traffic(): unknown } } };
        x.__pedSamples = [];
        x.__pedTimer = window.setInterval(() => x.__pedSamples?.push({ ped: x.__dvBridge.world.peds(), transit: x.__dvBridge.world.transit(), traffic: x.__dvBridge.world.traffic() }), 250);
      });
    } else if (SCENARIO !== 'graybox-walk') {
      // M02b2 (AC-7): the world scenarios run at the sky's most expensive look: 21:30 with rain (night lights, streaks, overlay, wet).
      await page.waitForFunction(() => (window as unknown as { __dvBridge?: { world?: unknown } }).__dvBridge?.world !== undefined, undefined, { timeout: 150_000 });
      await page.evaluate(() => {
        const world = (window as unknown as { __dvBridge: { world: { setHour(h: number, freeze?: boolean): boolean; setWeather(w: string, blendSec?: number): boolean; rain(v: number | null): void } } }).__dvBridge.world;
        world.setHour(21.5, true);
        world.setWeather('rain', 0);
        world.rain(200);
      });
      // M05c2: a scenario that plays a part of the game starts it now, with the sky already at its most expensive look
      if (PAGE) await PAGE.setup(page);
    }

    const report = (await page.evaluate(
      `window.__dvBridge.platform.perf.run(${JSON.stringify(SCENARIO)}, { durationS: ${DURATION_S}, warmupS: ${WARMUP_S} })`,
    )) as PerfReport;

    mkdirSync('test-results', { recursive: true });
    const file = `test-results/perf.${SCENARIO}.${testInfo.project.name}.${tier}.json`;
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    // M05c2: what the objects of the busiest frame were (by top-level scene node), beside the report; and which chase a story scenario played
    const extra = (await page.evaluate(
      `({ info: window.__dvBridge.platform.perf.info ? window.__dvBridge.platform.perf.info() : null, chase: window.__dvChase ?? null })`,
    )) as { info: { breakdownAtMax?: Record<string, number> } | null; chase: string | null };
    if (extra.info?.breakdownAtMax) writeFileSync(file.replace(/\.json$/, '.breakdown.json'), `${JSON.stringify({ chase: extra.chase, breakdown: extra.info.breakdownAtMax }, null, 2)}\n`);

    if (TRAFFIC.has(SCENARIO)) {
      const traffic = await page.evaluate(async () => {
        const w = window as unknown as { __trafficSamples?: Array<{ instances: number; draws: number; objects: number; cap: number } | null>; __trafficTimer?: number; __dvBridge: { world: { trafficSim(ms?: number): Promise<{ agents?: number; cap?: number } | null> } } };
        if (w.__trafficTimer !== undefined) window.clearInterval(w.__trafficTimer);
        const samples = (w.__trafficSamples ?? []).filter((x): x is NonNullable<typeof x> => x !== null);
        const sim = await w.__dvBridge.world.trafficSim(10_000);
        const max = (f: (x: (typeof samples)[number]) => number): number => samples.reduce((m, x) => Math.max(m, f(x)), 0);
        return { samples: samples.length, instancesMax: max((x) => x.instances), drawsMax: max((x) => x.draws), objectsMax: max((x) => x.objects), cap: samples[0]?.cap ?? 0, simAgents: sim?.agents ?? 0, simCap: sim?.cap ?? 0 };
      });
      const peds = await page.evaluate(async () => {
        type Ped = { instances: number; near: number; draws: number; objects: number; cap: number; nearCap: number } | null;
        type Transit = { buses: number; draws: number; objects: number } | null;
        type Cars = { instances: number } | null;
        const w = window as unknown as { __pedSamples?: Array<{ ped: Ped; transit: Transit; traffic: Cars }>; __pedTimer?: number; __dvBridge: { world: { pedsSim(h?: undefined, ms?: number): Promise<{ peds?: number; cap?: number } | null> } } };
        if (w.__pedTimer !== undefined) window.clearInterval(w.__pedTimer);
        const samples = (w.__pedSamples ?? []).filter((x) => x.ped !== null);
        const sim = await w.__dvBridge.world.pedsSim(undefined, 10_000);
        const max = (f: (x: (typeof samples)[number]) => number): number => samples.reduce((m, x) => Math.max(m, f(x)), 0);
        return {
          samples: samples.length, instancesMax: max((x) => x.ped?.instances ?? 0), nearMax: max((x) => x.ped?.near ?? 0), drawsMax: max((x) => x.ped?.draws ?? 0),
          objectsMax: max((x) => (x.ped?.objects ?? 0) + (x.transit?.objects ?? 0)), cap: samples[0]?.ped?.cap ?? 0, nearCap: samples[0]?.ped?.nearCap ?? 0,
          busesMax: max((x) => x.transit?.buses ?? 0), carsPlusBusesMax: max((x) => (x.traffic?.instances ?? 0) + (x.transit?.buses ?? 0)),
          simPeds: sim?.peds ?? 0, simCap: sim?.cap ?? 0,
        };
      });
      writeFileSync(`test-results/perf.${SCENARIO}.${testInfo.project.name}.${tier}.traffic.json`, `${JSON.stringify({ scenario: SCENARIO, tier, ...traffic, peds }, null, 2)}\n`);
      console.log(`peds ${testInfo.project.name} ${tier}: instancesMax=${peds.instancesMax} (cap ${peds.cap}) near=${peds.nearMax}/${peds.nearCap} draws=${peds.drawsMax} buses=${peds.busesMax} cars+buses=${peds.carsPlusBusesMax} simPeds=${peds.simPeds} samples=${peds.samples}`);
      console.log(`traffic ${testInfo.project.name} ${tier}: instancesMax=${traffic.instancesMax} (cap ${traffic.cap}) draws=${traffic.drawsMax} objects=${traffic.objectsMax} simAgents=${traffic.simAgents} samples=${traffic.samples}`);
      expect(traffic.samples).toBeGreaterThan(0);
    }

    const budget = budgets.tiers[tier].render;
    console.log(
      `perf ${testInfo.project.name} ${tier}: backend=${report.backend} frames=${report.frames.count} objects=${report.counts.renderObjectsMax}/${budget.maxRenderObjects} tris=${report.counts.trianglesMax}/${budget.maxTriangles} drawCmds=${String(report.counts.gpuDrawCmdsMax)}`,
    );
    expect(report.tier).toBe(tier);
    expect(report.backend).toBe('webgl2');
    expect(report.frames.count).toBeGreaterThan(0);
    expect(report.counts.renderObjectsMax).toBeGreaterThan(0);
    // The budget comparison is perf-verify --counts-only's job, so a miss is a warning in PR mode and an error with --fail.
    expect(report.errors.gpuLost).toBe(0);
  });
}
