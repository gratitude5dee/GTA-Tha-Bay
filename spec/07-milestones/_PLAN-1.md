# Milestone plan — part 1: fast-track, foundations, story spine (blocks A–C)

> S13 · 2026-10-18 · rows for `_PLAN.md` (order, graph, checkpoints). Field legend: **Goal** (≤ 2 lines) · **R** R-IDs · **Dep** direct dependencies · **Read** domain spec sections · **Out** top-level deliverable paths · **C** contracts @version · **Gate** secrets, paid accounts, owner questions, licence ADRs · **Proof** 2–4 key AC proofs · risk L/M/H. Sessions per row; "S##" names the owning domain(s). Paths of spec files are relative to `spec/domains/` unless they start with `spec/`.

## Block A — fast-track (READY files; ids, slugs and order fixed; run order per `spec/07-milestones/README.md`)

### M00 · bootstrap-ci-pwa-on-workers — 1 · risk M · S11, S13, S10
- **Goal:** pnpm monorepo with every canonical script, installable cross-origin-isolated PWA shell on an assets-only Worker, UI shell stubs, GPU/XR probe, Playwright projects, CI and per-PR Preview.
- **R** R-PLAT-01/02/03, R-ROLL-01, R-ENG-01/02, R-IP-01, R-UI-03 · **Dep** — · **Read** file `M00-bootstrap-ci-pwa-on-workers.md` (its Notes list the sections)
- **Out** root config, `apps/web`, `packages/{shared,engine,ui}`, `services/edge/wrangler.jsonc`, `tools/ci`, `tests/e2e`, `.github/workflows/{ci,preview}.yml` · **C** C13 1.1, C15 1.0
- **Gate** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, Workers Paid (operator) · **Proof** `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:unit && pnpm build`; `pnpm check:coi -- http://localhost:8788`; `pnpm check:e2e -- --project=xr-quest3`; manual Preview comment

### M00a · edge-api-skeleton — 0.8 · risk M · S09
- **Goal:** the Worker script: `/api/v1/*` with isolation headers in code, `ApiError`, geo-gate, routes 1–3, gradual-capable `deploy:prod`, `deploy.yml`.
- **R** R-PLAT-01, R-ROLL-01, R-ENG-01 · **Dep** M00 · **Read** file `M00a-edge-api-skeleton.md` · **Out** `services/edge/src`, `tools/ci/deploy.ts`, `.github/workflows/deploy.yml` · **C** C12 1.1, C16 1.1
- **Gate** same secrets; repo variable `DEPLOY_ALLOWED_ACTORS` · **Proof** `pnpm check:workers -- geo-gate`; `pnpm check:prod-routes`; `pnpm deploy:prod -- --env staging --dry-run`

### M00b · ip-provenance-gates — 1 · risk M · S05
- **Goal:** CI refuses unprovenanced files, foreign game formats and strings, copyleft in the bundle, real names and likeness violations; vendor-terms snapshots; `nightly.yml`.
- **R** R-IP-01/02, R-NPC-04, R-ENG-01 · **Dep** M00 · **Read** file `M00b-ip-provenance-gates.md` · **Out** `tools/ci/{provenance-check,ip-scan,names-lint,likeness-gate}.ts`, `config/*.json`, `docs/legal/vendor-terms/` · **C** C07 1.1, C13 1.1
- **Gate** `DV_NAMES_REAL_JSON` (CI only, optional) · **Proof** `pnpm provenance:check`; `pnpm ip:signatures`; `pnpm names:lint`; `pnpm genai:liveness`

### M00c · genai-spike — 1 · risk M · S05
- **Goal:** budget-capped CLI spike (≤ $4 since DL-OWN-07: the code cap stays $10 and the operator runs it with `DV_SPIKE_CAP_MICROS=4000000`, DL-740) through sheet → mesh → rig and three cutscene shots; records the U-items it can.
- **R** R-NPC-02, R-CUT-01, R-ENG-03 · **Dep** M00b, M00a · **Read** file `M00c-genai-spike.md` · **Out** `tools/assets/spike/`, `research/genai-spike-results.md` · **C** C07 1.1
- **Gate** `FAL_KEY` (previs, operator, Q-17), ≥ $4 prepaid · **Proof** `pnpm genai:spike -- --plan`; `env -u FAL_KEY pnpm genai:spike -- --run`; `pnpm genai:spike -- --verify`

### M01a1 · loop-ecs-detmath-physics — 1 · risk M · S01
- **Goal:** pure deterministic core in Node: C01–C03 files, detmath, RNG streams, hashing, canonical JSON, ECS, `SimCore`, headless host, lint bans.
- **R** R-PLAT-03, R-ENG-01 · **Dep** M00 · **Read** file `M01a1-…md` · **Out** `packages/shared/src/{contracts,detmath,rng,hash,json}`, `packages/engine/src/sim` · **C** C01 1.0, C02 1.1, C03 1.1
- **Gate** none · **Proof** `pnpm check:unit` (detmath golden bits, RNG streams, FNV/SHA vectors); ESLint banned fixtures; `ecs-churn` twice equal

### M01a2 · loop-ecs-detmath-physics — 1 · risk H · S01
- **Goal:** the core runs in `sim.worker` with Rapier (both builds), SAB or `postMessage` transport, determinism page equal in Chromium and WebKit.
- **R** R-PLAT-03 · **Dep** M01a1, M00 · **Read** file `M01a2-…md` · **Out** `packages/engine/src/{workers,physics}`, `apps/web/src/qa/` · **C** C01, C02 1.1, C03 1.1
- **Gate** none · **Proof** `pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism`; `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`

### M01b1 · controller-cameras-touch — 1 · risk M · S01
- **Goal:** desktop on-foot controller (kbm, pad), third/first-person camera without clipping, input router.
- **R** R-PLAT-04, R-ENG-04 · **Dep** M01a2 · **Read** file `M01b1-…md` · **Out** `packages/engine/src/{client/input,client/camera,sim/control}` · **C** C03 1.1, C04 1.1 (created)
- **Gate** none · **Proof** `pnpm --filter @dv/engine test -- input`; `walk-drop` 10,000-tick golden; camera 100-pose sweep

### M01b2 · controller-cameras-touch — 1 · risk M · S01 (runs after M01f)
- **Goal:** deployed gray-box Civic Center block, touch on iPhone Home Screen, mannequin animation, audio buses, IWER smoke, debug HUD.
- **R** R-PLAT-01/02/04, R-ENG-04 · **Dep** M01b1, M01f, M00 · **Read** file `M01b2-…md` · **Out** `packages/engine/src/client/{anim,audio,input/touch}` · **C** C04 1.1, C08 1.0 (read), C13 1.1
- **Gate** device availability (Q-13) · **Proof** `pnpm check:e2e -- --project=webkit-webgl2 --grep @touch`; `pnpm check:e2e -- --project=xr-quest3`; manual iPhone 15 and Quest checklists (AC-11, AC-12)

