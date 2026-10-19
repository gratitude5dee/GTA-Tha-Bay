# M10d1 — art-integration

## Goal
After this session the people and vehicles of the city are final v1 art instead of gray-box stand-ins. **Split boundary (M10d, split 1 of 3):** this session covers ambient vehicles, props, pedestrians and the creator kit; M10d3 (run next, DL-460) covers the player cars, the fight stages and the fighter-model fallback; M10d2 covers the city surfaces (facade atlas, skyline cards, landmark art pass, `desktop-ultra` atmosphere) and the `assets:final` placeholder scan. Ambient traffic (10 archetypes), police (6) and the robotaxi render real low-poly bodies with original liveries on the C07 vehicle node contract; every remaining `vehicle/graybox.*` and `prop/graybox.*` render asset in `assets/prefabs/` is replaced; the pedestrian kit ships 8 adult bodies × 20 outfits on `bay_rig_v1` with palette swaps; and the creator-kit `character/pc-<slot>-<id>` and `portrait/pc-<slot>-<id>` parts give every creator row a `model`. Every new file has provenance, passes the IP gates and stays inside the tier budgets. A placeholder registry, `config/art-placeholders.json`, lists every stand-in the earlier milestones shipped and which split replaces it (DL-390, DL-460).

## Requirements
- R-MODE-02 (s): police cruisers and robotaxis in pursuits and races have final bodies and liveries.
- R-MAP-04: the living city (traffic, robotaxis, pedestrians) is rendered with final v1 art.
- R-UI-01: creator body, face, hair and outfit presets show real parts instead of mannequin variants.
- R-IP-01: every new asset has a provenance record, an admitted licence and passes `ip:strings` and `names:lint`.

## Depends on
- **M05c2** (A-06 vertical slice; art integration starts after it, `_PLAN.md` §1).
- **M03b2:** pedestrian bodies (far `InstancedMesh`, near mannequin on `bay_rig_v1`), `ped.ambient.{a..h}` palettes. Through it **M03b1** (traffic `InstancedMesh` per archetype, box cars) and **M03a1** (prefabs with `vehicle/graybox.<archetype>` and `prop/graybox.<name>`, `anchors.ts` reading `extras.nodes`).
- **M04b2:** creator catalog `content/ui/creator/catalog.json`, `wardrobe-item.v1.schema.json`, `CreatorStage` (parts without `model` render as mannequin variants).
- **M01d:** `assets:catalog`, `assets:verify`, lock, `provenance:check`; `tools/assets` optimize steps.
- Contracts: C07 1.1 (`AssetRef`, tiered variants, `KindExtras` `vehicle` anchors, `ProvenanceRecord` unchanged), C04 1.1 (`bay_rig_v1`), C13 1.1 (`CrowdLimits`, budgets), C06 1.1 (prefabs).
- Owner: Q-39 (art sourcing), Q-24 (art lead time). The default applies when they stay open.

