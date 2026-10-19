# M10d2 — art-integration

## Goal
After this session the city surfaces are final v1 art and no gray-box stand-in can reach a release unnoticed. **Split boundary (M10d, split 2 of 2):** M10d1 delivered vehicles, props, the pedestrian kit, the creator-kit parts and the placeholder registry `config/art-placeholders.json`. This session ships the KTX2 facade atlas for the desktop building shader, replaces the M02b1 placeholder `texture/far-bay-cards` with cards from the software silhouette rasterizer, runs the landmark art pass at the same AssetIds where the owner supplies files, adds the `desktop-ultra` atmosphere adapter behind its removable interface and a flag, and adds `pnpm assets:final`, the scan that M14b3's `art-final` launch gate computes (DL-390).

## Requirements
- R-MAP-01: the city reads as San Francisco at every tier: facades, landmarks and the far Bay skyline are final art.
- R-MAP-02 (s): the far skyline cards serve `mobile`, `mobile-low`, `xr-quest` and `xr-visionpro` as specified.
- R-MODE-02 (s): the `desktop-ultra` sky gains the atmosphere adapter for the racing look.
- R-IP-01: every new asset has provenance and passes the IP gates; no stand-in ships unrecorded.

## Depends on
- **M10d1:** `config/art-placeholders.json` and its schema; the vehicle, ped and creator rows filled.
- **M02d2:** 37 `building/lm.<slug>` recipes, `map:landmarks -- --build --check`, `LandmarkLayer` skyline set. Through it **M02b1** (bake S11 `far-bay-*`, placeholder card atlas, window-grid shader) and **M02b2** (`AtmosphereAdapter` interface; `desktop-ultra` uses the desktop path).
- Contracts: C07 1.1, C08 1.0, C13 1.1 (`TierFeatures`, `DynamicQuality.atmosphereLevel`), unchanged.
- Owner: Q-39 (art sourcing). The default applies when it stays open.

## Scope in
- **Facade atlas** (`02-world-bake.md` §6 desktop row): one `texture/facade-atlas` KTX2 (verified CC0 sets or authored, `05-assets-pipeline.md` §7 "Facade, ground, PBR sets"), sampled by the TSL window-grid shader on `desktop-ultra` and `desktop` with the per-building tint; other tiers unchanged. Added to the boot set next to the sky assets (`02-world.md` §5.1).
- **Skyline cards** (`02-world-maps.md` §4): the software silhouette rasterizer in `tools/map` (bake S11 `s11-far.ts`) renders ≤ 24 camera-facing cards for the listed clusters from three azimuths (W, SW, NW) into a 2048 × 1024 KTX2 `texture/far-bay-cards`, reproducible, replacing the PNG placeholder; `derived` provenance from the bake inputs.
- **Landmark art pass** (DL-105, DL-201): supplied Blender files for any of the 37 landmarks replace the recipe output at the same `building/lm.<slug>` AssetIds, inside the class budgets, with `authored` provenance; recipes stay the final art for the rest (A-05 is met by recipes). `map:landmarks -- --build --check` skips replaced ids and lists them.
- **Atmosphere adapter** (`02-world-living.md` §6): `packages/world/src/client/sky/atmosphere-takram.ts` implements `AtmosphereAdapter` for `desktop-ultra` only, with the one-layer volumetric clouds of the §6 feature matrix (other tiers keep their painted or gradient layer), behind flag `world.atmosphere` (default off) and `DynamicQuality.atmosphereLevel` 2; when `init` rejects or the renderer runs WebGL2, it disposes and the desktop dome stays. Package version: what pnpm resolves, recorded in `spec/03`. Its r186 compatibility (U-PLT-8) is recorded, never asserted.
- **Placeholder scan** `pnpm assets:final` (`tools/assets/src/final.ts`, pure core `artFinal(input)` reused by M14b3): fails, naming file and ref, when (1) any AssetRef matching `^[a-z_]+/graybox\.` appears in `assets/prefabs/**`, `content/**`, `config/**` (the registry itself excluded) or the catalog manifest; (2) any registry entry has an empty `replacedBy` or a ref missing from the catalog; (3) any entry with `match.file` and `match.pointer` does not hold its `replacedBy` refs at that JSON pointer. `--json` prints `{ status: 'pass'|'pending', findings[] }`. Fill `replacedBy` for the `owner: 'M10d2'` rows.

## Scope out
- Vehicles, props, peds, creator parts: M10d1. Landmark interiors and new landmarks. Device calibration of the atmosphere cost: the M14b3 release device pass (`desktop-ultra` stays `uncalibrated` without Desktop C, Q-13).
- The `art-final` launch-gate entry and its release blocking: M14b3.

## Deliverables
- `tools/map/src/stages/s11-far.ts` (rasterizer), `tools/map/src/far/raster.ts`, `tools/map/test/far-cards.spec.ts`.
- `packages/world/src/client/chunks/facade.ts` (atlas sampling), `packages/world/src/client/sky/atmosphere-takram.ts`, `packages/world/test/{facade.atlas, atmosphere.adapter}.spec.ts`; `config/platform-flags.json` (`world.atmosphere`).
- `tools/assets/src/final.ts`, `tools/assets/test/final.spec.ts` (fixture trees: one with a `vehicle/graybox.sedan` ref, one with an empty `replacedBy`, one clean); root script `assets:final`.
- `config/art-placeholders.json` (M10d2 rows); `tests/e2e/art.spec.ts` (adds `@art-skyline`, `@art-ultra`).
- Generated and committed (not counted): KTX2 atlas and cards, replaced landmark `.glb` files, provenance records, lock entries, licence snapshots, credits lines.
- ≈ 16 code files.

