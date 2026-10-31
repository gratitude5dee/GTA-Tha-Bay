# M02h3 — ground-cover

## Goal
After this session the land between streets is no longer one grey paved plain. The bake sorts every 4 m land cell into seven cover classes (yard grass, dirt, mixed, driveway, vacant lot, hillside scrub, park) from OSM landuse plus a default rule: inside a residential block, not road or building, is yard. Every profile shades the classes (`legacy` through vertex colour). `sf` is re-baked and published to staging, so m.a1.01's first drive through Bayview passes yards and hillsides. DL-OWN-07 Phase 1: code only, $0 fal, no asset, 0 added render objects, no contract shape change.

## Requirements
- R-MAP-01: residential blocks, lots, parks and hillsides read as different ground at street level.
- R-PLAT-03: TSL only, on one `WebGPURenderer` (WebGPU and WebGL2).
- R-PLAT-05 (s): `mobile-low` keeps its frame budget, its 100 render objects and its 2 MiB upload cap.
- R-ENG-02: the object ledger and triangle and download budgets hold.

## Depends on
- **M02g2:** terrain normals, `aoRing()`, ground footprint fades, the ledger chain.
- **M02a2:** S5 roads (driveways leave the graph, `roadclass.json:21`), S7 grading, S13 packs, `synth` sources.
- **Run order (`_PLAN.md` §0 rule 10):** after M02h2 (`Lot`/`Plaza`, surface ids 38–41, the ledger chain).
- Merged context: M02g1 (`setLookLayer`, ledger, `@look-owner`), M02e (`surf`, `shot()`), M02c2 AC-14 (staging world release).
- Contracts: C08 1.1 (DL-741: this session lands it, LANDUSE cover codes 17–23) and C13 1.2 (read only).

## Scope in
† = design value in `config/world/cover.json`, `mesher.json` or `look.json` and their schemas.

Evidence: look study (2026-10-26) frames `desktop-03-third-st-bayview-1300-clear.png` and `desktop-06-golden-gate-park-1300-clear.png`, render audit item 4 ("most cells are Paved or Sidewalk"). Code: `s13-pack.ts:36` fills all land `Paved`, and `GROUND_OF` (`:27`) leaves residential land `Paved`; `landuseOfTags` is at `s3-water.ts:271`; `terrainMesh` (`mesher.ts:180`) sets a class per post at `:192`.

- **Cover stage** (new pure `tools/map/src/stages/s13-cover.ts`, inside S13 before GROUND is written). `CoverClass`: `none 0, yard 1, dirt 2, mixed 3, driveway 4, vacant 5, scrub 6, park 7`. Per 4 m cell centre, later rules win:
  1. `park`: the existing park polygons.
  2. `yard`: base `Paved` or `Grass` cells outside S4 footprints, inside a residential block.
     - A block is a 4-connected component of cells that are not road, rail or water, at most `blockMaxM2` † 200,000 m².
     - It is residential when `residential` landuse covers ≥ 50 % † of it, or ResLow plus ResMid are ≥ 50 % † of its building area.
  3. `mixed`: a yard cell with slope ≥ 0.18 †, or whose 16 m seeded hash is below `mixedShare` † 0.2. The share is uniform citywide, never weighted by neighbourhood.
  4. `scrub`: a `none` cell with slope ≥ 0.30 †, or a `park` cell with slope ≥ 0.35 †.
  5. `vacant`: landuse `brownfield`, `greenfield` or `construction`.
  6. `dirt`: landuse `landfill` or `quarry`, or an area tagged `surface` `dirt`, `ground` or `earth`.
  7. `driveway`: cells crossed by the centreline of each `service=driveway` way (a supercover walk; `bufferLine` widens to 8 m), over `yard`, `mixed`, `vacant` or `none` only.

  Slope: steepest graded-post gradient of the cell. Water, Pier, Asphalt, Sidewalk, Rail, Sand and Rock cells never change.