## Scope in
- **Placeholder registry** `config/art-placeholders.json` with schema `config/schemas/art-placeholders.schema.json`. One entry per stand-in: `{ id, what, owner: 'M10d1'|'M10d2'|'M10d3', match: { refPrefix?: string, file?: string, pointer?: string }, replacedBy: AssetRef[] }`. Seed rows: `vehicle/graybox.*`, `prop/graybox.*` (M03a1, M01b1); traffic box cars (M03b1; `config/world/traffic-art.json`, new, maps each archetype to its body AssetRef); ped mannequin near LOD and rigid far figures (M03b2); creator rows without `model` (M04b2); `texture/far-bay-cards` PNG placeholder (M02b1); facade atlas absent (M02b1); `desktop-ultra` sky falling back to the desktop dome (M02b2); player-car bodies `vehicle/graybox.<slug>` (M07a1, M07b1; owner M10d3); fight-stage dioramas `prop/graybox.stage-<id>-{day,night}` (M08a2, M08b2; owner M10d3); fighter capsule models `character/graybox.<slug>` that M10a2 leaves `pending` (M08a2, M08b1; owner M10d3). This session fills `replacedBy` for its own rows.
- **Sourcing** (`05-assets-pipeline.md` §7 table; Q-39 default): authored low-poly bodies or verified CC0/CC-BY bases with original liveries; a third-party pack enters only with (a) the licence-page snapshot `docs/legal/licenses/<pack>.md` with SHA-256, (b) per-file provenance, (c) `credits.json` lines, (d) a vision and `ip:strings` pass. No fal or other genAI meshes (DL-OWN-01; §11 "not funded"). If the owner supplies no source files by the start of the session, the Builder writes deterministic code recipes in `tools/assets/src/recipes/` (the M02d1 landmark-kit route) with `authored` provenance at the same AssetIds, and says so in the report.
- **Vehicles:** `vehicle/traffic.<archetype>` × 10 (the M03b1 archetypes), `vehicle/police.{cruiser,suv}` and the police heli body, `vehicle/robotaxi.default` (operator "Halcyon Mobility", fictional make), each with `desktop`/`mobile`/`mobile-low` variants and the §7 node contract (`body`, `wheel_*`, `steer_*`, `light_*`, `collider_hull`, `fictionalMake`). The traffic renderer (`packages/world/src/client/traffic/`) switches from box cars to one `InstancedMesh` per archetype built from the `lo`/`mid` body, keeping instance colour and light-state attributes and the two-box far LOD beyond 150 m. Prefabs in `assets/prefabs/` point `render.asset` at the new refs; `anchors.ts` reads the real nodes.
- **Props:** every `prop/graybox.*` render asset (other than the M10d3 stage rows) still referenced in `assets/prefabs/` (`prop.{cone,barrier,spikestrip,crate}`, `pickup.{cash,item}`, `player.default` capsule if still used) gets a final `prop/<name>` asset.
- **Pedestrian kit** (`02-world-living.md` §4.5): `character/ped.body.{a..h}` (adult, no likeness, no child body) skinned on `bay_rig_v1`, 20 outfit assets `character/ped.outfit.<nn>` sharing that skeleton, palette swaps from `ped.ambient.{a..h}`; far LOD `prop/ped.far.{a..h}` rigid ≤ 300 triangles with the existing TSL gait. Near-LOD caps per tier unchanged.
- **Creator kit** (`05-assets-pipeline.md` §14 "Creator kit"; `10-ui-pages.md` §2.8): `character/pc-<slot>-<id>` and `portrait/pc-<slot>-<id>` for every Body, Face, Hair and Outfit row of `content/ui/creator/catalog.json`, which gains `model` on each of those rows; `CreatorStage` drops the mannequin path for rows that have a model; `AppearanceV1` encoding unchanged (golden vectors stay byte-equal).
- **Budgets:** triangles and texture memory per variant inside `config/tier-budgets.json` and the `check:assets` size limits; `CrowdLimits` totals unchanged. Per-asset vehicle budgets are owned here (DL-683 part 2): `config/asset-budgets.json` gains `vehicle-traffic` (`class:traffic`, ambient archetypes and the robotaxi), `vehicle-police` (`class:police`) and `vehicle-hero` (`class:hero`, the values of the existing `vehicle-race` row, `05-assets-pipeline.md` §3 "Race or hero car") on the M02d1 stats mechanism, so `check:assets` enforces `tris` and `materials` for every vehicle asset. Design values (†): `vehicle-traffic` hi / mid / lo 12,000 / 5,000 / 1,500 triangles, ≤ 3 / 2 / 1 materials, textures ≤ 1,024² / 512² / 256²; `vehicle-police` 15,000 / 6,000 / 2,000 triangles with the same material and texture limits. The file's `note` names M10d1 for vehicles and M10a1 for characters.

