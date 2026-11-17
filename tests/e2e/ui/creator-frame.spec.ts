import { expect, test, type Page } from '@playwright/test';
import { canvasRgba } from '../canvas-capture.ts';
import { HOME, hideQaPanels, NO_BYPASS, passGates, waitForEngineReady } from './helpers.ts';

/**
 * The creator preview stands beside the options panel, not behind it (10-ui-pages.md 2.8, BD-FIX-CREATOR-FRAME-01) @creator-frame:
 *
 *  - the stage's own report (`__dvCreatorStage.frame`, and `__dvCreatorFigure`: the drawn figure's vertices projected through the stage
 *    camera) puts the turntable axis and the figure's middle on the centre line of the free area (the preview section beside the panel,
 *    above the zoom buttons), and the figure's box inside that area, at Full body and at Head, for the mannequin and for an assembled
 *    figure of part models;
 *  - the canvas itself agrees: with the page hidden, the columns from the free area's edge to the right (the panel's side, where the
 *    figure's right half used to be drawn) hold only the stage's background, and every figure pixel is inside the reported box;
 *  - the frame follows the window: a smaller window, a portrait tablet window (the panel beside a column a third as wide as the head
 *    picture at its full size: the head picture shrinks to the column, BD-FIX-CREATOR-FRAME-06), a one-column portrait window (no
 *    free area: the centred picture, as before), a scrolled page, and the Edit appearance page (`/menu/creator`), which uses the
 *    same editor.
 *
 * The turntable is still (reduced motion) and turned to the front by dragging the preview, so the figure's box is symmetric about the
 * axis and its middle can be compared to the pixel.
 */
test.use({ storageState: NO_BYPASS, locale: 'en-US', reducedMotion: 'reduce' });
test.describe.configure({ timeout: 420_000 });

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface Frame {
  canvas: { width: number; height: number };
  shifted: boolean;
  scale: number;
  centre: { x: number; y: number };
  subject: Box;
  free: { x: number; y: number; width: number; height: number } | null;
}
interface Stage {
  shown: boolean;
  yaw: number;
  zoom: 'full' | 'head';
  autoRotate: boolean;
  figure: 'models' | 'mannequin';
  pending: boolean;
  parts: { slot: string; ref: string; path: string }[];
  frame: Frame | null;
}
interface Figure {
  canvas: { width: number; height: number };
  figure: Box | null;
  floor: { x: number; y: number };
  /** The highest row the floor disc is drawn on; past the canvas's bottom edge where the picture does not show the floor. */
  floorTop: number;
}
/** The page's own layout, viewport CSS pixels. */
interface Layout {
  viewport: { width: number; height: number };
  section: Box;
  panel: Box;
  zoom: Box;
  summary: Box;
}

type Qa = { __dvCreatorStage?: Stage | null; __dvCreatorFigure?: Figure | null };
const stage = (page: Page): Promise<Stage | null> => page.evaluate(() => (window as unknown as Qa).__dvCreatorStage ?? null);
const figure = (page: Page): Promise<Figure | null> => page.evaluate(() => (window as unknown as Qa).__dvCreatorFigure ?? null);
const layout = (page: Page): Promise<Layout> =>
  page.evaluate(() => {
    const box = (sel: string): Box => {
      const b = (document.querySelector(sel) as Element).getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    };
    return {
      viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      section: box('.dv-creator-stage'),
      panel: box('.dv-creator-panel'),
      zoom: box('.dv-creator-zoom'),
      summary: box('[data-testid="creator-summary"]'),
    };
  });

/** The free area the page should have reported: the section beside the panel, down to the zoom buttons, cut to the canvas. */
function freeOf(l: Layout): Box {
  return { left: Math.max(0, l.section.left), top: Math.max(0, l.section.top), right: Math.min(l.viewport.width, l.section.right), bottom: Math.min(l.viewport.height, l.zoom.top, l.section.bottom) };
}

