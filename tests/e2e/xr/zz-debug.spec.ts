import { expect, test, type Page } from '@playwright/test';
import { observe, SMALL_VIEWPORT, waitForEngine } from '../engine-helpers.ts';

const ui = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`window.__dvBridge.ui.${fn}`) as Promise<T>;
const VARIANTS = (process.env['DBG_VARIANTS'] ?? 'nopanel,openclose').split(',');
VARIANTS.forEach((variant, n) => {
  test(`dbg ${n} ${variant} @xr`, async ({ page }) => {
    test.setTimeout(400_000);
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?xr-emulate=quest3&debug=1');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 90_000 }).toBe(true);
    await page.waitForFunction(() => Boolean((window as any).__dvBridge?.ui), undefined, { timeout: 60_000 });
    if (variant.startsWith('reveal')) await page.waitForFunction(() => (window as any).__dvBridge.world.boot().revealed, undefined, { timeout: 180_000 });
    console.log(`REVEALED-BEFORE-XR ${variant} ${await page.evaluate(() => JSON.stringify((window as any).__dvBridge.world?.boot?.() ?? null))}`);
    const button = page.locator('[data-dv-xr-smoke]');
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();
    await expect.poll(async () => (await observe(page)).xr?.presenting, { timeout: 30_000 }).toBe(true);
    if (variant === 'openclose') {
      await ui(page, 'open()');
      await ui(page, 'close()');
      await page.waitForTimeout(6000);
    } else if (variant === 'openstay') {
      await ui(page, 'open()');
      await page.waitForTimeout(6000);
    } else if (variant === 'full') {
      await ui(page, 'open()');
      await page.waitForTimeout(2000);
      await ui(page, 'press()');
      await page.waitForTimeout(2000);
      await ui(page, 'bump()');
      await page.waitForTimeout(2000);
      await ui(page, 'close()');
    } else {
      await page.waitForTimeout(6000);
    }
    await page.evaluate(() => {
      const host = (window as any).__dvBridge.world.internals().view.host;
      const r = host.renderer;
      const gl = r.backend.gl as WebGL2RenderingContext;
      const log: any[] = ((window as any).__rlog = []);
      const orig = r.render.bind(r);
      let frames = 0;
      const origTick = host.tick;
      r.render = (scene: any, camera: any) => {
        if (r.xr.isPresenting || frames > 6) return orig(scene, camera);
        const t0 = performance.now();
        const before = { calls: r.info.render.drawCalls, tris: r.info.render.triangles };
        const out = orig(scene, camera);
        const t1 = performance.now();
        gl.finish();
        const t2 = performance.now();
        const tgt = r.getRenderTarget();
        log.push({ at: +performance.now().toFixed(0), f: frames, scene: scene.name || scene.type, kids: scene.children?.length, cam: camera.type, par: camera.parent?.name ?? camera.parent?.type ?? null, pos: [camera.position.x, camera.position.y, camera.position.z].map((v: number) => +v.toFixed(1)), wpos: [12, 13, 14].map((i) => +camera.matrixWorld.elements[i].toFixed(1)), fwd: [8, 9, 10].map((i) => +camera.matrixWorld.elements[i].toFixed(2)), near: camera.near, far: camera.far, proj5: camera.projectionMatrix?.elements?.[5], tgt: tgt ? [tgt.width, tgt.height] : null, buf: [gl.drawingBufferWidth, gl.drawingBufferHeight], calls: r.info.render.drawCalls - before.calls, tris: r.info.render.triangles - before.tris, cpu: +(t1 - t0).toFixed(1), gpu: +(t2 - t1).toFixed(1) });
        return out;
      };
      const loop = () => { if (!r.xr.isPresenting) { frames++; log.push({ raf: +performance.now().toFixed(0), frames }); } if (frames <= 40) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      void origTick;
    });
    console.log('CANVASES', await page.evaluate(() => JSON.stringify([...document.querySelectorAll('canvas')].map((c) => ({ cls: c.className, id: c.id, w: c.width, h: c.height, parent: c.parentElement?.className })))));
    await page.evaluate(() => { (window as any).__rlog.push({ endAt: +performance.now().toFixed(0) }); });
    console.log(`BEFORE-END ${variant} ${await page.evaluate(() => JSON.stringify((window as any).__dvBridge.world?.boot?.() ?? null))}`);
    await page.evaluate(() => (window as any).__dvBridge.engine.endXr());
    const t0 = Date.now();
    let hang = 0;
    for (let i = 0; i < 30; i++) {
      const r = await Promise.race([observe(page).then((o) => JSON.stringify(o.xr)), new Promise((res) => setTimeout(() => res('TIMEOUT'), 5000))]);
      if (r === 'TIMEOUT') { hang = Date.now() - t0; continue; }
      break;
    }
    console.log(`RESULT ${variant} hang ${hang} ms`);
    for (const e of await page.evaluate(() => (window as any).__rlog)) console.log('RLOG', JSON.stringify(e));
  });
});
