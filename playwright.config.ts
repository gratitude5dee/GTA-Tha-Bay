import { defineConfig } from '@playwright/test';

// SwiftShader WebGPU on a GPU-less runner [research/gap-ci-cd-release-assets.md section 4.1].
const SWIFTSHADER_WEBGPU = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=swiftshader',
  '--use-vulkan=swiftshader',
];

// Parallel Builders on one machine set DV_E2E_PORT so that each run serves its own build (a reused server would be someone else's).
const PORT = Number(process.env.DV_E2E_PORT ?? 8788);

// CI downloads the build artifact first and sets DV_SKIP_BUILD=1.
const START_WORKER = `pnpm --filter @dv/edge exec wrangler dev --port ${PORT}`;
const command = process.env.DV_SKIP_BUILD === '1' ? START_WORKER : `VITE_DV_QA=1 pnpm build && ${START_WORKER}`;

// Tests tagged @quarantine (flaky on 3 of the last 10 main runs, 13-qa section 5) never gate; the nightly full run sets DV_E2E_QUARANTINE=1.
const QUARANTINE = process.env.DV_E2E_QUARANTINE === '1' ? null : /@quarantine/;
const skip = (base: RegExp | null): RegExp | RegExp[] => (base && QUARANTINE ? new RegExp(`${base.source}|${QUARANTINE.source}`) : (base ?? QUARANTINE ?? []));

export default defineConfig({
  testDir: 'tests/e2e',
  // Keep test-results/ itself (gpu-probe.*.json, preview-url.txt) out of Playwright's per-run cleanup.
  outputDir: 'test-results/pw',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
  projects: [
    {
      name: 'chromium-webgpu',
      grepInvert: skip(/@xr/),
      use: { browserName: 'chromium', launchOptions: { args: SWIFTSHADER_WEBGPU } },
    },
    { name: 'chromium-webgl2', grepInvert: skip(/@xr/), use: { browserName: 'chromium' } },
    { name: 'webkit-webgl2', grepInvert: skip(/@xr/), use: { browserName: 'webkit' } },
    { name: 'xr-quest3', grep: /@xr/, grepInvert: skip(null), use: { browserName: 'chromium' } },
  ],
});
