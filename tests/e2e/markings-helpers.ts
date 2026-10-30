import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { QualityTierId } from '../../packages/shared/src/index.ts';
import type { PlatformBridge } from '../../packages/engine/src/platform/probe.ts';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { decodePng, identical, type Rgba } from '../support/image-diff.ts';
import { SMALL_VIEWPORT } from './engine-helpers.ts';

/**
 * What the M02h1 street-markings specs share: `world-markings.spec.ts` (@world-markings), `markings-golden.spec.ts` (@markings-golden),
 * `markings-flicker-desktop.spec.ts` and `markings-flicker-low.spec.ts` (@markings-golden, the shot pair), `markings-ledger.spec.ts`
 * (@markings-ledger). The files are separate because Playwright cuts a shard out of the sorted list of tests by count and a `desktop` boot
 * is the longest single case of the suite on software GL (BD-REPAIR-M02g2-03, BD-FIX-CI-TEXGOLD-01).
 */
export type W = {
  __dvBridge: { world: WorldBridge; platform: PlatformBridge; engine: { setPaused(p: boolean): void } };
};
export const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
export const bakeIdOf = (): string => read<{ bakeId: string }>('dist/world/latest-synth.json').bakeId;
export const HIDE = '.dv-hud, .dv-sim-panel, .dv-sky-controls, .dv-pursuit, .dv-modes, .dv-mission, .dv-npcdbg, .dv-npcagency, [data-dv-xr-smoke], [data-dv-world-controls] { display: none !important }';
export const GOLDEN_VIEWPORT = { width: 256, height: 144 } as const;
export const FLAT_TIERS = ['desktop', 'mobile', 'mobile-low'] as const;
export type FlatTier = (typeof FLAT_TIERS)[number];
/** The tiers of the goldens and the pair: `xr-quest` is the Quest tier forced on the flat canvas (no immersive session). */
export const PAINT_TIERS = ['desktop', 'mobile-low', 'xr-quest'] as const;
/** The shots of the markings goldens, listed in the manifest of tests/e2e/golden/look. */
export const MARKINGS_GOLDEN_SHOTS = ['markings-near', 'markings-graze'] as const;

export const world = <T>(page: Page, fn: (w: WorldBridge) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__dvBridge.world)`) as Promise<T>;

/** A QA world boot in sandbox play at `tier`; `xr-quest` also asks for the Quest emulation the XR specs use. */
export async function bootWorld(page: Page, tier: string, query = '', size: { width: number; height: number } = SMALL_VIEWPORT): Promise<void> {
  await page.setViewportSize(size);
  const xr = tier.startsWith('xr-') ? '&xr-emulate=quest3' : '';
  await page.goto(`/?play=sandbox&tier=${tier}&debug=1${xr}${query}`);
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.world !== undefined, undefined, { timeout: 180_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world.boot().revealed, undefined, { timeout: 240_000 });
  await page.evaluate(() => (window as unknown as W).__dvBridge.world.settle(90_000));
}

/** Frames the page presents after now. */
export const frames = async (page: Page, n: number): Promise<void> => {
  const f0 = await world(page, (w) => w.chunks().frame);
  await page.waitForFunction((t) => (window as unknown as W).__dvBridge.world.chunks().frame >= t, f0 + n, { timeout: 180_000, polling: 250 });
};

/** The crowds and the animated characters out of the picture (their groups hidden, the avatar off the camera's layer). */
export async function clearActors(page: Page): Promise<void> {
  await page.evaluate(() => {
    type G = { group: { visible: boolean } } | null;
    const b = (window as unknown as W).__dvBridge;
    const view = b.world.internals().view as unknown as { traffic: G; peds: G; transit: G };
    for (const r of [view.traffic, view.peds, view.transit]) if (r) r.group.visible = false;
  });
}

/** The canvas once two consecutive presented frames agree. */
export async function settledCanvas(page: Page): Promise<Rgba> {
  await frames(page, 3);
  let img = decodePng(await page.locator('#dv-engine-canvas').screenshot());
  for (let i = 0; i < 5; i++) {
    await frames(page, 2);
    const next = decodePng(await page.locator('#dv-engine-canvas').screenshot());
    const same = identical(img, next);
    img = next;
    if (same) break;
  }
  return img;
}

export const live = (page: Page): Promise<{ renderObjects: number; triangles: number }> =>
  page.evaluate(() => (window as unknown as W).__dvBridge.platform.perf.live());

export async function setSky(page: Page, hour: number, weather: string): Promise<void> {
  await page.evaluate(
    ([h, w]) => {
      const bridge = (window as unknown as W).__dvBridge.world;
      bridge.setHour(h as number, true);
      bridge.setWeather(w as never, 0);
    },
    [hour, weather] as const,
  );
  await page.waitForFunction(
    ([h, w]) => {
      const s = (window as unknown as W).__dvBridge.world.sky();
      return !!s && Math.abs(s.hour - (h as number)) < 0.05 && s.weather === w && s.next === w;
    },
    [hour, weather] as const,
    { timeout: 120_000 },
  );
}

export type { QualityTierId };