### M01c · device-spike-renderer-host — 1 · risk H · S11
- **Goal:** C13 platform core: device classification, benchmarked tier, `RendererHost` with fallback and recovery, perf tooling (`check:perf`, `perf:verify`, `perf:checklist`), device spike.
- **R** R-PLAT-03/05, R-ENG-02 · **Dep** M00, M00a, M01a2 · **Read** file `M01c-device-spike-renderer-host.md` · **Out** `packages/engine/src/platform`, `config/tier-budgets.json`, `tools/ci/checklists/M01c-*.json`, `docs/device-spike/M01c/` · **C** C13 1.1
- **Gate** Q-13 devices · **Proof** `pnpm check:perf -- --fail`; `pnpm perf:verify -- tools/ci/fixtures/perf/over.json --tier mobile-low` (fails); manual M01c checklists

### M01d · assets-publish — 1 · risk M · S05
- **Goal:** catalog builder, `assets:verify/publish/lock`, credits, `resolveVariant`, rclone upload with HEAD verify, `assets.yml`.
- **R** R-IP-01, R-PLAT-03 · **Dep** M00b, M00a, M01a1 · **Read** file `M01d-assets-publish.md`; `05-assets.md` §4 · **Out** `tools/assets`, `assets/{lock,provenance}`, `.github/workflows/assets.yml` · **C** C07 1.1
- **Gate** `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; buckets in `config/cloudflare.resources.json` · **Proof** `pnpm check:assets`; `pnpm assets:verify`; dry-run publish

### M01d2 · media-route — 0.4 · risk L · S09
- **Goal:** the app Worker serves R2 media at `/media/<key>` (dispatch before the asset fallthrough and the geo gate, `run_worker_first`, Range and conditional requests, explicit key grammar, public CORS, cross-origin CORP, `MEDIA_ROUTE` kill switch) and `HOST_MEDIA` points at it, so deployed builds load published media without a custom domain (DL-713).
- **R** R-PLAT-01, R-IP-01 (support) · **Dep** M01d, M00e · **Read** file `M01d2-media-route.md`; DL-713; `spec/03` §6 (R2 media through a Worker) · **Out** `services/edge/src/{routes/media.ts, index.ts, headers.ts, env.ts}`, `services/edge/test/{media,headers}.test.ts`, `services/edge/wrangler.jsonc`, `packages/shared/src/{assets/media-key.ts, index.ts}`, `apps/web/src/sw.ts`, `config/{csp-hosts.ts, cloudflare.resources.json}`, `tools/ci/{deploy.ts, test/csp-hosts.test.ts}`, `docs/runbooks/r2-media.md` · **C** C12 1.3 (unchanged), C07 1.1
- **Gate** none (AC-5 is a post-deploy operator check) · **Proof** `pnpm check:workers -- media headers boot`; `pnpm check:unit -- packages/shared tools/ci`; `pnpm check:prod-routes`

### M01e · asset-worker-opfs-store — 1 · risk M · S11
- **Goal:** `asset.worker`, `WorldPackStore` on OPFS with hash check, eviction, `persist()`, `fetchRetry` lanes.
- **R** R-PLAT-01/03 · **Dep** M01d, M01c, M00a, M00, M01a2, M01f · **Read** file `M01e-…md`; `11-platform-pwa.md` §5 · **Out** `packages/engine/src/workers/asset.worker.ts`, `packages/engine/src/assets/store` (as the frozen file; DL-247) · **C** C13 1.1, C07 1.1
- **Gate** none · **Proof** `pack-store.spec.ts` in Chromium and WebKit (`11-platform-pwa.md` §10 test 5); `pnpm check:unit -- packages/engine`

### M01f · world-graybox-fixture-codec — 0.5 · risk L · S02
- **Goal:** C08 types, terrain helpers and `DVWP` pack codec with the 4-chunk Civic Center gray-box fixture.
- **R** R-MAP-01 · **Dep** M01a1, M00b · **Read** file `M01f-…md`; `02-world-contracts.md` §2, §4 · **Out** `packages/shared/src/world`, `tools/map/src/fixtures`, `tests/fixtures/world/civic-graybox` · **C** C08 1.0
- **Gate** none · **Proof** `pnpm --filter @dv/shared test -- world`; `pnpm map:fixture graybox --check`

## Block B — foundations

### M00d · qa-spec-gates — 1 · risk L · S13 (new)
- **Goal:** C15 1.1 lint and the traceability report run in CI; `check:agents`; `check:telemetry` (C16 privacy rules and per-name schemas, DL-230); device-run verification job; nightly det suites and perf fail mode.
- **R** R-ENG-01, R-ENG-02 · **Dep** M00, M01c, M00b · **Read** `13-qa.md` §2.3, §2.6, §3.8, §4; `spec/08-test-and-ci.md` §5.1, §5.5
- **Out** `packages/shared/src/contracts/c15-milestone.ts`, `tools/ci/{milestone-lint,trace,check-agents,check-telemetry}.ts`, `tools/ci/test/`, `.github/workflows/{ci,nightly}.yml`, `tests/reports/` · **C** C15 1.1, C16 1.1
- **Gate** none · **Proof** `pnpm check:unit -- tools/ci` (READY files pass, four bad fixtures fail, `trace.json` written); `pnpm check:agents`; `pnpm perf:verify -- tools/ci/fixtures/perf/ok.json --tier mobile-low`

### M00e · owner-account-hardening — 1 · risk H · Architect (owner PR #1, DL-605)
- **Goal:** owner password accounts conform: `TERMS_VERSION` in `config/terms.ts` with interim Terms and Privacy (route 66), 18+ and terms at sign-up and re-acceptance at sign-in stored server-side, `RL_AUTH`, cookie refresh, `/account/` island, `AUTH_PASSWORD_SIGNUP`, C12 1.3 types, routes 64–65 through the admin path.
- **R** R-IP-04, R-AUTH-01, R-IP-01, R-PLAT-01, R-ENG-01 · **Dep** M00a, M00b, M01c (code base `claude/build` at `495a240` with owner PR #1) · **Read** file `M00e-…md`; ADR-ACCT-01; `spec/05-api-and-realtime.md` §3 routes 58–66; `09-backend-contracts-1.3.md`
- **Out** `services/edge/src/{ratelimit.ts,routes/auth.ts,routes/legal.ts}`, `config/terms.ts`, `content/legal/{terms,privacy}.json`, `apps/web/account/`, `tests/e2e/account-password.spec.ts`, `docs/runbooks/supabase-auth.md` · **C** C12 1.3 (lands it; DL-604)
- **Gate** `SUPABASE_SECRET_KEY` (Worker; absent → admin routes `feature_disabled`); operator actions in the file (create `main`, `LEGAL_CONTACT`, production switch, dashboard sign-up off after U-ACCT-3 is recorded) · **Proof** `pnpm check:workers -- auth`, `-- boot`, `-- legal`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @account`; `pnpm build && pnpm check:secrets -- apps/web/dist`

