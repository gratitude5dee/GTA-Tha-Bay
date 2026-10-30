import { expect, type Page } from '@playwright/test';
import type { WorldBridge } from '../../packages/world/src/client/world-bridge.ts';

/**
 * The frame every render-object and triangle ledger of `docs/look` measures (DL-758, BD-FIX-LEDGER-SETTLED-01): one whose stream has
 * reached its plan. Used by `@look-ledger` (M02g1, `look-tune.spec.ts`, and its XR leg in `world-look.spec.ts`), `@textures-ledger`
 * (M10d0, `art-textures.spec.ts`), `@fixes-ledger` (M02g2, `world-sky-look-fixes.spec.ts`) and `@art-ledger` (M10d1, `art-city.spec.ts`).
 *
 * The count of a held frame rises with every world unit that comes up, and the gate lets one unit up per presented frame (C08 rule 13).
 * A `desktop` frame on software GL takes seconds, so `settle()` ran out long before the plan was resident and each ledger read a moment
 * of the fill (the `desktop` case of `@fixes-ledger` read 242 to 308 render objects on the same tree; the plan holds 551 to 552).
 * The world's draw is held while the stream fills (`RendererHost.holdWorld('cover')`, the hold a cutscene poster uses): the loop, the
 * sim and the gate run as before and only the render call is skipped, so the plan is resident in about a minute instead of about
 * seventeen. Then the draw is released and six frames are presented before the case holds its frame and measures.
 *
 * The transit and the pedestrians are left out of that frame, as the golden captures leave them out. Each is drawn as one instanced mesh
 * per kind or body, and a mesh is one render object while any of its vehicles or people is in range, which changes with their movement
 * from boot to boot: at `desktop` a bus was in range in two of three boots of the same tree (552 render objects) and not in the third
 * (551), every other node of the frame being the same, and at `mobile-low` (`fog-west`) one pedestrian body was drawn in one boot and not
 * in another (81 and 80). The traffic stays in: the protocol keeps it resident, and its one family (its art families on the desktop
 * tiers) was drawn in every boot.
 *
 * Call it after the case has set its sky, has its traffic resident and has taken its shot (`mobile-low` at `fog-west`): the plan is the
 * one around the focus at the call.
 */
export async function streamAtPlan(page: Page, timeoutMs = 600_000): Promise<void> {
  const r = await page.evaluate(async (t) => {
    const w = (window as unknown as { __dvBridge: { world: WorldBridge } }).__dvBridge.world;
    const host = (w.internals().view as unknown as { host: { holdWorld(kind: 'cover'): () => void } }).host;
    const release = host.holdWorld('cover');
    try {
      return await w.settle(t);
    } finally {
      release();
    }
  }, timeoutMs);
  expect(r.settled, `the stream holds its plan (pending ${r.pending}, queued ${r.queued})`).toBe(true);
  await page.evaluate(() => {
    type G = { group: { visible: boolean } } | null;
    const view = (window as unknown as { __dvBridge: { world: WorldBridge } }).__dvBridge.world.internals().view as unknown as { transit: G; peds: G };
    for (const r of [view.transit, view.peds]) if (r) r.group.visible = false;
  });
  const f0 = (await page.evaluate(() => (window as unknown as { __dvBridge: { world: WorldBridge } }).__dvBridge.world.chunks().frame)) as number;
  await page.waitForFunction((n) => (window as unknown as { __dvBridge: { world: WorldBridge } }).__dvBridge.world.chunks().frame >= n, f0 + 6, { timeout: 180_000, polling: 250 });
  const c = await page.evaluate(() => {
    const w = (window as unknown as { __dvBridge: { world: WorldBridge } }).__dvBridge.world;
    const k = w.chunks();
    return { l0: k.resident.l0.length, l1: k.resident.l1.length, l2: k.resident.l2.length, traffic: w.traffic()?.objects ?? null };
  });
  console.log(`ledger frame at plan: resident l0 ${c.l0}, l1 ${c.l1}, l2 ${c.l2}; traffic objects ${String(c.traffic)}; transit and pedestrians hidden`);
}
