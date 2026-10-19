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
