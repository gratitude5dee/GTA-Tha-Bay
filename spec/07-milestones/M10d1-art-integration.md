# M10d1 — art-integration

## Goal
After this session the city's cars and props are final v1 art. **Split boundary (DL-OWN-07 Phase 3; the earlier one-session M10d1 is split in two, DL-739):** vehicles, props and the placeholder registry here; pedestrians and creator parts in M10d4; player cars and stages in M10d3; surfaces in M10d2.

Traffic, police, the Halcyon Mobility robotaxi and transit get realistic bodies (fictional makes, altered silhouettes, text-free liveries) from vetted CC0 or CC-BY bases, at most two fal bodies (DL-OWN-07 (3)) and code recipes, with separate `glass`, `tyre_*`, `rim_*` and emissive `light_*` nodes, clearcoat paint on desktop, `MeshStandard` on mobile, and meshopt LODs. A ledger keeps `mobile-low` ≤ 100 render objects and `legacy` at +0. Today a car is three boxes (`packages/world/src/client/traffic/instances.ts:56`, `:116–126`; render audit item 7; capture study "Vehicles"; art-source study "Ambient traffic").

## Requirements
- R-MODE-02 (s): pursuit police and robotaxis have final bodies and liveries.
- R-MAP-04: traffic, robotaxis, transit and props render final v1 art.
- R-IP-01: every new file has provenance, an admitted licence, and passes `ip:*` and `names:lint`.
- R-ENG-02: tier budgets hold; a per-profile ledger is checked.

## Depends on
- **M10d0:** `docs/legal/licenses/packs.json`, the vetting checklist and `assets:import -- vet`, the `licensed` gate, `credits.json` `art[]`, `lineCapMicros('vehiclesProps')`.
- **M05c2:** the vertical slice.
- **M03b2:** transit dressing; through it **M03b1** (`TrafficRenderer`, `aTint`, `aLights`, `ARCHETYPES` at `packages/world/src/sim/traffic/components.ts:102–105`) and **M03a1** (prefabs, `anchors.ts`, `vehicle-view.ts`).
- **M04b2:** creator catalog (seeds M10d4 rows).
- Run order: after M02g1 (`skyReflect`, blob layer, casters, ledger shape) and M02h6 (`traffic/parked-dressing.ts`).
- Contracts: C07 1.1, C06 1.1, C13 1.2 (read).

## Scope in
† = design value, tuned here.
- **Registry** `config/art-placeholders.json` + schema: rows `{ id, what, owner: 'M10d1'|'M10d4'|'M10d2'|'M10d3', match, replacedBy, repoint?: Record<AssetRef, AssetRef> }` (DL-390). Seed twelve rows (the eleven of DL-390 plus the on-foot capsule, DL-741), each with its owner: `vehicle/graybox.*` ambient and police vehicles (`M10d1`), `prop/graybox.*` props other than the capsule and the stage dioramas (`M10d1`), traffic box cars (`M10d1`), ped mannequins (`M10d4`), creator rows without `model` other than the six Coast rows (`M10d4`), far-bay cards, facade atlas and `desktop-ultra` sky (`M10d2`, one row each), player-car bodies, stage dioramas, fighter capsules and `prop/graybox.capsule` in `player.default` and `ped.actor` (`M10d3`, one row each). Fill `replacedBy` and `repoint` for `M10d1` rows.
- **Assets** (24; `desktop`/`mobile`/`mobile-low` = `hi`/`mid`/`lo`):
  - `vehicle/traffic.{compact,sedan,rideshare,van,truck,pickup}`, `vehicle/robotaxi.default`, `vehicle/police.{cruiser,suv}`, `vehicle/transit.{bus,cablecar}` (the 8 `ARCHETYPES`, not the "10" of DL-390);
  - `prop/police.heli` (`rotor_main`, `rotor_tail`, spun like `buildHeli`, `vehicle-view.ts:216–227`), `prop/transit.{ferry,airliner}`;
  - `prop/{cone,barrier,county-barrier,spikestrip,crate,transit-entrance,portal-closure,pickup-cash,pickup-item,marker.beam}`. The owner's yellow "boom" is probably the 30 m `beam` box (`vehicle-view.ts:253–255`); the final beam is an emissive gradient fading out within 12 m † of the camera.
  - `convoy.*` reuse traffic refs; `vehicle.ondine-pico` uses `traffic.compact` until M10d3.