### M00f · third-party-reuse-gates — 0.7 · risk L · Architect (ADR-REUSE-01, DL-605)
- **Goal:** `license:scan` accepts `third_party/` only through the reuse register; licences file (`licenceFiles`) and `NOTICE` lines in `credits.json`; no GPL-family exception, dependency check of `services/*`; no import or bundle of `third_party/`; subset tool; in-repository clone check `reuse:clones`; Mapbox scan; Builder and vendoring PR-template attestations (DL-616, DL-630…DL-634). Inert until vendoring; the mechanical stop before any vendoring (DL-607).
- **R** R-IP-01, R-ENG-01 · **Dep** M00b, M00d · **Read** file `M00f-…md`; ADR-REUSE-01; `docs/legal/third-party-reuse.json`
- **Out** `tools/ci/{third-party-licenses,third-party-subset,reuse-clones}.ts`, `tools/ci/{license-scan,provenance-check,check-dist}.ts`, `apps/web/vite.config.ts`, `eslint.config.js`, `.github/pull_request_template.md` · **C** none
- **Gate** none (`DV_NAMES_REAL_JSON` optional, CI); operator actions in the file (branch protection with required `static` and `ip` checks before vendoring, DL-633) · **Proof** `pnpm check:unit -- tools/ci`; `pnpm build && pnpm license:scan && pnpm check:bundle && pnpm names:lint && pnpm reuse:clones && pnpm provenance:check`

### M02a1 · bake-core — 1 · risk M · S02
- **Goal:** `tools/map` S0 fetch, terrain, water and landuse, buildings, pack writer, world index, attribution, gates; SF packs without roads.
- **R** R-MAP-01, R-IP-01 · **Dep** M01f, M01d, M00d (`workflows.test.ts`), M01e (`media-local.ts` plugin, QA media-local publish step, catalog client; DL-671) · **Read** `02-world-bake.md` §1–§5, §8; `02-world-contracts.md` §4–§5 · **Out** `tools/map`, `content/world`, `assets/provenance/world` · **C** C08 1.0, C07 1.1 (DL-161 provenance)
- **Gate** public OSM/DataSF downloads (F-053, F-054) · **Proof** `pnpm map:build -- --area sf --stage terrain,water,buildings,pack` (baked buildings ≥ 98 % of the locked `ynuv-fyni` row count, packs ≤ 4 MiB, identical rerun; DL-288); `pnpm check:secrets -- dist/world`; `pnpm check:unit -- tools/map`

### M02a2 · bake-roads-graph — 1 · risk M · S02
- **Goal:** stages S5–S11: road graph, junctions, signals, grading, slabs, hoods, ped graph, tags, spawn tables, `sf-graph.v1`, POI and transit seeds; `l1`, `l2`, `far-bay-*` packs (S11, moved from M02b1, DL-546).
- **R** R-MAP-01/02/04 · **Dep** M02a1 · **Read** `02-world-bake.md` §4, §9; `02-world-living.md` §1, §7 · **Out** `tools/map/src/stages`, `content/world/{pois,landmarks}` · **C** C08 1.0
- **Gate** none · **Proof** `pnpm map:verify` (SCC ≥ 98 % of drivable edges, City Hall → every portal, ≥ 2 phases per signal); `pnpm map:landmarks`

