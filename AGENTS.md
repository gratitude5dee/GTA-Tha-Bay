# Dee-Verse: Tha Bay — agent notes

This file is for any coding agent working in this repository (and for humans). It carries the same rules as `CLAUDE.md` without tool-specific syntax. Modders: see "For modders" at the end.

## What this is
An original, story-driven open-world game in an accurate San Francisco: a Three.js (WebGPU with automatic WebGL2 fallback) Progressive Web App on Cloudflare Workers, with a WebXR port (Meta Quest, Apple Vision Pro), AI NPCs, generated-and-cached cutscenes, three unlockable modes (racing, fighter, tycoon) and player mods.
Rollout: single-player first, Cloudflare only; Supabase (data spine) arrives at milestone M05d; multiplayer rooms from M12b. The rest of the Bay Area comes after v1.

## Where to start
1. `spec/00-plan.md` — status, milestone totals, owner defaults; the run order and dependencies are in `spec/07-milestones/_PLAN.md`.
2. The current milestone file `spec/07-milestones/<ID>-*.md`; its "Notes for the Builder" say what else to read. File status (READY, PENDING, frozen) is in `spec/07-milestones/README.md`.
3. `prompt-pack/06-SHARED-CONTEXT.md` — requirement ids (R-*), contracts C01–C17, conventions. `spec/02-architecture.md` — the system and package tree.
4. One milestone per working session. The spec is the source of truth; when it is silent, choose the smallest reversible option behind an interface and record it under "Builder decisions" in `spec/11-decision-log.md`.

## Commands
Run from the repository root (pnpm workspaces, Node 22 LTS).

