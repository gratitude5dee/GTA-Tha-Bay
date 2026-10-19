# Dee-Verse: Tha Bay — builder notes

## What this is
An original, story-driven open-world game in an accurate San Francisco: a Three.js (WebGPU, WebGL2 fallback) PWA on Cloudflare Workers, with a WebXR port, AI NPCs, generated-and-cached cutscenes and player mods.
Single-player first on Cloudflare only; Supabase arrives at M05d; multiplayer rooms from M12b.
You are the Builder: one milestone per session, exactly as its file says. The spec is the source of truth.

## Read first
@AGENTS.md
@spec/00-plan.md

Then the current milestone file `spec/07-milestones/<ID>-*.md` (the kickoff names `<ID>`), then only the spec sections its Interfaces and Notes list. File status (READY, PENDING, frozen) is in `spec/07-milestones/README.md`. Contracts C01–C17 and the R-IDs: `prompt-pack/06-SHARED-CONTEXT.md`.

## Commands (root, pnpm workspaces, Node 22)
- `pnpm install` · `pnpm dev` (Vite + `wrangler dev`, QA flags on) · `pnpm build`
- `pnpm typecheck` · `pnpm lint` · `pnpm check:unit [-- <paths>]`
- `pnpm check:e2e -- --project=<chromium-webgpu|chromium-webgl2|webkit-webgl2|xr-quest3> [--grep @tag]`
- `pnpm check:perf [-- --scenario <id>]` · `pnpm check:workers [-- <suite>]` · `pnpm check:assets`
- `pnpm deploy:preview` (Workers Preview of the staging Worker) · `pnpm deploy:prod [-- --env staging]`
- Arguments: `pnpm <script> -- <args>` works for every root script. Tools run through `tools/ci/run.ts <tool>`, which drops one leading `--` (pnpm passes it through); in-house scripts parse argv with its `args()` helper. Package-local scripts that take arguments follow the same rule: `test` and `test:*` are `tsx <rel>/tools/ci/run.ts vitest run --dir packages/<pkg>` (or spec paths from the repo root, where run.ts runs the tool), so `pnpm --filter @dv/<pkg> test -- <name>` runs only matching specs; a plain `vitest run` script ignores the filter.
- Milestone scripts are listed under each milestone's Deliverables. M00–M00c add: `check:headers -- <url> | --serve <url> | --from <file>`, `check:coi` (same forms), `check:bundle`, `check:e2e:xr`, `deploy:bootstrap`, `check:secrets`, `check:prod-routes`, `check:do-migrations`, `check:smoke -- <url>`, `provenance:check`, `ip:*`, `license:scan`, `names:lint`, `likeness:gate`, `genai:liveness`, `genai:spike`, `genai:price`. Later root scripts: `check:agents`, `check:telemetry` (M00d), `perf:verify`, `perf:checklist` (M01c), `assets:*` (M01d; `assets:gen` M05c3, M10a1), `map:fixture` (M01f), `map:build`, `map:fetch`, `map:pack` (M02a1) and the other `map:*` steps (M02a2–M02c2; `map:races` M07a1, `map:webtiles` M13b2), `check:i18n` (M04b1), `check:balance` (M04d; tycoon suite M09a2), `missions:build` (M05a1), `missions:preview`, `check:missions` (M05a2), `check:pipeline`, `check:c2pa` (M05b1), `check:db`, `check:db:types`, `db:push`, `check:api`, `test:staging` (M05d), `npc:*` (M06a2, M06a4, M10c), `check:fighter` (M08b1), `tycoon:*` (M09a2), `test:ops` (M10b), `auth:tpa` (M12a1), `rooms:drain` (M12c1), `load:rooms` (M12c2), `check:mods`, `check:skills` (M13a6), `ip:history`, `ip:similarity`, `genai:terms-watch` (M14b3); the `dv` CLI for mods (`tools/cli`, M13a1, M13c3). Package-local scripts run as `pnpm --filter @dv/<pkg> <script>` (`test:*` M01a1, `bench:physics` M01a2, `fighter:*` M08a1–M08c1); full registry: `spec/08-test-and-ci.md` §6.
- Not-yet-implemented `check:*` scripts print `pending: lands in <milestone>` and exit 0.
- Unit tests are `*.test.ts` or `*.spec.ts` (either suffix) beside the code in `<pkg>/test/`; root Vitest collects `**/*.{test,spec}.{ts,tsx}` except `tests/e2e/**`, `tests/perf/**` (Playwright) and `services/*/test/**` (`check:workers`) (DL-250).

