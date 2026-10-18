import { expect, test } from '@playwright/test';
import { BRAND, DISPLAY_NAME } from '../../config/brand.ts';
import { runGpuProbe } from './helpers.ts';

const SIX_MIB = 6 * 1024 * 1024;

test.describe('shell', () => {
  test('boots to the title screen @smoke', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByTestId('title-name')).toHaveText(DISPLAY_NAME);
    await expect(page).toHaveTitle(DISPLAY_NAME);
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);

    const probe = await runGpuProbe(page);
    expect(probe.error).toBeNull();
    if (testInfo.project.name === 'chromium-webgpu') {
      expect(['webgpu', 'webgl2']).toContain(probe.backend);
    } else {
      expect(probe.backend).toBe('webgl2');
    }
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
    await page.goto('/');
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
