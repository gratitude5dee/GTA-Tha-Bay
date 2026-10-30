import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';

/**
 * Shared helpers of the M02e look specs (`world-look.spec.ts`, `city-look-golden.spec.ts`). The goldens live in a file of their own whose
 * name sorts into a light nine-shard slice, apart from the other look cases (BD-FIX-CI-WORLDLOOK-01).
 */
export type W = { __dvBridge: { world: WorldBridge } };

export interface Json { [k: string]: unknown }
export const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

export async function bootWorld(page: Page, tier: QualityTierId, query = '', size: { width: number; height: number } = SMALL_VIEWPORT): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?tier=${tier}&debug=1${query}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
}

export const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;


/** Frames the page presents after now. */
export const frames = async (page: Page, n: number): Promise<void> => {
  const f0 = await world(page, (w) => w.chunks().frame);
  await page.waitForFunction((t) => (window as unknown as W).__dvBridge.world.chunks().frame >= t, f0 + n, { timeout: 180_000, polling: 250 });
};

/** The golden capture size, shared by the goldens and the before/after pair. */
export const GOLDEN_VIEWPORT = { width: 256, height: 144 } as const;
export const bakeIdOf = (): string => read<{ bakeId: string }>('dist/world/latest-synth.json').bakeId;