- **GROUND:** only base-`Paved` cells change (yard, mixed, scrub → `Grass`; dirt, vacant → `Dirt`; driveway stays `Paved`), all existing `GroundClass` values, so `isWater` is unchanged.
- **Pack and codec:**
  - l0 chunks write section 21 `LANDUSE` in its C08 §4 layout: run-merged rectangles, class code 16 + `CoverClass` (17–23); `L0_SECTIONS` gains 21. M01f's `decodeL0` ignores it, so older clients still load.
  - New pure `packages/shared/src/world/cover-codec.ts` (`encodeCoverRects`, `decodeCover(l0, key) → Uint8Array(4096)`); `jobs.ts:199` passes the cover in `MeshChunkOptions`.
- **Mesher:** a post with cover gets surface `cover.<class>` and colour `mesher.json` `cover.<class>` †; M02h2's `Lot`/`Plaza` rule applies only to cover-`none` posts. Same vertices and triangles, 0 added bytes. The ids are appended after the last id at rebase (42–48 after M02h2); tests key on names. Bind new surfaces or list them `procedural` in M10d0's `config/world/surface-textures.json` (data only): the `yard`, `dirt`, `mixed`, `vacant`, `scrub` and `park` covers to grass-dirt and `driveway` to concrete, or `procedural` where a set reads wrong (BD row); if this row merges before M10d0, M10d0 binds them at its rebase (DL-755).
- **Shading** (new `look/cover.ts`, called from `groundNodes`; `look.json` `ground` gains `cover.*` keys):
  - yard: mown grass, ±6 % † tone per 8 m lot; mixed: fbm grass over dirt; dirt: M02e `dirtF`; vacant: dirt, gravel, dry weeds; scrub: dry gold-green with shrub clumps; driveway: stained concrete; park: lawn.
  - `full` gets every term, `lite` one octave, `min` and `legacy` vertex colour plus roughness; noise fades with `bandFade`.
- **Switch and QA:**
  - `platform-flags.json` `world.cover` (default `true`) is the rollback switch; `setLookLayer('cover', on)` re-meshes resident chunks; `look().cover` reports `{enabled, cells}`.
  - Shots: `synth` `yard-street` and `hill-scrub`, chosen by the Builder (BD row). `sf` (not goldens): `sf-bayview-yards` at about x 2530, z 5040 and `sf-bernal-hill` at about x 410, z 4030.
- **Synth:** `synth.json` and `sources/synth.ts` add brownfield, landfill and `driveways` entries so every class has ≥ 50 cells.
- **Report:** cells per class, blocks per rule, driveways, l0 bytes; a class with 0 `sf` cells warns.
- **Ledger:** `@cover-ledger` writes `docs/look/M02h3-render-ledger.json` in M02g1's shape (`DV_LOOK_WRITE=1`); baseline = the latest merged ledger's `after`. Plan (desktop, mobile, mobile-low, legacy): +0 objects, +0 triangles.

## Scope out
- Path and Stairs ribbons: not scheduled in v1 (DL-740). Curbs, lots and plazas: M02h2. Shrubs, trees and park scatter: M02h4/M02h5. Furniture: M02h6. Licensed grass and dirt sets: M10d0.
- Widening the OSM `tagFilter` (`sources.json:168` lacks `natural=scrub|heath|grassland`) needs a raw re-fetch; scrub comes from slope.
- Map styling, grip by surface, L1/L2 cover. Story-start lighting (decision 2), HUD icons (DL-738), any fal spend.

## Deliverables
- **New:** `tools/map/src/stages/s13-cover.ts`, `packages/shared/src/world/cover-codec.ts`, `packages/world/src/client/look/cover.ts`.
- **Edits:**
  - `tools/map/src/{stages/s13-pack.ts, pack/encode.ts, bake.ts, sources/synth.ts}`;
  - `tools/map/src/config.ts` (`cover.json` in `configHashesOf`);
  - `packages/shared/src/world/{pack-codec.ts, c08.ts}` (`C08_VERSION = '1.1.0'`, DL-741), `packages/shared/src/index.ts`;
  - `packages/world/src/client/{jobs.ts, world-bridge.ts}`, `chunks/{mesher.ts, chunk-renderer.ts}`, `look/{surfaces.ts, ground.ts, config.ts, look-materials.ts}`;
  - `packages/engine/src/platform/tier-config.ts`.