- **Sourcing, in order:**
  1. **Licensed** (DL-OWN-06; art-source study): the OpenGameArt CC0 "Free Low Poly Vehicles Pack", Quaternius "LowPoly Public Transport", Poly Haven street props, optional vetted Sketchfab CC-BY singles in `content-incoming/`. New packs get M10d0 register rows (Quaternius becomes `import`); every item is vetted, and every vehicle's vetting record carries the per-vehicle silhouette check of M10d0's checklist (rule `V-SIL`: side and three-quarter profile compared with the denylisted makes; a match is remodelled or dropped). `import/vehicle.ts` remodels to realistic proportions (scales, roof and hood offsets, re-cut arches, no grille or badge faces) and writes `changes`.
  2. **fal, ≤ 2 bodies** (`sedan`; `pickup`, the m.a1.01 tow vehicle): §11 Lean recipe without the rig (`05-assets-pipeline.md:168`). Four `google/nano-banana-2.1/edit` 2K views ($0.252; `research/genai-pipeline-fal.md:77`) of this milestone's own recipe blockout, then two `tripo3d/h3.1/multiview-to-3d` standard candidates ($0.60; `:93`, `:383`): ≤ 1,704,000 micros; M10d3 keeps 12,296,000. A Tripo row joins `config/genai-endpoints.json` (`licenseType` as `genai:liveness` reports). Live runs need `FAL_KEY` and a live M00c spike result (its ledger shows 0 micros), else `SKIP`. Fused wheels become recipe wheels, the window band `glass`; H6 picks. The target image and real-car photos are never inputs.
  3. **Recipes** `recipes/{vehicle,wheel,prop}.ts` on the M02d1 kit (`tools/map/src/landmarks/kit/gltf-writer.ts`): bodies lofted from 3–4 cross-sections (audit item 7), deterministic, `authored` provenance; they build every AssetId first.
- **Nodes** (C07 shape unchanged; children by name, BD row): `body` holds paint, `glass` and `light_head_l|r`/`light_brake_l|r`; police lamps are `sirens`; `wheel_*` hold `tyre_*` and `rim_*`; plus `steer_*`, `collider_hull` (≤ 64 vertices), `fictionalMake` (player-car makes, new model names; Halcyon for the robotaxi). Per-entity meshes ≤ the prefab's measured gray-box count.
- **LOD** `lod.ts`: `meshoptimizer@1.3.0` simplify, `@gltf-transform` meshopt and KTX2 (§3 pins), stats in `asset.json`.
- **Budgets** (`config/asset-budgets.json`, DL-683 part 2):

| Row | Tag | Tris hi / mid / lo † | Materials | Textures |
|---|---|---|---|---|
| `vehicle-traffic` | `class:traffic` | 12,000 / 3,000 / 800 | 4 / 3 / 1 | 1,024² / 512² / 256² |
| `vehicle-police` | `class:police` | 15,000 / 4,000 / 1,200 | 4 / 3 / 1 | same |
| `vehicle-hero` | `class:hero` | `vehicle-race` values | | |
| `prop-street` | `prop:street` | 2,000 / 800 / 300 | 2 / 1 / 1 | 512² / 256² / 128² |
| `prop-backdrop` | `prop:backdrop` | 8,000 / 3,000 / 1,000 | 2 / 2 / 1 | 1,024² / 512² / 256² |

- **Materials** (`traffic/materials.ts`, also used per entity): one TSL material per profile, a vertex part id (paint, glass, tyre, rim, lamp), lamps from `aLights`. `full`: `MeshPhysicalNodeMaterial`, clearcoat 1 †, hue flake; `lite`, `min`: `MeshStandardNodeMaterial`, roughness 0.3; glass reflects the env map or M02g1 `skyReflect`; `legacy`: vertex colour.
- **Instanced traffic** (`traffic/archetype-mesh.ts`, `config/world/traffic-art.json` + schema): families per profile, each drawing its base body (`mid` on `full`, else `lo`, wheels merged); members use instance scale, `aTint`, `aLights` and a livery bit. `full`: car (compact, sedan, rideshare, cruiser), robotaxi, pickup, box (van, truck); `lite`: car+robotaxi, pickup, box; `min`: car+robotaxi+pickup, box; `legacy`: one. `full` splits opaque and glass. M02h6 parked dressing mirrors families; bodies cast under M02g1's rule. `TRAFFIC_DRAWS_MAX` (`tools/ci/perf-check.ts:161`) becomes the family-mesh count.
- **Ledger** `docs/look/M10d1-render-ledger.json` (M02g1 shape plus `triangles`), baseline measured on the default branch at session start (`downtown-rush`, `story-chase`); `DV_LOOK_WRITE=1` writes it, `@art-ledger` checks it:

