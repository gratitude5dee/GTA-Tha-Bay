import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';

/**
 * Shared helpers of the M10d0 texture specs (`art-textures.spec.ts`, `pavement-textures-golden.spec.ts`). The goldens live in their own spec
 * file so CI's file-level sharding can place them apart from the other texture cases (BD-FIX-CI-TEXGOLD-01).
 */
export type W = { __dvBridge: { world: WorldBridge; platform: { perf: { live(): { renderObjects: number } } } } };

export const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

/** A software-rendered frame costs seconds, so every boot here is small (the goldens use it too). */
export const VIEWPORT = { width: 256, height: 144 } as const;

export async function bootWorld(page: Page, tier: QualityTierId, query = '', size: { width: number; height: number } = VIEWPORT): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?tier=${tier}&debug=1${query}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
}

export const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

/** Resolves once the tier's textures have arrived (or failed); a tier with none is settled at once. */
export const texturesSettled = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (window as unknown as W).__dvBridge.world.look()?.textures?.settled === true, undefined, { timeout: 300_000, polling: 500 });

export const frames = async (page: Page, n: number): Promise<void> => {
  const f0 = await world(page, (w) => w.chunks().frame);
  await page.waitForFunction((t) => (window as unknown as W).__dvBridge.world.chunks().frame >= t, f0 + n, { timeout: 180_000, polling: 250 });
};

export const HIDE = '.dv-hud, .dv-sim-panel, .dv-sky-controls, .dv-pursuit, .dv-modes, .dv-mission, .dv-npcdbg, .dv-npcagency, [data-dv-xr-smoke], [data-dv-world-controls] { display: none !important }';

/** The golden capture size, shared by the goldens and the XR ledger leg. */
export const GOLDEN_VIEWPORT = { width: 256, height: 144 } as const;
export const bakeIdOf = (): string => read<{ bakeId: string }>('dist/world/latest-synth.json').bakeId;
