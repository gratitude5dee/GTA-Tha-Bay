# M10d3 — art-integration

## Goal
After this session the drivable player cars and the fight stages are final v1 art instead of gray-box stand-ins. **Split boundary (M10d, third id; the last art row, after M10d5 and M10d2, DL-460, DL-739, DL-755):** M10d1 covers traffic, police, robotaxi, props and the placeholder registry `config/art-placeholders.json`, M10d4 peds and creator parts, M10d5 the on-foot player and mission actors; this session covers the 14 player cars of `06-racing-content.md` C.1 that have prefabs (the 13 cars of M07a1 and M07b1 plus `ondine-pico`), the six fight stages of `07-fighter-content.md` FX5 and the fighter-model fallback; M10d2 (merged before this row) covers the city surfaces and the `assets:final` scan, which this row turns to `pass`. Each car renders a real body with an original livery on the C07 vehicle node contract extended by C.8 (cockpit, steering wheel, thrusters, `_dent`), so M07b2's VR-7 cockpits and VR-8 dents run on final meshes; each stage ships final `prop/stage-<id>-{day,night}` dioramas; and any roster slot that M10a2 left on its gray-box capsule gets a creator-kit body. Every new file has provenance, passes the IP gates and stays inside the tier and stage budgets.

## Requirements
- R-MODE-02: player cars (supercars, the rocket roadster, the robotaxi) have final bodies, cockpits and dent-ready meshes for the `desktop-ultra` look.
- R-MODE-03: the six fight stages stand at SF landmarks with final art.
- R-IP-01: every new asset has a provenance record, an admitted licence and passes `ip:strings` and `names:lint`.

## Depends on
- **M10d5** (DL-755): the on-foot bodies and the `capsule` row filled. Through it **M10d4** (DL-739): the creator-kit `character/pc-*` parts on `bay_rig_v1`, `fallbackPart`, `packages/engine/src/client/avatar/assemble.ts`; and **M10d1**: `config/art-placeholders.json` and schema (with the three `owner: 'M10d3'` seed rows), `vehicle-gen.ts` and `assets:vehicle` with `assets/genai/vehicles-props.ledger.json`, the recipe route in `tools/assets/src/recipes/`, the vetted import route and `lineCapMicros('vehiclesProps')` (M10d0).
- **M10d2** (DL-755): `pnpm assets:final`, `artFinal`, and the `final.repo` case in `tools/assets/test/final.spec.ts`, which names every repository finding as an `owner: 'M10d3'` row.
- **M07b2:** garage, livery (`texture/<id>` + hue + plate), VR-7 cockpit and VR-8 `_dent` nodes in `packages/modes/racing/src/client/`; through it **M07b1** and **M07a1** (14 prefabs `assets/prefabs/vehicle.<slug>.json` on `vehicle/graybox.<slug>` stand-ins with the C.8 nodes as proxies, handling JSON).
- **M08b2:** six `content/fighter/stages/<id>.json` on `prop/graybox.stage-<id>-{day,night}` stand-ins, `fight-stage` scenario cycling the stages; through it **M08b1** (roster, `check:fighter`) and **M08a2** (`powell_turntable`, capsule fighters `character/graybox.<slug>`).
- **M10a2:** generated fighter models; slugs it lists as `pending` keep `character/graybox.<slug>` until this session.
- Contracts: C07 1.1 (`AssetRef`, tiered variants, `KindExtras` `vehicle`, `ProvenanceRecord` unchanged), C04 1.1 (`bay_rig_v1`), C13 1.1 (budgets), C06 1.1 (prefabs).
- Owner: Q-39 (art sourcing), Q-24 (art lead time). The default applies when they stay open.

