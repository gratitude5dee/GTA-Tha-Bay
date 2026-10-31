# M02g2 — look-fixes

## Goal
This session fixes the render defects the 2026-10-26 look study found on the real `sf` bake (DL-OWN-07, Phase 0 session B):
- contact shading: baked vertex AO, the main contact cue on `mobile-low` and Quest;
- faceted terrain;
- floating roofs;
- sunk or oversized trees;
- z-fighting;
- sparkle and moiré;
- the floating slab;
- horizon cones.

Headless Chromium now classifies as Chromium. That change lands with M02g1's owner-representative `webkit-webgl2` golden. Everything is procedural: 0 added render objects, no contract change.

## Requirements
- R-MAP-01: streets read as built ground (contact shading, roofs on walls, grounded trees).
- R-PLAT-03: TSL on one `WebGPURenderer` (WebGPU and WebGL2). CI classifies its own browser correctly.
- R-PLAT-05 (s): `mobile-low` keeps its frame budget and object count.
- R-ENG-02: the object ledger and triangle budgets hold in `check:perf`.

## Depends on
- **M02g1:** the tuned look (grade, haze, `blob` shadows), `docs/look/M02g1-render-ledger.json`, and the step-0 `webkit-webgl2` golden (tag `@look-owner`).
- Merged context: M02e (look, `shot()`, goldens), M02d2 (landmark swap), M02b1 (mesher, upload gate), M01c (`classifyDevice`, meter).
- Contracts: C08 1.0 and C13 1.2, read only.

## Scope in
† = design value in `config/world/mesher.json` and its schema, tuned here.

- **Vertex AO** (`mesher.ts`). Today only wall feet (`AO_BASE` 0.55, line 254) and pitched roofs carry `ao`. Add:
  - terrain posts within `ao.ringM` † 3 m of a footprint edge in the same chunk: `1 − 0.35 † × (1 − d/ringM)²`;
  - a wall vertex row at 1.2 m †, only when `tris + 2n ≤ trisPerBuilding`;
  - pitched eaves at 0.8 †;
  - `aAO` in the ground material on every profile (today only `min` uses it);
  - an exported `aoRing()`, which M02h2's curbs will use.
- **Terrain** (`terrainMesh`, line 180):
  - normals come from a Sobel filter over the stride-1 posts;
  - L0 chunks within `nearRingM` † 300 m of the focus mesh at `nearStride` † (mobile 1, low 2), so vertices stay on the posts;
  - finer chunks carry a 1 m † border skirt;
  - a chunk that crosses the ring is re-meshed once through `asset.worker` and the upload gate (enter under 1×, leave over 1.5×).
- **Roofs.** The gable and hip base ring is the wall-top ring at `wallTop`.
  - Reproduce the study's Lombard gap first. Suspects: the pitched path (lines 333–381), coarse massing under `COARSE_DEPTH_BIAS`, the façade top band. The BD row names the cause.
- **Trees** (`treeRecords`, line 572; the 6.2 m cone `treeGeometry`):
  - `y` is the lowest terrain height under the trunk radius, minus 0.1 m;
  - height is `clamp(6.2·s, 3.5 †, min(7.5 †, nearest eave within 8 m † − 0.5))`;
  - the bake (`s3-water.ts` `treeRecord`) and the species byte (M02h4) stay unchanged.
- **Depth bias.** Where two surfaces fight, the finer one wins by polygon offset; the audit goes in the BD row.
  - `roads` gets its own material instance, factor −1 and units −4 †.
  - Ribbons lift `0.12 + 0.01 † × class rank` and are emitted lowest rank first.
  - L1/L2 water sheets and the backdrop sea lose to terrain water.
  - A landmark beats its M02d2 hand-over proxy, and its plinth beats the terrain.
  - `legacy` materials get the same rules.
- **Footprint fades.**
  - Every `ground.ts` noise term fades with `bandFade(pixelFootprint)`, including `crack` (line 75) and the grass `dry` mask.
  - Landmarks, today drawn with the world vertex-colour material (`landmark-view.ts` line 31), get `look/landmark.ts`. On `full`, `lite` and `min` it fades vertex colour toward the model's area-weighted mean, a uniform from `landmark-merge.ts`.
- **Floating slab** (study frame `staging-prod-autotier-mobile-low-03-play-02.png`).
  - Suspects: placement in `cards.ts`, `far-mesh.ts`, `massing.ts` and `skyline.ts`.
  - Name the object, fix it, and add a regression case.
  - Invariant on every level (L0, L1, L2, far mesh, cards): no vertex sits above its unit's maximum top + 10 m, and no wall foot sits above the terrain.
- **Far trees.** `ChunkRenderer` hides `vegetation` beyond `tree.drawM` † (desktop 900, mobile 500, low 300 m), with 10 % hysteresis and one counted re-record per crossing.
- **Classifier** (`packages/shared/src/platform/classify.ts`, line 29).
  - `isChromiumEngine` matches `HeadlessChrome/`, and a UA fixture covers it.
  - The desktop Chromium goldens then render with `envMap: true` and are regenerated under `golden-update`. M02g1's WebKit golden is not touched.
  - If PMREM fails under SwiftShader, M02e's hemisphere fallback stays on, with a spec/03 §7 row.