## Repo layout
- `apps/web` — PWA shell: Vite entry, service worker, `_headers`, routes
- `packages/shared` (`@dv/shared`) — pure: contract types C01–C17, detmath, RNG, hashing, canonical JSON, pure cores (world codec, soul compiler, tycoon, fight, vehicle, racing, asset gates)
- `packages/engine` — sim (ECS, loop, physics, control, modes host, saves), workers, client (input, camera, anim, audio), platform (renderer host, tiers, XR, pack store, telemetry)
- `packages/world` — chunk store, road graph, traffic, peds, map views
- `packages/net` — C11 codec, clock, room client, cloud sync port
- `packages/identity` — local, device, OpenAI, Thirdweb identity adapters (client-only)
- `packages/npc` — dialogue client, ink runner, TTS, lip-sync, NPC brains
- `packages/ui` — Preact shell, kit, pages, HUD, i18n, XR panel surface
- `packages/mod-sdk` — typed mod API, schemas, templates for modders
- `packages/modes/{story,racing,fighter,tycoon}` — `@dv/mode-<id>` mode adapters
- `services/edge` — `tha-bay-web` Worker: static assets, `/api/v1/*`, DOs, crons
- `services/rooms` — `tha-bay-rooms` Worker: room DOs (M12b)
- `services/pipeline` — genAI steps and workflows, compiled into `tha-bay-web`
- `tools/{map,assets,ci,cli,ops,soul,fighter}` — bake, asset/genAI CLIs, CI checks, `dv` CLI, ops scripts, soul CLIs, QA-only fighter editor
- `config/` (brand, budgets, registries, guardrails) · `content/` · `assets/` (lock, provenance) · `supabase/` · `tests/` · `docs/` · `spec/` · `research/` · `prompt-pack/`

## Conventions
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Vanilla three, no React Three Fiber; Preact for DOM UI only.
- C02 determinism lint in sim code (`packages/shared/src/**`, `packages/engine/src/sim/**` except `sim/save/**`, `packages/world/src/sim/**`, `packages/modes/*/src/sim/**`; tests, scripts and fixtures excluded): no `Math.random`, no transcendental `Math.*` (use `detmath`), no `**`, no `Date`/`performance.now`/timers, no `crypto.getRandomValues`, no `for…in`, no `Intl`, no `three`, no DOM types. Seeded `xoshiro128**` streams only.
- `@dv/shared` imports nothing else and does no IO. `services/*` import only `@dv/shared` and `@dv/net`.
- Persistent identity is a C01 `StableKey` (`player:`, `veh:`, `npc:`, `amb:<cell>:<slot>`, `mis:`, `pfb:`); `EntityId` never leaves a session.
- Every cross-domain asset reference is a C07 `AssetRef` `'<kind>/<id>'`; object keys `<root>/<variant>.<sha256[0:12]>.<ext>`.
- Ids are UUIDv7 (minted in the Worker); times are epoch ms (ISO-8601 `Z` only in repo-audited files such as provenance records); game money is integer cents; genAI spend is integer USD micros; hashes are lowercase SHA-256 hex.
- World coordinates: ENU metres from SF City Hall (+X east, +Y up, −Z north).
- Browser storage names start with `dv-`. QA URL flags and `window.__dvBridge` exist only when `VITE_DV_QA=1`.
- The display name comes only from `config/brand.ts` (`DISPLAY_NAME`). The franchise name in the repo's codename never appears in code, file names, packages, UI strings or builds; `ip:strings` and `names:lint` enforce it.
- Original content only. Never open, fetch or search the example repositories named in `research/repos-*.md`.
- Contracts C01–C17 change only through the Architect: propose in your report, never edit a contract shape.
- Branch per milestone `m<id>-<slug>` (e.g. `m00a-edge-api-skeleton`); conventional commits (`feat(edge): …`); one PR per milestone.
- Small reversible choices the spec leaves open: record as a `BD-NNN` row under "Builder decisions" in `spec/11-decision-log-builder.md`.

## Verification rule
Before reporting anything done, run a real check that exercises the change: the tests, the type-checker, the build, or the changed command itself. A syntax-only check, or a command that failed to start, does not count. Missing dependencies: install them with pnpm. If no real check can run here, say which one and why instead of claiming done. Every acceptance criterion's proof command is run and quoted in the report.

