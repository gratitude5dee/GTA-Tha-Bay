# M02d1 — landmarks-kit-and-heroes

## Goal
After this session San Francisco has recognisable silhouettes. A deterministic landmark recipe kit in `tools/map/src/landmarks/` builds original glTF models from parameters (no photographs, no logos), and the first twelve landmarks of `02-world-bake.md` §7 (the eight heroes and four majors: City Hall, Golden Gate Bridge, Bay Bridge at Yerba Buena Island, Coit Tower, Ferry Building, the pyramid tower, the crown tower, Sutro Tower, Palace of Fine Arts, Alcatraz, Twin Peaks, the Lombard switchback block) ship as C07 `building/lm.<slug>` assets with `hi`/`mid`/`lo` fidelity variants inside their triangle budgets, with provenance and committed, byte-reproducible bytes. At runtime a `LandmarkLayer` outside the chunk bundles loads landmarks inside the tier's swap distance, swaps the baked extrusion proxies out of the chunk meshes, and puts them back beyond it. This milestone also builds the stats-based asset budget check that M01d deferred, because landmarks are its first consumer.

## Requirements
- R-MAP-01: players recognise where they are from the hero landmarks at their real positions.
- R-IP-01: every landmark is original geometry from code (A-05 as amended by DL-201), named through the place registry, with `authored` provenance; no mark, mural, sculpture or public art is reproduced.

## Depends on
- **M02b1:** `ChunkRenderer`, mesher job in `asset.worker`, `BundleGroup` re-record path, `RenderBudgetMeter` scenarios, `DV_WORLD=synth` CI builds.
- **M02c1:** `TeleportApi` and `__dvBridge.world.teleport(id)` (AC-6, AC-9; inherited by M02d2; DL-348).
- Present from earlier milestones: M02a2's `content/world/landmarks.json` seeds with `replaces` and `arrival`, `proxyOf` in `l0` BUILDING records; M01d's catalog, lock and `check:assets`.
- Contracts: C07 1.1 (`building` kind, tiered variants, `VariantStats`, `ProvenanceRecord`, `resolveVariant`, `TIER_FIDELITY`), C08 1.0 (rule 12: landmarks outside the chunk `BundleGroup`; LMREF section).