- **QA.**
  - Three `synth` shot pairs, each 0.05 m apart, in `look-shots.json`: `junction-graze`, `asphalt-low` and `civic-hall-graze` (each with a `-b` shot).
  - `look()` gains `vegetation: {shown, farthestM}`.
  - `tests/support/flicker.ts` measures the share of pixels whose difference between the two shots of a pair exceeds 32/255, at 640 × 360. The baselines from the parent commit are in `tests/e2e/golden/look/flicker-baseline.json`.
- **Ledger.** `@fixes-ledger` writes `docs/look/M02g2-render-ledger.json` in M02g1's shape (`{commit, bakeId, tiers: {<tier>: {baseline, after}}, xr}`; `DV_LOOK_WRITE=1` writes, otherwise it checks). The baseline is M02g1's `after`, and `xr` comes from `__dvBridge.perf.live()` in the `@xr` case.
  - Planned: 0 new objects on `desktop`, `mobile`, `mobile-low` and `legacy`; far trees can only lower the count.
  - At most +16 k † triangles at `mobile-low`, from the near grid.

## Scope out
- M02g1: grade, haze, blob shadows, camera, window ratio, asphalt albedo.
- M02h1: markings. M02h2: curbs. M02h3: ground cover. M02h4/M02h5: tree forms. M02h6: furniture. M02h8: TRAA and `xr` profile.
- Not here: story-start lighting (owner decision 2), HUD icons (DL-738), any fal or licensed asset.

## Deliverables
- **Edits:**
  - `packages/world/src/client/chunks/{mesher.ts, chunk-renderer.ts, materials.ts, landmark-view.ts, landmark-merge.ts}`;
  - `look/{look-materials.ts, ground.ts, noise.ts}`, plus the new `look/landmark.ts`;
  - `client/{world-view.ts, world-bridge.ts}`;
  - the culprit backdrop file;
  - `packages/shared/src/platform/classify.ts`.
- **Tests:**
  - `packages/world/test/{look.fixes.spec.ts, look.floating.spec.ts}`;
  - `device-classify.spec.ts` (edit);
  - `tests/e2e/world-look-fixes.spec.ts` (`@look-fixes`, `@fixes-ledger`, with one `@xr @fixes-ledger` case);
  - `tests/support/flicker.ts`.
- **Data (not counted):** `mesher.json` and its schema, the shots, the UA fixture, the goldens, the flicker baseline, the ledger, the BD rows. No new script, dependency or asset.

## Interfaces
- C08 1.0 (`RenderChunk.trees`, heightfield) and C13 1.2 (`DeviceProfile.browser`, `TierBudget`) are read unchanged. `MesherConfig`, `aoRing()`, the landmark material, the bridge field and the ledger shape are S02 internals.
- Contract change proposals: none.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 and no new file holds GLSL or `ShaderMaterial` — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the `synth` and `civic-excerpt` bakes When the mesher runs twice per profile Then:
  - buffers are byte-identical;
  - posts inside `ao.ringM` of a footprint have `ao < 1` and all others 1;
  - a wall row exists exactly when headroom allows;
  - no building exceeds `trisPerBuilding`;
  - eaves carry the eave AO;
  - no `mobile-low` L0 unit exceeds 2 MiB — proof: `pnpm map:build -- --area synth && pnpm map:build -- --area civic-excerpt && pnpm check:unit -- packages/world`
- AC-3 Given the same bakes When the terrain, roof and tree cases run Then:
  - every non-skirt vertex is within 1 mm of `sampleHeight`, and normals match the stride-1 Sobel normal within 1e-3;
  - near-ring chunks use `nearStride`, with skirts on every border segment and the ring hysteresis applied;
  - every pitched eave vertex coincides within 1 mm with a wall-top vertex, and the reproduced-gap case passes;
  - every tree's `y` is at or below the terrain under its trunk and within 0.15 m of its minimum, and its height is in `[3.5, cap]` — proof: `pnpm check:unit -- packages/world/test/look.fixes.spec.ts`
