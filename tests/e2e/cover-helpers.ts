import { expect, type Page } from '@playwright/test';
import { frames, world, type W } from './markings-helpers.ts';

/**
 * What the M02h3 ground-cover specs share: `world-cover.spec.ts` (@world-cover), `city-cover-golden.spec.ts` (the four cover goldens,
 * @look-golden) and `cover-ledger.spec.ts` (@cover-ledger). The cases live in three files because Playwright cuts a shard out of the sorted
 * list of tests by count, and a `desktop` boot is the longest single case of the suite on software GL (BD-REPAIR-M02h2-04): the
 * `city-` and `cover-` names sort the goldens and the ledger into chromium-webgl2 shard 2 of 9, away from the `world-` files of shard 8
 * and from shards 3, 5 and 6, which are the fullest.
 *
 * A toggle of the layer re-meshes the resident L0 chunks nearest first (`WorldView.setCover`); the cases wait for the chunks to follow it
 * (`look().cover.pending`) with the world's draw held, the way the ledgers wait for their plan (`streamAtPlan`), never on a frame count.
 */
export type CoverReport = { enabled: boolean; cells: Record<string, number>; pending: number; pendingNear: number };
export const CLASSES = ['yard', 'dirt', 'mixed', 'driveway', 'vacant', 'scrub', 'park'] as const;

export const cover = async (page: Page): Promise<CoverReport> => {
  const r = await world(page, (w) => (w.look() as unknown as { cover?: CoverReport } | null)?.cover ?? null);
  expect(r, 'look().cover is reported').not.toBeNull();
  return r as CoverReport;
};

/** What makes up the frame's render objects: the world units by level and the traffic. */
export const parts = (page: Page): Promise<Record<string, unknown>> =>
  world(page, (w) => {
    const c = w.chunks();
    return { objects: c.objects, triangles: c.triangles, l0: c.resident.l0.length, l1: c.resident.l1.length, l2: c.resident.l2.length, masks: c.masks, traffic: w.traffic()?.objects ?? null };
  });

export const setCover = (page: Page, on: boolean): Promise<boolean> => page.evaluate((o) => (window as unknown as W).__dvBridge.world.setLookLayer('cover', o), on);

/**
 * After a toggle: with the world's draw held (the hold of `streamAtPlan`), wait until every resident chunk with cover follows the layer
 * (`look().cover.pending`) and the stream is quiet (`settle`), then six frames. The render objects of a desktop frame move while the
 * stream fills (one unit a presented frame on software GL), so both counts are read at the plan.
 */
export async function coverSettled(page: Page): Promise<void> {
  const r = await page.evaluate(async () => {
    const w = (window as unknown as W).__dvBridge.world;
    const host = (w.internals().view as unknown as { host: { holdWorld(kind: 'cover'): () => void } }).host;
    const release = host.holdWorld('cover');
    try {
      const t0 = performance.now();
      for (;;) {
        const c = (w.look() as unknown as { cover: CoverReport }).cover;
        if (c.pending === 0) break;
        if (performance.now() - t0 > 600_000) return { ok: false, c, settled: false };
        await new Promise((res) => setTimeout(res, 250));
      }
      const s = await w.settle(600_000);
      return { ok: true, c: (w.look() as unknown as { cover: CoverReport }).cover, settled: s.settled };
    } finally {
      release();
    }
  });
  expect(r.ok && r.settled, `every resident chunk follows the cover layer and the stream is quiet (${JSON.stringify(r)})`).toBe(true);
  await frames(page, 6);
}