## Scope in
- **Sourcing** (`05-assets-pipeline.md` §7 "Race and hero cars" and "Landmarks" rows; Q-39 default): authored bodies or verified CC0/CC-BY bases with original liveries, admitted only with licence snapshot, per-file provenance, `credits.json` lines and a vision and `ip:strings` pass, exactly as in M10d1. Generated bodies are allowed within the vehicles-and-props line (DL-OWN-07 (3), DL-740): M10d1's route (four image-edit views of this milestone's recipe blockout, then multiview-to-3D candidates, H6 picks), live only with `FAL_KEY` and `--live`, refused by the ledger above what M10d1 left of `lineCapMicros('vehiclesProps')` (12,296,000 micros at most); the §7 Meshy buffer route is not used. If the owner supplies no source files by the start of the session, the Builder writes deterministic recipes `tools/assets/src/recipes/{race-car.ts, stage.ts}` with `authored` provenance at the same AssetIds and says so in the report.
- **Player cars:** `vehicle/<slug>` for `ondine-pico`, `ondine-nimbus`, `kestrel-quill`, `kestrel-finch`, `tidewater-neap`, `brackenridge-rasp`, `brackenridge-drayman`, `tidewater-spring`, `aurelian-sorrel`, `aurelian-meridian`, `aurelian-halberd`, `aurelian-apogee`, `solenne-skip`, `halcyon-cormorant` (fictional makes; operator "Halcyon Mobility"), each with `desktop`/`mobile`/`mobile-low` variants. Nodes: the §7 contract (`body`, `wheel_fl|fr|rl|rr`, `steer_fl|fr`, `light_head_l|r`, `light_brake_l|r`, `collider_hull` ≤ 64 vertices, `fictionalMake`) plus the C.8 extension: `cockpit` (`desktop` and `mobile` only), `steering_wheel`, `anchor_driver`, `anchor_hood`, `exhaust_l|r`, `thruster_fl|fr|rl|rr` (`solenne-skip` only) and the `_dent` vertex attribute (0..1) on `body`. H6 checks of §7 hold (wheel spin axis, steer pivot, no interior at `lo`, hull within 5 cm). Base liveries take M07b2's hue and plate. Each prefab `vehicle.<slug>.json` points `render.asset` at `vehicle/<slug>` (`vehicle.ondine-pico` moves off M10d1's traffic body); `anchors.ts` resolves the nodes.
- **Stages:** `prop/stage-<id>-day` and `prop/stage-<id>-night` for `powell_turntable`, `ferry_plaza`, `dolores_slope`, `bayview_cranes`, `alcatraz_yard`, `mission_bay_court`, built over open-data massing and the stage's `landmarkRefs` (A-05), original art, no landmark used as a logo, no mural or public art, fictional venue names; `alcatraz_yard` in museum state (`07-fighter-content.md` FX4.6). Budgets per the FX5 stage-budget table (≤ 60 % of the tier's render objects and triangles, ≤ 50 % of its texture MB). `content/fighter/stages/<id>.json` `scene` switches to the final refs.
- **Fighter-model fallback:** every `assets.model` or `standIn.assets.model` in `content/fighter/roster.json` still on `character/graybox.<slug>` after M10a2 gets `character/kit.<slug>`, assembled from M10d4 creator-kit parts on `bay_rig_v1` (no likeness; the fighter's `standIn` and tier rules are unchanged); the report lists those slugs.
- **Registry:** fill `replacedBy` for the three `owner: 'M10d3'` rows (player cars, stages, fighter models).
- **Release scan:** with every row filled, `pnpm assets:final` passes; this row edits M10d2's `final.repo` case to expect zero findings.

## Scope out
- Traffic, police, ambient robotaxi, props: M10d1. Peds, creator parts: M10d4. The on-foot player and mission actors: M10d5. Facade atlas, skyline cards, landmark pass, atmosphere, the `assets:final` scan: M10d2. The `art-final` gate: M14b3.
- Generated fighter characters and fighter animation: M10a1–M10a2, M08b1 (Q-24). Backlog stages (`lombard_switchbacks` and the others in FX5): not v1.
- Device calibration with final art: the M14b3 release device pass.

## Deliverables
- `tools/assets/src/recipes/{race-car.ts, stage.ts}` (recipe fallback only) or supplied files through `tools/assets/src/import/kit.ts`; `tools/assets/src/recipes/fighter-kit.ts` (creator-part assembly); `tools/assets/test/{race-car.nodes, stage.budget, fighter-kit}.spec.ts`.
- `packages/modes/racing/test/car-art.spec.ts` (nodes through `anchors.ts`, cockpit and dent bindings); `packages/modes/fighter/test/stage-art.spec.ts`.
- `assets/prefabs/vehicle.<slug>.json` (14, render refs), `content/fighter/stages/*.json` (6, `scene`), `content/fighter/roster.json` (fallback models), `config/art-placeholders.json` (M10d3 rows).
- Edit M10d2's `tools/assets/test/final.spec.ts` (`final.repo` case: zero findings).
- Edits to M10d1's `tools/assets/src/vehicle-gen.ts` (player-car slugs; `--check` covers this milestone's ledger entries).
- `tests/e2e/art.spec.ts` (adds `@art-cars`, `@art-stages`).
- Generated and committed (not counted): `.glb`/KTX2 files, `asset.json`, provenance records, lock entries, licence snapshots, credits lines.
- ≈ 15 code files.