## Scope in
- **Recipe kit** (`tools/map/src/landmarks/kit/`): parametric primitives (extruded footprint with setbacks, tapered tower, dome and drum, arch and colonnade, truss and cable span, suspension tower, deck, pier and seawall, terrace and stair, lattice mast, hill mound), a district-palette material set (vertex colours plus PBR factors, no textures in recipe outputs), fidelity rules that derive `hi`, `mid` and `lo` from one parameter set, and a glTF writer on `@gltf-transform/core` (4.5.1, already pinned in the root `package.json` by M01d) with meshopt compression through `@gltf-transform/functions` and the `meshoptimizer@1.3.0` encoder [research/stack-rendering-platform.md §5.6] (DL-683). All output is deterministic: fixed node order, no timestamps, no generator strings with versions that drift (the writer pins `asset.generator`).
- **Twelve recipes** `tools/map/src/landmarks/<slug>.ts` for `lm.city-hall`, `lm.golden-gate-bridge`, `lm.bay-bridge-ybi`, `lm.coit-tower`, `lm.ferry-building`, `lm.pyramid-tower`, `lm.crown-tower`, `lm.sutro-tower`, `lm.palace-fine-arts`, `lm.alcatraz`, `lm.twin-peaks`, `lm.lombard-crooked`; parameters added under each entry's `recipe` key in `content/world/landmarks.json`. Model architecture only; brand-bearing venues stay fictional (`lm.pyramid-tower`, `lm.crown-tower`); in-world names through `NameRegistry` keys `place.<slug>`.
- **Build command:** `map:landmarks -- --build [--slug <id>] [--check]` writes `assets/src/building/lm.<slug>/{asset.json, desktop.glb, mobile.glb, mobile-low.glb}` plus one provenance record per file (`origin: authored`, licence `LicenseRef-DeeVerse-Owned`, `tool: tools/map landmarks@<version>`), with tags `lm-class:<hero|major|minor>`; `--check` regenerates in memory and fails on any byte difference from the committed files (the M01d `assets:seed --check` pattern). Then `assets:catalog` and `assets:lock` pick them up as for every source asset.
- **Stats budgets** (the part M01d left for "M03a1/M10a"; done here first; vehicle rows belong to M10d1 and character rows to M10a1, DL-683 part 2): the build records `VariantStats` (`tris`, `verts`, `primitives`, `materials`) in `asset.json`; `config/asset-budgets.json` gains landmark class rows (hero 30,000 / 12,000 / 4,000; major 12,000 / 5,000 / 1,800; minor 5,000 / 2,200 / 800 triangles for `hi` / `mid` / `lo`; ≤ 3 render objects at `hi` and `mid`, ≤ 2 at `lo`; atlas ≤ 1,024² / 512² / 256² when an art file adds one); `tools/ci/check-assets.ts` enforces stats columns for any asset whose budget row exists. M10d1 adds the traffic, police and hero vehicle rows on the same mechanism (the `vehicle-race` row ships with M01d).
- **`LandmarkLayer`** (`packages/world/src/client/chunks/landmark-layer.ts`): landmarks are not chunk objects; resident caps per tier (desktop and ultra 8, Vision Pro 6, mobile 4, Quest 3, mobile-low 3), swap distance `swapM` (1,200 / 1,200 / 900 / 500 / 400 / 350 for ultra, desktop, Vision Pro, mobile, Quest, mobile-low), nearest-first loading through `AssetClient` with `resolveVariant(tier)`, LRU beyond the cap. On load, chunks that reference the landmark (LMREF, `proxyOf`) are remeshed in `asset.worker` with a proxy mask and each gets exactly one re-record request (`bundleGroup.needsUpdate = true`, counted per chunk by M02b1's `ChunkRenderer` as `bundleRerecords`); a render bundle is actually recorded only on the WebGPU backend [research/stack-rendering-platform.md §1.5], so the counter, not the backend, is the oracle (DL-682); the remesh upload goes through the `ChunkUploadGate`. Beyond `swapM`, or on any load failure, the proxy is meshed back: never a hole. The layer reports its objects to `RenderBudgetMeter`.
- **QA:** `__dvBridge.world.landmarks()` (resident ids, fidelity, proxy-masked chunks with their `bundleRerecords`); `config/world/landmarks-runtime.json` (caps and `swapM` per tier) with schema.

## Scope out
- The remaining 25 landmarks and the always-resident skyline set: M02d2. Blender art passes at the same AssetIds: M10d2, after M05c2 (DL-105, DL-201, DL-390). KTX2 textures (recipes ship none). Landmark interiors and mission dressing: S03 milestones.

## Deliverables
- `tools/map/src/landmarks/kit/{primitives.ts, spans.ts, palette.ts, fidelity.ts, gltf-writer.ts, build.ts}`.
- `tools/map/src/landmarks/{city-hall, golden-gate-bridge, bay-bridge-ybi, coit-tower, ferry-building, pyramid-tower, crown-tower, sutro-tower, palace-fine-arts, alcatraz, twin-peaks, lombard-crooked}.ts`.
- `tools/map/src/verify/landmarks.ts` (extended with `--build`), `tools/map/test/{landmarks.kit.spec.ts, landmarks.build.spec.ts}`.
- `tools/ci/check-assets.ts` (stats budgets), `tools/ci/test/assets-stats.spec.ts`, `config/asset-budgets.json` and its schema (landmark rows).
- `packages/world/src/client/chunks/{landmark-layer.ts, proxy-mask.ts}`, `packages/world/src/client/chunks/mesher.ts` (proxy mask input), `config/world/landmarks-runtime.json` + schema, `packages/world/test/landmark-layer.spec.ts`, `tests/e2e/world-landmarks.spec.ts` (`@world-landmarks`).
- Generated and committed (not counted): 12 × 3 `.glb`, `asset.json` files, provenance records, lock entries; `content/world/landmarks.json` recipe parameters.
- Pins: `meshoptimizer@1.3.0` [research/stack-rendering-platform.md §5.6]; `@gltf-transform/core` stays at M01d's 4.5.1; `@gltf-transform/functions` in the release line of the verified `@gltf-transform/cli@4.5.1` (F-017): take what pnpm resolves and record it in `spec/03` §7 (DL-683).
- ≈ 31 code files.

## Interfaces
- C07 1.1 and C08 1.0 unchanged. `LandmarkLayer` is an S02 client component (`02-world.md` §3), not a contract. Stats budgets are a tooling extension of M01d's `config/asset-budgets.json`.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the committed landmark files When every recipe is rebuilt in memory Then all 36 `.glb` files and their `asset.json` stats are byte-identical to the committed ones — proof: `pnpm map:landmarks -- --build --check`
- AC-3 Given the catalog When the asset gates run Then the 12 `building/lm.*` assets each carry `desktop`, `mobile` and `mobile-low` variants within their class triangle budgets with ≤ 3 render objects at `hi` and `mid` and ≤ 2 at `lo`, and a fixture landmark 1 triangle over its `lo` budget fails the stats check — proof: `pnpm check:assets && pnpm check:unit -- tools/ci`
- AC-4 Given the landmark sources When provenance and IP gates run Then every `.glb` has an `authored` record with licence `LicenseRef-DeeVerse-Owned`, no recipe module imports an image decoder or reads an image file (unit-checked over `tools/map/src/landmarks/**`), and names and strings pass — proof: `pnpm provenance:check && pnpm names:lint && pnpm ip:strings && pnpm check:unit -- tools/map`
- AC-5 Given a mock asset client and a scripted camera When the layer runs per tier Then resident landmarks never exceed the tier cap, a landmark loads only inside its tier `swapM`, the farthest is evicted first, a failed load leaves the proxy meshed, and leaving `swapM` restores the proxy — proof: `pnpm check:unit -- packages/world`
- AC-6 Given a QA build with the `synth` world at `?tier=mobile` When the bridge teleports to `lm.coit-tower` (on land with an arrival pose in `synth`, M02a1 land pads, DL-652) and then 2 km away Then the landmark becomes resident, the chunks that reference it report a proxy mask and a `bundleRerecords` count that rose by exactly one each (re-record requests, backend-agnostic, DL-682), no frame uploads more than one chunk, and after the move the landmark is evicted and the proxy footprints are back — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-landmarks`
- AC-7 Given the same build When the route scenario runs for every flat tier in fail mode Then render objects and triangles, landmarks included, stay within each tier's budget — proof: `DV_WORLD=synth pnpm check:perf -- --scenario route-ferry-ocean-beach --fail`
- AC-8 Given the branch When the production build is verified and deployed to a Preview Then the asset verifier accepts the 12 new entries, the build succeeds and the Preview passes its header checks — proof: `pnpm assets:verify && pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-9 Given a local QA build with the `synth` world in a desktop browser When the reviewer visits each of the 12 landmarks at `?tier=desktop` and at `?tier=mobile-low` (every §7 landmark, Alcatraz and the bridge seeds included, has a land pad and an arrival pose in `synth`, DL-652) Then each reads as its building from street level, shows no text, logo, mural or sculpture, and the review is recorded in `docs/device-runs/M02d1/desktop/notes.json` — proof: manual: desktop browser, `DV_WORLD=synth pnpm dev`, open `/?debug=1&tier=desktop`, call `__dvBridge.world.teleport(id)` for each id, repeat at `tier=mobile-low`, write the notes file

## Test plan
- **Unit:** `tools/map/landmarks.kit` (primitive triangle counts, fidelity derivation, deterministic writer), `landmarks.build`; `tools/ci/assets-stats`; `world/landmarks.layer`.
- **Gates:** `pnpm map:landmarks -- --build --check`, `pnpm check:assets`, `pnpm provenance:check`, `pnpm names:lint`, `pnpm ip:strings`.
- **E2E / perf:** `@world-landmarks` on `chromium-webgl2`; `route-ferry-ocean-beach` in fail mode.
- **Manual:** AC-9 review.

## Demo script
1. `pnpm map:landmarks -- --build --slug lm.coit-tower` and open the three `.glb` files in any glTF viewer: same shape, falling triangle counts.
2. `DV_WORLD=synth pnpm dev`; teleport to `lm.golden-gate-bridge` at `?tier=mobile`; walk away until it swaps back to the proxy.

## Effort
1 Builder session; about 31 code files; risk **medium**. The two bridges (towers, cables, deck spans) and the stats budget plumbing are the main time sinks.

## Risks & fallbacks
- **meshopt output not byte-stable across platforms:** compress with a pinned encoder and level; if bytes still drift between Linux and macOS, commit uncompressed `.glb` (meshopt off) and log the decision; budgets are in triangles, not bytes.
- **Hero budget exceeded by the bridges at `hi`:** lower cable segment counts first, never split one landmark into two assets.
- **Proxy remesh causes an upload burst:** the gate already serializes uploads; if a chunk misses its frame, the proxy stays one more frame (no hole).

## Notes for the Builder
- Read first: `02-world-bake.md` §7 (table, rules 1–7); `02-world-contracts.md` rule 12; `05-assets.md` §4.1–§4.3; M01d's `asset.json` layout and `assets:seed --check`.
- Model only architecture at the scale of the §7 roles; use the §7 coordinates and the M02a2 arrival poses; never read or trace photographs (rule 7).
- **World goldens.** Merge order follows Depends on (DL-700), so M03b1, M03b2 or M03c may already be on `claude/build` when this PR rebases. If the `recipe` parameters in `content/world/landmarks.json` change the synth `bakeId`, their goldens fail with `world golden from bake <old>, current bake <new>`: regenerate them as M02c2's Notes say (`DV_UPDATE_GOLDEN=1` outside CI, label `golden-update`, one-line reason) and list them in the report (DL-657).
- No generative AI anywhere in this milestone: zero fal spend (DL-OWN-01). Secrets: none. Branch `m02d1-landmarks-kit-and-heroes`.
