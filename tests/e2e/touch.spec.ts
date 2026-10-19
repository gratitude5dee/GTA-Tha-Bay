import { expect, test, type Page } from '@playwright/test';
import { observe, waitForEngine } from './engine-helpers.ts';

// An iPhone landscape viewport with touch. The synthetic events are dispatched on the touch layer; the binder reads them like
// the real ones (Pointer Events with pointerType 'touch', or TouchEvents when the engine does not set pointerType).
test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

type Kind = 'down' | 'move' | 'up';

/** Dispatches one touch contact event on the element at the given selector (or the layer). */
async function touch(page: Page, kind: Kind, id: number, x: number, y: number, selector = '.dv-touch'): Promise<void> {
  await page.evaluate(
    ({ kind, id, x, y, selector }) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) throw new Error(`no element ${selector}`);
      const type = kind === 'down' ? 'pointerdown' : kind === 'move' ? 'pointermove' : 'pointerup';
      const ev = new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true,
      });
      el.dispatchEvent(ev);
      // WebKit may drop pointerType from a synthetic PointerEvent (M01b2 risk); the binder then needs TouchEvents.
      (window as unknown as { __dvPointerTypeOk?: boolean }).__dvPointerTypeOk = ev.pointerType === 'touch';
    },
    { kind, id, x, y, selector },
  );
}

/** TouchEvent fallback dispatch, used when the PointerEvent test above reports no pointerType. */
async function touchEvent(page: Page, kind: Kind, id: number, x: number, y: number, selector = '.dv-touch'): Promise<void> {
  await page.evaluate(
    ({ kind, id, x, y, selector }) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) throw new Error(`no element ${selector}`);
      const type = kind === 'down' ? 'touchstart' : kind === 'move' ? 'touchmove' : 'touchend';
      const t = new Touch({ identifier: id, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent(type, { touches: kind === 'up' ? [] : [t], targetTouches: kind === 'up' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
    },
    { kind, id, x, y, selector },
  );
}

test.describe('touch controls @touch', () => {
  test('the stick walks, Jump jumps, Camera toggles first person; the layer blocks gestures and every button is 44 px @touch', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?touch=1');
    await waitForEngine(page);
    await expect.poll(async () => (await observe(page)).world?.chunks, { timeout: 90_000 }).toBe(4);
    await expect.poll(async () => (await observe(page)).player?.grounded, { timeout: 60_000 }).toBe(true);

    // Tap Start on the title; the touch layer appears.
    await page.getByTestId('title-start').tap();
    await expect(page.locator('.dv-touch')).toBeVisible();
    expect((await observe(page)).play).toBe(true);

    // Does this engine give synthetic PointerEvents their pointerType? If not, use TouchEvents for the rest.
    await touch(page, 'down', 90, 5, 5, '.dv-touch-stick-hint');
    const pointerOk = await page.evaluate(() => (window as unknown as { __dvPointerTypeOk?: boolean }).__dvPointerTypeOk === true);
    await touch(page, 'up', 90, 5, 5, '.dv-touch-stick-hint');
    console.log(`${testInfo.project.name}: synthetic PointerEvent keeps pointerType = ${String(pointerOk)}`);
    const tap = pointerOk ? touch : touchEvent;

    // Layout: touch-action none and every button at least 44 x 44 CSS px, inside the viewport.
    const layer = await page.evaluate(() => {
      const el = document.querySelector('.dv-touch') as HTMLElement;
      const cs = getComputedStyle(el);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const buttons = [...el.querySelectorAll('button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { id: b.dataset['dvBtn'] ?? '', w: r.width, h: r.height, inside: r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh };
      });
      return { touchAction: cs.touchAction, userSelect: cs.userSelect || cs.getPropertyValue('-webkit-user-select'), buttons };
    });
    expect(layer.touchAction).toBe('none');
    expect(layer.buttons.map((b) => b.id).sort()).toEqual(['camera', 'jump', 'pause']);
    for (const b of layer.buttons) {
      expect(b.w, `${b.id} width`).toBeGreaterThanOrEqual(44);
      expect(b.h, `${b.id} height`).toBeGreaterThanOrEqual(44);
      expect(b.inside, `${b.id} inside the viewport`).toBe(true);
    }

    // Drag the stick up for 3 s: the player moves at least 5 m.
    const start = (await observe(page)).player!;
    await tap(page, 'down', 1, 160, 300);
    await tap(page, 'move', 1, 160, 240);
    await page.waitForTimeout(3000);
    const mid = (await observe(page)).player!;
    await page.screenshot({ path: testInfo.outputPath('touch-walk.png') });
    const walked = Math.hypot(mid.pos[0] - start.pos[0], mid.pos[2] - start.pos[2]);
    console.log(`${testInfo.project.name}: stick walked ${walked.toFixed(1)} m in 3 s`);
    expect(walked).toBeGreaterThanOrEqual(5);

    // Tap Jump while the stick is held: control state 110 shows up.
    const seen = page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const states = new Set<number>();
          const engine = (window as unknown as { __dvBridge: { engine: { observe(): { player: { control: number } | null } } } }).__dvBridge.engine;
          const t0 = performance.now();
          const poll = (): void => {
            const p = engine.observe().player;
            if (p) states.add(p.control);
            if (performance.now() - t0 < 2000) setTimeout(poll, 16);
            else resolve([...states]);
          };
          poll();
        }),
    );
    await tap(page, 'down', 2, 780, 340, '[data-dv-btn="jump"]');
    await page.waitForTimeout(60);
    await tap(page, 'up', 2, 780, 340, '[data-dv-btn="jump"]');
    expect(await seen).toContain(110);

    // Tap Camera: first person.
    expect((await observe(page)).camera?.mode).toBe('tp');
    await tap(page, 'down', 3, 720, 262, '[data-dv-btn="camera"]');
    await page.waitForTimeout(40);
    await tap(page, 'up', 3, 720, 262, '[data-dv-btn="camera"]');
    await expect.poll(async () => (await observe(page)).camera?.mode, { timeout: 10_000 }).toBe('fp');

    // Releasing the stick stops the player.
    await tap(page, 'up', 1, 160, 240);
    await page.waitForTimeout(600);
    const stopped = (await observe(page)).player!;
    await page.waitForTimeout(500);
    const still = (await observe(page)).player!;
    expect(Math.hypot(still.pos[0] - stopped.pos[0], still.pos[2] - stopped.pos[2])).toBeLessThan(0.3);
    expect(errors).toEqual([]);
  });
});
