import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { runGpuProbe } from './helpers.ts';

test.describe('platform', () => {
  test('records the GPU probe @probe', async ({ page }, testInfo) => {
    await page.goto('/?probe=gpu');
    await page.waitForSelector('html[data-dv-probe="done"]', { state: 'attached', timeout: 60_000 });
    const probe = await runGpuProbe(page);

    mkdirSync('test-results', { recursive: true });
    writeFileSync(`test-results/gpu-probe.${testInfo.project.name}.json`, `${JSON.stringify(probe, null, 2)}\n`);
    console.log(`gpu-probe ${testInfo.project.name}: backend=${String(probe.backend)} adapter=${String(probe.adapter)} fallback=${String(probe.isFallbackAdapter)} arch=${String(probe.architecture)}`);

    // The recording is the criterion for chromium-webgpu; the fields must be present.
    expect(probe).toHaveProperty('adapter');
    expect(probe).toHaveProperty('isFallbackAdapter');
    expect(probe).toHaveProperty('features');
    expect(probe).toHaveProperty('limits');
    expect(probe.threeRevision).toBe('186');
    expect(probe.error).toBeNull();

    if (testInfo.project.name === 'chromium-webgpu') {
      expect(['webgpu', 'webgl2']).toContain(probe.backend);
      if (process.env.DV_EXPECT_WEBGPU === '1') expect(probe.backend).toBe('webgpu');
    } else {
      expect(probe.backend).toBe('webgl2');
    }
  });

  test('enters immersive-vr under IWER and renders XR frames @xr', async ({ page }) => {
    await page.goto('/?xr-emulate=quest3');
    await page.waitForFunction(() => window.__dvBridge?.platform !== undefined, undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__dvBridge?.platform?.xr.enterForTest());

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const s = window.__dvBridge?.platform?.xr.state();
            return s ? { isPresenting: s.isPresenting, enough: s.frames >= 10 } : null;
          }),
        { timeout: 30_000, intervals: [250] },
      )
      .toEqual({ isPresenting: true, enough: true });

    const state = await page.evaluate(() => window.__dvBridge?.platform?.xr.state());
    expect(state?.sessionMode).toBe('immersive-vr');
    expect(state?.error).toBeNull();
    expect(await page.evaluate(() => window.__dvBridge?.platform?.backend())).toBe('webgl2');
  });
});
