import { expect, test } from '@playwright/test';
import { BRAND, DISPLAY_NAME } from '../../config/brand.ts';
import { runGpuProbe } from './helpers.ts';

const SIX_MIB = 6 * 1024 * 1024;

// The tests that look at the Title, the credits and the legal pages opt out of the QA play bypass (M04b1, DL-650): the rest of this
// file, and every other engine spec, loads straight into play through the config-level storage state.
const GATES = { cookies: [], origins: [] } as { cookies: []; origins: [] };

test.describe('shell', () => {
  // The title now sits over the live gray-box world, which the software renderer draws while these checks run (M01b2).
  test.setTimeout(90_000);

  // The service worker is these tests' subject: they run the real one that production runs. Every other spec blocks it
  // (playwright.config.ts, BD-FIX-CI7-D01).
  test.describe('service worker', () => {
    test.use({ serviceWorkers: 'allow' });

    test('registers sw.js on its own; the worker activates and controls the page after a reload @pwa', async ({ page }) => {
      // BD-FIX-CI7-D05: from M04b1 until BD-FIX-CI6-C01 the page never registered its worker (the `load` listener came after a top-level
      // await) and no spec noticed. The e2e build is a production `vite build` (import.meta.env.PROD, the registration path production
      // takes) with the QA flags on; nothing here registers or activates the worker for the page.
      await page.goto('/?world=walk-drop');
      const registration = (): Promise<{ count: number; script: string | null; state: string | null; scope: string | null }> =>
        page.evaluate(async () => {
          const regs = await navigator.serviceWorker.getRegistrations();
          const active = regs[0]?.active ?? null;
          return { count: regs.length, script: active?.scriptURL ?? null, state: active?.state ?? null, scope: regs[0]?.scope ?? null };
        });
      await expect.poll(registration, { timeout: 60_000, message: 'sw.js registered and activated' }).toMatchObject({ count: 1, state: 'activated' });
      const reg = await registration();
      expect(reg.script).toMatch(/\/sw\.js$/);
      expect(new URL(reg.scope as string).pathname).toBe('/');

      await page.reload();
      const after = await page.evaluate(() => ({
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        state: navigator.serviceWorker.controller?.state ?? null,
      }));
      expect(after.controller).toMatch(/\/sw\.js$/);
      expect(after.state).toBe('activated');
    });

    test('keeps crossOriginIsolated after a service-worker reload @coi', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await page.reload();
      const state = await page.evaluate(() => ({
        isolated: self.crossOriginIsolated,
        controlled: navigator.serviceWorker.controller !== null,
      }));
      expect(state).toEqual({ isolated: true, controlled: true });
    });

    test('is an installable PWA @pwa', async ({ page, request, browserName }) => {
      test.skip(browserName !== 'chromium', 'manifest and precache checks run on Chromium');
      // BD-FIX-CI2-03: the manifest, the service worker and the precache do not depend on the world, so the page boots the small
      // `walk-drop` scene (QA builds take `?world=` on a DV_WORLD build too) instead of the software-rendered synth city, which kept
      // the main thread busy past the 90 s timeout. The manifest's own start_url is still checked to be '/'.
      await page.goto('/?world=walk-drop');
      await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);

      const manifest = (await (await request.get('/manifest.webmanifest')).json()) as Record<string, unknown> & {
        icons: Array<{ purpose?: string; sizes: string }>;
      };
      expect(manifest['name']).toBe(DISPLAY_NAME);
      expect(manifest['short_name']).toBe(BRAND.shortName);
      expect(manifest['display']).toBe('standalone');
      expect(manifest['start_url']).toBe('/');
      expect('orientation' in manifest).toBe(false);
      expect('display_override' in manifest).toBe(false);
      expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);

      const registered = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return reg.active?.scriptURL ?? null;
      });
      expect(registered).toMatch(/\/sw\.js$/);

      const precache = await page.evaluate(async () => {
        const names = (await caches.keys()).filter((n) => n.includes('precache'));
        const sizes: Array<{ url: string; bytes: number }> = [];
        for (const name of names) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) {
            const res = await cache.match(req);
            sizes.push({ url: req.url, bytes: res ? (await res.clone().arrayBuffer()).byteLength : 0 });
          }
        }
        return sizes;
      });
      expect(precache.length).toBeGreaterThan(0);
      expect(precache.some((e) => e.url.endsWith('/index.html') || e.url.includes('index.html'))).toBe(true);
      for (const entry of precache) expect(entry.bytes, entry.url).toBeLessThanOrEqual(SIX_MIB);
      // QA pages and their chunks are never precached, not even in this QA build (BD-FIX-CI7-D04).
      expect(precache.filter((e) => /\/qa\/|\/media-local\//.test(new URL(e.url).pathname)).map((e) => e.url)).toEqual([]);
    });
  });


  test.describe('gates', () => {
    test.use({ storageState: GATES });

    test('boots to the title screen @smoke', async ({ page }, testInfo) => {
      await page.goto('/');
      await expect(page.getByTestId('title-name')).toHaveText(DISPLAY_NAME);
      await expect(page).toHaveTitle(DISPLAY_NAME);
      expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);

      // M00a: a same-origin fetch of the Worker API works under COEP and the response is isolated.
      const health = await page.evaluate(async () => {
        const res = await fetch('/api/v1/health');
        return { status: res.status, coep: res.headers.get('cross-origin-embedder-policy'), body: (await res.json()) as { ok: boolean } };
      });
      expect(health.status).toBe(200);
      expect(health.coep).toBe('require-corp');
      expect(health.body.ok).toBe(true);

      const probe = await runGpuProbe(page);
      expect(probe.error).toBeNull();
      if (testInfo.project.name === 'chromium-webgpu') {
        expect(['webgpu', 'webgl2']).toContain(probe.backend);
      } else {
        expect(probe.backend).toBe('webgl2');
      }
    });

    test('shows the unsupported screen, credits and legal stubs @ui-shell', async ({ page }) => {
      await page.goto('/?unsupported=1');
      await expect(page.getByTestId('unsupported')).toBeVisible();
      await expect(page.getByTestId('diagnostics')).toContainText('dv-diag/1');

      await page.goto('/menu/credits');
      await expect(page.getByTestId('credits')).toBeVisible();
      await expect(page.getByTestId('disclaimer')).toHaveText(BRAND.disclaimer);

      await page.goto('/legal/terms');
      await expect(page.getByTestId('legal')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of Service');
      await expect(page.getByTestId('legal')).toContainText('Text pending counsel review');

      // Client-side navigation from the title screen.
      await page.goto('/');
      await page.getByRole('link', { name: 'Credits' }).click();
      await expect(page).toHaveURL(/\/menu\/credits$/);
      await expect(page.getByTestId('credits')).toBeVisible();
      await page.goBack();
      await expect(page.getByTestId('title')).toBeVisible();
    });
  });
});
