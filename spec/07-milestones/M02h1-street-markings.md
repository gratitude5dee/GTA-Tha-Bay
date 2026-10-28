# M02h1 — street-markings

## Goal
After this session the streets carry paint. L0 road ribbons get a per-vertex `road` attribute from the C08 lane data, and a `markings` look layer draws:
- dashed lane lines, a double-yellow centre line, edge lines, parking Ts and a bus-lane tint;
- crosswalk and stop-bar quads;
- a plain junction patch, where ribbons now end instead of overlapping.

Lines use `fwidth` antialiasing and fade with distance, so nothing sparkles. `full` and `lite` add worn paint; `mobile-low` and XR draw flat paint. 0 render objects, $0 fal, no asset, no contract change. First file of the street-realism phase (DL-OWN-07 (1)).

## Requirements
- R-MAP-01: lane lines, crosswalks and stop bars make the SF grid read as streets.
- R-PLAT-02 (part): Quest and Vision Pro get the same markings in the flat profile.
- R-PLAT-03: TSL only, on WebGPU and on the WebGL2 fallback.
- R-PLAT-05 (s): the iPhone 15 at `mobile-low` keeps its frame budget.
- R-ENG-02: a render-object ledger per profile; `check:perf` stays green.

## Depends on
- **M02g2:** the `roads` material with depth bias, the rank lifts, footprint fades, `tests/support/flicker.ts` and `docs/look/M02g2-render-ledger.json` (the ledger chain).
- **M02a2:** `RoadEdge` (`lanes`, `laneWidthM`, `medianM`, `parkingSides`, flags), `Junction` (`control`, `stopApproaches`), `PedEdge` `Crosswalk` (`widthM`), and the synth roads.
- Through M02g2: M02g1 (`layers`, `setLookLayer`, ledger shape, asphalt albedo) and M02e (surface table, `shot()`, goldens).
- Contracts: C08 1.0 and C13 1.2, read unchanged.

## Scope in
- **Pure layout** (`look/road-layout.ts`, new, no `three`):
  - `packRoad(seg, edges)` returns lanes each way, lane width, parking sides, median, flags and `markClass`.
  - Lane width is rescaled so that median + lanes × width + parking × 2.4 m † equals `seg.widthM`.
  - `markClass` from `look.json` `markings.byClass` †: freeway and ramp edges and dashes; arterial and collector double yellow; local double yellow if two-way and ≥ 9 m wide; service nothing.
  - `markingAt(layout, s, t)`: the TS reference of the shader rules.
- **Mesher** (`mesher.ts` `addRibbon`, lines 436–462; road loop, lines 548–556):
  - Every road vertex gets `road`, an `Int16x4` uploaded normalised like `facade`: `x` decimetres along the segment, wrapped at 2,880 m (a multiple of every period); `y` centimetres from the centreline, + left of `dir 1`; `z` lane width (0.05 m steps) and median (0.5 m); `w` lanes each way, parking sides, the `OneWay`, `Divided`, `BusLane`, `NoParking` bits and `markClass`.
  - **Junction patch** (`chunks/junction-patch.ts`, new, pure): at junctions of three or more segments, ribbons are clipped at the largest incident half-width + 1.0 m † from the node, and the convex hull of the clipped corners becomes surface `Junction` at their highest lift, replacing M02g2's rank-lift overlap there.
  - **Crosswalks:** one quad per `Crosswalk` ped edge, `widthM` wide, lifted 0.02 m † (`decalLiftM`), surface `Crosswalk`. A ladder pattern at `Signal` junctions, two transverse lines elsewhere †.
  - **Stop bars:** for each `stopApproaches` edge and each signal `inEdge`, a bar 0.40 m † deep from the centreline to the curb, 1.2 m † behind the crosswalk, surface `StopBar`.
  - New surface ids: `Junction` 35, `Crosswalk` 36, `StopBar` 37. `SURFACE_COUNT` (surfaces.ts:39) becomes 38; M02h2 takes 38–39.
  - Bind new surfaces or list them `procedural` in M10d0's `config/world/surface-textures.json` (data only): `Junction` to asphalt, `Crosswalk` and `StopBar` procedural. If this row merges before M10d0, M10d0 binds them at its rebase (DL-755).
  - All inside the L0 `roads` object (≤ 6 objects per chunk); byte-identical across runs; `meshBytes` counts +8 B per road vertex; L1/L2 unchanged.