/** Waits until the stage's frame is the one of the page's current layout, and returns both. */
async function framed(page: Page, zoom: 'full' | 'head', want?: (s: Stage) => boolean): Promise<{ s: Stage; l: Layout; free: Box }> {
  let out: { s: Stage; l: Layout; free: Box } | null = null;
  await expect
    .poll(async () => {
      const [s, l] = await Promise.all([stage(page), layout(page)]);
      if (!s?.shown || s.pending || !s.frame?.free || !s.frame.shifted || s.zoom !== zoom || s.autoRotate) return 'the stage is not framed yet';
      if (want && !want(s)) return 'the stage does not draw the pick yet';
      const free = freeOf(l);
      const f = s.frame.free;
      const off = Math.max(Math.abs(f.x - free.left), Math.abs(f.y - free.top), Math.abs(f.x + f.width - free.right), Math.abs(f.y + f.height - free.bottom));
      if (s.frame.canvas.width !== l.viewport.width || s.frame.canvas.height !== l.viewport.height || off > 0.5) return `the frame is of another layout (${JSON.stringify(f)} against ${JSON.stringify(free)})`;
      out = { s, l, free };
      return 'framed';
    }, { timeout: 120_000, message: 'the stage frames the figure in the free area of the current layout' })
    .toBe('framed');
  return out as unknown as { s: Stage; l: Layout; free: Box };
}

/**
 * Turns the still turntable to the front (yaw 0) by dragging the preview: one pixel of drag is 0.01 rad. The drag is a real mouse drag
 * across the middle of the free area, at head height, where the figure now stands under the pointer. Playwright's WebKit reports
 * `movementX` 0 for its mouse moves, so a drag that turned nothing is repeated as the same `pointermove` with the movement spelled out.
 */
async function faceFront(page: Page): Promise<void> {
  const turn = (yaw: number): number => Math.atan2(Math.sin(yaw), Math.cos(yaw));
  const yawNow = async (): Promise<number> => turn((await stage(page))?.yaw ?? 9);
  let how = 'mouse drag';
  for (let i = 0; i < 8; i++) {
    const yaw = await yawNow();
    if (Math.abs(yaw) < 0.006) break;
    const free = freeOf(await layout(page));
    const dx = Math.max(-120, Math.min(120, Math.round(-yaw / 0.01)));
    const x0 = (free.left + free.right) / 2 - dx / 2;
    const y0 = free.top + (free.bottom - free.top) * 0.3;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + dx, y0, { steps: Math.abs(dx) });
    await page.mouse.up();
    if ((await yawNow()) === yaw) {
      how = 'pointermove with movementX';
      await page.getByTestId('creator-preview').evaluate((el, movementX) => el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, movementX })), dx);
    }
  }
  expect(Math.abs(await yawNow()), 'dragging the preview turns the figure to the front').toBeLessThan(0.006);
  test.info().annotations.push({ type: 'creator-frame turn', description: how });
}