- AC-4 Given every level of both bakes When `look.floating` runs Then no building or massing vertex is above its unit's maximum top plus 10 m, no wall foot is above the terrain, and the culprit-record case passes — proof: `pnpm check:unit -- packages/world/test/look.floating.spec.ts`
- AC-5 Given the UA fixtures When `device-classify` runs Then `HeadlessChrome/` classifies as `chrome`, desktop Safari as `safari`, iOS `CriOS` as `chrome` on WebKit, and earlier fixtures are unchanged — proof: `pnpm check:unit -- packages/shared`
- AC-6 Given a QA `synth` build When `@look-fixes` runs on `chromium-webgl2` and `webkit-webgl2` Then:
  - each shot pair flickers at ≤ 50 % of its committed baseline (`junction-graze` and `civic-hall-graze` at `desktop`, `asphalt-low` at `mobile-low`);
  - `vegetation.farthestM ≤ tree.drawM × 1.1`;
  - `look().envMap` is `true` at `desktop` on Chromium and `false` on WebKit — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @look-fixes && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-fixes`
- AC-7 Given the regenerated look goldens (`golden-update` label) and M02g1's unmodified `@look-owner` golden When both suites run Then every `@look-golden` shot is within M02e's tolerance on `chromium-webgl2` and `@look-owner` passes on `webkit-webgl2` — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @look-golden && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-owner`
- AC-8 Given the same build When the earlier suites run Then `@world-look`, `@world-landmarks`, `@world-sky`, `@world-route`, `@world-backdrop`, M02g1's `@look-tune` and the XR smoke pass — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-look|@world-landmarks|@world-sky|@world-route|@world-backdrop|@look-tune" && DV_WORLD=synth pnpm check:e2e:xr`
- AC-9 Given every perf scenario in fail mode and the committed ledger When `@fixes-ledger` runs flat and in the `@xr` case Then:
  - every tier stays in budget;
  - `mobile-low` stays at or under 100 render objects;
  - the object delta is ≤ 0 for `desktop`, `mobile`, `mobile-low` and `legacy`;
  - the `mobile-low` triangle delta is ≤ +16,000 — proof: `DV_WORLD=synth pnpm check:perf -- --fail && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @fixes-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-10 Given the branch When the asset and IP gates run Then they pass with no new asset, provenance record or licence entry — proof: `pnpm assets:catalog && pnpm check:assets && pnpm provenance:check && pnpm ip:strings`
- AC-11 Given the production build When it is verified and deployed to a Preview Then it succeeds, `__dvBridge` is absent and the header checks pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-12 Given the merged default branch republished to staging When the operator plays New Game to the m.a1.01 truck stage in Safari and Chrome Then the slab is gone, roofs meet walls, trees are grounded at Lombard, and before/after frames per browser are in `docs/look/M02g2-sf/` — proof: manual: desktop Mac (Safari and Chrome), `pnpm deploy:prod -- --env staging`, `pnpm check:smoke -- https://tha-bay-web-staging.gratitude-8f4.workers.dev`, frames and `notes.json` committed

## Test plan
- **Unit:** `look.fixes`, `look.floating`, `device-classify`.
- **E2E:**
  - `@look-fixes`, `@fixes-ledger`, `@look-golden` and `@look-owner` run in the `DV_WORLD=synth` half (`--grep-invert "$GRAYBOX_GREP"`, file unchanged).
  - `@xr @fixes-ledger` runs on `xr-quest3`.
  - The pair cases skip on `chromium-webgpu` (WebGL2 baselines).
- **Perf:** AC-9. **Operator:** AC-12.

## Demo script
How to see it:
1. Run `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev` and open `/?play=sandbox&debug=1&tier=mobile-low&gl=1`. In the console, `__dvBridge.world.shot('asphalt-low')` then `('asphalt-low-b')`: no sparkle.
2. Reload with `&tier=desktop`, then `shot('junction-graze')` and `shot('civic-hall-graze')`: no flicker, no moiré.
3. Walk a pitched-roof block: roofs sit on walls, wall feet are dark, trees are grounded below the eaves. The horizon has no cones; the debug look row shows `vegetation.farthestM`.

## Effort
0.7 Builder session; ≈ 18 code files; risk **medium**. Order: classifier and goldens, AO and terrain, roofs and trees, depth bias, fades, slab, far trees, ledger. Short on time: the near ring is decided at request time only (the M02b1 `skip` pattern), with a BD row.

## Risks & fallbacks
- **Re-mesh churn:** wider hysteresis, then the request-time rule.
- **Flicker unstable under SwiftShader:** pair cases go nightly; the unit invariants stay (logged).
- **Slab appears only on `sf`:** AC-4 and AC-12 cover it, with the culprit record as a unit fixture.
- **PMREM fails on headless Chromium:** the hemisphere fallback plus a spec/03 §7 row.
- **Too many triangles at `mobile-low`:** `nearStride` 4 for `low`. Never raise a budget.

## Notes for the Builder
- Read first: `02-world-bake.md` §6, `02-world.md` §5.2–§5.4, `02-world-living.md` §6, `11-platform.md` §4.5 and §5.2, M02e, M02d2, M02g1, DL-704 and DL-OWN-07.
- Evidence: the capture study's frames (Lombard roof gap, slab, `mobile-low` sparkle, City Hall moiré in `docs/look/M02e-before-after-sf.png`, horizon cones), render audit items 6 and 12, and the plan's "Fix session B".
- The target image is never committed; since DL-OWN-10 the owner's look references may be used as look inputs (a fal reference input, a side-by-side comparison, a palette), read from outside the repository. All fixes are original code.
- The mesher stays deterministic and free of `three` (it runs in `asset.worker`). Sim and collision (the C08 heightfield) are untouched.
- Goldens: `DV_UPDATE_GOLDEN=1` outside CI, under the `golden-update` label. Commit the Chromium goldens together with the classifier fix.
- Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for AC-11 and AC-12 (SKIP locally). Branch: `m02g2-look-fixes`.