| Command | Does |
|---|---|
| `pnpm install` | install the workspace (CI uses `--frozen-lockfile`) |
| `pnpm dev` | Vite dev server plus `wrangler dev`; QA flags on |
| `pnpm build` | UI tokens, Vite build of `apps/web`, Worker dry-run bundle |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm lint` | ESLint, including the determinism and no-GLSL rules |
| `pnpm check:unit [-- <paths>]` | Vitest unit tests |
| `pnpm check:e2e -- --project=<p> [--grep @tag]` | Playwright; projects `chromium-webgpu`, `chromium-webgl2`, `webkit-webgl2`, `xr-quest3` |
| `pnpm check:perf [-- --scenario <id>]` | CPU-side budgets on canned scenarios (from M01c) |
| `pnpm check:workers [-- <suite>]` | Workers-runtime tests for `services/*` (from M00a) |
| `pnpm check:assets` | config and asset schemas, size limits (from M00b) |
| `pnpm deploy:preview` | Workers Preview of the staging Worker for the current branch or PR |
| `pnpm deploy:prod [-- --env staging]` | versions upload, 0 % smoke, 100 %, rollback on failure (from M00a) |

Milestone-specific scripts are listed in each milestone's Deliverables. Arguments: `pnpm <script> -- <args>` works for every script; tools run through `tools/ci/run.ts <tool>`, which drops the one leading `--` that pnpm passes through, and in-house scripts parse argv with its `args()` helper. The M00 family adds `check:headers -- <url> | --serve <url> | --from <file>`, `check:coi` (same forms), `check:bundle`, `check:e2e:xr`, `deploy:bootstrap`, `check:secrets`, `check:prod-routes`, `check:do-migrations`, `check:smoke -- <url>`, `provenance:check`, `ip:signatures`, `ip:extensions`, `ip:strings`, `license:scan`, `names:lint`, `likeness:gate`, `genai:liveness`, `genai:spike`, `genai:price`. Later root scripts: `check:agents`, `check:telemetry` (M00d), `perf:verify`, `perf:checklist` (M01c), `assets:*` (M01d; `assets:gen` M05c3, M10a1), `map:fixture` (M01f), `map:build`, `map:fetch`, `map:pack` (M02a1) and the other `map:*` steps (M02a2–M02c2; `map:races` M07a1, `map:webtiles` M13b2), `check:i18n` (M04b1), `check:balance` (M04d; tycoon suite M09a2), `missions:build` (M05a1), `missions:preview`, `check:missions` (M05a2), `check:pipeline`, `check:c2pa` (M05b1), `check:db`, `check:db:types`, `db:push`, `check:api`, `test:staging` (M05d), `npc:*` (M06a2, M06a4, M10c), `check:fighter` (M08b1), `tycoon:*` (M09a2), `test:ops` (M10b), `auth:tpa` (M12a1), `rooms:drain` (M12c1), `load:rooms` (M12c2), `check:mods`, `check:skills` (M13a6), `ip:history`, `ip:similarity`, `genai:terms-watch` (M14b3); the `dv` CLI for mods (`tools/cli`, M13a1, M13c3). Package-local scripts run as `pnpm --filter @dv/<pkg> <script>` (`test:*` M01a1, `bench:physics` M01a2, `fighter:*` M08a1–M08c1); full registry: `spec/08-test-and-ci.md` §6. A `check:*` script whose milestone has not landed prints `pending: lands in <milestone>` and exits 0.

## Repository layout
- `apps/web` — PWA shell: Vite entry, service worker, `_headers`, page routes
- `packages/shared` (`@dv/shared`) — pure and deterministic: contract types C01–C17, detmath, RNG, hashing, canonical JSON, and the pure cores shared by client, Worker and CI (world codec, soul compiler, tycoon sim, fight frame data, vehicle and racing logic, asset gates)
- `packages/engine` (`@dv/engine`) — sim (ECS, loop, physics, control, modes host, saves), workers, client (input, camera, animation, audio), platform (renderer host, tiers, XR, pack store, telemetry)
- `packages/world` — chunk store, road graph, traffic, pedestrians, transit, minimap and full map
- `packages/net` — C11 binary codec, clock and interpolation, room client, cloud-sync port
- `packages/identity` — identity adapters (local, device, OpenAI, Thirdweb); client-only
- `packages/npc` — dialogue client, ink runner, TTS player, lip-sync, NPC brains
- `packages/ui` — Preact shell, kit, pages, HUD, i18n, XR panel surface
- `packages/mod-sdk` — typed mod API, schemas, templates for modders
- `packages/modes/story|racing|fighter|tycoon` — `@dv/mode-<id>` adapters on the C06 mode contract
- `services/edge` — `tha-bay-web` Worker: static assets, `/api/v1/*`, Durable Objects, crons
- `services/rooms` — `tha-bay-rooms` Worker: multiplayer room Durable Objects (M12b)
- `services/pipeline` — generative-AI steps and workflows, compiled into `tha-bay-web`
- `tools/map`, `tools/assets`, `tools/ci`, `tools/cli`, `tools/ops`, `tools/soul`, `tools/fighter` — SF bake, asset and genAI CLIs, CI checks, `dv` CLI and MCP server, operator scripts, soul CLIs, QA-only fighter editor
- `config/` — brand, tier budgets, endpoint registry, guardrails, input maps
- `content/` — authored original data · `content-private/` — private mount, never published
- `assets/` — asset lock file, provenance records, prefabs · `supabase/` — migrations and DB tests (M05d)
- `tests/` — cross-package e2e and ops suites · `docs/` — ADRs, legal snapshots · `spec/`, `research/`, `prompt-pack/` — the specification

## Conventions
- TypeScript strict, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Vanilla three; no React Three Fiber; Preact for DOM UI only.
- Determinism rules (contract C02) in sim code — `packages/shared/src/**`, `packages/engine/src/sim/**` except `sim/save/**`, `packages/modes/*/src/sim/**`; tests, scripts and fixtures excluded: no `Math.random`, no transcendental `Math.*` (use `detmath`), no `**`, no `Date`, `performance.now` or timers, no `crypto.getRandomValues`, no `for…in`, no `Intl`, no `three`, no DOM types. Randomness comes from seeded `xoshiro128**` streams. ESLint enforces this.
- `@dv/shared` imports no other package and does no IO. `services/*` import only `@dv/shared` and `@dv/net`. Packages never import apps.
- Persistent identity is a C01 `StableKey` (`player:`, `veh:`, `npc:`, `amb:<cell>:<slot>`, `mis:`, `pfb:`); the dense `EntityId` never leaves a session.
- Asset references are C07 `AssetRef` strings `'<kind>/<id>'`; stored objects use `<root>/<variant>.<sha256[0:12]>.<ext>`.
- Ids are UUIDv7 minted in the Worker. Times are epoch milliseconds (ISO-8601 `Z` only in repo-audited files such as provenance records). Game money is integer cents; generative-AI spend is integer USD micros. Content and cache hashes are lowercase SHA-256 hex.
- World coordinates are ENU metres from San Francisco City Hall (+X east, +Y up, −Z north).
- Browser storage names start with `dv-`. QA URL flags and `window.__dvBridge` exist only when `VITE_DV_QA=1` (dev, test, preview builds).
- The display name comes only from `config/brand.ts` (`DISPLAY_NAME`, default "Dee-Verse: Tha Bay"). The franchise name in the repository's codename never appears in code, file names, package names, UI strings or builds; CI (`ip:strings`, `names:lint`) fails otherwise.
- Original content only: no assets, code, data, names or plots from any other publisher's games. Never open, fetch or search the example repositories named in `research/repos-*.md`; work from the spec.
- Real people appear only through the name registry and likeness tiers (`consented`, `parody`, `fictionalized`); never hard-code a real name, alias or catchphrase.
- Contracts C01–C17 change only through the Architect: propose a change in your report; never edit a contract shape.
- One branch per milestone, `m<id>-<slug>` (for example `m00a-edge-api-skeleton`); conventional commits (`feat(edge): …`, `fix(ui): …`); one pull request per milestone.

## Verification rule
Before reporting work done, run a real check that exercises the change: tests, type-checker, build, or the changed command. A syntax-only check, or a command that failed to start, does not count. If dependencies are missing, install them with pnpm. If no real check can run, say which one and why instead of claiming completion. Run every acceptance criterion's proof command and quote its result.

## Facts and sources
Facts about external systems come only from `spec/03-decisions-and-facts.md`, `research/INDEX.md` (ledger F-001…) or the research file a spec section cites. Never invent an endpoint, model id, SDK call, limit or price. If a step depends on an item marked UNVERIFIED, stop, use the fallback the milestone names, and report it. Record newly verified facts in `spec/03` with URL and date. Library versions not in the ledger: use what pnpm resolves, record the version in `spec/03`, and keep it out of acceptance criteria.

## Secrets
Never commit values; names only.
- Deploy: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (GitHub repository secrets; shell environment locally).
- Optional early: `FAL_KEY` (M00c spike, non-production key), `DV_NAMES_REAL_JSON` (CI only, M00b), `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (M01d).
- Later, named by their milestones: `PLAY_TOKEN_HMAC`, `ANTHROPIC_API_KEY`, `SUPABASE_SECRET_KEY`, `ID_SIGNING_JWK_CURRENT`, `ID_SIGNING_JWK_NEXT`, `INTERNAL_HMAC`, `OPENAI_MODERATION_API_KEY`.
- Worker secrets travel with versions (`wrangler versions upload --secrets-file`) or `wrangler secret`; local development uses `services/edge/.dev.vars` (git-ignored). No key may reach a client bundle (`pnpm check:secrets -- apps/web/dist`).
- When a secret is absent: stub behind the environment variable, print `SKIP … <VAR> not set`, exit 0 locally, continue with the rest, and list it as blocked in the report.

## Known pitfalls
- **WebGPU and WebGL2:** one `WebGPURenderer` (`three@0.186.1`) falls back to WebGL2 by itself; `?gl=1` forces it in QA builds. `chromium-webgl2` is the guaranteed CI path. WebKit on Linux has neither `navigator.gpu` nor `navigator.xr`. Materials are TSL only; no GLSL.
- **iOS PWA:** no install prompt (use the coach mark), no fullscreen, orientation lock, vibration or Pointer Lock; storage may be evicted (`navigator.storage.persist()` after story start; OPFS is never assumed durable); the WebContent process dies near 2 GB; audio and video need a user gesture; plan for 60 Hz.
- **Cross-origin isolation (COOP/COEP/CORP):** `_headers` covers static assets only; every Worker response needs `withIsolationHeaders`; cross-origin media is fetched in CORS mode; no third-party iframe inside the app; `/account/*` is the only non-isolated path; check `crossOriginIsolated` again after a service-worker-served reload.
- **WebXR:** `immersive-vr` only; request a session only inside a user-gesture handler (emulated tests excepted); set `renderer.xr.enabled` before `init()`; `navigator.xr` is Window-only, so rendering stays on the main thread. In CI the IWER emulator must be installed before the renderer, with `forceInstall: true` on Chromium.
- **Durable Objects:** they hibernate only when no timers run; every deploy restarts the deployed script's objects and drops their sockets (rooms live in a separate Worker); class lifecycle changes ship alone through `wrangler deploy` (`check:do-migrations`, label `do-lifecycle`); never schedule an alarm per tick.
- **Workers Previews:** no queue consumers, cron triggers or own Workflows; service bindings call production; bindings are not inherited and must be repeated under `previews`.
- **fal.ai:** submit to the queue, verify ED25519-signed webhooks, keep a polling fallback (webhook retries stop after about 6 minutes for results of 10 KB or more); copy every output to R2 immediately because CDN copies expire; never call fal from a browser; new accounts get 2 concurrent requests; there is no spend cap.
- **Anthropic runtime models (Haiku 5.5, Sonnet 5.5):** no `temperature` or other sampling parameters, no assistant prefill; Haiku runs with thinking disabled and low effort; Sonnet disables thinking with `between_tools`; use `output_config.format` for structured output; calls go only through the Worker and AI Gateway.
- **Workers KV** is eventually consistent (60 s or more): never use it for an atomic switch.

## How to add
- A mission: author with the story builder in `packages/modes/story`, run `pnpm missions:build`, ship the C09 IR as `data/mission.<id>` (M05a1).
- An NPC: an original `soul.md` in `content/` (real-derived souls only in `content-private/`), the `npc:*` CLIs, then C07 assets with likeness records (M06a2, M10a).
- A vehicle: a C06 prefab in `assets/prefabs/` plus C07 assets with provenance (M03a1).
- A mode: `packages/modes/<id>` implementing the C06 `GameModeDescriptor`, registered with the unlock registry (M04a).
- A mod: see below.

## For modders
Mods are personal and sandboxed: data mods (JSON Schema), script mods (QuickJS in a worker) and UI mods (opaque-origin iframe), disabled in multiplayer, with closed permissions and provenance for every asset. The design, the mod API and the publishing flow are in `spec/domains/12-modding.md` (with `12-modding-contracts.md` and `12-modding-publish.md`). The modder kit (`@dv/mod-sdk`, the `dv` CLI, skills and a knowledge base) lands in milestone M13a; until then, read the spec and do not build against unreleased APIs. Published experiences pass moderation before they appear on the map.