/** The stage's report at one zoom preset: axis, middle and box of the figure against the free area and the panel. */
async function expectFramed(page: Page, zoom: 'full' | 'head', opts: { symmetric: boolean; want?: (s: Stage) => boolean }): Promise<{ free: Box; box: Box; l: Layout; frame: Frame; floorTop: number }> {
  const { s, l, free } = await framed(page, zoom, opts.want);
  const m = (await figure(page)) as Figure;
  const frame = s.frame as Frame;
  const centre = (free.left + free.right) / 2;
  const why = `${zoom} ${s.figure}`;
  expect(m.figure, why).not.toBeNull();
  const box = m.figure as Box;
  // the turntable axis (the floor disc's centre) and the picture's centre are on the centre line of the free area
  expect(Math.abs(m.floor.x - centre), `${why}: floor disc centre ${m.floor.x} against ${centre}`).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.centre.x - centre), why).toBeLessThanOrEqual(0.5);
  expect(Math.abs(frame.centre.y - (free.top + free.bottom) / 2), why).toBeLessThanOrEqual(0.5);
  // the figure's own middle, where its box is symmetric (the mannequin from the front)
  if (opts.symmetric) expect(Math.abs((box.left + box.right) / 2 - centre), `${why}: figure middle ${(box.left + box.right) / 2} against ${centre}`).toBeLessThanOrEqual(2);
  // the figure's box is inside the free area and does not cross the panel's left edge
  expect(box.left, why).toBeGreaterThanOrEqual(free.left);
  expect(box.right, why).toBeLessThanOrEqual(free.right);
  expect(box.right, why).toBeLessThan(l.panel.left);
  expect(box.top, why).toBeGreaterThanOrEqual(free.top);
  // it is a figure, not a speck: at least a fifth of the free width at either preset
  expect(box.right - box.left, why).toBeGreaterThan(40);
  // The preset's picture (the canvas-high view of the centred stage, moved and scaled) ends where the zoom buttons begin, and the
  // "Look data" line is under the buttons. At Full body that clears both of the figure: the drawn figure's box is checked below. At
  // Head it does not: the torso runs on under the picture to the canvas's bottom edge, behind the buttons and the line
  // (BD-FIX-CREATOR-FRAME-02), so only the picture's own box is checked here.
  expect(frame.subject.bottom, why).toBeLessThanOrEqual(Math.min(l.zoom.top, l.viewport.height) + 0.5);
  expect(l.summary.top, why).toBeGreaterThanOrEqual(l.zoom.bottom);
  if (zoom === 'full') {
    // the drawn figure, head to feet, is inside the free area: above the buttons and the "Look data" line
    expect(box.bottom, why).toBeLessThanOrEqual(free.bottom);
    expect(box.bottom - box.top, why).toBeGreaterThan((free.bottom - free.top) * 0.5);
  }
  test.info().annotations.push({
    type: 'creator-frame report',
    description: `${why}: viewport ${l.viewport.width} x ${l.viewport.height}, panel from x = ${l.panel.left}, free area ${JSON.stringify(free)}, scale ${frame.scale.toFixed(3)}, floor disc centre x = ${m.floor.x.toFixed(2)}, figure box ${JSON.stringify(box)}`,
  });
  return { free, box, l, frame, floorTop: m.floorTop };
}

/**
 * The canvas, with the page hidden: figure pixels (anything that is not the stage's flat background) in the rows where only the figure
 * can be: above the floor disc. At Full body that is the upper three quarters of the figure; at Head every row down to `floorTop`,
 * the disc's far edge as the stage reports it, which is under the canvas unless the head picture is drawn small (a portrait tablet).
 */
async function expectPixels(page: Page, zoom: 'full' | 'head', free: Box, box: Box, floorTop = Infinity): Promise<void> {
  const hide = await page.addStyleTag({ content: 'body > *:not(#dv-engine) { visibility: hidden !important }' });
  try {
    let last = '';
    // The drawing buffer can be coarser than the page (a phone tier draws at a lower resolution and the browser scales it up), so an
    // edge is smeared over the neighbouring buffer pixels: the reported box is allowed that much, plus two pixels for antialiasing.
    const coarse = await page.evaluate(() => {
      const c = document.getElementById('dv-engine-canvas') as HTMLCanvasElement;
      return c.clientWidth / c.width;
    });
    const pad = 2 + Math.ceil(Math.max(1, coarse) * 2);
    await expect
      .poll(async () => {
        const img = await canvasRgba(page);
        const at = (x: number, y: number): [number, number, number] => {
          const i = (y * img.width + x) * 4;
          return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
        };
        const bg = at(2, 2);
        const y0 = Math.max(0, Math.ceil(box.top));
        const y1 = zoom === 'full' ? Math.floor(box.top + (box.bottom - box.top) * 0.75) : Math.min(img.height, Math.floor(floorTop) - pad);
        const edge = Math.ceil(free.right);
        let inFree = 0;
        let panelSide = 0;
        let outside = 0;
        let stray = '';
        // The outermost ring of the capture is left out: WebKit's screenshot of a touch viewport has an off-colour pixel at (0, 0),
        // there with the canvas hidden too (measured: 47,55,70 on a page background of 11,20,38), so it is not the stage's.
        for (let y = 1; y < Math.min(y1, img.height - 1); y++) {
          const rows = y >= y0;
          if (!rows && zoom === 'full') continue;
          for (let x = 1; x < img.width - 1; x++) {
            const p = at(x, y);
            if (Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2])) < 4) continue;
            if (x >= edge) panelSide++;
            else inFree++;
            if (x < box.left - pad || x > box.right + pad || y < box.top - pad) {
              if (outside === 0) stray = ` (the first at ${x},${y}: ${p.join(',')})`;
              outside++;
            }
          }
        }
        const area = Math.round((Math.min(box.right, edge) - box.left) * (Math.min(y1, box.bottom) - y0));
        last = `${zoom}: ${inFree} figure pixels in the free area (of ${area} in the box), ${panelSide} on the panel's side of x = ${edge}, ${outside} outside the reported box${stray} ${JSON.stringify(box)}; rows ${y0} to ${y1}, canvas ${img.width} x ${img.height} drawn at 1 : ${coarse.toFixed(2)} (box allowance ${pad} px), background ${bg.join(',')}`;
        const ok = img.width === Math.round(page.viewportSize()?.width ?? 0) && panelSide === 0 && outside === 0 && inFree > area * 0.2;
        return ok ? 'the figure is in the free area only' : last;
      }, { timeout: 60_000, message: 'the canvas shows the figure in the free area and nowhere else' })
      .toBe('the figure is in the free area only');
    test.info().annotations.push({ type: 'creator-frame pixels', description: last });
  } finally {
    await hide.evaluate((el) => (el as Element).remove());
  }
}

