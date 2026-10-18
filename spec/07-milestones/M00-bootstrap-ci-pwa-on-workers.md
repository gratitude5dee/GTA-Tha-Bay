# M00 — bootstrap-ci-pwa-on-workers

## Goal
A pnpm monorepo with every canonical script; an installable PWA shell (`apps/web`, Vite 8.3.4 + vite-plugin-pwa 2.0.0 `injectManifest`) served by an assets-only Worker on Workers static assets, cross-origin isolated; the S10 shell skeleton; a QA-only GPU/XR probe; Playwright with the four projects; and GitHub Actions running lint, typecheck, unit tests and a `chromium-webgl2` smoke on every PR plus a Workers Preview per PR. No game code; this is the floor every later milestone deploys on.

## Requirements
- R-PLAT-01: the shell is a Workers-hosted installable PWA; iPhone-safe manifest (no `orientation`).
- R-PLAT-02: an IWER `immersive-vr` smoke runs in CI from day one.
- R-PLAT-03: `WebGPURenderer` probe proves the WebGPU path and the automatic WebGL2 fallback.
- R-ROLL-01: the first thing deployed is hosted on Cloudflare and tested there.
- R-ENG-01: deterministic root scripts, no GUI-only steps; `CLAUDE.md`/`AGENTS.md` commands all run.
- R-ENG-02: perf hook exists (`check:perf`), filled from M01c.
- R-IP-01: the display name comes only from `config/brand.ts` (default "Dee-Verse: Tha Bay").
- R-UI-03: boot, title, credits and legal pages exist as stubs.

## Depends on
None. Contracts: C13 1.1 (identifier types of `11-platform.md` §4.1 and `PwaUpdateController` of `11-platform-pwa.md` §4), C15 1.0.

## Scope in
- Root workspace (`apps/*`, `packages/*`, `packages/modes/*`, `services/*`, `tools/*`); `engines.node` 22; one strict root `tsconfig.json` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- All canonical scripts (see Deliverables).
- `config/brand.ts`: `BRAND = { codename: 'tha-bay', displayName: 'Dee-Verse: Tha Bay', shortName: 'Tha Bay', legalName, tagline, disclaimer }` (disclaimer text fixed by R-NAME-2 in `research/legal-ip-likeness.md` §1.3) plus `DISPLAY_NAME` and `SHORT_NAME` re-exports (specs use both forms).
- `apps/web`: Vite app, `index.html` (`viewport-fit=cover`), manifest generated from `config/brand.ts` and S10 tokens, icons from `@vite-pwa/assets-generator@2.0.0` committed under `public/icons/`, `public/_headers` exactly as `11-platform-pwa.md` §2, `src/sw.ts` (precache shell only; navigation route denies `/api/` and `/account/`; `maximumFileSizeToCacheInBytes: 6 * 1024 * 1024`), `src/pwa-update.ts` implementing `PwaUpdateController` (stub UI, safe points honoured).
- `packages/shared/src/platform/c13.ts`: the `11-platform.md` §4.1 block verbatim.
- `packages/engine/src/platform/`: `qa-flags.ts` (the single `QaFlags` parser; M00 handles `?gl=1`, `?tier=`, `?xr-emulate=quest3`, `?probe=gpu`, `?unsupported=1`; parses nothing unless `import.meta.env.VITE_DV_QA === '1'`) and `probe.ts` (QA-only `window.__dvBridge.platform` with `backend()`, `gpuProbe()`, `xr.enterForTest()`, `xr.state()`).
- `packages/ui` (Preact 11.0.1): `tokens.json` → `tokens.css` (also manifest colors); `BootScreen`; `Unsupported` (diagnostics string); `Title` stub (`t('title.name')` = `{brand}` from `BRAND.displayName`); `/menu/credits` and `/legal/<doc>` stubs (`terms`, `privacy`, `dmca`, `ncii`, `ugc`, `ai-disclosure`, `repeat-infringer`, `contact`; "Text pending counsel review"); `UpdateToast` on `PwaUpdateController`; `t()` + `en.json` without the display-name literal.
- `services/edge/wrangler.jsonc`, assets-only (no `main` yet): `name: tha-bay-web`, `compatibility_date: 2026-10-18`, `assets.directory: ../../apps/web/dist`, `not_found_handling: single-page-application`, `workers_dev: true` (no custom domain until Q-15), `env.staging` = `tha-bay-web-staging` with `preview_urls: true`, and an empty `previews: {}` block (required) [research/gap-ci-cd-release-assets.md §1.5].
- CI per research R3: actions pinned by SHA (§1.1), `ubuntu-24.04`, `permissions: contents: read` by default.
- Lint: C02 determinism bans (`01-engine-contracts.md` "Determinism rules" 1) on its sim paths (save/ excepted); `no-glsl-in-engine` (no `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile`, `glsl` templates under `packages/**`, P-03).