## Interfaces
- C07 1.1 unchanged: stand-ins are identified by `<kind>/graybox.*` AssetRefs and registry rows (DL-390). The C.8 node names are the S06 extension of `KindExtras` `vehicle` already in `06-racing-content.md` C.8; no contract change. C04 1.1 and C13 1.1 unchanged.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the registry, prefabs, stages and roster When the art tests run Then every `owner: 'M10d3'` row has a non-empty `replacedBy` whose refs exist in the catalog, and no `vehicle.<slug>` `render.asset`, stage `scene` or roster model matches `^[a-z_]+/graybox\.` — proof: `pnpm check:unit -- tools/assets packages/modes/racing packages/modes/fighter`
- AC-3 Given the 14 car bodies When the node test runs Then each variant exposes the §7 nodes and the C.8 nodes (no `cockpit` at `mobile-low`, thrusters only on `solenne-skip`), `body` carries `_dent` in 0..1, wheels spin about local X, steer pivots about Y, the hull has ≤ 64 vertices within 5 cm of the body, and render objects per car stay ≤ 6/4/2 — proof: `pnpm check:unit -- tools/assets packages/modes/racing`
- AC-4 Given the new assets When the asset gates run Then every asset has its three variants inside budget (player cars against the `vehicle-race` or `vehicle-hero` row of `config/asset-budgets.json`, enforced by `check:assets` since M10d1; DL-683 part 2) and a provenance record with an allowlisted licence, and every third-party pack has its licence snapshot and credits lines — proof: `pnpm assets:catalog && pnpm assets:verify && pnpm check:assets && pnpm provenance:check`
- AC-5 Given the new makes, liveries, stages and roster When the IP and fighter gates run Then all pass and no `fictionalMake` matches the denylist — proof: `pnpm names:lint && pnpm ip:strings && pnpm ip:signatures && pnpm check:fighter`
- AC-6 Given the six final stages When `fight-stage` runs for every flat tier in fail mode Then each stage stays inside its FX5 stage budget — proof: `pnpm check:perf -- --scenario fight-stage --fail`
- AC-7 Given a QA build with the `synth` world When `@art-cars` spawns each `vehicle.<slug>` at `?tier=desktop` and `?tier=mobile-low` and `@art-stages` opens each stage day and night Then bridge `observe()` lists no `graybox.` ref, and at `desktop` the cockpit camera shows the `cockpit` node — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@art-cars|@art-stages"`
- AC-8 Given a local QA build in a desktop browser When the reviewer opens the garage for every car and Versus on every stage at `?tier=desktop` and `?tier=mobile-low` Then no car shows a real brand, badge or text, no stage shows a logo, mural or prisoner imagery, and the review is recorded in `docs/device-runs/M10d3/desktop/notes.json` — proof: manual: desktop browser, `DV_WORLD=synth pnpm dev`, open `/?debug=1&unlockAll=1&tier=desktop`, visit Garage and Culture Wars stage select, repeat at `tier=mobile-low`, write the notes file
- AC-9 Given `FAL_MODE=mock` fixtures When `assets:vehicle` runs for a player-car slug Then `--live` without `FAL_KEY` or a live M00c spike prints `SKIP` and exits 0, an input not rendered by this milestone's recipes is refused, a job that would take the vehicles-and-props ledger past `lineCapMicros('vehiclesProps')` (so past M10d1's spend plus 12,296,000 micros) is refused, and the ledger equals the provenance costs — proof: `pnpm check:unit -- tools/assets && pnpm assets:vehicle -- --check`
- AC-10 Given the repository after this session When the placeholder scan and its tests run Then `assets:final` exits 0 with `status: 'pass'` and zero findings, and the `final.repo` case expects zero findings — proof: `pnpm assets:final && pnpm check:unit -- tools/assets`