- **Tests:** `tools/map/test/{cover, pack.roundtrip}.spec.ts`, `packages/shared/test/world.cover-codec.spec.ts`, `packages/world/test/cover.mesher.spec.ts`, `tests/e2e/world-cover.spec.ts` (`@world-cover`, `@cover-ledger`, `@xr @cover-ledger`).
- **Data (not counted):** `config/world/cover.json` and its schema; `mesher.json`, `look.json`, `look-shots.json`, `synth.json` and schemas; `platform-flags.json`; goldens, ledger, BD rows; the operator run's `assets/world/*`, `offerUrl` and attribution.
- About 23 code files. No new script, dependency or asset.

## Interfaces
- C08 1.1 (`02-world-contracts.md` §8, 06 v1.5, DL-741): this session writes `C08_VERSION = '1.1.0'`, so `WorldIndex.c08` reads `'1.1.0'`, and section 21's class list gains the cover codes 17–23 in the same layout; `DVWP` stays 1. C13 1.2 is read. `CoverClass`, the codec, the surface ids, config and bridge fields are S02 internals.
- Contract change proposals: none beyond C08 1.1, which the Architect has made.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 and no new file holds GLSL or `ShaderMaterial` — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given hand-built rasters When the cover cases run Then the seven rules and their order hold, protected classes never change, a driveway is one cell wide, `mixed` is within ±0.02 of `mixedShare` on 1 km², and `buildPacks` with cover on and off differs only in GROUND on base-`Paved` cells — proof: `pnpm check:unit -- tools/map`
- AC-3 Given random grids and the `synth` packs When the codec cases run Then the cover round-trips exactly, `decodeL0` returns identical chunks with and without section 21, a pack without it decodes to all `none`, the `synth` `WorldIndex.c08` is `'1.1.0'`, and a 1.0 index with classes above 16 skips them — proof: `pnpm check:unit -- packages/shared`
- AC-4 Given the `synth` sources When the bake runs twice Then the outputs are identical, the `bakeId` is new, every class has ≥ 50 cells and no l0 pack exceeds 2.5 MiB — proof: `pnpm map:build -- --area synth --repro && pnpm check:unit -- tools/map`
- AC-5 Given the `synth` bake When the mesher runs twice per profile with cover on and off Then runs are byte-identical, posts carry their `cover.*` ids, cover-off output equals the parent commit's, vertex, triangle and object counts match on and off, and no `mobile-low` L0 unit exceeds 2 MiB — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world/test/cover.mesher.spec.ts`
- AC-6 Given a QA `synth` build When `@world-cover` opens `?tier=desktop`, `mobile` and `mobile-low` on `chromium-webgl2` and `webkit-webgl2` Then `look().cover.cells` is > 0 for all seven classes across `yard-street` and `hill-scrub`, and the `cover` layer toggle changes the `yard-street` frame's mean |Δ| by ≥ 0.02 and leaves render objects unchanged — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-cover && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-cover`
- AC-7 Given the look goldens regenerated for the new `synth` `bakeId` (`golden-update` label), plus both shots at `desktop` and `mobile-low` When every committed look golden set (`_PLAN-3.md` Look program rule 6: every committed look golden set) and `@look-owner` run Then every shot is within M02e's tolerance — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@look-golden|@markings-golden|@textures-golden|@facade-golden" && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-owner`
- AC-8 Given every perf scenario in fail mode and the ledger When `@cover-ledger` runs flat and in the `@xr` case Then every tier stays in budget, `mobile-low` stays ≤ 100 render objects, object and triangle deltas are 0 for `desktop`, `mobile`, `mobile-low` and `legacy`, and `xr` equals its baseline — proof: `DV_WORLD=synth pnpm check:perf -- --fail && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @cover-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-9 Given the same build When the earlier suites run Then `@world-hash` passes with no golden regenerated, and `@world-look`, `@world-sky`, `@world-route`, `@world-boot-size` and the XR smoke pass — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-hash|@world-look|@world-sky|@world-route|@world-boot-size" && DV_WORLD=synth pnpm check:e2e:xr`
- AC-10 Given the branch When the asset and IP gates run Then they pass with no new asset or licence entry — proof: `pnpm assets:catalog && pnpm check:assets && pnpm provenance:check && pnpm ip:strings`
- AC-11 Given the production build When it is verified and deployed to a Preview Then it succeeds and `__dvBridge` is absent — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-12 Given an operator workstation with the M02a1 `sf` snapshot and the media R2 secrets When the operator re-bakes and publishes `sf` to staging Then `--repro` is identical, the report gives cells per class, no l0 pack exceeds 2.5 MiB, the staging catalog names the new `bakeId`, both checks pass, and New Game to the m.a1.01 truck stage in Safari and Chrome shows yards, driveways and scrub (cover-off and cover-on frames in `docs/look/M02h3-sf/`) — proof: manual: operator workstation and a desktop Mac (Safari, Chrome), `pnpm map:build -- --area sf --repro`, `pnpm map:pack -- --area sf --target r2:staging`, `pnpm assets:publish -- --env staging --world assets/world/sf.lock.json --pointer-out assets/world/pointer.staging.json`, update `offerUrl` and attribution, merge, `pnpm deploy:prod -- --env staging`, record `docs/bake-runs/M02h3/staging.json`, then `pnpm provenance:check && pnpm check:smoke -- https://tha-bay-web-staging.gratitude-8f4.workers.dev`

