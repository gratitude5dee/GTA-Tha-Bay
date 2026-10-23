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

// BD-FIX-CI8-H02: the local Worker of the e2e runs with no secret, as on the CI runner. Wrangler loads the names listed in
// `secrets.required` of services/edge/wrangler.jsonc from the process environment by itself
// (https://developers.cloudflare.com/workers/configuration/secrets/, spec/03 section 6), so a shell that holds one, such as an agent
// container with SUPABASE_SECRET_KEY, handed it to `wrangler dev`: the Worker then had a live database (SUPABASE_URL is a var), every
// roster poll (route 30, every 30 s) failed against it with no KV copy and answered 503, and every spec that collects console errors
// (hud.spec.ts:19) saw "Failed to load resource: ... 503". A name the shell holds is passed on empty (every route treats an empty secret
// as absent); a name it does not hold stays unset, so CI, where none is set, sees exactly what it saw before.
// Keep equal to `secrets.required` of the top-level config (tools/ci/test/workflows.test.ts checks it).
export const E2E_UNSET_SECRETS = ['SUPABASE_SECRET_KEY', 'PLAY_TOKEN_HMAC', 'QUOTA_NET_SALT_SECRET', 'ANTHROPIC_API_KEY'] as const;
const unsetSecrets: Record<string, string> = Object.fromEntries(E2E_UNSET_SECRETS.filter((k) => process.env[k] !== undefined).map((k) => [k, '']));

// The QA play bypass (M04b1, DL-650): every spec loads straight into play unless it opts out with
// `test.use({ storageState: { cookies: [], origins: [] } })` (the gate specs under tests/e2e/ui and the title tests of shell.spec.ts).
export const QA_PLAY_STORAGE = {
  cookies: [],
  origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'dv-qa-play', value: 'sandbox' }] }],
};

// CI downloads the build artifact first and sets DV_SKIP_BUILD=1.
// --local: the Workers AI binding (M06a4) is remote-only; without it wrangler would need CLOUDFLARE_API_TOKEN to start. env.AI then fails on use and the Worker degrades to text.
const START_WORKER = `pnpm --filter @dv/edge exec wrangler dev --local --port ${PORT}`;
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
    storageState: QA_PLAY_STORAGE,
    // BD-FIX-CI7-D01: no service worker unless a spec asks for one. Playwright's route() does not intercept a request that the
    // service worker handles, and the docs recommend 'block' wherever a test intercepts requests (https://playwright.dev/docs/api/class-page#page-route,
    // https://playwright.dev/docs/service-workers, spec/03 section 6). Once sw.js registered in every build (BD-FIX-CI6-C01), it
    // claimed each page mid-test, and WebKit stopped routing the mocks of @npc-dialogue and @cutscene. Each test context is fresh,
    // so 'allow' would also have every test install the whole precache (119 entries, 8.4 MB in a QA build) beside its software-rendered world.
    // The specs whose subject is the service worker (tests/e2e/shell.spec.ts: @coi, @pwa) set `serviceWorkers: 'allow'`.
    serviceWorkers: 'block',
  },
  webServer: {
    command,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...unsetSecrets, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_PATH: E2E_CF_PATH },
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
