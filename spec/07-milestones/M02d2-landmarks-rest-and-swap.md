# M02d2 — landmarks-rest-and-swap

## Goal
After this session all 37 landmarks of `02-world-bake.md` §7 exist as C07 `building/lm.<slug>` assets, and the city's skyline is always on screen. The remaining 25 recipes (the 9 majors from Painted Ladies to Transit Center Park and Hunters Point, and the 16 minors from Mount Davidson to St. Mary's Cathedral) are built with the M02d1 kit, inside their class budgets, with `authored` provenance and committed, reproducible bytes. The `LandmarkLayer` gains the always-resident skyline set (`lm.golden-gate-bridge`, `lm.bay-bridge-ybi`, `lm.sutro-tower`, `lm.crown-tower`, `lm.pyramid-tower`, `lm.coit-tower`, `lm.ferry-building` at `lo` fidelity within the tier's building draw distance) and the swap is hardened along the whole Ferry Building to Ocean Beach route: no double rendering, no upload burst, no long main-thread task at a swap.

## Requirements
- R-MAP-01: the A-05 count (≥ 25 hand-authored landmark models; 37 specified) is met, every landmark at its real place.
- R-MAP-02: the skyline set keeps the far silhouettes (bridges, towers) visible across the city on every tier, joining the backdrop of M02b1.

## Depends on
- **M02d1:** recipe kit, glTF writer, `map:landmarks -- --build [--check]`, stats budgets in `check:assets`, `LandmarkLayer`, proxy masks, `@world-landmarks`.
- Contracts: C07 1.1 (`building` tiered variants, provenance), C08 1.0 (rule 12).

## Scope in
- **25 recipes** `tools/map/src/landmarks/<slug>.ts` for #13–#37 of §7: `lm.painted-ladies`, `lm.china-basin-ballpark`, `lm.mission-bay-arena`, `lm.pier-39`, `lm.fort-point`, `lm.grace-cathedral`, `lm.dragon-gate`, `lm.transit-center-park`, `lm.hunters-point-yard`, `lm.mount-davidson-cross`, `lm.dolores-park`, `lm.haight-ashbury`, `lm.flower-conservatory`, `lm.park-bandshell`, `lm.cliff-house`, `lm.crissy-field`, `lm.powell-turntable`, `lm.lands-end-lookout`, `lm.candlestick-point`, `lm.treasure-island`, `lm.un-plaza`, `lm.caltrain-terminus`, `lm.peace-pagoda`, `lm.opera-house`, `lm.saint-mary-cathedral`. A minor landmark's file may be a short call into one kit primitive with its parameters in `content/world/landmarks.json`; a new kit primitive is allowed when two or more landmarks share it (for example glasshouse, pagoda, gateway, bandshell, gantry crane).
- **IP rules** (§7 rule 6): brand-bearing venues stay fictional (`lm.china-basin-ballpark`, `lm.mission-bay-arena`, `lm.transit-center-park`); the Dragon Gate and Peace Pagoda are modelled as generic architecture with no inscriptions; no mural, sculpture or public art (the Mount Davidson cross is a plain geometric cross; Haight-Ashbury storefronts carry no signage); names through `place.<slug>`.
- **Skyline set** (`LandmarkLayer`, §7 rule 4): the seven skyline landmarks stay resident at `lo` within the tier's building draw distance (`r2`), loaded at boot after the spawn `p0` set and pinned in the pack store; they sit outside the per-tier resident caps, which count full-fidelity swaps only (record as a Builder decision). When the same landmark is resident at a higher fidelity, its skyline instance is hidden (one landmark, one visible model).
- **Swap hardening:** the proxy-mask remesh for a landmark runs in `asset.worker` before the landmark becomes visible; the remeshed chunk upload and the landmark upload are queued through the `ChunkUploadGate` so a frame carries at most one; the swap commits on the frame both are ready (no frame with neither proxy nor model). A `landmark.swap` debug event (QA bridge only, not telemetry) records the frame and main-thread duration of each commit.
- **Catalog completeness:** `map:landmarks` (content mode) fails when any id in `landmarks.json` lacks a `building/lm.<slug>` asset or an asset lacks a landmark entry.

## Scope out
- Blender art passes and KTX2 atlases (M10d2, after M05c2, same AssetIds; DL-390); interiors. Night lighting of landmarks beyond the window mask (M02b2 look applies through the shared materials). XR comfort teleport nodes at landmarks (M11b1). Device calibration of `swapM` and caps (M11a1–M11a2).

## Deliverables
- `tools/map/src/landmarks/<slug>.ts` × 25 (as listed), `tools/map/src/landmarks/kit/{glasshouse.ts, gantry.ts}` (shared primitives, if needed).
- `tools/map/src/verify/landmarks.ts` (catalog completeness), `tools/map/test/landmarks.rest.spec.ts`.
- `packages/world/src/client/chunks/{landmark-layer.ts (skyline, swap commit), skyline.ts}`, `config/world/landmarks-runtime.json` (skyline list), `packages/world/test/landmark-skyline.spec.ts`, `tests/e2e/world-landmarks.spec.ts` (adds `@world-landmarks-swap`).
- Generated and committed (not counted): 25 × 3 `.glb`, `asset.json`, provenance records, lock entries, recipe parameters in `content/world/landmarks.json`.
- ≈ 33 code files (25 of them short recipe files).

## Interfaces
- C07 1.1 and C08 1.0 unchanged. Skyline and swap behaviour are internal to the S02 `LandmarkLayer`.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the committed landmark files When every recipe is rebuilt in memory Then all 111 `.glb` files (37 × 3) and their stats are byte-identical to the committed ones — proof: `pnpm map:landmarks -- --build --check`
- AC-3 Given `content/world/landmarks.json` and the catalog When the landmark and asset gates run Then exactly 37 `building/lm.*` assets exist, one per landmark entry, each with `desktop`, `mobile` and `mobile-low` variants inside its class budget (hero 30,000 / 12,000 / 4,000; major 12,000 / 5,000 / 1,800; minor 5,000 / 2,200 / 800 triangles) and an `authored` provenance record — proof: `pnpm map:landmarks && pnpm check:assets && pnpm provenance:check`
- AC-4 Given the new recipes and parameters When the IP gates run Then names and strings pass and no recipe module imports an image decoder or reads an image file — proof: `pnpm names:lint && pnpm ip:strings && pnpm check:unit -- tools/map`
- AC-5 Given a mock asset client per tier When the camera starts at City Hall Then the seven skyline landmarks are resident at `lo` within `r2` regardless of the tier cap, a skyline landmark that becomes resident at `hi` or `mid` hides its skyline instance, and the cap still limits full-fidelity landmarks — proof: `pnpm check:unit -- packages/world`
- AC-6 Given a QA build with the `synth` world at `?tier=mobile-low` in Chromium When the camera follows `route-ferry-ocean-beach` Then every skyline landmark within `r2` is visible on every sampled frame, every `landmark.swap` commit shows neither a frame without proxy and model nor two uploads in one frame, and no main-thread task longer than 50 ms overlaps a swap commit — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-landmarks-swap`
- AC-7 Given the same build When the route scenario runs for every flat tier in fail mode on `chromium-webgl2` and `webkit-webgl2` Then render objects and triangles, skyline and swapped landmarks included, stay within each tier's budget — proof: `DV_WORLD=synth pnpm check:perf -- --scenario route-ferry-ocean-beach --fail`
- AC-8 Given the branch When the asset verifier, the production build and a Preview deploy run Then all succeed and the Preview passes its header checks — proof: `pnpm assets:verify && pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-9 Given a local QA build with the `synth` world in a desktop browser When the reviewer visits each of the 25 new landmarks at `?tier=desktop` and `?tier=mobile-low` (each has a land pad and an arrival pose in `synth`, DL-652) and looks at the skyline from Twin Peaks Then each reads as its place, none shows text, logo, mural or sculpture, the skyline set is visible, and the review is recorded in `docs/device-runs/M02d2/desktop/notes.json` — proof: manual: desktop browser, `DV_WORLD=synth pnpm dev`, open `/?debug=1&tier=desktop`, call `__dvBridge.world.teleport(id)` for each new id and `lm.twin-peaks`, repeat at `tier=mobile-low`, write the notes file

## Test plan
- **Unit:** `tools/map/landmarks.rest` (stats per class, determinism), `world/landmark.skyline`.
- **Gates:** `map:landmarks -- --build --check`, `map:landmarks`, `check:assets`, `provenance:check`, `names:lint`, `ip:strings`.
- **E2E / perf:** `@world-landmarks` and `@world-landmarks-swap` on `chromium-webgl2`; route scenario in fail mode on both engines.
- **Manual:** AC-9 review.

## Demo script
1. `DV_WORLD=synth pnpm dev`, open `/?perf=1&tier=mobile-low`, teleport to `lm.twin-peaks`: the bridges and towers stand on the horizon at `lo`.
2. Fly the free cam toward the Ferry Building: the crown and pyramid towers swap to `mid` without a flicker.

## Effort
1 Builder session; about 33 code files, 25 of them short recipes; risk **medium**. Variety without new primitives for every landmark, and the swap commit ordering, are the main time sinks.

## Risks & fallbacks
- **Session runs long:** finish the 9 majors and the skyline first, then the minors in table order; any minor not finished keeps its proxy, `map:landmarks` lists it as missing, and the report names it (AC-2 and AC-3 then fail, so the milestone is not done: split the rest into a follow-up file through the Architect).
- **Long-task check flaky on a loaded runner:** measure only tasks that start inside the swap commit callback; if still flaky, mark `@world-landmarks-swap` `@quarantine` per the flake policy and report it, never raise the 50 ms threshold.

## Notes for the Builder
- Read first: `02-world-bake.md` §7 (rows 13–37, rules 1–7); the M02d1 file's Scope in; `02-world.md` §5.3–§5.4 (render-object plan).
- Keep recipes parametric and small; reuse M02d1 primitives before adding new ones.
- Secrets: none. Branch `m02d2-landmarks-rest-and-swap`.
