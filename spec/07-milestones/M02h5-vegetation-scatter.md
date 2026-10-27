# M02h5 — vegetation-scatter

## Goal
Golden Gate Park stops being "an open lawn with a dozen tiny cones" (look study, `desktop-06-golden-gate-park-1300-clear.png`). This is DL-OWN-07 Phase 1, second vegetation session:
- seeded Poisson tree scatter over OSM wood and forest, and groves in parks;
- a shrub and hedge layer;
- correct street-tree density;
- opaque impostors at distance;
- an `sf` re-bake and staging publish that also carries M02h4's forms.

Code only: $0 fal, no asset, no contract shape change.

## Requirements
- R-MAP-01: parks, woods and hillsides read as vegetated SF ground.
- R-PLAT-03: TSL on one `WebGPURenderer`; no alpha test or transparency.
- R-PLAT-05 (s): `mobile-low` keeps 100 objects, its triangle budget and its 2 MiB upload cap.
- R-ENG-02: a render-object ledger per profile against the measured baseline; `check:perf` green.

## Depends on
- **M02h4:** `TreeForm`, `tree-forms.json`, 6-float tree records, per-unit pools (10/5/2), `look().vegetation`, bake tool `0.4.0`.
- **M02h3:** `CoverClass` (`yard`, `scrub`, `park`), `s13-cover.ts`, the `sf` publish route of its AC-12.
- Through them: M02g2, M02g1 (ledger, `@look-owner`), M02e (`shot()`), M02a2.
- Contracts: C08 1.1 (DL-741; record 22 TREE `i16 dx, i16 dz, u8 scale, u8 species` as a `TreeForm`; `RenderChunk.trees`) and C13 1.2, shapes unchanged.

## Scope in
† = design value in `config/world/vegetation.json` (bake) or `look.json` `vegetation` (client), with schemas.

Code: `sources.json:168` fetches only `natural=coastline,water,tree`; `s3-water.ts:269` folds `landuse=forest` into `grass`; OSM trees (`:346`) and DataSF rows (`:357`) are never de-duplicated.