- **Shader** (`look/markings.ts`, new, in M02g2's `roads` material at `look-materials.ts:152`):
  - `paintAA(d, halfW, fp)` takes its coverage from `fwidth(d)`. Once `pixelFootprint` is wider than the line, it blends to the line's mean coverage, never to 0. That blend is the distance fade.
  - Line rules †: dashes 0.10 m, 3 m on and 9 m off; double yellow (two 0.10 m lines, 0.10 m gap), yellow median edges on `Divided`; edge lines on freeway, ramp and arterial; Ts every 6 m unless `NoParking`; a red tint on the rightmost lane with `BusLane`.
  - `worn` mode (`full`, `lite`): `vnoiseAA` wear and paint roughness 0.6 †.
  - `flat` mode (`min`, XR): colour from `paintAA` only, with no noise or roughness change.
  - Original paint colours in `markings.paint`, darkened by `uWet`.
- **Layer:** `markings` joins M02g1's `layers` for `full`, `lite`, `min` and `legacy`.
  - On `legacy` it draws only on the XR tiers, as `flat`, through a legacy roads material beside `chunk` (`chunks/materials.ts:94`).
  - `setLook(false)` and `world.look: false` still report `layers: []`.
- **Bridge (QA):** `look().markings` `{ mode: 'worn' | 'flat' | 'off', roadVerts, patches, crosswalks, stopBars }`; `setLookLayer('markings', on)`; a debug toggle `markings.aa` turns AA and fade off, to prove the flicker check detects sparkle.
- **Shots:** `markings-near` (a synth four-lane signalised junction, 13:00 `clear`); `markings-graze` and `-b`, 0.05 m apart (a straight at 300 m, 1.6 m eye height).
- **Goldens:** both shots at `desktop`, `mobile-low` and `xr-quest` (forced on the flat canvas, no immersive session): 6 PNGs at 256 × 144 in the look manifest.
- **Ledger:** `@markings-ledger` writes `docs/look/M02h1-render-ledger.json` in M02g1's shape with `perLayer.markings`; baseline the `after` of the ledger most recently merged at rebase, named in `baselineFrom` (M02g2's or M10d0's), `xr` from `__dvBridge.perf.live()`. Plan: +0 objects on every profile, road triangles ≤ +10 % †.
- **Checklist:** `tools/ci/checklists/M02h1-iphone15.json`.

## Scope out
- Curbs, gutters and sidewalks: M02h2. Ground cover: M02h3. Trees: M02h4/M02h5. Furniture and parked cars: M02h6. Façades: M02h7.
- The `xr` profile (it takes over the legacy markings) and TRAA: M02h8. Textures: M10d0.
- Painted text and arrows, manholes, patching: not scheduled. No bake change or re-bake; physics unchanged.

## Deliverables
- **New:** `packages/world/src/client/look/{road-layout.ts, markings.ts}`, `packages/world/src/client/chunks/junction-patch.ts`.
- **Edits:**
  - `packages/world/src/client/chunks/{mesher.ts, mesh-types.ts, chunk-renderer.ts, materials.ts}`;
  - `packages/world/src/client/look/{surfaces.ts, config.ts, look-materials.ts, look-view.ts}`;
  - `packages/world/src/client/world-bridge.ts`, `packages/engine/src/client/debug/sim-panel.ts`.
- **Tests:** `packages/world/test/{markings.layout.spec.ts, markings.mesh.spec.ts, markings.config.spec.ts}`; `tests/e2e/world-markings.spec.ts` (`@world-markings`, `@markings-golden`, `@markings-ledger`, `@xr` cases); `tests/support/flicker.ts` (a region mask).
- **Data (not counted):** `look.json` and its schema, `look-shots.json`, the goldens, the ledger, the checklist and the BD rows.
- No new script, dependency, asset or provenance record.
- ≈ 20 code files: 3 new, 10 edits, 6 tests and support (with `look.no-fetch`).

## Interfaces
- C08 1.0 and C13 1.2 read unchanged; the `road` attribute, ids 35–37, `LookFile.markings`, the layer and bridge fields are S02 internals. Contract change proposals: none.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 and the new files hold no GLSL or `ShaderMaterial` — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given `look.json` and the synth edges When the layout tests run Then:
  - the file validates, and `layers` lists `markings` for `full`, `lite`, `min` and `legacy`;
  - `packRoad` round-trips every field, and lane widths sum to `widthM` within 0.05 m;
  - `markingAt` draws a double yellow only on two-way roads of its class, nothing on `service`, the bus tint only with `BusLane`, and no T with `NoParking`
  - — proof: `pnpm check:unit -- packages/world`
- AC-3 Given the synth bake When every L0 chunk is meshed twice per profile Then:
  - the buffers are byte-identical, and every road vertex has `road`;
  - each junction with three or more segments has one convex patch, with no clipped ribbon vertex more than 0.05 m inside it;
  - crosswalk quads equal the `Crosswalk` ped edges, and stop bars equal the approaches;
  - ids stay below 38, objects ≤ 6 per chunk, and no `mobile-low` chunk exceeds the upload cap
  - — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world`
- AC-4 Given a QA synth build When `@world-markings` opens `?play=sandbox` at `desktop`, `mobile` and `mobile-low` on `chromium-webgl2` and `webkit-webgl2` Then `look().markings.mode` is `worn`, `worn` and `flat`, the counts are > 0 at `markings-near`, and `setLook(false)` reports `off` with `layers: []` — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-markings && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-markings`
- AC-5 Given the committed goldens When `@markings-golden` captures the 6 shots on `chromium-webgl2` Then:
  - each is within M02e's tolerance, and two captures are byte-identical;
  - at 640 × 360, the `markings-graze` pair flickers on ≤ 0.2 % † of road pixels at `desktop`, `mobile-low` and `xr-quest`;
  - with `markings.aa` off, the pair exceeds that bound
  - — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @markings-golden`
- AC-6 Given the committed ledger When `@markings-ledger` toggles the layer, flat and in the `@xr` case Then `baseline` equals the `after` named in `baselineFrom`, the markings delta is 0 objects on every profile, `mobile-low` `after` ≤ 100, `xr` `after` equals `baseline`, and road triangles grow ≤ 10 % — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @markings-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-7 Given the same build When every perf scenario runs in fail mode Then every flat tier is within budget — proof: `DV_WORLD=synth pnpm check:perf -- --fail`
- AC-8 Given the regenerated look goldens (`golden-update` label) When the earlier suites run Then `@look-golden`, `@textures-golden` once M10d0 has merged (`_PLAN-3.md` Look program rule 6: every committed look golden set), `@look-fixes`, `@world-look`, `@world-sky`, `@world-route` and `@world-backdrop` pass, and `@xr @world-markings` reports `flat` on `xr-quest3` — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@look-golden|@textures-golden|@look-fixes|@world-look|@world-sky|@world-route|@world-backdrop" && DV_WORLD=synth pnpm check:e2e:xr`
- AC-9 Given the untouched sim When the determinism suites run Then the state hashes equal the parent commit's — proof: `pnpm --filter @dv/engine test:determinism && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-hash`
- AC-10 Given the branch When the asset and IP gates run Then they pass with no new asset, texture, provenance or licence entry — proof: `pnpm assets:catalog && pnpm check:assets && pnpm provenance:check && pnpm ip:strings`
- AC-11 Given the production build When it is verified and deployed to a Preview Then it succeeds, `__dvBridge` is absent and the header checks pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-12 Given an operator synth Preview on an iPhone 15 Home Screen app at `mobile-low` When the checklist walks `walk-civic-center` with markings on, then off Then `perf:verify` passes and `notes.json` records the frame-median delta — proof: manual: iPhone 15 (Home Screen app), operator Preview from `pnpm map:build -- --area synth && DV_WORLD=synth VITE_DV_QA=1 pnpm build && pnpm deploy:preview`, `pnpm perf:checklist -- tools/ci/checklists/M02h1-iphone15.json`, upload to `docs/device-runs/M02h1/iphone15/`, then `pnpm perf:verify -- docs/device-runs/M02h1/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M02h1-iphone15.json`

## Test plan
- **Unit:** `markings.layout`, `markings.mesh` (patch, quads, bytes, determinism), `markings.config` and `look.no-fetch`.
- **E2E:** `@world-markings` on Chromium and WebKit; `@markings-golden` and `@markings-ledger` on `chromium-webgl2` only (`test.skip` elsewhere); `@xr` cases on `xr-quest3`.
- **CI split:** every new tag runs in the `DV_WORLD=synth` half (`--grep-invert "$GRAYBOX_GREP"`). None matches `GRAYBOX_GREP`, which is unchanged, and `@world-markings` does not select `@markings-*`.
- **Perf:** AC-6 and AC-7. **Device:** AC-12.

## Demo script
How to see it:
1. Run `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, then open `/?play=sandbox&debug=1&tier=desktop&gl=1`.
2. Console: `__dvBridge.world.shot('markings-near')`: dashes, double yellow, crosswalks, stop bars, a clean junction.
3. `shot('markings-graze')`, then `shot('markings-graze-b')`: far lines become a soft tint. Toggle `markings.aa` off to see the sparkle.
4. Reload with `&tier=mobile-low`, then `&tier=xr-quest`: flat paint. The debug panel switches the `markings` layer.

## Effort
1 Builder session; ≈ 20 code files; risk **medium** (junction clipping, decal z-fight, sparkle). Order: layout, mesher and patch, `flat` then `worn`, layer and bridge, goldens, ledger, perf.

## Risks & fallbacks
- **Decals z-fight far away:** fade the quads past 250 m † (`decalFarM`); else draw crosswalks and stop bars in the shader from patch coordinates (BD row).
- **Hull fails** (curved approach, layered node): skip that patch, keep M02g2's lifts, count the skips.
- **No flat `xr-quest` capture:** that golden moves to M02h8, and the `@xr` bridge state proves `flat` (DL row).
- **Upload cap at `mobile-low`:** drop `road` beyond 120 m † first.
- **Flicker bound missed:** start the fade earlier (data); never loosen the bound.

## Notes for the Builder
- Read first: `02-world-contracts.md` §3–§4, `02-world-living.md` §4.1, and the M02e, M02g1 and M02g2 files.
- Study anchors (look study, 2026-10-26; render audit area 1): `mesher.ts:436` (`ROAD_LIFT_M`), `:439` (`addRibbon`, no road coordinates), `:548–556`; `look-materials.ts:152` (roads share the terrain material); `chunk-renderer.ts:304`; `noise.ts:57` (`edgeLineAA` fades to 0, unfit for paint). Capture frames `desktop-03-third-st-bayview-1300-clear.png` and `staging-prod-autotier-mobile-low-02-intro.png`.
- Original content only († = design values; no text, sign faces or logos). The target image is never committed, sampled or fed to fal. C08 is read-only: a missing field means stop and propose. The mesher runs in `asset.worker`: no `three`, no `Math.random`.
- Goldens: `DV_UPDATE_GOLDEN=1` outside CI, under the `golden-update` label.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for AC-11 and AC-12 (SKIP locally). Device: Q-13. Branch `m02h1-street-markings`.