### M02b1 · streaming-lod — 1 · risk H · S02 (+S11)
- **Goal:** `ChunkStore`, mesher in `asset.worker`, `ChunkRenderer`, upload gate, L1/L2, backdrop ring and skyline cards (from M02a2's S11 packs, DL-546); scenarios `walk-civic-center`, `route-ferry-ocean-beach`; CI world builds with the gray-box tags on a no-world build, `ci.yml` and `nightly.yml` (DL-546).
- **R** R-MAP-01/02, R-PLAT-03, R-ENG-02 · **Dep** M02a2, M01c, M01e, M01b2 (gray-box boot, debug panel) · **Read** `02-world.md` §5; `02-world-contracts.md` §4; `11-platform-pwa.md` §5; `11-platform-perf.md` §4–§5 · **Out** `packages/world/src/{sim/streaming,client/chunks,client/backdrop}`, `config/perf/paths` (DL-221) · **C** C08 1.0, C13 1.1
- **Gate** none · **Proof** `pnpm check:perf -- --scenario route-ferry-ocean-beach` (≤ 1 upload/frame, objects ≤ tier on webgl2 and webkit); `pnpm check:e2e -- --project=chromium-webgl2 --grep @world-boot-size`; `pnpm check:unit -- packages/world`

### M02b2 · weather-time — 1 · risk M · S02 (+S01)
- **Goal:** time-of-day cycle, dome sky, fog bank, rain, night lights, per-tier matrix, presets, blackout look on the S01 clock.
- **R** R-MAP-04 · **Dep** M02b1 · **Read** `02-world-living.md` §6; `01-engine-save-modes.md` "Time-of-day and weather clock" · **Out** `packages/world/src/client/sky`, `packages/world/src/sim/env` · **C** C06 1.1 (`WorldClockApi`), C13 1.1
- **Gate** none · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @world-sky`; manual `M02b2-iphone15` (sky ≤ 0.3 ms at `mobile-low`)

### M02e · look-pass — 1 · risk H · S02 (+S11) (owner request, DL-704)
- **Goal:** TSL physically based materials on the existing geometry (procedural façades per building class, roofs, ground, asphalt, water waves), physically based day sky and sun on desktop tiers, exposure, and the C13 post stack (tone mapping everywhere; GTAO, bloom, SMAA/TRAA and cascaded shadows on desktop tiers); XR unchanged; screenshot goldens and a before/after image.
- **R** R-MAP-01, R-MAP-04, R-PLAT-03, R-PLAT-05 (s), R-ENG-02 · **Dep** M02b1, M02b2, M01c · **Read** `02-world-living.md` §6; `02-world-bake.md` §4, §6; `11-platform.md` §4.2–§4.5, §5.1 · **Out** `packages/world/src/client/look`, `packages/engine/src/platform/post`, `config/world/look.json` · **C** C13 1.1, C08 1.0 (read only)
- **Gate** Q-13 iPhone 15 and Mac (AC-12, AC-13) · **Proof** `DV_WORLD=synth pnpm check:perf -- --fail`; `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-look|@look-golden"`; `pnpm check:unit -- packages/engine packages/world`

### M02c1 · graph-services-teleports — 1 · risk M · S02
- **Goal:** `RoadGraphService` and A*, junction runtime, `WorldQuery`, `TeleportApi`, `WorldResolver`, `PlaceIndex`, districts, POI table, `WorldApi` wiring; boundaries, portals and swim respawn (DL-691).
- **R** R-MAP-01/03 · **Dep** M02a2, M02b1, M02b2 (blackout resource) · **Read** `02-world-contracts.md` §3; `02-world-maps.md` §4.1–§4.2, §5; `02-world.md` §3 · **Out** `packages/world/src/sim/{graph,api,traffic/control.ts}` · **C** C08 1.0, C06 1.1 (`ModeContext.world`)
- **Gate** none · **Proof** `pnpm check:unit -- packages/world` (A* equal in Node; `snap` rejects > 25 m); `pnpm check:e2e -- --project=chromium-webgl2 --grep @world-teleport` (10 landmarks within 0.2 m or precondition message)

### M02d1 · landmarks-kit-and-heroes — 1 · risk M · S02
- **Goal:** landmark recipe kit, 12 hero/major original glTFs, `LandmarkLayer`, proxy swap; `VariantStats` budgets in `check:assets` (left open by M01d, first needed here; DL-230).
- **R** R-MAP-01, R-IP-01 · **Dep** M02b1, M02c1 (`world.teleport`) · **Read** `02-world-bake.md` §7; `05-assets.md` §4 · **Out** `assets/src/building/lm.*`, `tools/map/src/landmarks`, `packages/world/src/client/chunks` (`LandmarkLayer`) · **C** C07 1.1, C08 1.0
- **Gate** human art time · **Proof** `pnpm check:assets` (per-fidelity triangle budgets); `pnpm provenance:check`; `pnpm check:unit -- tools/map`

### M02d2 · landmarks-rest-and-swap — 1 · risk M · S02
- **Goal:** the remaining 25 landmarks and the skyline set; 37 `building/lm.*` assets in the catalog.
- **R** R-MAP-01/02 · **Dep** M02d1 · **Read** `02-world-bake.md` §7 · **Out** `assets/src/building/lm.*` · **C** C07 1.1
- **Gate** human art time · **Proof** `pnpm check:assets` (37 refs, provenance); `pnpm check:perf -- --scenario route-ferry-ocean-beach` (swap without a frame over budget on the CPU-side meter)

### M03a1 · vehicles-interaction-prefabs — 1 · risk M · S01 (+S06 handling v1)
- **Goal:** vehicle controller and enter/exit, prefabs (incl. `police.{cruiser,suv,heli}`, `prop.spikestrip` for M03b1 and M03c), interaction v1, ragdoll-lite, lines recorder, inspector; shared handling model, 9 presets (incl. `hp.police-suv`), `quirks.ts` and oracle lines (DL-235).
- **R** R-MODE-01/02, R-PLAT-04 · **Dep** M01b2, M02c1 · **Read** `01-engine-save-modes.md` "Interaction system", "Entity prefabs"; `06-racing-data.md` §4.1; `06-racing-content.md` C.2–C.3 · **Out** `packages/shared/src/vehicle`, `packages/engine/src/sim/vehicle`, `assets/prefabs` · **C** C06 1.1, C07 1.1 (vehicle anchors), C03 1.1
- **Gate** none · **Proof** `pnpm --filter @dv/engine test:lines` (filbert identical over 3 runs; C.3 oracles); `pnpm --filter @dv/shared test` (`vehicle.powerCurve`, `vehicle.envelope`)

### M03a2 · handling-model-wheel-spike — 0.5 · risk M · S06 (+S01)
- **Goal:** decide the wheel-force path (U-RAC-1) on oracle lines; write the C06 1.2 wheel-readout proposal and ADR (DL-104).
- **R** R-MODE-02 · **Dep** M03a1 · **Read** `06-racing.md` §2; `06-racing-content.md` C.3 · **Out** `packages/shared/src/vehicle`, `docs/decisions/` · **C** C06 1.1 (1.2 proposed via Architect)
- **Gate** none · **Proof** `pnpm --filter @dv/engine test:lines` on both paths; the run records U-RAC-1 in the ADR

### M03b1 · traffic-robotaxis — 1 · risk H · S02
- **Goal:** traffic agents (IDM, junction protocol, signals), parked cars, robotaxis, blackout, density model, promotion; `downtown-rush`.
- **R** R-MAP-04 · **Dep** M02c1, M03a1, M02b2 · **Read** `02-world-living.md` §1–§3, §7–§8 · **Out** `packages/world/src/{sim/traffic,client/traffic}`, `config/perf/paths/downtown-rush.json` · **C** C08 1.0, C01 1.0 (`amb:` keys)
- **Gate** none · **Proof** `pnpm check:e2e -- --project=webkit-webgl2 --grep @world-hash` (10,000 ticks equal in Node, Chromium, WebKit); `pnpm check:unit -- packages/world` (no red-light entry in 600 s; robotaxi holds 4–9 s in 20 seeds); `pnpm check:perf -- --scenario downtown-rush`; manual `M03b1-iphone15`

### M03b2 · peds-transit — 1 · risk M · S02
- **Goal:** pedestrians (FSM, crossings, crowds, LOD), stations, buses, cable cars, ferries, aircraft as set dressing.
- **R** R-MAP-04 · **Dep** M03b1 · **Read** `02-world-living.md` §4–§5, §7 · **Out** `packages/world/src/{sim/peds,sim/transit,client/peds}` · **C** C08 1.0
- **Gate** none · **Proof** `pnpm check:unit -- packages/world` (`ped.crossing`; `density.prefix`: `mobile-low` agents ⊂ desktop at the same `(cell, slot)`)

### M03c · pursuit-director — 1 · risk M · S01
- **Goal:** pursuit director, dispatcher, police behaviours (follow, PIT, box-in, roadblocks, spikes, heli LOS), arrest, `config/pursuit.json`, sandbox heat toggles.
- **R** R-MODE-01/02 · **Dep** M03a1, M03b1 · **Read** `01-engine-save-modes.md` "PursuitDirector core"; `06-racing-content.md` C.11 · **Out** `packages/engine/src/sim/pursuit`, `config/pursuit.json` · **C** C06 1.1 (`PursuitApi`)
- **Gate** none · **Proof** `pnpm --filter @dv/engine test:pursuit` (bot reaches heat 3 from scripted infractions and escapes through cooldown)

### M04a1 · saves-gamemode-unlocks — 1 · risk M · S01 (split 1 of 2)
- **Goal:** `SaveService`: profiles, slices, two-phase atomic writes, caps, tombstones, migrations, export/import on IndexedDB `dv-saves`.
- **R** R-MODE-01, R-MODE-05, R-PLAT-01 · **Dep** M01b2 · **Read** `01-engine-save-modes.md` §C05 and "C05 1.1 and C06 1.1 additions" · **Out** `packages/engine/src/sim/save` (goldens in `sim/save/__golden__/`, C05 rule 5), `packages/shared/src/contracts/{c05-save,c06-modes,ui-bridge,engine-world}.ts` (created whole for C05's imports; DL-220) · **C** C05 1.1
- **Gate** none · **Proof** `pnpm --filter @dv/engine test:save` (caps, CAS conflict, tombstones, golden migrations); `pnpm check:e2e -- --project=chromium-webgl2 --grep @save-kill`

### M04a2 · saves-gamemode-unlocks — 1 · risk M · S01 (split 2 of 2)
- **Goal:** `ModeHost` and `ModeContext`, unlock registry with `comingSoon` stubs, controls-remap persistence, economy wallet, clock and interaction scoring.
- **R** R-MODE-05, R-ENG-04, R-MODE-01 · **Dep** M04a1, M03c, M03b2, M02b2 (clock, `WorldApi`, interaction, `PursuitApi`, fares; DL-219) · **Read** `01-engine-save-modes.md` §C06, "Economy and combat cores", 1.1 section; `10-ui.md` §3.3 · **Out** `packages/engine/src/sim/modes` (C06 contract files from M04a1, checked against the spec) · **C** C06 1.1, C05 1.1
- **Gate** none · **Proof** `pnpm --filter @dv/engine test:modes` (depth ≤ 2, idempotent first-encounter unlock); `pnpm --filter @dv/engine test` (`economy.idempotent`, `clock`)

### M04b1 · shell-ui-kit-menus-settings — 1 · risk M · S10
- **Goal:** shell, kit, focus navigation, i18n, age gate (every under-18 bracket blocked), terms, main menu, saves and profiles (New Game = new profile), settings pages.
- **R** R-UI-02/03, R-ENG-04, R-MODE-05, R-IP-04 · **Dep** M04a2, M00e (`config/terms.ts`, DL-602) · **Read** `10-ui.md` §2–§3; `10-ui-pages.md` §2, §4 · **Out** `packages/ui/src/{shell,kit,pages,i18n}`, `content/ui/i18n/en.json` (catalog moved from M00's `packages/ui/src/i18n/`, DL-222), root script `check:i18n` · **C** C06 1.1 (`UiBridge`), C05 1.1, C13 1.1 (`PlatformSettings`)
- **Gate** none · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-menus`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-a11y` (zero critical or serious); `pnpm check:i18n`

### M04b2 · creator-phone-hud-kit — 1 · risk M · S10 (+S05 creator kit)
- **Goal:** character creator with `PlayerAvatar` / `AppearanceV1`, **`avatar.v1` and wardrobe-item schemas in `packages/shared/schemas/ui/` (gap 11)**, new-game flow, phone and pause, HUD and story HUD, touch layouts, coach mark, help, garage frame, `UiSurface` skeleton.
- **R** R-UI-01/03, R-ENG-04, R-PLAT-01 · **Dep** M04b1 · **Read** `10-ui-pages.md` §2 (creator), §4.1; `10-ui-hud-xr.md` §2 · **Out** `packages/ui/src/{creator,hud,phone,touch}`, `packages/shared/schemas/ui/`, `assets/creator-kit` · **C** C05 1.1 (`CoreSlice.avatar`), C06 1.1, C07 1.1
- **Gate** none · **Proof** `pnpm check:unit -- packages/ui` (`AppearanceV1` ≤ 512 B golden vectors; schema fallback); `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-touch`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @creator`

### M02c2 · maps — 1 · risk M · S02 (+S10)
- **Goal:** map data bake, minimap, full map, blips, GPS route, address search, attribution screen data.
- **R** R-MAP-03 · **Dep** M02c1, M04b2, M01d2 · **Read** `02-world-maps.md` §1–§3, §6; `10-ui-hud-xr.md` §2 · **Out** `packages/world/src/{client/map,sim/map}`, `tools/map/src/stages/s12` · **C** C08 1.0
- **Gate** M01d2 deployed to staging and the media R2 secrets (AC-14 operator release only; DL-713) · **Proof** `pnpm check:e2e -- --project=chromium-webgl2 --grep @world-map` (5 m at 10 landmarks, banner at 20 points, 50 EAS addresses within 10 m); `--grep @world-attribution`

### M04b3 · local-identity-play-token — 0.5 · risk L · S09
- **Goal:** `IdentityService` with the local adapter (UUIDv7 profile, device key), `NullCloudSync`; single-player never needs an account.
- **R** R-AUTH-01/02, R-ROLL-01 · **Dep** M00a, M04b1 · **Read** `09-backend-contracts.md` §2 (identity); `09-backend.md` §3 · **Out** `packages/identity`, `services/edge/src/id/playtoken.ts` (route 5 stateless mint) · **C** C12 1.1 (`IdentityService`)
- **Gate** `PLAY_TOKEN_HMAC` (Worker secret; SKIP without it, DL-231) · **Proof** `pnpm check:unit -- packages/identity`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @offline` (`/boot` down → single-player starts)

### M04c · cutscene-playback-spike — 1 · risk M · S11 (+S03 fixtures, S10 overlay)
- **Goal:** `FirstGestureUnlock` and video pool, wake lock, media budget, flat DOM host, fixture `CutsceneManifest`s, `CutsceneOverlay` (skip, subtitles, AI chip).
- **R** R-CUT-03, R-PLAT-01, R-ENG-04 · **Dep** M01c, M04b1 · **Read** `11-platform-pwa.md` §7; `03-story-cutscenes.md` §D2, §D7; `10-ui-hud-xr.md` §2 · **Out** `packages/engine/src/platform/media`, `packages/ui/src/cutscene`, `tests/fixtures/cutscenes`, `packages/shared/src/contracts/{c09-cutscene,c09-mission (partial; M05a1 completes),dom-media.d.ts}` (DL-232) · **C** C09 1.0, C13 1.1
- **Gate** none · **Proof** `pnpm check:e2e -- --project=webkit-webgl2 --grep @cutscene` (plays after gesture, subtitles, skip); manual `M04c-{iphone15,quest3}` (records U-PLT-17)

### M04d · qa-harness-bots-goldens — 1 · risk M · S13 (+S01 econ-sim) (new)
- **Goal:** `CanonicalRunner`, `BotDriver` registry with driver `lines`, golden store and update guard, det suite registry, mutants, verifier lock, **`tools/ci/econ-sim` (gap 11)**.
- **R** R-ENG-01/02, R-MODE-01 · **Dep** M04a2, M03a1, M00d · **Read** `13-qa.md` §3.1–§3.6, §3.9; `01-engine-contracts.md` C03 1.1 section · **Out** `packages/engine/src/qa`, `tests/{golden,e2e/det}`, `tools/ci/{mutants,econ-sim}`, `config/econ-bands.json` · **C** C02 1.1, C03 1.1, C06 1.1 (`EconomyApi`)
- **Gate** none · **Proof** `pnpm check:unit -- packages/engine/src/qa tools/ci` (equal traces; mutants fail; lock guard); `pnpm check:e2e -- --project=webkit-webgl2 --grep @determinism`; `pnpm check:balance -- --suite econ` (self-test fixture fails)

### Study set in Block B (owner request 2026-10-23, DL-716, DL-732; run order rows 43–45 before M05c2 (M04e5, M04e0, M02f1) and rows 49–56 after M05c3 (the rest), `_PLAN.md` §0 rule 9)

### M04e5 · ip-wall-strings — 0.2 · risk L · S05 (+S10) (DL-717)
- **Goal:** no shipped string reuses trainer-checklist wording (the teleport refusal, the control-reason default, heat labels, the QA panel label, comments), the heat HUD shows bars instead of stars with the phase "Pursued", and three `trainer-*` patterns in `config/ip-denylist.json` make `ip:strings` refuse it from now on.
- **R** R-IP-01, R-UI-03 (s) · **Dep** M00b, M02c1, M03c, M04b2 · **Read** file `M04e5-ip-wall-strings.md`; DL-664, DL-717 · **Out** `content/ui/i18n/en.json`, `config/ip-denylist.json`, `packages/engine/src/sim/control/states.ts`, `packages/engine/src/debug/pursuit-panel.ts`, `packages/ui/src/hud/{model.ts, widgets.tsx}`, `tools/ci/test/ip-trainer-phrases.test.ts` · **C** none changed (C05 1.2, C06 1.1 read)
- **Gate** none · **Proof** `pnpm check:unit -- tools/ci/test/ip-trainer-phrases.test.ts`; `pnpm build && pnpm ip:strings`; `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @pursuit`

### M04e0 · sandbox-rooms-guard — 0.2 · risk L · S01 (DL-719)
- **Goal:** every sandbox tool (`sandbox.*`, `mode.cmd {mode:'sandbox'}`, the phone's `map.travel`) is refused with `sandbox.refuse.online` while any running `ModeContext` has `net`; `ContextPorts.net` becomes an engine-internal getter. Must merge before M12b1.
- **R** R-ROLL-02 (s), R-UI-03 (s) · **Dep** M04b2, M02c2 · **Read** file `M04e0-sandbox-rooms-guard.md`; DL-719 · **Out** `packages/engine/src/sim/modes/{commands.ts, context.ts, builtin/sandbox.ts}`, `packages/engine/test/modes/{fixture.ts, sandbox-guard.spec.ts}`, `content/ui/i18n/en.json` · **C** C06 1.1 (read)
- **Gate** none · **Proof** `pnpm check:unit -- packages/engine/test/modes/sandbox-guard.spec.ts`; `pnpm check:unit -- packages/engine/test/modes`; `pnpm check:i18n`

### M04e1 · sandbox-world-controls — 0.8 · risk M · S01 (+S02, S10) (DL-718, DL-720)
- **Goal:** Weather (presets held by the engine-internal `WorldClock.holdWeather`, no draws while held), Time (hour, pause, wall-clock sync, our SF fog-day shortcuts in `config/clock.json`) and World (speed through `SimCore.setSandboxScale`, blackout, density) sections in the phone Sandbox app as `ScreenDef` widgets; the `SANDBOX_ACTIONS` dispatcher for `mode.cmd {mode:'sandbox'}`.
- **R** R-MAP-04, R-UI-03 (s), R-PLAT-02 (s) · **Dep** M04e5, M04e0, M04b2, M02b2, M03b1, M03b2 · **Read** file `M04e1-sandbox-world-controls.md`; `01-engine-save-modes.md` (`SandboxSlice`, clock rules); DL-720 · **Out** `packages/engine/src/sim/{world/clock.ts, loop/sim-core.ts, modes/}`, `config/{clock.json, schemas/clock.schema.json}`, `packages/ui/src/phone/{apps.ts, pause.tsx}` · **C** C02 1.1, C05 1.2, C06 1.1, C08 1.0 (all read)
- **Gate** none · **Proof** `pnpm check:unit -- packages/engine/test/clock.hold.spec.ts`; `pnpm check:unit -- packages/engine/test/modes/sandbox-world.spec.ts`; `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @sandbox-world`

### M04e2 · sandbox-teleport-display — 0.7 · risk L · S01 (+S02, S10)
- **Goal:** Teleport (37 landmarks, map pin, previous spot, up to 32 saved `pos-<n>` spots) through `TeleportApi.request('sandbox', …)`, rerouting `sandbox.teleport` and `map.travel`; Display (hide HUD, hide minimap; subtitles stay).
- **R** R-MAP-01, R-UI-03 (s), R-ENG-04 (s), R-IP-01 (s) · **Dep** M04e1, M04e5, M04e0, M02c1, M02c2, M04b2, M04a2 · **Read** file `M04e2-sandbox-teleport-display.md`; `02-world-maps.md` §5 · **Out** `packages/engine/src/sim/modes/`, `packages/ui/src/{phone,hud}`, `content/ui/i18n/en.json` · **C** C05 1.2, C06 1.1, C08 1.0 (read)
- **Gate** none · **Proof** `pnpm check:unit -- packages/engine/test/modes/sandbox-teleport.spec.ts`; `DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @sandbox-teleport`

### M04e3 · sandbox-vehicle-spawner — 0.8 · risk M · S01 (+S06, S10) (DL-721)
- **Goal:** a Cars tab placing our fictional cars by class with a new near-player in-view search `findNearSpot` (the garage's 120–400 m `findCallSpot` is untouched); session cars `veh:sbx<n>`, cap 8, never saved, gone on exit and when `net` turns non-null.
- **R** R-UI-03, R-IP-01 (s), R-PLAT-02 (s) · **Dep** M04e1, M04e5, M04e0, M03a1, M07a1, M05c1 · **Read** file `M04e3-sandbox-vehicle-spawner.md`; DL-721 · **Out** `packages/engine/src/sim/modes/{builtin/sandbox-spot.ts, sandbox-vehicle-port.ts}`, `content/vehicles/sandbox-catalog.json`, `packages/ui/src/phone` · **C** C01 1.0, C05 1.2, C06 1.1, C08 1.0 (read)
- **Gate** none · **Proof** `pnpm check:unit -- packages/engine/test/sandbox-spot.spec.ts packages/engine/test/garage.test.ts`; `pnpm check:unit -- packages/engine/test/modes/sandbox-vehicles.spec.ts`; `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @sandbox-vehicles`

### M04e4 · sandbox-vehicle-player-actions — 0.6 · risk M · S01 (+S10)
- **Goal:** Player tab (can't get hurt, big jumps, patch me up) and car actions on `veh:sbx` cars (repair, upright, dismiss, no-damage); every flag session-only in `EngineServices.sandboxFlags`, cleared online.
- **R** R-UI-03, R-PLAT-02 (s), R-ROLL-02 (s), R-IP-01 (s) · **Dep** M04e3, M04e5 · **Read** file `M04e4-sandbox-vehicle-player-actions.md`; DL-718, DL-730 · **Out** `packages/engine/src/sim/{sandbox-flags.ts, services.ts, combat, control/onfoot.ts, vehicle}`, `packages/ui/src/phone` · **C** C01 1.0, C05 1.2, C06 1.1 (read)
- **Gate** none · **Proof** `pnpm check:unit -- packages/engine/test/sandbox-flags.spec.ts`; `pnpm check:unit -- packages/engine/test/modes/sandbox-player.spec.ts`; `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @sandbox-actions`

### M04b5 · settings-live-overlay-hooks — 0.8 · risk M · S10 (+S11) (DL-727)
- **Goal:** a fixed render scale applies inside the tier budget, the frame-cap row is disabled with a reason until M11a1, an FPS chip, a full-screen control where `document.fullscreenEnabled` (tests stub it), the read-only overlay hooks (`data-ui-skip` and one `ShellSignal` stream on the `dv-shell` window event and `BroadcastChannel('dv-shell')`, DL-732), unknown prefs fields kept.
- **R** R-UI-02, R-PLAT-03, R-PLAT-01, R-ENG-04 (s) · **Dep** M01c, M04b1, M04b2 · **Read** file `M04b5-settings-live-overlay-hooks.md`; `10-ui-hud-xr.md` §2.14 rule 5; DL-727 · **Out** `packages/engine/src/platform/{render-scale.ts, perf/fps-feed.ts}`, `packages/ui/src/{shell, hud, screen, pages/settings}`, `apps/web/src/{main.ts, shell-ports.ts}` · **C** C13 1.1 (read)
- **Gate** none · **Proof** `pnpm check:unit -- packages/ui/test/overlay-hooks.spec.ts`; `pnpm check:e2e -- --project=webkit-webgl2 --grep @ui-fullscreen`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @ui-settings-live`

### M04b4 · offline-download-ui — 0.3 · risk L · S10 (+S11) (DL-728)
- **Goal:** "Download the city for offline play" (size, 1.2 × quota check, `persist()` first, progress, cancel) and "Clear downloaded data" (confirm) enabled in Settings › Install and storage; no offline-reload AC (M11a2).
- **R** R-PLAT-01, R-UI-03 (s) · **Dep** M01e, M04b1 · **Read** file `M04b4-offline-download-ui.md`; `11-platform-pwa.md` §5 · **Out** `packages/engine/src/assets/`, `packages/ui/src/pages/settings/`, `apps/web/src/offline-port.ts`, `tests/e2e/offline-download.spec.ts` · **C** C13 1.1, C16 1.2 (read)
- **Gate** none · **Proof** `pnpm check:unit -- packages/engine/test/assets/offline-download.spec.ts`; `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @offline-download`

### M02f1 · stream-measure — 0.6 · risk M · S11 (+S02) (DL-722, DL-725)
- **Goal:** boot figures (requests, bytes, reveal time, waves, peak in flight from new `FetchRetry` counting) in the bridge, the perf report (C13 1.2) and `data-dv-boot`; new `boot-cityhall` perf scenario; QA-only `?net=` shaper; a staging device checklist that records the restated U-W8.
- **R** R-ENG-02, R-PLAT-01, R-ENG-01 · **Dep** M02b1, M01d2, M02c2 · **Read** file `M02f1-stream-measure.md`; `11-platform-perf.md` §4–§5; DL-722, DL-725 · **Out** `packages/engine/src/assets/store/{fetch-retry.ts, net-shaper.ts}`, `packages/shared/src/platform/{perf.ts, c13.ts}`, `config/{tier-budgets.json, perf/}`, `tools/ci/checklists/M02f1-staging.json` · **C** C13 1.2 (additive, DL-725)
- **Gate** AC-8 only: the M02c2 AC-14 staging `sf` release and Q-13 devices (Mac, iPhone 15) · **Proof** `pnpm check:unit -- packages/engine/test/assets/fetch-retry.spec.ts`; `DV_WORLD=synth pnpm check:perf -- --scenario boot-cityhall --fail`; manual `M02f1-staging`

### M02f2 · boot-prefetch — 0.5 · risk L · S11 (+S02, S10) (DL-726)
- **Goal:** the speculative part of `bootSet()` waits for the Title backdrop's reveal, runs in the `idle` lane and is promoted at mode start; skipped on a failed quota check or a Save-Data hint (U-W17); the CI `bootset.<mode>.json` is retired.
- **R** R-PLAT-01 (s), R-ENG-02 (s) · **Dep** M01e, M02b1, M04b1, M04a2 · **Read** file `M02f2-boot-prefetch.md`; `11-platform-pwa.md` §5; DL-726 · **Out** `packages/world/src/client/boot-prefetch.ts`, `packages/engine/src/assets/store/{fetch-retry.ts, store.ts}`, `packages/ui/src/shell/{types.ts, core.ts}` · **C** C13 1.1, C06 1.1 (read)
- **Gate** none · **Proof** `pnpm check:unit -- packages/world/test/boot-prefetch.spec.ts`; `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-prefetch`

### M01d3 · media-route-tuning — 0.4 · risk L · S09 (DL-724)
- **Goal:** one bucket `get` per satisfiable ranged `GET` on `/media/<key>` (`Content-Range` from the returned `size`), a pure range parser with tables (multi-range rejected), and `MEDIA_ROUTE` `throttle` applying a new `RL_MEDIA` binding (429 with `Retry-After`).
- **R** R-PLAT-01 (s), R-ROLL-01 (s) · **Dep** M01d2, M00e · **Read** file `M01d3-media-route-tuning.md`; spec/03 §6 row M01d3; DL-713, DL-724 · **Out** `services/edge/src/routes/{media-range.ts, media.ts}`, `services/edge/{src/env.ts, wrangler.jsonc}`, `services/edge/test/media-{range,throttle}.test.ts`, `docs/runbooks/r2-media.md` · **C** C12 1.3 (unchanged), C07 1.1
- **Gate** AC-8 only: a staging deploy (operator, `deploy.yml`) · **Proof** `pnpm check:workers -- media-range.test`; `pnpm check:workers -- media-throttle.test`; `pnpm check:prod-routes`

## Block C — story spine (VS-Story)

### M05a1 · mission-ir-vm — 1 · risk M · S03
- **Goal:** mission IR types and schema, authoring builder and compiler (`missions:build`), resolver over C08, VM, predicates, objectives, checkpoints, fail/retry, debugger, `m.dev.sample`.
- **R** R-MODE-01 · **Dep** M04a2, M02c1 · **Read** `03-story-missions.md` §C1–§C8, §C10; `03-story.md` §5 · **Out** `packages/modes/story`, `packages/shared/src/contracts/c09-mission.ts`, `packages/shared/schemas/mission-ir-1.schema.json` · **C** C09 1.0, C06 1.1, C08 1.0
- **Gate** none · **Proof** `pnpm check:unit -- packages/modes/story/test/compiler.test.ts`; `pnpm missions:build`

### M05a2 · autoplayer-director-preview — 1 · risk M · S03
- **Goal:** story autoplayer (`story.autoplayer` driver), `check:missions`, timeline export and scrub preview (`missions:preview`), in-engine director (auto, `DirectorScript`, LOS, hill rule, XR vantage data).
- **R** R-MODE-01, R-CUT-03 · **Dep** M05a1, M04d · **Read** `03-story-missions.md` §C9–§C10; `03-story-cutscenes.md` §D6 · **Out** `packages/modes/story/src/{autoplay,director}` · **C** C09 1.0, C04 1.1, C03 1.1
- **Gate** none · **Proof** `pnpm check:missions -- --mission m.dev.sample` (3 seeds twice, equal end hashes inside `expectedSec`); `pnpm check:unit -- packages/modes/story` (`director-los`)

### M05b1 · cutscene-infra-mock — 1 · risk H · S09, S05
- **Goal:** `CutsceneJobDO`, `FalGateDO`, minimal `BudgetGovernorDO` with `budget_program` = 100,000,000 micros (DL-OWN-01), `GenJobWorkflow` + `MockFalPort`, routes 27–29 and 49, media/private buckets; DO tag `web-v1` in its own PR, with `check:do-migrations` widened to accept DO class files and their export lines (DL-233).
- **R** R-CUT-01, R-ENG-03, R-NPC-02 · **Dep** M00a, M00c, M01d · **Read** `09-backend.md` §8; `09-backend-ops.md` §1.2, §5; `05-assets-pipeline.md` §6, §9; `03-story-cutscenes.md` §D5 · **Out** `services/edge/src/{cutscenes,budget}`, `services/pipeline` · **C** C09 1.0, C12 1.1, C07 1.1
- **Gate** `OPS_TOKEN`; `FAL_MODE=mock`; live fal only after ADR-GENAI-01 `cleared` · **Proof** `pnpm check:workers -- cutscene-singleflight`; `pnpm check:workers -- genjob-poll-fallback`; `pnpm check:workers -- budget-cache-first`; `pnpm check:pipeline`

### M05b2 · cutscene-player-index — 1 · risk M · S03
- **Goal:** `cutsceneKey` and vectors, index builder (`assets:cutscene-index`), templates and prompt lint, `CutscenePlayer` flat hosts, triggers, subtitles, AI chip, `beat` op.
- **R** R-CUT-01/02/03 · **Dep** M05b1, M04c, M05a1 · **Read** `03-story-cutscenes.md` §D2–§D4, §D7 · **Out** `packages/shared/src/genai/cutscene-key.ts`, `packages/engine/src/client/cutscene` (`CutscenePlayer`, C09 §D2), `packages/modes/story/src/cutscene` (story glue), `tools/assets/cutscene-index` · **C** C09 1.0, C13 1.1
- **Gate** none · **Proof** `pnpm check:unit -- packages/shared/test/cutscene-key.test.ts`; `pnpm check:e2e -- --project=chromium-webgl2 --grep @cutscene` (status `absent` → fallback within 2.5 s, mission resumes)

### M05c1 · act1-missions-1-6 — 1 · risk M · S03 (+S01 melee stub, S10 story HUD)
- **Goal:** Act 1 cast and stand-ins (original souls), missions `m.a1.01`–`06` with lines and director scripts, unlock defs, stub hooks (DL-157 ids), Yard safehouse, shops, basic melee via `CombatApi` stub, econ-sim Act 1 section.
- **R** R-MODE-01/05, R-MAP-01 · **Dep** M05a2, M05b2, M03c, M04b2, M02c2 · **Read** `03-story-narrative.md` §B1–§B4, §B7–§B8; `03-story-missions.md` §C7–§C8, §C11 · **Out** `content/missions/m.a1.0{1..6}/`, `content/story/act1/cutscene-refs.ts`, `packages/modes/story/src/missions` · **C** C09 1.0, C06 1.1, C10 1.0 (talk fields)
- **Gate** none · **Proof** `pnpm check:missions -- --act 1` (missions 1–6 on 3 seeds); `pnpm check:unit -- packages/modes/story` (`depiction-lint`); `pnpm check:balance -- --suite econ`

### M05c2 · act1-vertical-slice — 1 · risk M · S03 · **VS-Story**
- **Goal:** `m.a1.07`–`12`, Act 1 refs, plates and index, sensitivity gate, save/resume e2e, `story-chase`; racing and fighter tiles reachable through stub hooks (unlocked, `comingSoon`), tycoon tile registered and locked because its hook is `m.a2.01` in Act 2 (M09b2; DL-391); deployed and tested on staging (R-ROLL-01 anchor).
- **R** R-MODE-01/05, R-CUT-02, R-ROLL-01 · **Dep** M05c1, M03b2 · **Read** `03-story-narrative.md` §B4–§B5; `03-story.md` §8–§9 · **Out** `content/missions/m.a1.{07..12}/`, `content/story/act1/cutscene-refs.ts`, `content/story/sensitivity.json` · **C** C09 1.0, C05 1.1
- **Gate** the M02c2 AC-14 staging `sf` release (AC-7 to AC-9; DL-670, DL-713); Q-21 sensitivity read (public release only) · **Proof** `pnpm check:missions -- --act 1` (12 missions, 3 seeds); `pnpm check:e2e -- --project=webkit-webgl2 --grep @story` (reload resumes with `unlock.racing`); `pnpm check:perf -- --scenario story-chase`; `pnpm check:smoke -- <staging url>`; manual `M05c2-{iphone15,mac}`

### M05d · data-spine-supabase — 1 · risk M · S09
- **Goal:** Supabase staging and production projects, migrations 0001–0002, `DataPort` + `InMemoryDataPort`, `db:push` in deploy, cutscene index and ledger export, staging keep-alive.
- **R** R-ROLL-02, R-ENG-03 · **Dep** M05b1, M00e (§0 rule 7) · **Read** `09-backend-db.md` §1–§3, §8; `09-backend-ops.md` §1.3, §2 · **Out** `supabase/`, `packages/shared/src/{data-port,db.gen}.ts`, root script `check:api` (`tools/ci/check-api.ts`, DL-230) · **C** C12 1.1
- **Gate** Supabase Pro `us-west-1` (G1) for production; `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, `SUPABASE_SECRET_KEY` · **Proof** `pnpm check:db && pnpm check:db:types`; `pnpm check:unit -- packages/shared` (DataPort contract on the in-memory port)

### M05c3 · act1-prewarm — 0.7 · risk M · S05
- **Goal:** `assets:gen` with its `prewarm` subcommand (M10a1 adds `plan`/`run`/`gate`); prewarm Act 1 cutscenes through a `cleared` provider within ≤ $16 of the $38 cutscene cap (DN-S13-02, DL-740); otherwise ship fallback-only; C2PA re-sign; on Workers Free the Worker hands each key off after `copy-orig` and the operator's `prewarm --finish` transcodes (`cut@1`, pinned `ffmpeg`), re-signs and publishes off-edge (DL-745, replacing DL-232's Transcoder Container, which is parked with `claude/release-do-lifecycle-3` until the owner upgrades).
- **R** R-CUT-01, R-ENG-03 · **Dep** M05c2, M05d · **Read** `05-assets-pipeline.md` §6, §11–§12; `03-story-cutscenes.md` §D9 · **Out** `tools/assets/gen`, `services/pipeline/transcoder/ladder.sh`, `assets/cutscenes` index entries · **C** C09 1.0, C07 1.1
- **Gate** ADR-GENAI-01 `cleared` (owner), `FAL_KEY` (operator), prepaid balance ≤ cap; for `--finish`: pinned `ffmpeg`, `C2PA_CERT_CHAIN_PEM`/`C2PA_KEY_PEM` (operator) · **Proof** `pnpm check:pipeline` (mock prewarm: second run 0 calls; off-edge hand-off); `pnpm check:unit -- tools/assets/test/finish.spec.ts`; `pnpm check:c2pa`; manual operator `pnpm assets:gen prewarm --release <tag>` with ledger ≤ 16,000,000 micros
