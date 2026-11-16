import type { Page } from '@playwright/test';
import { decodePng, type Rgba } from '../support/image-diff.ts';

/**
 * The engine canvas as the look goldens, the flicker pairs and the look captures read it: a page screenshot clipped to the canvas's
 * bounding rect (BD-FIX-CI-CLIPSHOT-01).
 *
 * `locator('#dv-engine-canvas').screenshot()` first waits for the element to be visible and stable (the same bounding box on two
 * consecutive animation frames), and every animation frame of a `desktop` world on software GL costs 5 to 9 s. A page screenshot clipped
 * to the canvas takes the same pixels without those frames (the bytes identical; locally about 30 s against about 70 s per `desktop`
 * capture). The QA play canvas is `position: fixed; inset: 0; 100vw x 100vh`, so the clip is the viewport; the canvas's bounding rect,
 * its visibility and the page scroll are read in the page while the screenshot is taken (the read waits for the same main thread as the
 * capture, so it costs no extra frame), and a rect that is not exactly the clip, a hidden canvas or a scrolled page fail loudly instead of
 * returning some other part of the page.
 */
export async function canvasPng(page: Page): Promise<Buffer> {
  const vp = page.viewportSize();
  if (!vp) throw new Error('canvasPng: the page has no fixed viewport, so the canvas clip is unknown');
  const clip = { x: 0, y: 0, width: vp.width, height: vp.height };
  const [rect, png] = await Promise.all([
    page.evaluate(() => {
      const c = document.getElementById('dv-engine-canvas');
      if (!c) return null;
      const b = c.getBoundingClientRect();
      const s = getComputedStyle(c);
      return { x: b.x, y: b.y, width: b.width, height: b.height, visibility: s.visibility, display: s.display, scrollX: window.scrollX, scrollY: window.scrollY };
    }),
    page.screenshot({ clip }),
  ]);
  const ok =
    rect !== null && rect.x === clip.x && rect.y === clip.y && rect.width === clip.width && rect.height === clip.height &&
    rect.scrollX === 0 && rect.scrollY === 0 && rect.visibility === 'visible' && rect.display !== 'none';
  if (!ok) throw new Error(`canvasPng: the engine canvas is not the whole visible viewport (canvas ${JSON.stringify(rect)}, clip ${JSON.stringify(clip)}); the clipped screenshot would not be the canvas`);
  return png;
}

/** `canvasPng` decoded. */
export const canvasRgba = async (page: Page): Promise<Rgba> => decodePng(await canvasPng(page));
