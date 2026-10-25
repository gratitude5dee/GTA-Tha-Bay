import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { NO_ENV_FILE, scrubProcessEnv, WORKER_LOCAL_SECRETS } from './tools/ci/secret-env.ts';
import { enterTmpRoot, tmpRootEnv } from './tools/ci/tmp-root.ts';

// BD-FIX-TMP-01: the runner, its workers, the web server (QA build and wrangler dev) and every spec work inside one per-run temporary
// root (TMPDIR/TEMP/TMP). It is made here, at config load, because Playwright starts the web server before globalSetup; the runner
// process that made it removes it when it exits (after the web server has stopped), pass or fail. Workers load this config again,
// find DV_TEST_TMP_ROOT set and reuse the root; so does a run started by tools/ci/run.ts, which then removes it itself.
export const E2E_TMP_ROOT = enterTmpRoot('pw').root;

// SwiftShader WebGPU on a GPU-less runner [research/gap-ci-cd-release-assets.md section 4.1].
const SWIFTSHADER_WEBGPU = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=swiftshader',
  '--use-vulkan=swiftshader',
];

// Parallel Builders on one machine set DV_E2E_PORT so that each run serves its own build (a reused server would be someone else's).
// BD-FIX-SEC-02: the default is 8790, off the 8788 of `pnpm dev` and `pnpm dev:edge`, and a server already listening is never reused
// (webServer.reuseExistingServer below): a reused Worker is one this config did not start, so it may hold live secrets. The value is put
// back into the environment so that the workers and the specs that build their own origin (hud.spec.ts, npc-builder.spec.ts) agree.
export const E2E_DEFAULT_PORT = 8790;
const PORT = Number(process.env.DV_E2E_PORT ?? E2E_DEFAULT_PORT);
process.env.DV_E2E_PORT = String(PORT);

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
// BD-FIX-SEC-01: the list lives in tools/ci/secret-env.ts (one source of truth). Before that, at config load, every secret name of that
// module is removed from this runner's own environment, so the web server (Playwright merges process.env into webServer.env), the
// workers (forked with process.env) and every spec start without them; tools/ci/run.ts already did the same for `check:e2e`. With the
// operator's opt-in (DV_ALLOW_LIVE_SECRETS=1) the names stay, and the Worker's own names below are still passed on empty.
scrubProcessEnv({ label: 'playwright' });
export const E2E_UNSET_SECRETS = WORKER_LOCAL_SECRETS;
const unsetSecrets: Record<string, string> = Object.fromEntries(E2E_UNSET_SECRETS.filter((k) => process.env[k] !== undefined).map((k) => [k, '']));

// The QA play bypass (M04b1, DL-650): every spec loads straight into play unless it opts out with
// `test.use({ storageState: { cookies: [], origins: [] } })` (the gate specs under tests/e2e/ui and the title tests of shell.spec.ts).
export const QA_PLAY_STORAGE = {
  cookies: [],
  origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'dv-qa-play', value: 'sandbox' }] }],
};

// CI downloads the build artifact first and sets DV_SKIP_BUILD=1.
// --local: the Workers AI binding (M06a4) is remote-only; without it wrangler would need CLOUDFLARE_API_TOKEN to start. env.AI then fails on use and the Worker degrades to text.
// --env-file NO_ENV_FILE (BD-FIX-SEC-02): wrangler reads neither services/edge/.dev.vars nor any .env file, which may hold live secrets
// (as on the CI runner, where none exists); the process environment it still reads is scrubbed above.
const START_WORKER = `pnpm --filter @dv/edge exec wrangler dev --local --port ${PORT} --env-file ${NO_ENV_FILE}`;
const command = process.env.DV_SKIP_BUILD === '1' ? START_WORKER : `VITE_DV_QA=1 pnpm build && ${START_WORKER}`;

// Tests tagged @quarantine (flaky on 3 of the last 10 main runs, 13-qa section 5) never gate; the nightly full run sets DV_E2E_QUARANTINE=1.
const QUARANTINE = process.env.DV_E2E_QUARANTINE === '1' ? null : /@quarantine/;
const skip = (base: RegExp | null): RegExp | RegExp[] => (base && QUARANTINE ? new RegExp(`${base.source}|${QUARANTINE.source}`) : (base ?? QUARANTINE ?? []));

export default defineConfig({
  testDir: 'tests/e2e',
  // Keep test-results/ itself (gpu-probe.*.json, preview-url.txt) out of Playwright's per-run cleanup.
  outputDir: 'test-results/pw',
  // Fails the run before any test when the per-run temporary root is not in effect (BD-FIX-TMP-01).
  globalSetup: './tests/support/tmp-root.setup.ts',
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
    // Never reuse (BD-FIX-SEC-02): a server already on the port fails the run instead ("is already used"); stop it or set DV_E2E_PORT.
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...unsetSecrets, ...tmpRootEnv(E2E_TMP_ROOT), WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_PATH: E2E_CF_PATH },
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