## Facts and sources
External-system facts come only from `spec/03-decisions-and-facts.md` and `research/INDEX.md` (ledger F-001…), or the research file a spec section cites. Never invent an endpoint, model id, SDK call, limit or price. A step that depends on something marked UNVERIFIED: stop, use the fallback the milestone names, and report. New facts you verify go into `spec/03` with URL and date. Versions not in the ledger: take what pnpm resolves, record it in `spec/03`, keep it out of acceptance criteria.

## Secrets (names only; never commit values)
- Deploy: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (GitHub repo secrets; shell env locally).
- Optional now: `FAL_KEY` (M00c spike, previs key), `DV_NAMES_REAL_JSON` (CI only, M00b), `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (M01d).
- Later (named by their milestones): `PLAY_TOKEN_HMAC`, `ANTHROPIC_API_KEY`, `SUPABASE_SECRET_KEY`, `ID_SIGNING_JWK_CURRENT`/`_NEXT`, `INTERNAL_HMAC`, `OPENAI_MODERATION_API_KEY`.
- Worker secrets ride with versions (`wrangler versions upload --secrets-file`) or `wrangler secret`; local dev uses `services/edge/.dev.vars` (git-ignored). No key ever reaches a client bundle (`pnpm check:secrets -- apps/web/dist`).
- Secret absent: stub behind the env var, print `SKIP … <VAR> not set`, exit 0 locally, continue with everything else, list it under "Blocked on".

## Known gotchas
- **WebGPU → WebGL2:** one `WebGPURenderer` (`three@0.186.1`) falls back to WebGL2 by itself; `?gl=1` forces it. `chromium-webgl2` is the guaranteed CI path; WebKit on Linux has no `navigator.gpu` or `navigator.xr`. TSL materials only, no GLSL.
- **iOS PWA:** no install prompt (coach mark), no fullscreen, orientation lock, vibrate or Pointer Lock; storage can be evicted (`persist()` after story start, OPFS never assumed durable); WebContent dies near 2 GB; audio and video need a user gesture; cap at 60 Hz.
- **COOP/COEP:** `_headers` covers static assets only; every Worker response needs `withIsolationHeaders`; every cross-origin fetch is CORS with CORP; no third-party iframe inside the app; `/account/*` is the only non-isolated path; check `crossOriginIsolated` after a service-worker reload.
- **XR:** `immersive-vr` only; `navigator.xr.requestSession` only inside a user-gesture handler (IWER tests excepted); `renderer.xr.enabled` before `init()`; XR is Window-only, so rendering stays on the main thread. Install IWER before the renderer, `forceInstall: true` on Chromium.
- **Durable Objects:** they hibernate only without timers; every deploy restarts DOs and drops sockets; rooms live in their own Worker (restart scope per script is UNVERIFIED, U-BE-21; M12c1 AC-12 records it); DO class changes ship alone via `wrangler deploy` (`check:do-migrations`, label `do-lifecycle`); never `setAlarm` per tick.
- **Workers Previews:** no queue consumers, crons or own Workflows; service bindings call production; bindings are not inherited and must be repeated under `previews`.
- **fal.ai:** queue submit + ED25519-verified webhook + polling fallback (webhook retries stop ≈ 6 min for results ≥ 10 KB); copy every output to R2 at once (CDN copies expire); never call fal from the browser; new accounts get 2 concurrent requests; no spend cap.
- **Anthropic (Haiku/Sonnet 5.5):** no `temperature`/sampling parameters and no assistant prefill; Haiku runs with thinking disabled and effort low; Sonnet turns thinking off with `between_tools`; format control via `output_config.format`; calls go only through the Worker and AI Gateway.
- **KV** is eventually consistent (≥ 60 s): never use it for an atomic switch.

## How to add
- a mission → `packages/modes/story` authoring builder → `pnpm missions:build` → C09 IR in `data/mission.<id>` (M05a1)
- an NPC → original `soul.md` in `content/` (real-derived only in `content-private/`) → `npc:*` CLIs → C07 assets with likeness records (M06a2, M10a)
- a vehicle → C06 prefab in `assets/prefabs/` + C07 assets with provenance (M03a1)
- a mode → `packages/modes/<id>` implementing the C06 `GameModeDescriptor`, registered with the unlock registry (M04a)
- a mod → `spec/domains/12-modding.md`; the agent kit lands in M13a6
