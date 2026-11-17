import type { Page } from '@playwright/test';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';
import { lap, secs, tierOf } from './lap.ts';

/**
 * The world's draw held from a spec (BD-FIX-CI-PLAN-04): `RendererHost.holdWorld('cover')`, the hold `streamAtPlan` of `ledger-helpers.ts`
 * and the held shots (`shot(id, { held: true })`) take. While it stands the page's loop, the engine hand-off, the sim and the upload gate
 * run every animation frame as before and only the render call of the flat world is skipped, so nothing waits behind a frame that costs
 * 4 to 9 s at `desktop` on software GL: a command to the sim is on the page a few loop frames later (milliseconds), a `page.evaluate`
 * is answered at once, and `settle()` is not paced by the draw.
 *
 * For a case whose assertions read the page's state or its own offscreen targets (`world.sky()`, `world.luma()`), never the canvas.
 * `drawWorldFrames` puts what the case has set on the canvas for as many frames as it asks, so every state the case walks through is
 * still drawn by the page's own pipeline and a page error of that draw still reaches the case.
 */
type HoldHost = { frames: number; heldFrames: number; holdWorld(kind: 'cover'): () => void; addFrameListener(l: { after?(time: number): void }): () => void };
type HoldWindow = { __dvBridge: { world: WorldBridge }; __dvE2eWorldHold?: (() => void) | null };

/** Holds the world's draw from the next frame on. A second call while the hold stands changes nothing. */
export async function holdWorldDraw(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window as unknown as HoldWindow;
    if (g.__dvE2eWorldHold) return;
    const host = (g.__dvBridge.world.internals().view as unknown as { host: HoldHost | null }).host;
    if (!host) throw new Error('holdWorldDraw: the world view has no renderer host');
    g.__dvE2eWorldHold = host.holdWorld('cover');
  });
}

/** Releases the hold of `holdWorldDraw`; the page draws again from its next frame. Without a hold it does nothing. */
export async function releaseWorldDraw(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window as unknown as HoldWindow;
    g.__dvE2eWorldHold?.();
    g.__dvE2eWorldHold = null;
  });
}

/**
 * Lets the page draw `frames` frames of the flat world (the frames of the loop that reached their render call:
 * `RendererHost.frames - heldFrames`) and resolves when they are done. A hold of `holdWorldDraw` is released for them and taken again
 * inside the last one's `after` listener, so exactly that many are drawn (a timer would run only after a further frame: on a slow
 * renderer the next animation frame is due before any timer). Without a hold the page simply draws on. Rejects, naming what was drawn,
 * when the frames are not there in `timeoutMs`.
 */
export async function drawWorldFrames(page: Page, frames = 1, timeoutMs = 120_000): Promise<void> {
  const t0 = Date.now();
  const r = await page.evaluate(
    async ([n, limit]) => {
      const g = window as unknown as HoldWindow;
      const host = (g.__dvBridge.world.internals().view as unknown as { host: HoldHost | null }).host;
      if (!host) throw new Error('drawWorldFrames: the world view has no renderer host');
      const held = !!g.__dvE2eWorldHold;
      const drawn = (): number => host.frames - host.heldFrames;
      const from = drawn();
      g.__dvE2eWorldHold?.();
      g.__dvE2eWorldHold = null;
      await new Promise<void>((resolve, reject) => {
        const done = (err?: Error): void => {
          off();
          clearTimeout(timer);
          if (held && !g.__dvE2eWorldHold) g.__dvE2eWorldHold = host.holdWorld('cover');
          if (err) reject(err);
          else resolve();
        };
        const off = host.addFrameListener({
          after: () => {
            if (drawn() - from >= (n as number)) done();
          },
        });
        const timer = setTimeout(() => done(new Error(`drawWorldFrames: ${drawn() - from} of ${n as number} frames drawn in ${limit as number} ms`)), limit as number);
      });
      return { drawn: drawn() - from, held };
    },
    [frames, timeoutMs] as const,
  );
  lap(`drawWorldFrames ${tierOf(page)}`, `${r.drawn} drawn in ${secs(t0)} s${r.held ? ', the hold taken again' : ''}`);
}