## Scope out
- Facade atlas, rasterized skyline cards, landmark art pass, `desktop-ultra` atmosphere adapter and the `assets:final` scan: M10d2.
- Player cars (`vehicle/graybox.<slug>` from M07a1 and M07b1, including `vehicle.ondine-pico`'s own body; this session points it at `vehicle/traffic.compact` meanwhile), fight stages and the fighter-model fallback: M10d3 (DL-460); this session only seeds their registry rows.
- Generated (fal) characters and NPC looks: M10a1–M10a2. Fighter animation: M08b1, M10a2 (Q-24).
- Device calibration with final art: the M14b3 release device pass.

## Deliverables
- `config/art-placeholders.json`, `config/schemas/art-placeholders.schema.json`.
- `tools/assets/src/recipes/{vehicle.ts, ped.ts, creator-part.ts, prop.ts}` (only on the recipe fallback) or `tools/assets/src/import/kit.ts` (import of supplied files through the optimize steps); `tools/assets/test/{recipes, art-placeholders}.spec.ts`.
- `packages/world/src/client/traffic/{archetype-mesh.ts}` (glTF body to instanced mesh), `packages/world/src/client/peds/{kit.ts}` (body plus outfit assembly), `packages/world/test/{traffic.art, peds.kit}.spec.ts`.
- `packages/ui/src/creator/stage.ts` (model path), `packages/ui/test/creator.parts.spec.ts`.
- `config/asset-budgets.json` (rows `vehicle-traffic`, `vehicle-police`, `vehicle-hero`; DL-683 part 2), `assets/prefabs/*.json` (render refs), `config/world/traffic-art.json` (new: archetype → body AssetRef, read by the traffic renderer), `content/ui/creator/catalog.json` (`model` fields).
- `tests/e2e/art.spec.ts` (`@art-city`, `@art-creator`).
- Generated and committed (not counted): `.glb`/KTX2 files, `asset.json`, provenance records, lock entries, licence snapshots, credits lines.
- ≈ 20 code files.

## Interfaces
- C07 1.1 unchanged: placeholders are identified by AssetRef prefix and by registry entries, never by a new provenance field (C07 has none for stages).
- C04 1.1 `bay_rig_v1` unchanged; C13 1.1 budgets unchanged. `config/art-placeholders.json` is internal config read by M10d2's scan and M14b3's gate.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given `config/art-placeholders.json` When its schema test runs Then it is schema-valid, holds the eleven seed rows named in Scope in, every `owner: 'M10d1'` row has a non-empty `replacedBy` whose refs exist in the catalog, and a fixture row with an empty `replacedBy` fails naming its id — proof: `pnpm check:unit -- tools/assets`
- AC-3 Given the new assets When the asset gates run Then every new asset has `desktop`, `mobile` and `mobile-low` variants inside its budget (each vehicle against its `config/asset-budgets.json` class row, `vehicle-traffic` or `vehicle-police`, whose `tris` and `materials` `check:assets` enforces; DL-683 part 2), a provenance record with an allowlisted licence, and every third-party pack has its licence snapshot and credits lines — proof: `pnpm assets:catalog && pnpm assets:verify && pnpm check:assets && pnpm provenance:check`
- AC-4 Given the new assets and liveries When the IP gates run Then makes, models, operators and textures pass and no `fictionalMake` matches the denylist — proof: `pnpm names:lint && pnpm ip:strings && pnpm ip:signatures`
- AC-5 Given `assets/prefabs/` When the prefab test runs Then no `render.asset` matches `^[a-z_]+/graybox\.` except prefabs listed in the registry under `owner: 'M10d2'` or `owner: 'M10d3'`, and every vehicle body exposes the C07 vehicle nodes that `anchors.ts` resolves — proof: `pnpm check:unit -- packages/engine tools/assets`
- AC-6 Given a mock asset client When the traffic and ped renderers build their meshes Then each archetype is one `InstancedMesh` from its glTF body with colour and light-state attributes, each ped near LOD binds to `bay_rig_v1` with one outfit and one palette, and totals stay within `CrowdLimits` per tier — proof: `pnpm check:unit -- packages/world`
- AC-7 Given the creator catalog When the creator tests run Then every Body, Face, Hair and Outfit row has a `model` that resolves in the catalog, and the `AppearanceV1` golden vectors are byte-equal to M04b2's — proof: `pnpm check:unit -- packages/ui`
- AC-8 Given a QA build with the `synth` world When `@art-city` runs at `?tier=desktop` and `?tier=mobile-low` and `@art-creator` opens New Game Then traffic, police, robotaxis and pedestrians render from the new assets (bridge `observe()` lists no `graybox.` ref), and the creator stage shows a model for each tab — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@art-city|@art-creator" && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @art-city`
- AC-9 Given the same build When `downtown-rush` runs for every flat tier in fail mode Then render objects, triangles and texture memory stay within each tier's budget — proof: `DV_WORLD=synth pnpm check:perf -- --scenario downtown-rush --fail`
- AC-10 Given a local QA build in a desktop browser When the reviewer walks Market Street at `?tier=desktop` and `?tier=mobile-low` and opens the creator Then no vehicle shows a real brand, badge or text, no ped resembles a real person, and the review is recorded in `docs/device-runs/M10d1/desktop/notes.json` — proof: manual: desktop browser, `DV_WORLD=synth pnpm dev`, open `/?debug=1&tier=desktop`, call `__dvBridge.world.teleport('lm.ferry-building')` and walk up Market Street, repeat at `tier=mobile-low`, open New Game, write the notes file

## Test plan
- **Unit:** `tools/assets` (registry schema, recipes determinism if used), `packages/world` (`traffic.art`, `peds.kit`), `packages/ui` (`creator.parts`), `packages/engine` (prefab anchors).
- **Gates:** `assets:catalog`, `assets:verify`, `check:assets`, `provenance:check`, `names:lint`, `ip:strings`, `ip:signatures`.
- **E2E / perf:** `@art-city` (Chromium, WebKit), `@art-creator` (Chromium); `downtown-rush` in fail mode. M03b1, M03b2 and M04b2 tags stay green.
- **Manual:** AC-10 review.

## Demo script
1. `DV_WORLD=synth pnpm dev`, open `/?debug=1&tier=desktop`, teleport to `lm.ferry-building` and face Market Street: liveried traffic, a Halcyon Mobility robotaxi and dressed pedestrians pass.
2. Open New Game: the creator stage shows the body and outfit parts.

## Effort
1 Builder session; ≈ 20 code files plus generated assets; risk **medium** (source availability, Q-39; skinning the ped kit on `bay_rig_v1`).

## Risks & fallbacks
- **No supplied art (Q-39 open):** recipe fallback at the same AssetIds; the owner may replace the files later without an id change.
- **A CC0 pack's terms cannot be snapshotted (U10):** drop the pack, use the recipe fallback for those assets; never ship a file without its licence snapshot.
- **Budget overrun on `mobile-low`:** simplify the `lo` variant; never raise a budget in this milestone.
- **Session runs long:** finish vehicles and props first, then the ped kit, then the creator parts; any unfinished row keeps `replacedBy: []` and AC-2 fails, so the rest becomes a follow-up file through the Architect.

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §3, §4, §7, §14; `02-world-living.md` §2.6, §4.5; `10-ui-pages.md` §2.8; the M03a1, M03b1, M03b2 and M04b2 files (stand-ins and renderers).
- Facts: F-017 (KTX2 tooling). The CC0 catalogue terms are UNVERIFIED (U10) and stay out of every AC; the licence snapshot is the evidence.
- Secrets: none. No genAI spend. Owner gates: Q-39 and Q-24 (defaults apply). Branch `m10d1-art-integration`.