## Interfaces
- C07, C08 and C13 unchanged. `artFinal(input): { status: 'pass'|'pending'; findings: { file: string; ref: string; rule: 1|2|3 }[] }` is the internal core M14b3 imports.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the fixture trees When `artFinal` runs Then the `vehicle/graybox.sedan` fixture is `pending` naming file and ref under rule 1, the empty-`replacedBy` fixture is `pending` naming the entry under rule 2, and the clean fixture passes — proof: `pnpm check:unit -- tools/assets`
- AC-3 Given the repository after this session When the placeholder scan runs Then it exits 0 with `status: 'pass'` and zero findings — proof: `pnpm assets:final`
- AC-4 Given the `civic-excerpt` area When stage S11 runs twice Then `texture/far-bay-cards` is a 2048 × 1024 KTX2 with ≤ 24 cards, byte-identical across runs, ≤ 4 MiB — proof: `pnpm map:build -- --area civic-excerpt --repro && pnpm check:unit -- tools/map`
- AC-5 Given the new and replaced assets When the asset and IP gates run Then variants, budgets, provenance, licence snapshots and credits pass, every landmark still has exactly one `building/lm.<slug>` asset, and recipe rebuilds match for every id not replaced — proof: `pnpm assets:catalog && pnpm assets:verify && pnpm check:assets && pnpm provenance:check && pnpm map:landmarks -- --build --check && pnpm names:lint && pnpm ip:strings`
- AC-6 Given a mock renderer When the atmosphere adapter is enabled on a WebGL2 backend, or its `init` rejects Then it disposes, the desktop dome stays and no error escapes; at any tier other than `desktop-ultra` it is never constructed — proof: `pnpm check:unit -- packages/world`
- AC-7 Given a QA build with the `synth` world When `@art-skyline` runs at `?tier=mobile-low` and `@art-ultra` at `?tier=desktop-ultra&gl=1` Then the far cards come from the KTX2 asset, the facade atlas is not requested below `desktop`, and with `world.atmosphere` on under WebGL2 the sky falls back with no console error — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@art-skyline|@art-ultra"`
- AC-8 Given the same build When `route-ferry-ocean-beach` runs for every flat tier in fail mode Then render objects, triangles and texture memory stay within each tier's budget — proof: `DV_WORLD=synth pnpm check:perf -- --scenario route-ferry-ocean-beach --fail`
- AC-9 Given a local QA build in a desktop browser When the reviewer looks from `lm.twin-peaks` at `?tier=desktop` and `?tier=mobile`, and at `?tier=desktop-ultra` with `world.atmosphere` on where WebGPU is available Then facades, cards and replaced landmarks read as their places with no text or logo, and `docs/device-runs/M10d2/desktop/notes.json` records the review and U-PLT-8 — proof: manual: desktop browser, `DV_WORLD=synth pnpm dev`, open `/?debug=1&tier=desktop`, call `__dvBridge.world.teleport('lm.twin-peaks')`, repeat at `tier=mobile` and `tier=desktop-ultra`, write the notes file

## Test plan
- **Unit:** `tools/assets/final`, `tools/map/far-cards`, `packages/world` (`facade.atlas`, `atmosphere.adapter`).
- **Gates:** `assets:final`, `assets:verify`, `check:assets`, `provenance:check`, `map:landmarks -- --build --check`, `names:lint`, `ip:strings`.
- **E2E / perf:** `@art-skyline`, `@art-ultra` on `chromium-webgl2`; route scenario in fail mode. M02b1, M02b2, M02d2 and M10d1 tags stay green.
- **Manual:** AC-9 review.

## Demo script
1. `pnpm assets:final`: zero findings.
2. `DV_WORLD=synth pnpm dev`, open `/?tier=mobile-low`, teleport to `lm.twin-peaks`: the East Bay and Marin cards stand on the horizon.

## Effort
1 Builder session; ≈ 16 code files plus generated assets; risk **medium** (rasterizer determinism; adapter compatibility with r186, U-PLT-8).

## Risks & fallbacks
- **takram incompatible with r186 (U-PLT-8):** ship the adapter disabled (flag off) with the fallback path tested; the registry row is satisfied by the adapter module and flag, and the report says so.
- **No supplied landmark files (Q-39):** recipes stay; nothing to replace.
- **Session runs long:** the scan and the cards first (they carry the release gate), then the atlas, then the adapter; an unfinished row keeps `replacedBy: []`, AC-3 fails, and the rest becomes a follow-up file through the Architect.

## Notes for the Builder
- Read first: `02-world-maps.md` §4; `02-world-bake.md` §6, §7; `02-world-living.md` §6; `05-assets-pipeline.md` §7; the M02b1, M02b2, M02d2 and M10d1 files.
- Facts: F-017 (KTX2 tooling). takram's r186 support is UNVERIFIED (U-PLT-8) and stays out of every AC.
- Secrets: none. No genAI spend. Branch `m10d2-art-integration`.
