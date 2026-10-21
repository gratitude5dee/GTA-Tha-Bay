import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// The country the local Worker sees (BD-FIX-CI-02). wrangler dev (miniflare) fills `request.cf` from https://workers.cloudflare.com/cf.json,
// that is from the machine's egress location, so a runner outside the US would hit the US-only geo gate (451 region_blocked) on
// gated routes. Miniflare reads `request.cf` from the file named by CLOUDFLARE_CF_FETCH_PATH instead while the file is under
// 30 days old, so it is written fresh on every load. DV_E2E_COUNTRY (two letters, default US) runs the suite as another country.
export const E2E_COUNTRY = (process.env.DV_E2E_COUNTRY ?? 'US').toUpperCase();
if (!/^[A-Z]{2}$/.test(E2E_COUNTRY)) throw new Error(`DV_E2E_COUNTRY must be a two-letter country code, got ${E2E_COUNTRY}`);
export const E2E_CF_PATH = fileURLToPath(new URL(`./test-results/e2e-cf.${E2E_COUNTRY}.json`, import.meta.url));
mkdirSync(dirname(E2E_CF_PATH), { recursive: true });
writeFileSync(E2E_CF_PATH, `${JSON.stringify({ country: E2E_COUNTRY, colo: 'LOCAL', httpProtocol: 'HTTP/1.1', clientTcpRtt: 0 })}\n`);

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
    env: { WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_PATH: E2E_CF_PATH },
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