## Test plan
- **Unit:** `cover`, `pack.roundtrip`, `world.cover-codec`, `cover.mesher`.
- **E2E:** `@world-cover`, `@cover-ledger`, `@look-golden` and `@look-owner` run in the `DV_WORLD=synth` half; none matches `GRAYBOX_GREP` (unchanged). `xr-quest3` runs `@xr @cover-ledger`.
- **Perf:** AC-8. **Operator:** AC-12.

## Demo script
How to see it:
1. Run `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev` and open `/?play=sandbox&debug=1&tier=desktop`.
2. In the console, `__dvBridge.world.shot('yard-street')` shows yards, driveways and worn patches.
3. `__dvBridge.world.setLookLayer('cover', false)`, then `true`: grey paving versus cover. `shot('hill-scrub')`: scrub on the slope.
4. Reload with `&tier=mobile-low&gl=1`: vertex colours.
5. For `sf`, serve `DV_WORLD=sf VITE_DV_QA=1 pnpm build` and run `shot('sf-bayview-yards')`.

## Effort
1 Builder session; about 23 code files; risk **medium** (flood fill on `sf`, pack growth, golden churn). Order: stage, pack and codec, synth, mesher, shading, QA and goldens, ledger, operator handoff. Short on time: `mixed` and `scrub` fall back to `yard` and `none` (data, BD row).

## Risks & fallbacks
- **Flood fill too large on `sf`:** label blocks per z7 tile with a 64 m overlap.
- **l0 over 2.5 MiB:** merge rectangles across rows, then derive `mixed` on the client from the same hash.
- **OSM residential gaps:** the footprint-kind half of the block rule covers them.

## Notes for the Builder
- Read first: `02-world-bake.md` §4, §6; `02-world-contracts.md` §2, §4; M02e, M02g1, M02g2, M02h2, M02c2 AC-14; DL-OWN-07.
- OSM tag meanings here are UNVERIFIED in the ledger: record their wiki pages in spec/03 §7; the bake counts are the check. Gap to report: `landuseOfTags` maps `natural=beach|bare_rock`, which the `tagFilter` never fetches.
- Original procedural code only; the target image is never committed; since DL-OWN-10 the owner's look references may be used as look inputs (a fal reference input, a side-by-side comparison, a palette), read from outside the repository.
- The sim is untouched (`@world-hash`); the mesher stays deterministic and `three`-free. Goldens: `DV_UPDATE_GOLDEN=1` outside CI.
- Secrets: Cloudflare (AC-11, AC-12), `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` (AC-12); absent: SKIP, AC-12 under "Blocked on". Branch `m02h3-ground-cover`.
