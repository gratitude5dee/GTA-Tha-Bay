# M02h2 — curbs-sidewalks

## Goal
After this session streets have edges: a 0.10–0.12 m curb with a gutter wherever a carriageway has a sidewalk, and sidewalk ribbons built from the C08 `PedEdge` graph instead of the 4 m ground-class grid. Lots and plazas are shaded apart; ground gets bump normals from the existing noise heights and a 50–200 m macro variation. DL-OWN-07 Phase 1, session 2: code only, no texture or fal, 0 added render objects, no contract change. Licensed PBR sets (DL-OWN-06, M10d0) bind to these surface ids: concrete on the sidewalk ribbons, curbs and gutters, pavers on lots and plazas.

## Requirements
- R-MAP-01: city blocks read as built streets: curbs, gutters and sidewalks frame the carriageway; lots and plazas differ from sidewalks.
- R-PLAT-03: TSL only on one `WebGPURenderer` (WebGPU and WebGL2).
- R-PLAT-05 (s): `mobile-low` keeps its frame budget, its 100 render objects and its 2 MiB upload cap.
- R-ENG-02: the render-object ledger and the triangle budgets hold in `check:perf`.

## Depends on
- **M02h1:** the per-vertex `road` attribute on `addRibbon`, the junction patch surface and surface ids 35–37, the markings layer, and its ledger `docs/look/M02h1-render-ledger.json`.
- Merged context: M02g2 (depth-bias order, ribbon lift `0.12 + 0.01 × rank`, `aoRing()`, `tests/support/flicker.ts` and the `asphalt-low` pair), M02g1 (`setLookLayer`, `layers`, `@look-owner`, ledger shape), M02e (look profiles, `shot()`, `@look-golden`), M02b1 (mesher, upload gate).
- Contracts: C08 1.0 (`PedEdge`, `PedNode`, `RoadSegment`, `RoadEdge`, `GroundClass`, heightfield) and C13 1.2 (`TierBudget`), read only.

## Scope in
† = design value in `config/world/mesher.json` or `config/world/look.json` and their schemas, tuned here.

Evidence: capture study "Ground, sidewalks and curbs" (frames `desktop-03-third-st-bayview-1300-clear.png`, `desktop-05-embarcadero-ferry-1300-clear.png`); render audit items 4 and 10. Code: one flat road ribbon (`mesher.ts:436` `ROAD_LIFT_M`, `:439` `addRibbon`, `:547–556`); `Surf.Sidewalk` 18 unused (`look/surfaces.ts:23`, `SURFACE_COUNT` 35 at `:39`); one slab grid for Paved, Sidewalk and 18 (`ground.ts:40`, `:60–63`); no ground bump (`look-materials.ts:84`).