| Profile | Families × meshes | Objects added (≤) | Traffic tris at cap (≤) |
|---|---|---|---|
| `full` | 4 × 2 | 14 + 9 casters (3 cascades) | 540 × 3,000 (desktop) |
| `lite` | 3 × 1 | 4 | 200 × 800 |
| `min` | 2 × 1 | 2; total ≤ 100 | 120 × 800 |
| `legacy` | 1 × 1 | 0 | 120 × 800 |

- **Prefabs:** `assets:vehicle -- --repoint` sets `render.asset` from the registry.
- **Bridge (QA):** `world.art()` → `{ profile, families, objects, refs, materialKind }`.

## Scope out
- Peds, creator parts: M10d4 (the Coast rows are M10a2's, merged). Player cars, stages, fighter capsules and the on-foot capsule: M10d3. Surfaces: M10d2. Furniture: M02h6. `xr` profile: M02h8. Spec edits (§7, §11, `02-world-living.md` §2.6) and a tow-boom node: Architect.

## Deliverables
- `config/{art-placeholders.json, schemas/art-placeholders.schema.json, world/traffic-art.json, schemas/traffic-art.schema.json}`; edits to `config/{asset-budgets.json, genai-endpoints.json}`.
- `tools/assets/src/{lod.ts, placeholders.ts, vehicle-gen.ts, import/vehicle.ts, recipes/vehicle.ts, recipes/wheel.ts, recipes/prop.ts}`; `tools/assets/test/{art-placeholders, recipes.vehicle, import.vehicle, vehicle-gen, lod}.spec.ts`.
- Root script **`assets:vehicle`** (`tsx tools/assets/src/vehicle-gen.ts`): `--dry-run` (default), `--live` (`FAL_KEY`; CI `FAL_MODE=mock`), `--turntable`, `--repoint`, `--check` (prefabs, and `assets/genai/vehicles-props.ledger.json` against the line cap and 1,704,000).
- `packages/world/src/client/traffic/{archetype-mesh.ts, materials.ts}`; edits to `traffic/{instances.ts, parked-dressing.ts}`, `world-bridge.ts`; `packages/world/test/traffic.art.spec.ts`.
- `packages/engine/src/client/vehicle/{gltf-thing.ts, marker-beam.ts}`; edits to `vehicle-view.ts`, `anchors.ts`, `tools/ci/perf-check.ts`; `packages/engine/test/vehicle/art-nodes.spec.ts`.
- `tests/e2e/art-city.spec.ts` (`@art-city`, `@art-ledger`, `@xr @art-city`).
- Generated (not counted): assets, provenance, lock, credits, intake records, prefab repoints, ledger, goldens.

## Interfaces
- C07 1.1 `KindExtras` vehicle unchanged (child names; `sirens`; existing `class` values). C06 1.1: `render.asset` values only. C13 1.2: budgets and `CrowdLimits` unchanged.
- Contract change proposals: none of shape.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given `config/art-placeholders.json` When its test runs Then it holds the twelve seed rows with the owners of Scope in, every `M10d1` row's `replacedBy` and `repoint` refs resolve in the catalog, and a fixture with an empty `replacedBy` fails naming its id — proof: `pnpm check:unit -- tools/assets`
- AC-3 Given the 24 assets When the asset gates run Then each has three variants within its budget row with LOD stats, two recipe runs are byte-identical, and every licensed record has a register snapshot, an approved vetting review, `changes` and credits lines — proof: `pnpm assets:catalog && pnpm assets:verify && pnpm check:assets && pnpm provenance:check`
- AC-4 Given makes, liveries and file names When the IP gates run Then no make or model matches the denylist and no game extension or rip-style name exists — proof: `pnpm names:lint && pnpm ip:strings && pnpm ip:signatures && pnpm ip:extensions`
- AC-5 Given `assets/prefabs/` When the prefab and node tests run Then:
  - no `render.asset` matches `^[a-z_]+/graybox\.` outside rows owned by `M10d4`, `M10d2` or `M10d3`;
  - `anchors.ts` resolves body, wheels, steers, lights, `glass`, tyres and rims; wheels spin about X, steers about Y (H6);
  - per-entity meshes are ≤ the gray-box counts and state hashes are unchanged.
  — proof: `pnpm check:unit -- packages/engine tools/assets && pnpm --filter @dv/engine test:determinism && pnpm assets:vehicle -- --check`
- AC-6 Given a mock asset client When `traffic.art` builds each profile Then families and meshes equal the ledger table, `materialKind` is `physical` only on `full`, `aTint`, `aLights` and the livery bit survive, parked dressing mirrors the families, and instances stay within `CrowdLimits` — proof: `pnpm check:unit -- packages/world`
- AC-7 Given `FAL_MODE=mock` fixtures When `vehicle-gen` runs Then `--live` without `FAL_KEY` or a live spike prints `SKIP` and exits 0, an input not rendered by this milestone's recipes is refused, a job past 1,704,000 micros or the line cap is refused, and the ledger equals the provenance costs — proof: `pnpm check:unit -- tools/assets && pnpm assets:vehicle -- --check`
- AC-8 Given a `synth` QA build When `@art-city` opens Market Street at `?tier=desktop` and `?tier=mobile-low` and `@xr @art-city` runs Then `world.art()` and `observe()` list no `M10d1`-owned gray-box ref, `materialKind` matches the profile, and XR reports `legacy` with one family — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @art-city && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @art-city && DV_WORLD=synth pnpm check:e2e:xr`
- AC-9 Given the committed ledger When `@art-ledger` and every perf scenario run in fail mode Then each profile's added objects and triangles are within the table, `mobile-low` is ≤ 100, `legacy` adds 0, and every tier is within budget — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @art-ledger && DV_WORLD=synth pnpm check:e2e:xr && DV_WORLD=synth pnpm check:perf -- --fail`
- AC-10 Given goldens regenerated under the `golden-update` label When `@look-golden` and M02g1's `@look-owner` run Then every shot is within M02e's tolerance and repeat captures are byte-identical — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @look-golden && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-owner`
- AC-11 Given a local QA build When the reviewer walks Market Street at `desktop` and `mobile-low` and inspects every turntable Then no body shows a real make, badge, grille, silhouette or text (§7 (d), H6), recorded in `docs/device-runs/M10d1/desktop/notes.json` — proof: manual: desktop browser, `DV_WORLD=synth pnpm dev`, open `/?debug=1&tier=desktop`, `__dvBridge.world.teleport('lm.ferry-building')`, walk up Market Street, repeat at `tier=mobile-low`, run `pnpm assets:vehicle -- --turntable`, write the notes file

## Test plan
- **Unit:** the Deliverables specs plus engine determinism.
- **E2E:** `@art-city` (both engines) and `@art-ledger` (`chromium-webgl2` only) run in the `DV_WORLD=synth` half, not `GRAYBOX_GREP` (unchanged); `@xr @art-city` on `xr-quest3`; earlier world tags stay green.
- **Perf:** AC-9. **Manual:** AC-11.

## Demo script
How to see it:
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`; open `/?debug=1&tier=desktop`.
2. `__dvBridge.world.teleport('lm.ferry-building')`, face Market Street: glossy traffic, a Halcyon robotaxi, a bus, parked cars on blob shadows.
3. `__dvBridge.world.art()`: families, objects, `materialKind: 'physical'`.
4. Reload `/?debug=1&tier=mobile-low&gl=1`: two families, standard paint.
5. New Game, m.a1.01 `truck` stage: the final tow pickup; the beam fades near the camera.

## Effort
1 Builder session; ≈ 32 hand-written files (26 code, 6 config); risk **high** (source quality, fal gates, `mobile-low` budget). Order: registry, recipes, renderer, ledger, licensed swaps, fal, goldens.

## Risks & fallbacks
- **No base, `FAL_KEY` or spike; Tripo not `commercial`; H6 rejects:** recipes at the same AssetIds, named in the report; never past 1,704,000 micros.
- **`mobile-low` over 100:** one `min` family, then no parked mirror on `min` (data); never raise a budget.
- **Clearcoat fails on WebGL2:** `standard` there (`spec/03` §7 row).

## Notes for the Builder
- Read first: `05-assets-pipeline.md` §2 (H6), §3, §7 (`:120`), §11; `02-world-living.md` §2.5–§2.7; the M10d0, M10d4, M02g1, M02h6 files.
- Verify `MeshPhysicalNodeMaterial` clearcoat in `three@0.186.1` first. Licence terms only from M10d0 snapshots; `SKETCHFAB_API_TOKEN` access is UNVERIFIED, so hand-downloads only. fal runs from the CLI (queue, polling), never a browser.
- `GLTF_FORWARD_FLIP` (`anchors.ts:28`) turns +Z assets to −Z; `isGrayboxThing` (`vehicle-view.ts:281`) stays for other owners' rows.
- Secrets: `FAL_KEY` (optional). Owner gate: the live M00c spike. Branch `m10d1-art-integration`.