- **Form byte** (`tree-form.ts`): bits 0–2 hold the form (M02h4's 0–4, plus `Shrub 5`, `Hedge 6`); bit 7 marks scatter. Heights † Shrub 0.6/1.2/2.5 m, Hedge 0.9/1.4/2.2 m.
- **OSM:**
  - `tagFilter` gains `natural=tree_row,wood,scrub` and `nwr/barrier=hedge`;
  - `map:fetch -- --area sf --only osm --no-download` re-runs only the osmium steps from the cached extract (`extract.sha256` unchanged);
  - S3 emits `vegetationPolys` (`wood` from `natural=wood` and `landuse=forest`; `scrub`) and hedge and tree-row lines, never into `landuse` or section 21.
- **Scatter** (new pure `stages/s13-scatter.ts`, `geom/poisson.ts`), in S13 after M02h3's cover:
  - Bridson per polygon, seeded `fnv32(bakeSeed|polyId)` with `@dv/shared` `xoshiro128**` and detmath, in id order against one spatial hash;
  - **wood:** `rMin` 6 m †, mix Eucalyptus 0.45 / Conifer 0.40 / Plane 0.15 †; understory shrubs `rMin` 3.5 m †, share 0.5 †;
  - **park** (M02h3 `park` cells outside wood): groves of 3–9 † trees, centres `rMin` 45 m †; edge shrubs 0.3 †; lawns stay open; `leisure=pitch|playground` excluded;
  - **scrub:** shrubs `rMin` 3 m †, share 0.6 †;
  - **hedges:** a block every 0.9 m † on `barrier=hedge`; yard frontage cells get a run when their 8 m lot hash < `hedgeShare` 0.12 † (uniform citywide); yard shrubs 0.08 † per cell;
  - **exclusions:** footprints + 1.5 m, roads + 2 m, ped edges + 1 m, water, piers, Sand, Rock, landmark proxies.
- **Street-tree density:** OSM trees within 3 m † of a DataSF tree are dropped; `tree_row` gets a tree every 8 m †; DataSF species in `tree-forms.json` `skipSpecies` are dropped (tuned from M02h4's `treeUnmatched`); street trees are never thinned.
- **Report and id:** `bake-report.json` gains `scatter` (m² and counts per kind) and `streetTrees` (trees per km of sidewalk per neighbourhood; 0 warns). `vegetation.json` joins `configHashesOf`; `TOOL_VERSION` → `0.5.0`.
- **Impostors** (new `chunks/impostors.ts`): opaque cards turned to the camera about Y by a TSL `positionNode`, `crown` (8 triangles) and `palm` (12). No texture, offscreen render, `alphaTest`, alpha-to-coverage or `transparent`; never casting.
- **Bands** (`vegetation-pool.ts`):
  - within `tree.drawM` every instance draws once, as a mesh inside `impostorM` † (150/80/50 m desktop/mobile/mobile-low, 10 % hysteresis), otherwise as an impostor;
  - re-banded after 16 m † of travel or on a unit landing, crossing units only; ≤ 4,096 † instance writes per frame, counted against the upload cap;
  - shrubs and hedges within `shrubDrawM` † 250/120/80 m.
- **Pools added:** `full` shrub, hedge, `crown`, `palm` (+4); `lite` shrub, `crown`, `palm` (+3); `low` on `min` `crown` only (+1; shrubs and hedges are flattened instances in M02h4's `crown` pool); `low` on `legacy` (XR, `world.look: false`) +0, no impostors.
- **Thinning** (bit 7 only, positional hash): `scatterKeep` † 1/0.7/0.5/0.35 and `shrubKeep` † 1/0.6/0.3/0.25 for full/lite/min/legacy.
- **Switch and QA:** `world.scatter` flag (default `true`; `false` skips bit 7 and impostors) in `tier-config.ts`; `setLookLayer('scatter' | 'impostors', on)`; `look().vegetation` gains impostor, shrub, hedge, band-write and per-pool triangle counts. Synth shot `park-forest` (13:00 `clear`) at `desktop` and `mobile-low`. `sf` shots, not goldens: `sf-ggp-woods` about x −4960, z 1090; `sf-presidio-woods` about x −3580, z −1350 (BD row).
- **Synth** gains one case of every source above.
- **Ledger:** `@scatter-ledger` writes `docs/look/M02h5-render-ledger.json` in M02g1's shape (`DV_LOOK_WRITE=1`); the baseline is M02h4's `after`. Plan: objects `desktop` ≤ +4, `mobile` ≤ +3, `mobile-low` ≤ +1 (≤ 100 total), `legacy` and `xr` +0; `park-forest` vegetation triangles ≤ 1.2M / 250k / 60k †.

## Scope out
- Vegetation collision (unowned).
- Canopy tint on L1/L2, shrub wind, invented street-tree infill; EZ-Tree and licensed vegetation (M10d0 on); `xr` profile (M02h8).
- No fal or scan; the target image is never committed, sampled or fed to fal.

## Deliverables
- **New:** `tools/map/src/stages/s13-scatter.ts`, `tools/map/src/geom/poisson.ts`, `packages/world/src/client/chunks/impostors.ts`.
- **Edits:** `packages/shared/src/world/tree-form.ts`; `tools/map/src/{stages/s3-water.ts, stages/s13-pack.ts, stages/s0-fetch.ts, cli.ts, config.ts, bake.ts, sources/synth.ts}`; `packages/world/src/client/{chunks/tree-forms.ts, chunks/vegetation-pool.ts, chunks/mesher.ts, chunks/chunk-renderer.ts, look/look-materials.ts, look/config.ts, world-bridge.ts}`; `packages/engine/src/platform/tier-config.ts`.
- **Tests:** `tools/map/test/{scatter, poisson, fetch.only-osm}.spec.ts`, `packages/shared/test/tree-form.spec.ts`, `packages/world/test/{veg.impostors, veg.bands}.spec.ts`, `tests/e2e/world-scatter.spec.ts` (`@world-scatter`, `@scatter-ledger`, `@xr @scatter-ledger`).
- **Data (not counted):** the config files above with schemas, goldens, ledger, BD rows, the operator run's outputs.
- No new script (`--only`, `--no-download` are `map:fetch` flags), dependency or asset; ≈ 25 code files.

## Interfaces
- C08 1.1 and C13 1.2 keep their shapes. The `TreeForm` byte of C08 1.1 (`02-world-contracts.md` §8) gains its `Shrub 5`, `Hedge 6` and bit-7 scatter values here (DL-741). Packs and client ship together.
- Contract change proposals: none to shapes.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 and no new or edited client file holds GLSL, `ShaderMaterial`, `alphaTest`, `alphaToCoverage` or `transparent: true` — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given hand-built polygons and the `synth` sources When the scatter, Poisson and form cases run and the bake runs twice Then:
  - same-layer points are ≥ `rMin` apart, and 1 km² of wood is within ±10 % of target density;
  - no point is in an exclusion or pitch, lawns between groves are empty, and hedge blocks are 0.9 m apart;
  - the duplicate and `skipSpecies` trees are gone, and the tree row has a tree every 8 m;
  - bit 7 is set on scatter records only;
  - shuffled polygon order gives identical packs, `--repro` is identical, the `bakeId` is new, l0 packs are ≤ 2.5 MiB, and the report has `scatter` and `streetTrees`
  - — proof: `pnpm map:build -- --area synth --repro && pnpm check:unit -- tools/map packages/shared`
- AC-3 Given an injected osmium shell and download When `map:fetch --only osm --no-download` runs with and without a cached extract Then with it only the osmium steps run and only the `osm` lock entry changes (same `extract.sha256`); without it the command exits non-zero naming the extract, with no download call — proof: `pnpm check:unit -- tools/map/test/fetch.only-osm.spec.ts`
- AC-4 Given 300 scripted camera moves and unit adds and removals When `veg.bands` and `veg.impostors` run per set Then:
  - within `drawM` each instance draws once, as a mesh inside `impostorM` (±10 %), otherwise as an impostor;
  - no frame exceeds the write cap, and thinning touches bit-7 records only, identically across runs;
  - pools added are 4/3/1/0 for `full`/`lite`/`min`/`legacy`; impostors are 8 and 12 triangles, opaque, non-casting
  - — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world`
- AC-5 Given a QA `synth` build When `@world-scatter` runs `shot('park-forest')` at `desktop`, `mobile` and `mobile-low` on `chromium-webgl2` and `webkit-webgl2` Then `look().vegetation` reports impostors, shrubs and hedges > 0 and band writes within the cap; the `scatter` layer toggle changes mean |Δ| by ≥ 0.02; `world.scatter: false` reports no scatter instances or impostor pool — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-scatter && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-scatter`
- AC-6 Given goldens regenerated for the new synth `bakeId` (`golden-update` label), `park-forest` at `desktop` and `mobile-low` included When `@look-golden` and `@look-owner` run Then every shot is within M02e's tolerance and two `park-forest` captures are byte-identical — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @look-golden && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-owner`
- AC-7 Given the same build When the earlier suites run Then `@world-hash` passes with no golden regenerated, and `@world-trees`, `@world-cover`, `@world-look`, `@world-route`, `@world-boot-size` and the XR smoke pass — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-hash|@world-trees|@world-cover|@world-look|@world-route|@world-boot-size" && DV_WORLD=synth pnpm check:e2e:xr`
- AC-8 Given every perf scenario in fail mode and the committed ledger When `@scatter-ledger` runs flat and in the `@xr` case Then every tier is in budget (shadow passes counted), object deltas are ≤ +4 `desktop`, ≤ +3 `mobile`, ≤ +1 `mobile-low` (≤ 100 total), `legacy` and `xr` equal their baseline, and `park-forest` vegetation triangles are ≤ 1.2M / 250k / 60k — proof: `DV_WORLD=synth pnpm check:perf -- --fail && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @scatter-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-9 Given the branch When the asset, IP and licence gates run Then they pass with no new asset, provenance record, licence entry or dependency — proof: `pnpm assets:catalog && pnpm check:assets && pnpm provenance:check && pnpm ip:strings && pnpm license:scan`
- AC-10 Given the production build When it is verified and deployed to a Preview Then it succeeds, `__dvBridge` is absent and the header checks pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-11 Given an operator workstation with the `sf` raw cache and media R2 secrets When the operator re-derives OSM, re-bakes and publishes `sf` to staging Then `extract.sha256` is unchanged, `--repro` is identical, the report shows wood m² > 0, the staging catalog names the new `bakeId`, and in Safari and Chrome at `desktop` and `?tier=mobile-low` `sf-ggp-woods` and `sf-presidio-woods` show forest with impostors at ≤ 100 objects on `mobile-low` (frames and `notes.json` in `docs/look/M02h5-sf/`) — proof: manual: operator workstation and a desktop Mac (Safari, Chrome), `pnpm map:fetch -- --area sf --only osm --no-download`, `pnpm map:build -- --area sf --repro`, `pnpm map:pack -- --area sf --target r2:staging`, `pnpm assets:publish -- --env staging --world assets/world/sf.lock.json --pointer-out assets/world/pointer.staging.json`, update `offerUrl`, merge, `pnpm deploy:prod -- --env staging`, record `docs/bake-runs/M02h5/staging.json`, then `pnpm provenance:check && pnpm check:smoke -- https://tha-bay-web-staging.gratitude-8f4.workers.dev`

## Test plan
- **Unit:** `scatter`, `poisson`, `fetch.only-osm`, `tree-form`, `veg.bands`, `veg.impostors`.
- **E2E:** all new tags run in the `DV_WORLD=synth` half (`--grep-invert "$GRAYBOX_GREP"`); none matches `GRAYBOX_GREP` (unchanged). `@scatter-ledger` and `@look-golden` on `chromium-webgl2`, `@look-owner` on `webkit-webgl2`, `@xr @scatter-ledger` on `xr-quest3`.
- **Perf:** AC-8. **Operator:** AC-11.

## Demo script
How to see it:
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`; open `/?play=sandbox&debug=1&tier=desktop&gl=1`.
2. `__dvBridge.world.shot('park-forest')`: woods with understory, groves on lawn, a hedged yard, impostors past 150 m.
3. `setLookLayer('impostors', false)`, then `setLookLayer('scatter', false)`: far trees go, then only street trees remain.
4. `&tier=mobile-low`: one impostor pool, thinned woods.

## Effort
0.75 Builder session; ≈ 25 code files; risk **medium** (`sf` instance counts, band churn, goldens). Short on time: `hedgeShare` 0 (BD row); never cut impostors.

## Risks & fallbacks
- **No OSM re-derivation:** wood from `landuse=forest` and DataSF parks only (BD row).
- **Triangles or writes over budget on `sf`:** lower `scatterKeep`, then `impostorM`, then wood `rMin` to 8 m; never raise a budget.
- **l0 over 2.5 MiB:** raise understory `rMin`.
- **Billboard fails on WebGL2:** fixed opaque crossed cards, spec/03 §7 row.

## Notes for the Builder
- Read first: `02-world-bake.md` §4–§6, `02-world-contracts.md` (record 22, §4), `02-world.md` §5.2–§5.4, `11-platform.md` §4.5, M02h4, M02h3, DL-OWN-06, DL-OWN-07.
- Evidence (look study 2026-10-26): capture "Vegetation"; render audit item 6(b) (impostors past about 120/60/40 m, no alpha test on tile GPUs or Quest); plan Phase 1.
- OSM tag meanings are not in the ledger: record wiki pages in spec/03 §7. Form mixes are design values.
- Verify detmath and RNG export names and `positionNode` billboarding on `three@0.186.1`; the sim is untouched.
- Secrets: Cloudflare (AC-10, AC-11), `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` (AC-11); absent: SKIP, AC-11 under "Blocked on". Branch `m02h5-vegetation-scatter`.