- **Sidewalk ribbons** (new `chunks/sidewalks.ts`, into the existing `roads` object): one per `Sidewalk` `PedEdge` (`c08.ts:96–97`), resampled every ≤ 4 m on the heightfield:
  - **attached** (both ends 1.6 ± 0.8 m † past a segment's curb line, `02-world-living.md` §4.1): from the curb line to `widthM / 2` past the ped centreline; that segment side is curbed;
  - **unattached** (OSM sidewalks elsewhere): a flat `widthM` walkway, no curb;
  - corner fans where attached ribbons meet, clipped at M02h1's junction patch;
  - curb ramps: the curb drops to 0 within `rampM` † 1.5 m of each `Crosswalk` start.
- **Curb and gutter** (mesher profiles `desktop`, `visionpro`, `mobile`, the last also serving `xr-quest`):
  - curb face `curb.heightM` † 0.11 (schema range 0.10–0.12) above the road ribbon, `curb.topM` † 0.3 top band, a 2 cm bevel on desktop; foot AO from M02g2's `aoRing()`;
  - gutter: `addRibbon` emits the outer `gutterM` † 0.35 of each curbed side as an edge-adjacent strip (shared edge, no overlap);
  - `low` (`mobile-low`): a flat strip 0.02 m † above the road with a painted curb band in vertex colour, no curb faces.
- **Surface ids** (`look/surfaces.ts`): `Curb` 38, `Gutter` 39, `Lot` 40, `Plaza` 41; `SURFACE_COUNT` 42. `look.json` `ground` gains the keys `Curb`, `Gutter`, `Lot` and `Plaza` (the map is already keyed by name, so there is no shape change). Bind new surfaces or list them `procedural` in M10d0's `config/world/surface-textures.json` (data only): `Curb` and `Gutter` to concrete, `Lot` and `Plaza` to pavers; `sidewalk` stays on concrete. If this row merges before M10d0, M10d0 binds them at its rebase (DL-755).
- **Lots and plazas** (terrain `surf`): a `Paved` post within 8 m † of a `Plaza` ped edge or `PedNodeFlag.Plaza` node is `Plaza` (0.6 × 0.3 m † running-bond pavers), every other `Paved` post `Lot` (darker worn concrete, oil stains, patch seams); `Sidewalk` keeps the 1.5 m slabs; `min` uses `mesher.json` class colours.
- **Bump normals** (`look/ground.ts`, `look-materials.ts`):
  - `groundNodes` returns a `height`: the aggregate, slab-joint, crack, paver and grass-clump terms that already exist;
  - the normal comes from TSL `bumpMap` (verify the export in the installed `three@0.186.1` first, and add a spec/03 §7 row); fallback: three-tap finite differences in the same file;
  - the bump fades with `bandFade(pixelFootprint)` so it adds no sparkle;
  - profiles: `full`, `lite` (one octave), off on `min` and `legacy`; strength `bump[profile]` †.
- **Macro variation** (new pure `chunks/macro.ts`, mirrored in TSL in `look/noise.ts`): `macroTone(x, z)`, a world-space value-noise fbm with 200 m and 50 m † octaves, albedo ±8 % † and roughness ±0.04 † on asphalt, sidewalk, curb, lot, plaza and grass; shader on `full` and `lite`, baked into vertex colours by the mesher on `min`.
- **Render feet** (render only; sim and heightfield untouched): the mesher returns a per-chunk `walk` lift mask (1 m cells, 8 KiB); peds and the on-foot player figure draw with it (the BD row names the player-figure file).
- **QA:** `look().curbs` `{ribbons, curbedM, rampCount}`; `setLookLayer` ids `curbs`, `bump`, `macro`, `lots`; `synth` shots `curb-corner` and `lot-plaza` in `@look-golden` at `desktop` and `mobile-low` (4 PNGs); existing look and `@look-owner` goldens regenerated under `golden-update`.
- **Ledger:** `@curbs-ledger` writes `docs/look/M02h2-render-ledger.json` in M02g1's shape (`DV_LOOK_WRITE=1` writes it, otherwise the test checks it). The baseline is the `after` of the ledger most recently merged at rebase, named in `baselineFrom`. Planned per profile (desktop, mobile, mobile-low, legacy): +0 objects. Triangles: ≤ +20,000 † per L0 chunk on desktop and ≤ +4,000 on `mobile-low`.

## Scope out
- Markings, crosswalks, the junction patch: M02h1. Ground cover and driveways: M02h3. Path and Stairs ribbons: not scheduled in v1 (DL-740). Trees and verges: M02h4/M02h5. Furniture and parked cars: M02h6. `xr` profile: M02h8.
- Licensed PBR textures and triplanar tiling: M10d0 (DL-OWN-06). L1/L2 roads stay flat (`lod-mesher.ts` unchanged).
- Physics curbs: vehicles keep driving on the heightfield (accepted, BD row).
- Not here: story-start lighting, HUD icons (DL-738), fal spend.

## Deliverables
- **New:** `packages/world/src/client/chunks/{sidewalks.ts, macro.ts}`.
- **Edits:**
  - `packages/world/src/client/chunks/{mesher.ts, mesh-types.ts, chunk-renderer.ts}`;
  - `packages/world/src/client/look/{surfaces.ts, ground.ts, noise.ts, look-materials.ts, config.ts, look-view.ts}`;
  - `packages/world/src/client/peds/{instances.ts, mannequin.ts}`;
  - `packages/world/src/client/{world-view.ts, world-bridge.ts}`.
- **Tests:**
  - `packages/world/test/{curbs.mesher.spec.ts, curbs.macro.spec.ts, curbs.walk.spec.ts}`;
  - `tests/e2e/world-curbs.spec.ts` (`@world-curbs`, `@curbs-ledger`, and one `@xr @curbs-ledger` case).
- **Data (not counted):** `config/world/{mesher.json, look.json, look-shots.json}` and schemas, goldens, the ledger, BD rows.
- No new script, dependency or asset.

## Interfaces
- C08 1.0 and C13 1.2 are read unchanged. `MeshBuffers`, the surface table, `walk`, `macroTone`, the config keys and the bridge fields are S02 internals.
- Contract change proposals: none.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 and no new file holds GLSL or `ShaderMaterial` — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the `synth` and `civic-excerpt` bakes When the mesher runs twice per profile Then:
  - buffers and `walk` are byte-identical across the runs;
  - every attached Sidewalk edge yields a ribbon;
  - curb height is in [0.10, 0.12] m on desktop and `mobile`, with no curb face on `low`;
  - curb height is 0 within `rampM` of every crosswalk start;
  - gutter and carriageway triangles share edges but never overlap;
  - every surface id is < 42;
  - no `mobile-low` L0 unit exceeds 2 MiB — proof: `pnpm map:build -- --area synth && pnpm map:build -- --area civic-excerpt && pnpm check:unit -- packages/world/test/curbs.mesher.spec.ts`
- AC-3 Given `macroTone` When the macro cases run Then:
  - values at shared chunk-border vertices are equal;
  - the tone stays within ±8 %;
  - the sampled correlation is ≥ 0.8 at 10 m lag and ≤ 0.3 at 400 m;
  - `min` vertex colours equal the CPU tone within 1/255 — proof: `pnpm check:unit -- packages/world/test/curbs.macro.spec.ts`
- AC-4 Given the `walk` masks When the walk cases run Then the lift equals the ribbon top above the road within 0.01 m on sidewalks, is 0 on carriageways and crosswalks, and the sim state hash of a 600-tick ped scenario equals the parent commit's — proof: `pnpm check:unit -- packages/world/test/curbs.walk.spec.ts`
- AC-5 Given a QA `synth` build When `@world-curbs` opens `?tier=desktop`, `mobile` and `mobile-low` on `chromium-webgl2` and `webkit-webgl2` Then:
  - `look().curbs.ribbons > 0` and `rampCount > 0`;
  - toggling `bump` changes the `curb-corner` frame's mean |Δ| by ≥ 0.01 on `full` and by 0 on `min`;
  - the `asphalt-low` flicker pair stays ≤ 1.1 × M02g2's baseline;
  - a ped standing on a sidewalk has its feet within 0.05 m of the ribbon top — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-curbs && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-curbs`
- AC-6 Given the regenerated goldens (`golden-update` label) When `@look-golden` and `@look-owner` run Then every shot, including `curb-corner` and `lot-plaza`, is within M02e's tolerance — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @look-golden && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-owner`
- AC-7 Given every perf scenario in fail mode and the committed ledger When `@curbs-ledger` runs flat and in the `@xr` case Then:
  - every tier stays in budget;
  - `mobile-low` stays at or under 100 render objects;
  - the object delta is 0 for `desktop`, `mobile`, `mobile-low` and `legacy`;
  - triangle deltas per L0 chunk stay at or under +20,000 on `desktop` and +4,000 on `mobile-low` — proof: `DV_WORLD=synth pnpm check:perf -- --fail && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @curbs-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-8 Given the same build When the earlier suites run Then `@world-look`, `@look-tune`, `@look-fixes`, `@world-landmarks`, `@world-route`, M02h1's suites and the XR smoke pass — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-look|@look-tune|@look-fixes|@world-landmarks|@world-route|@world-markings|@markings-golden" && DV_WORLD=synth pnpm check:e2e:xr`
- AC-9 Given the branch When the asset and IP gates run Then they pass with no new asset, provenance record or licence entry — proof: `pnpm assets:catalog && pnpm check:assets && pnpm provenance:check && pnpm ip:strings`
- AC-10 Given the production build When it is verified and deployed to a Preview Then it succeeds, `__dvBridge` is absent and the header checks pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-11 Given the merged default branch republished to staging When the operator drives Third Street and walks Civic Center Plaza in Safari and Chrome Then curbs, gutters and ramps show, the plaza differs from the sidewalks and lots, and before/after frames are in `docs/look/M02h2-sf/` — proof: manual: desktop Mac (Safari and Chrome), `pnpm deploy:prod -- --env staging`, `pnpm check:smoke -- https://tha-bay-web-staging.gratitude-8f4.workers.dev`, frames and `notes.json` committed

## Test plan
- **Unit:** `curbs.mesher`, `curbs.macro`, `curbs.walk`.
- **E2E:**
  - `@world-curbs`, `@curbs-ledger`, `@look-golden` and `@look-owner` run in the `DV_WORLD=synth` half (`--grep-invert "$GRAYBOX_GREP"`); none matches `GRAYBOX_GREP`, and the file is unchanged;
  - `@world-curbs` runs on Chromium and WebKit, `@look-owner` on `webkit-webgl2` only;
  - `@xr @curbs-ledger` runs on `xr-quest3`;
  - frame-difference cases skip on `chromium-webgpu`.
- **Perf:** AC-7. **Operator:** AC-11.

## Demo script
How to see it:
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, open `/?play=sandbox&debug=1&tier=desktop&gl=1`.
2. Console: `__dvBridge.world.shot('curb-corner')` shows curb, gutter and crosswalk ramp; `setLookLayer('curbs', false)` restores the flat edge.
3. `shot('lot-plaza')`, then toggle `lots`, `bump`, `macro`.
4. Reload with `&tier=mobile-low`: flat strips, painted curb, baked tone. Walk onto a sidewalk: feet step up.

## Effort
1 Builder session; ≈ 20 code files; risk **medium-high** (ped-edge matching on real data, `mobile-low` triangles, golden churn). Order: surfaces and config, ribbons, curb and gutter, lots and plazas, macro, bump, walk lift, goldens and ledger. Short on time: bump is cut first (BD row); curbs and sidewalks never.

## Risks & fallbacks
- **Ped edges do not line up with curb lines on `sf`:** widen the match band (data). If that fails, derive the curbed sides from `parkingSides` and the road class, with a BD row.
- **Triangles too high on `mobile-low`:** a coarser resample (8 m) on `low` and no corner fans. Never raise a budget.
- **`bumpMap` missing or broken on WebGL2:** use the finite-difference fallback and add a spec/03 §7 row.
- **Golden churn under SwiftShader:** the frame-difference cases go nightly, and the unit invariants stay in the PR suite (logged).
- **Vehicles sink 0.11 m into sidewalks:** accepted for v1 and recorded in a BD row. A physics curb would change the C08 heightfield (Architect).

## Notes for the Builder
- Read first: `02-world-living.md` §4.1, `02-world-bake.md` §6, `02-world.md` §5.2–§5.4, `11-platform.md` §4.5, M02e, M02g1, M02g2, M02h1, DL-704, DL-OWN-07.
- The target image is never committed, sampled or fed to fal. Every pattern is original code.
- The mesher stays deterministic and free of `three`. Collision, the sim and state hashes are untouched.
- Goldens: `DV_UPDATE_GOLDEN=1` outside CI, `golden-update` label, `@look-owner` before/after frames in the PR. Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` for AC-10 and AC-11 (SKIP locally). Branch `m02h2-curbs-sidewalks`.