## Scope out
- `/api/v1/*`, the Worker script, isolation headers in code, geo-gate, telemetry ingest, gradual deploys, `check:secrets`, `check:prod-routes`, `check:do-migrations` → M00a.
- IP and provenance gates, `names:brand`, PR clean-room template → M00b.
- `RendererHost`, tier selection, `config/tier-budgets.json` and its validation, perf scenarios → M01c (11-platform.md §8 lists budget validation under M00; moved to keep this session inside its file budget).
- Age gate, menus, settings → M04b1. Fonts (system stack until M04b1). KV, R2, Supabase (M05d).

## Deliverables
Generated files (lockfile, icons, `tokens.css`) do not count toward the file budget.
- Root: `package.json`, `pnpm-workspace.yaml`, `.gitignore` (`node_modules`, `dist`, `.wrangler`, `.dev.vars`, `test-results`, `playwright-report`, `.spike`), `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `playwright.config.ts`.
- `.github/workflows/ci.yml`: job `static` (`pnpm lint`, `pnpm typecheck`), `unit` (`pnpm check:unit`, `pnpm check:workers`), `build` (`VITE_DV_QA=1 pnpm build`, `pnpm check:bundle`, upload `apps/web/dist` 3 days), `e2e` matrix over the four projects: `chromium-webgl2` required, the other three `continue-on-error: true` in M00 and promoted to required by the milestone that first depends on them; each uploads `test-results/gpu-probe.*.json`.
- `.github/workflows/preview.yml`: same-repo PRs only (`github.event.pull_request.head.repo.full_name == github.repository`); build with `VITE_DV_QA=1`; `pnpm deploy:preview`; `pnpm check:headers -- <url>`; `pnpm check:coi -- <url>`; `gh pr comment --edit-last --create-if-none` with the URL; on `closed`, `wrangler preview delete --env staging --name pr-<N> --skip-confirmation`.
- `config/brand.ts`, `config/ui/tokens.json`.
- `packages/shared/package.json` (`@dv/shared`, `exports` map), `src/platform/c13.ts`, `test/c13.test.ts`.
- `packages/engine/package.json` (`@dv/engine`), `src/platform/qa-flags.ts`, `src/platform/probe.ts`.
- `packages/ui/package.json` (`@dv/ui`), `scripts/build-tokens.ts`, `src/index.tsx`, `src/i18n.ts`, `src/i18n/en.json`, `test/i18n.test.ts`.
- `apps/web/package.json` (`@dv/web`), `vite.config.ts` (dev `server.headers` and `preview.headers` with the three isolation headers), `pwa-assets.config.ts`, `index.html`, `public/_headers`, `public/icon.svg` (authored original glyph), `src/main.ts`, `src/sw.ts`, `src/pwa-update.ts`.
- `services/edge/package.json` (`@dv/edge`), `services/edge/wrangler.jsonc`.
- `tests/e2e/shell.spec.ts` (tags `@smoke`, `@pwa`, `@coi`, `@ui-shell`), `tests/e2e/platform.spec.ts` (`@probe`, `@xr`).
- `tools/ci/check-headers.ts`, `tools/ci/check-coi.ts`, `tools/ci/check-bundle.ts`, `tools/ci/deploy.ts` (modes `preview`, `prod`, `bootstrap`), lint fixtures `tools/ci/fixtures/lint/sim/banned.ts` and `tools/ci/fixtures/lint/glsl.ts` (ignored by `pnpm lint`, linted with `--no-ignore` in a unit test).
- Root scripts: `dev` (Vite with `VITE_DV_QA=1`), `build` (tokens → `vite build` → icons check), `typecheck` (`tsc -p tsconfig.json --noEmit`), `lint` (`eslint .`), `check:unit [-- <paths>]` (`vitest run`), `check:e2e [-- --project=<p> --grep <tag>]` (`playwright test`), `check:e2e:xr` (= `check:e2e -- --project=xr-quest3`), `check:perf` and `check:assets` and `check:workers` (stubs: print `pending: lands in M01c` / `M00b` / `M00a` and exit 0), `check:headers -- <url>`, `check:coi -- <url>`, `check:bundle`, `icons` (regenerates `public/icons/`), `deploy:preview`, `deploy:prod` (plain `wrangler deploy` of `tha-bay-web` in M00; M00a replaces it), `deploy:bootstrap` (first `wrangler deploy --env staging` and `wrangler deploy`; idempotent).
- Pins: `typescript@6.0.3`, `vite@8.3.4`, `vite-plugin-pwa@2.0.0`, `@vite-pwa/assets-generator@2.0.0`, `workbox-*@7.4.1`, `wrangler@4.151.1`, `three@0.186.1`, `@playwright/test@1.64.1`, `iwer@2.6.0` (dev, QA-only dynamic import), `preact@11.0.1`. Unpinned in the ledger (UNVERIFIED; take the version `pnpm add` resolves, record it in `spec/03` §5): pnpm itself, `vitest`, `eslint`, `typescript-eslint` (must accept TS < 6.1, F-016), `tsx`.
- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (GitHub repo secrets; shell env locally). Absent → each `deploy:*` prints `SKIP deploy:<mode>: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not set`, exits 0.

## Interfaces
- C13 1.1: §4.1 identifiers copied verbatim; `PwaUpdateController` exactly as `11-platform-pwa.md` §4 (`updateAvailable`, `markSafePoint`, `markUnsafe`, `applyNow({force?})`, `onChange`).
- C15 1.0: this file's format.
- `window.__dvBridge.platform` subset per `11-platform-perf.md` §4 (QA builds only).
- No contract change.

## Acceptance criteria
- AC-1 Given a clean clone on Node 22 When `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:unit && pnpm build` runs Then every step exits 0 — proof: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:unit && pnpm build`
- AC-2 Given the root `package.json` When the not-yet-implemented canonical checks run Then each exists, exits 0 and names its landing milestone — proof: `pnpm check:perf && pnpm check:workers && pnpm check:assets`
- AC-3 Given the two lint fixtures When the lint unit test lints them with `--no-ignore` Then `Math.random`, `Date.now`, `import 'three'` in the sim fixture and `ShaderMaterial` in the GLSL fixture are each reported, while `pnpm lint` on the repo stays clean — proof: `pnpm check:unit -- tools/ci && pnpm lint`
- AC-4 Given a QA build served by `wrangler dev` on port 8788 When headers are checked Then `/`, `/sw.js`, `/manifest.webmanifest` and one hashed `/assets/*.js` carry COOP `same-origin`, COEP `require-corp`, CORP `same-origin`; the hashed JS has `Cache-Control: public, max-age=31556952, immutable`; `/account/` has no COEP — proof: `pnpm check:headers -- http://localhost:8788`
- AC-5 Given the same server When Chromium and WebKit load `/`, wait for the service worker to control the page, and reload Then `crossOriginIsolated === true` both times — proof: `pnpm check:coi -- http://localhost:8788`
- AC-6 Given the QA build When `@pwa` runs Then the manifest `name` equals `DISPLAY_NAME` ("Dee-Verse: Tha Bay"), `display` is `standalone`, a maskable icon exists, no `orientation` key exists, the SW is registered, and no precache entry exceeds 6 MiB — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @pwa`
- AC-7 Given `chromium-webgl2` (no GPU flags) When `/?probe=gpu` runs Then `test-results/gpu-probe.chromium-webgl2.json` has `backend: "webgl2"` and `threeRevision: "186"` — proof: `pnpm check:e2e -- --project=chromium-webgl2 --grep @probe`
- AC-8 Given `chromium-webgpu` (SwiftShader flags) When `/?probe=gpu` runs Then `test-results/gpu-probe.chromium-webgpu.json` exists with `adapter`, `isFallbackAdapter`, `features`, `limits` and `backend` recorded (the recorded value decides U-PLT-19; `webgpu` is asserted only when `DV_EXPECT_WEBGPU=1`) — proof: `pnpm check:e2e -- --project=chromium-webgpu --grep @probe`
- AC-9 Given `xr-quest3` with IWER installed before the renderer When `__dvBridge.platform.xr.enterForTest()` starts `immersive-vr` Then `xr.state()` reports `isPresenting: true` and ≥ 10 XR frames — proof: `pnpm check:e2e -- --project=xr-quest3`
- AC-10 Given `webkit-webgl2` When `@smoke` loads `/` Then the title shows "Dee-Verse: Tha Bay", `crossOriginIsolated` is true and the probe backend is `webgl2` — proof: `pnpm check:e2e -- --project=webkit-webgl2 --grep @smoke`
- AC-11 Given the shell When `/?unsupported=1`, `/menu/credits` and `/legal/terms` open Then the unsupported screen shows its diagnostics string, the stubs render, every `t()` key exists in `en.json` and no catalog contains the display-name literal — proof: `pnpm check:unit -- packages/ui && pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-shell`
- AC-12 Given a `PwaUpdateController` with a mocked registration reporting a waiting worker When `markUnsafe()` is set Then `applyNow()` rejects; after `markSafePoint('menu')` the toast shows and `applyNow()` resolves — proof: `pnpm check:unit -- apps/web`
- AC-13 Given no Cloudflare secrets When `deploy:preview` runs Then it prints the SKIP line naming both variables and exits 0 — proof: `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID pnpm deploy:preview`
- AC-14 Given the operator prerequisites (Workers Paid, token, account id) and a same-repo PR When `preview.yml` runs Then the PR gets a Preview URL comment and the job's `check:headers` and `check:coi` steps pass against that URL — proof: manual: desktop browser, open the PR on GitHub, read the bot comment and the `preview` job log; then run `pnpm check:headers -- <preview-url>` locally
- AC-15 Given `VARIANT_FALLBACK` When the unit test walks all six tiers Then every chain starts with its own tier, never goes upward on `FLAT_LADDER`, and ends at `mobile-low` — proof: `pnpm check:unit -- packages/shared`

## Test plan
- Unit (Vitest): `c13.test.ts`, `i18n.test.ts`, `pwa-update.test.ts`, the lint-fixture test. `pnpm check:unit`.
- E2E (Playwright 1.64.1, one config, projects `chromium-webgpu` with `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-vulkan=swiftshader`, `chromium-webgl2`, `webkit-webgl2`, `xr-quest3` with `grep: /@xr/`) [`11-platform-perf.md` §9]. `webServer`: `VITE_DV_QA=1 pnpm build && pnpm --filter @dv/edge exec wrangler dev --port 8788` (skip the build when `DV_SKIP_BUILD=1`, as CI does after downloading the artifact); `reuseExistingServer: !process.env.CI`. Assert on state, not pixels.
- Deployed: `check:headers`, `check:coi` against the Preview URL. Device: none (M01c).

## Demo script
1. `pnpm install && pnpm dev`; open the printed localhost URL in Chrome; boot screen, then the title "Dee-Verse: Tha Bay".
2. Console: `crossOriginIsolated` → `true`; open `/?probe=gpu`, `/menu/credits`, `/legal/dmca`.
3. `pnpm build && pnpm check:e2e -- --project=chromium-webgl2`; green.
4. Open a PR; open the Preview URL from the bot comment on an iPhone; add to Home Screen; it launches standalone with the brand name.

## Effort
1 session; ≈ 40 hand-written files; risk medium (Workers Previews beta, SwiftShader on hosted runners, IWER).

## Risks & fallbacks
- `wrangler preview` (open beta in 4.151.1) fails or its JSON changes (CI-R01): `deploy.ts preview` parses `--json` defensively and falls back to `wrangler versions upload --env staging --preview-alias pr-<N>` (a Version URL on the staging Worker, which holds no production data). Record which path ran.
- `wrangler dev` does not apply `_headers` locally (UNVERIFIED): switch the Playwright `webServer` to `vite preview` with `preview.headers`; keep `check:headers` against the deployed Preview as the real proof; log a Builder decision.
- SwiftShader WebGPU absent on the hosted runner (U-PLT-19): AC-8 still passes because it records; `chromium-webgl2` remains the required project.
- File budget overrun: drop `check:bundle` (fold into `check:headers`), then the `@ui-shell` e2e (keep the unit test). Icons are committed so M00b provenance records stay stable.

## Notes for the Builder
- Read first: `11-platform-pwa.md` §2–§4, `11-platform-perf.md` §4, §9, `10-ui.md` §2.4–§2.7, `research/gap-ci-cd-release-assets.md` §1, §4, R1–R4. Never open the example repositories named in `research/repos-*.md`.
- Order: workspace + scripts → brand + tokens → shell + SW → UI stubs → probe → Playwright → wrangler + `deploy.ts` → CI. Run AC-1 often.
- IWER: install it from the QA-only dynamic import when `?xr-emulate=quest3` is present, before constructing the renderer, with `forceInstall: true` on Chromium; on `xr-quest3` construct `WebGPURenderer` with `forceWebGL: true` and `renderer.xr.enabled = true` before `init()` [research/gap-ci-cd-release-assets.md §4.2; research/INDEX.md §1.8]. Under IWER no user gesture is needed; on real devices XR starts only from a click handler.
- Backend detection in `probe.ts`: how r186 exposes the active backend is not in the ledger; read `three@0.186.1` source in `node_modules` and note the property used.
- The string ban `\bgta\b` (M00b) will scan everything outside `spec/`, `research/`, `prompt-pack/`, `docs/research/`, `docs/legal/`: never put the franchise abbreviation in code, package names, file names or UI strings. Package names are `@dv/*`.
- Guard every QA path with `import.meta.env.VITE_DV_QA === '1'` so production builds drop IWER and the bridge. Branch `m00-bootstrap-ci-pwa-on-workers`.
