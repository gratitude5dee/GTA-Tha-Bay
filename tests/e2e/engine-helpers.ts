import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeP0, sampleHeight, type SimChunk } from '../../packages/shared/src/index.ts';
import type { EngineObservation } from '../../packages/engine/src/client/boot/boot-engine.ts';
import type { Page } from '@playwright/test';

export type Obs = EngineObservation;

export async function waitForEngine(page: Page): Promise<void> {
  await page.waitForSelector('html[data-dv-engine="ready"]', { state: 'attached', timeout: 90_000 });
}

export const observe = (page: Page): Promise<Obs> =>
  page.evaluate(() => {
    const engine = (window as unknown as { __dvBridge?: { engine?: { observe(): unknown } } }).__dvBridge?.engine;
    if (!engine) throw new Error('missing __dvBridge.engine');
    return engine.observe();
  }) as Promise<Obs>;

export const act = (page: Page, cmd: object): Promise<boolean> =>
  page.evaluate((c) => {
    const engine = (window as unknown as { __dvBridge?: { engine?: { act(c: object): boolean } } }).__dvBridge?.engine;
    if (!engine) throw new Error('missing __dvBridge.engine');
    return engine.act(c);
  }, cmd);

/** Small viewports keep the software renderer near 60 ticks a second (the sim clamps a frame to 0.15 s of ticks). */
export const SMALL_VIEWPORT = { width: 480, height: 270 } as const;

/** C02: 60 Hz fixed step, and a frame is paid for at most 9 ticks (`MAX_FRAME_DT` 0.15 s); time beyond that is dropped and counted. */
const SIM_HZ = 60;
const MAX_TICKS_PER_FRAME = 9;

/** The sim's own numbers over a window that starts and ends on a stats report, so the numerator and the wall clock line up. */
export interface TickWindow {
  wallSec: number;
  /** Ticks the sim ran in the window. */
  ticks: number;
  /** Frame time the C02 clamp dropped in the window (the sim counts it; it is not a missing tick). */
  droppedSec: number;
  /** Frames that hit the clamp, each of which ran the full MAX_TICKS_PER_FRAME. */
  overruns: number;
  /** Frames the page rendered. */
  frames: number;
}

/** Waits for the next stats report (they arrive about every sixth frame group) and returns the observation that carries it. */
async function nextReport(page: Page, after: number): Promise<{ obs: Obs; at: number }> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const obs = await observe(page);
    const at = Date.now();
    if (obs.stats.tick !== after) return { obs, at };
    if (at > deadline) throw new Error('no sim stats report arrived within 30 s');
    await page.waitForTimeout(20);
  }
}

/**
 * Measures the sim over at least `windowMs`, from one stats report to a later one. Sizing the window by the sim's own
 * accounting (ticks / 60 plus the dropped time it reports) instead of a fixed wall-clock guess keeps the check valid on a
 * software GPU, where a slow frame rate makes the C02 clamp drop time by design.
 */
export async function measureTicks(page: Page, windowMs = 2000): Promise<TickWindow> {
  // Each end waits for a report newer than the one in hand, so its arrival time is when its numbers were true.
  const first = await nextReport(page, (await observe(page)).stats.tick);
  await page.waitForTimeout(windowMs);
  const last = await nextReport(page, (await observe(page)).stats.tick);
  return {
    wallSec: (last.at - first.at) / 1000,
    ticks: last.obs.stats.tick - first.obs.stats.tick,
    droppedSec: last.obs.stats.droppedSec - first.obs.stats.droppedSec,
    overruns: last.obs.stats.overruns - first.obs.stats.overruns,
    frames: last.obs.frames - first.obs.frames,
  };
}

/**
 * The fixed-rate rule (C02 rules 1 and 3) as numbers: every second of wall time is either ticked at 60 Hz or counted as
 * dropped by the clamp, a clamped frame still runs all nine ticks, and when nothing was dropped the sim ran near 60 ticks a
 * second (45 or better).
 */
export function fixedRateViolations(w: TickWindow): string[] {
  const out: string[] = [];
  const accounted = w.ticks / SIM_HZ + w.droppedSec;
  if (w.ticks <= 0) out.push('no ticks ran');
  // The two ends are stamped when the test sees each report, which can lag the report by a frame or two on a loaded
  // runner, so the band is wide: it still catches a sim that stalls (under) or runs ahead of real time (over).
  if (accounted < 0.7 * w.wallSec) out.push(`sim time accounted ${accounted.toFixed(3)} s is under 70% of ${w.wallSec.toFixed(3)} s wall`);
  if (accounted > 1.3 * w.wallSec + 0.5) out.push(`sim time accounted ${accounted.toFixed(3)} s is over 130% of ${w.wallSec.toFixed(3)} s wall (+0.5 s)`);
  if (w.ticks < MAX_TICKS_PER_FRAME * w.overruns) out.push(`${w.overruns} clamped frames should have run ${MAX_TICKS_PER_FRAME * w.overruns} ticks, got ${w.ticks}`);
  // Nothing dropped means every frame was paid in full, so the rate is the fixed 60 Hz; 45 leaves room for the report-stamp lag above.
  if (w.droppedSec < 0.05 * w.wallSec && w.ticks / w.wallSec < 45) out.push(`${(w.ticks / w.wallSec).toFixed(1)} ticks/s with nothing dropped`);
  return out;
}

const packDir = fileURLToPath(new URL('../fixtures/world/civic-graybox/', import.meta.url));
let chunks: SimChunk[] | null = null;

/** The decoded p0 chunks of the fixture, read once. */
export function fixtureChunks(): SimChunk[] {
  chunks ??= decodeP0(new Uint8Array(readFileSync(`${packDir}p0-64-64.pack`)));
  return chunks;
}

/** Terrain height at an ENU position, or NaN outside the four chunks. */
export function terrainAt(x: number, z: number): number {
  for (const c of fixtureChunks()) {
    const o = c.height;
    if (x >= o.originX && x <= o.originX + 256 && z >= o.originZ && z <= o.originZ + 256) return sampleHeight(o, x, z);
  }
  return Number.NaN;
}

/** The z=9 chunk column and row of an ENU position (chunks are 256 m and the grid starts at -128 m for this fixture). */
export const chunkIndexOf = (x: number, z: number): [number, number] => [Math.floor((x + 128) / 256), Math.floor((z + 128) / 256)];
