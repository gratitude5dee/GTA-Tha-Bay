import type { Page } from '@playwright/test';
import type { GpuProbeResult } from '../../packages/engine/src/platform/probe.ts';

/** Waits for the QA bridge (installed after a dynamic import in QA builds) and runs the GPU probe. */
export async function runGpuProbe(page: Page): Promise<GpuProbeResult> {
  await page.waitForFunction(() => window.__dvBridge?.platform !== undefined, undefined, { timeout: 30_000 });
  return page.evaluate(() => {
    const platform = window.__dvBridge?.platform;
    if (!platform) throw new Error('missing __dvBridge.platform');
    return platform.gpuProbe();
  });
}