async function openCreator(page: Page): Promise<void> {
  await hideQaPanels(page);
  await page.goto(HOME);
  await passGates(page);
  await waitForEngineReady(page);
  await page.getByTestId('nav-new').click();
  await page.getByTestId('new-name').fill('Coast Test');
  await page.getByTestId('new-continue').click();
  await expect(page.getByTestId('creator')).toBeVisible({ timeout: 60_000 });
}

const part = (s: Stage, slot: string): string | undefined => s.parts.find((p) => p.slot === slot)?.ref;

/**
 * Presses a zoom button and returns to the top of the page. On a phone in landscape the page is taller than the window and the buttons
 * are under the fold, so the press scrolls the page; the canvas is read at scroll 0 (`canvasPng`), and the frame follows the scroll.
 */
async function zoomTo(page: Page, zoom: 'full' | 'head'): Promise<void> {
  await page.getByTestId(`btn-zoom-${zoom}`).click();
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Both presets, for the Coast mannequin (New Game's default) and then for an assembled figure of part models. */
async function bothFigures(page: Page): Promise<void> {
  await framed(page, 'full');
  await faceFront(page);
  for (const zoom of ['full', 'head'] as const) {
    await zoomTo(page, zoom);
    const { free, box, floorTop } = await expectFramed(page, zoom, { symmetric: true });
    expect((await stage(page))?.figure).toBe('mannequin');
    await expectPixels(page, zoom, free, box, floorTop);
  }
  // a realistic body and face: the figure is assembled from the part models, at the widest build
  await zoomTo(page, 'full');
  await page.getByTestId('creator-card-body-broad').click();
  await page.getByTestId('slider-creator-build').fill('100');
  await expect(page.getByTestId('val-creator-build')).toHaveText('100%');
  await page.getByTestId('tab-creator-face').click();
  await page.getByTestId('creator-card-face-karl').click();
  const models = (s: Stage): boolean => s.figure === 'models' && part(s, 'body') === 'character/pc-body-broad' && part(s, 'face') === 'character/pc-face-karl';
  for (const zoom of ['full', 'head'] as const) {
    await zoomTo(page, zoom);
    const { free, box, floorTop } = await expectFramed(page, zoom, { symmetric: false, want: models });
    await expectPixels(page, zoom, free, box, floorTop);
  }
  await zoomTo(page, 'full');
}

test.describe('creator frame @creator-frame', () => {
  test.describe('desktop', () => {
    test.use({ viewport: { width: 1600, height: 900 } });

    test('the figure stands in the area left of the panel at Full body and at Head, and follows the window @creator-frame', async ({ page }) => {
      await openCreator(page);
      await bothFigures(page);

      // A smaller window: the panel and the buttons move, the frame follows.
      await page.setViewportSize({ width: 1024, height: 600 });
      const small = await expectFramed(page, 'full', { symmetric: false });
      expect(small.l.viewport).toEqual({ width: 1024, height: 600 });
      await expectPixels(page, 'full', small.free, small.box);

      // A portrait tablet: the panel is still beside the preview, which is a column of 327 px. The head picture at its full size needs
      // 1.01 canvas heights of width; it was drawn at that size on the canvas centre, the head half behind the panel
      // (BD-FIX-CREATOR-FRAME-06). It is drawn as wide as the column instead, and the widest figure on stage is inside it.
      await page.setViewportSize({ width: 768, height: 1024 });
      const tablet = { full: 0, head: 0 };
      for (const zoom of ['full', 'head'] as const) {
        await zoomTo(page, zoom);
        const at = await expectFramed(page, zoom, { symmetric: false });
        expect(at.l.viewport).toEqual({ width: 768, height: 1024 });
        expect(at.l.panel.left, 'the panel is beside the preview').toBeGreaterThan(at.l.section.right);
        expect(at.box.right, `${zoom}: the figure against the panel's left edge`).toBeLessThan(at.l.panel.left);
        // drawn canvas pixels per metre of figure: the picture's height over the height the preset's camera sees at the axis
        tablet[zoom] = (at.frame.scale * 1024) / (2 * (zoom === 'full' ? 3.9 : 1.15) * Math.tan((16 * Math.PI) / 180));
        if (zoom === 'head') {
          // the column's width is what limits the head picture: its box is the column, and the picture is far smaller than the canvas
          expect(at.frame.subject.left).toBeCloseTo(at.free.left, 1);
          expect(at.frame.subject.right).toBeCloseTo(at.free.right, 1);
          expect(at.frame.scale).toBeLessThan(0.35);
          // so small a head picture shows the far edge of the floor disc above the canvas's bottom edge
          expect(at.floorTop).toBeLessThan(1024);
        }
        await expectPixels(page, zoom, at.free, at.box, at.floorTop);
      }
      // Head is still the closer view of the two
      expect(tablet.head).toBeGreaterThan(tablet.full * 1.1);
      await zoomTo(page, 'full');

      // A narrow portrait window: one column, the panel covers the whole width, so there is no free area and the picture is centred.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(async () => {
          const s = await stage(page);
          return s?.frame ? { shifted: s.frame.shifted, canvas: s.frame.canvas, x: s.frame.centre.x } : null;
        }, { timeout: 60_000 })
        .toEqual({ shifted: false, canvas: { width: 390, height: 844 }, x: 195 });
      expect(Math.abs(((await figure(page)) as Figure).floor.x - 195)).toBeLessThanOrEqual(1);

      // Back to the desktop window: beside the panel again.
      await page.setViewportSize({ width: 1600, height: 900 });
      await expectFramed(page, 'full', { symmetric: false });

      // Edit appearance (`/menu/creator`) is the same editor on the same stage: Back to the name step, then the page by its route.
      await page.getByTestId('btn-creator-back').click();
      await expect(page.getByTestId('creator')).toHaveCount(0);
      await expect.poll(async () => (await stage(page))?.shown).toBe(false);
      await page.evaluate(() => {
        history.pushState(null, '', '/menu/creator');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(page.getByTestId('creator')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('tab-creator-body')).toBeVisible();
      const edit = await expectFramed(page, 'full', { symmetric: false });
      await expectPixels(page, 'full', edit.free, edit.box);
    });
  });

  test.describe('phone landscape', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });

    test('the figure stands in the area left of the panel at Full body and at Head, also when the page is scrolled to the zoom buttons @creator-frame', async ({ page }) => {
      await openCreator(page);
      await bothFigures(page);

      // The page is taller than a phone in landscape. Scrolled to its end, the zoom buttons are on screen, over the fixed canvas: the
      // free area ends at their top and the figure with it.
      const scrolled = await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return window.scrollY;
      });
      expect(scrolled, 'the creator page is taller than the phone window').toBeGreaterThan(0);
      const end = await expectFramed(page, 'full', { symmetric: false });
      expect(end.l.zoom.top).toBeLessThan(end.l.viewport.height);
      expect(end.box.bottom).toBeLessThanOrEqual(end.l.zoom.top);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectFramed(page, 'full', { symmetric: false });
    });
  });
});