## Test plan
- **Unit:** `tools/assets` (`race-car.nodes`, `stage.budget`, `fighter-kit`, `vehicle-gen` ledger cases, `final.repo`, recipe determinism if used), `packages/modes/racing` (`car-art`), `packages/modes/fighter` (`stage-art`).
- **Gates:** `assets:final`, `assets:catalog`, `assets:verify`, `check:assets`, `provenance:check`, `names:lint`, `ip:strings`, `ip:signatures`, `check:fighter`.
- **E2E / perf:** `@art-cars`, `@art-stages` on `chromium-webgl2`; `fight-stage` in fail mode. M07a1–M07b2, M08a2–M08b2, M10d1, M10d4, M10d5 and M10d2 tags stay green.
- **Manual:** AC-8 review.

## Demo script
1. `DV_WORLD=synth pnpm dev`, open `/?unlockAll=1&tier=desktop`, Garage: the Sorrel, the Skip with its thrusters and the Cormorant robotaxi show final bodies; enter cockpit view.
2. Culture Wars, Versus, stage select: `ferry_plaza` at night and `alcatraz_yard` by day load their final dioramas.

## Effort
1 Builder session; ≈ 15 code files plus generated assets; risk **medium** (14 bodies on the extended node contract; source availability, Q-39).

## Risks & fallbacks
- **No supplied art (Q-39 open):** recipe fallback at the same AssetIds; the owner may replace the files later without an id change.
- **A CC0 pack's terms cannot be snapshotted (U10):** drop the pack, use the recipe fallback for those assets.
- **Budget overrun on `mobile-low` or a stage:** simplify the `lo` variant or the diorama; never raise a budget here.
- **Session runs long:** cars of classes A, S and R and the six stages first, then the other cars, then the fighter fallback; an unfinished row keeps `replacedBy: []`, AC-2 and AC-10 fail, and the rest becomes a follow-up file through the Architect.

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §3, §4, §7; `06-racing-content.md` C.1, C.8, C.10; `07-fighter-content.md` FX4.6, FX5 and the asset table; the M07a1, M07b1, M07b2, M08a2, M08b2, M10d1, M10d4, M10d5 and M10d2 files.
- Facts: F-017 (KTX2 tooling). The CC0 catalogue terms are UNVERIFIED (U10) and stay out of every AC; the licence snapshot is the evidence.
- Secrets: `FAL_KEY` (optional; generated bodies only, within what M10d1 left of the vehicles-and-props line, after a live M00c spike; else `SKIP` and recipes). CI stays `FAL_MODE=mock`; every paid run prints its estimate and needs `--live`. Owner gates: Q-39 and Q-24 (defaults apply). Branch `m10d3-art-integration`.
