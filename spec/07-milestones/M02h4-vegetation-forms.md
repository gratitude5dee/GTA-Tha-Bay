# M02h4 — vegetation-forms

## Goal
SF street trees stop being one 20-triangle cone (`chunk-renderer.ts` `treeGeometry`, lines 96–102). The species byte is `fnv32(name) % 8` (`tools/map/src/stages/s3-water.ts` `treeRecord`, lines 312–316) and carries no form. DL-OWN-07 Phase 1, first vegetation session:
- the byte becomes a **tree form class** (species table, bake-id bump);
- five original procedural forms (London plane, Monterey cypress or pine, eucalyptus, Canary palm, street ficus) with height distributions;
- opaque low-poly crowns on `mobile-low` and XR; wind sway on desktop only;
- **per-chunk instance ranges** in a few pools, not one global InstancedMesh per form.

Code only: $0 fal, no asset or dependency, no contract shape change.

## Requirements
- R-MAP-01: street trees read as SF species at believable heights.
- R-PLAT-03: TSL on WebGPU and WebGL2; no alpha test.
- R-PLAT-05 (s): `mobile-low` keeps its object count and frame budget.
- R-ENG-02: render-object ledger per profile; `check:perf` green.

## Depends on
- **M02g2:** grounded trees (`treeRecords` `y`, eave cap), far-tree hiding (`tree.drawM`), `look().vegetation`, `docs/look/M02g2-render-ledger.json`.
- **Run order (`_PLAN.md` §0 rule 10):** after M02h3 (Phase 1 rows share `mesher.ts`, `surfaces.ts`, `look.json`, `look-shots.json` and the ledger chain).
- Through M02g2: M02g1 (desktop tree casters within `dynamicCasterRadiusM`, `setLookLayer`, ledger shape, `@look-owner`), M02e (profiles, `shot()`, `@look-golden`), M02b1 (mesher, unit bundles), M02a2 (S3, synth source).
- Contracts: C08 1.1 (DL-741; `RenderChunk.trees` `x,z,scale,species`; record 22 TREE `u8 species` holds a `TreeForm`; rule 12 vegetation pool) and C13 1.2 (`TierBudget`), shapes unchanged.

## Scope in
† marks a design value in config.

- **Form class** (`packages/shared/src/world/tree-form.ts`, pure):
  - `TreeForm`: Plane 0, Ficus 1, Conifer 2, Eucalyptus 3, Palm 4; 5–255 reserved (meshed as Plane).
  - `formOfSpecies(name, table)` matches the lowercased genus (first word of the botanical name) against `config/world/tree-forms.json` (with schema). Each form takes an optional `asset` (an `AssetRef`, absent by default, so every form stays procedural): a later Track B import may swap a near LOD there without touching the mesher (DL-755; unscheduled).
  - Rows †: `platanus` → Plane; `ficus` → Ficus; `cupressus`, `pinus`, `sequoia` → Conifer; `eucalyptus` → Eucalyptus; `phoenix`, `washingtonia`, `syagrus` → Palm.
  - No match: a hash-keyed split (Plane 0.6 †, Ficus 0.4 †). OSM: `species`, then `genus`; `leaf_type=needleleaved` → Conifer.
- **Bake (S3):**
  - `treeRecord` writes the form into the byte; `scale` is unchanged. `configHashesOf` (`tools/map/src/config.ts:235`) gains `treeForms` and `TOOL_VERSION` (line 16) goes `0.3.1` → `0.4.0`: every area gets a new `bakeId`.
  - `bake-report.json` gains `treeForms` (per-form counts) and `treeUnmatched` (top 20 names); tune the table from the `sf` raw snapshot, never an assumed format.
  - The synth `SPECIES` list (`sources/synth.ts:160`) gains `Phoenix canariensis`, `Cupressus macrocarpa` and `Eucalyptus globulus`.
- **Mesher** (`treeRecords`, `mesher.ts:572`):
  - records grow to 6 floats `(x, y, z, heightM, yawRad, form + 8 × tint)`;
  - height: the form's triangular quantile `[min, mode, max]` of `u = (scale − 0.75) / 0.5` plus a 1/17 hash jitter, under M02g2's eave cap (`min(max, eave − 0.5)` within 8 m, ≥ 3.5 m);
  - heights †, in m (min/mode/max): Plane 6/10/16, Ficus 4/6/9, Conifer 6/12/20, Eucalyptus 10/18/30, Palm 6/10/16;
  - `meshBytes` counts the new stride, and `objectCountOf` (line 603) stops counting vegetation per unit.
- **Forms** (`chunks/tree-forms.ts`): pure, three-free, seeded original recipes with vertex colour and a per-vertex `sway` weight.
  - `full` (desktop tiers, ≤ 260 † triangles each): Plane wide three-lobed crown; Ficus dense clipped crown; Conifer flat-topped wind-swept tiers; Eucalyptus pale tall trunk, sparse high clumps; Palm 12 arched double-sided opaque fronds.
  - `lite` (`mobile`): the same forms at ≤ 120 †.
  - `low` (`mobile-low`, XR, `world.look: false`): two opaque geometries ≤ 48 † each, `crown` (Plane, Ficus, Conifer, Eucalyptus by non-uniform scale and tint) and `palm`.
  - No alpha test, alpha-to-coverage or transparency.
- **Pools** (`chunks/vegetation-pool.ts`): one `InstancedMesh` per geometry of the active set, outside the unit bundles.
  - `frustumCulled = false`, `visible = count > 0`. Each L0 unit owns a range in every pool, allocated on upload and freed on removal.
  - Drawn ranges are packed at the front. A unit crossing `tree.drawM` (10 % hysteresis) moves only the prefix tail, with a partial upload (`updateRanges` if the installed three has it, else `needsUpdate`). Capacity only doubles; range writes count against the upload cap.
  - On `full`, each form has a `near` pool (units within `dynamicCasterRadiusM`, the only casters, keeping M02g1's tree casters) and a `far` pool.
  - Pools: 10 on `full`, 5 on `lite`, 2 on `low`; rebuilt on tier change and in `onRendererReplaced`. M02g2's per-unit far-tree re-record goes away.
- **Materials and wind:** `look-materials.ts` `trees()` (lines 139–147) and legacy `materials.ts` add an instance tint. `look/wind.ts` (`full` only) is a TSL `positionNode` offset `uWindDir × uWindAmp × sway² × sin(uLookTime × f + dot(positionWorld.xz, k))`, amplitude per preset in `look.json` `vegetation.wind` † (rain 0.12, others 0.03–0.06); `shot()` freezes `uLookTime`. Sim and collision are untouched.
- **Switch and QA:** `platform-flags.json` `world.treeForms` (default `true`; `false` = M02b1's cone as one pool), read in `tier-config.ts`; `look().vegetation` gains `{set, pools, forms: {form, instances, drawn, tris}[], wind}`; `setLookLayer('wind', on)`; `synth` shot `trees-street` (13:00 `clear`) at `desktop` and `mobile-low`.
- **Ledger:** `@trees-ledger` writes `docs/look/M02h4-render-ledger.json` in M02g1's shape (`DV_LOOK_WRITE=1` writes it, otherwise the test checks it).
Baseline: the newest ledger on the default branch at rebase (`baselineFrom`); `xr` from `__dvBridge.perf.live()`. Plan: `mobile-low` ≤ +2 objects (2 pools replace one vegetation object per resident unit), `legacy` +0, `desktop` ≤ +40 † with shadow passes, `low` ≤ 48 triangles per tree (20 today).

## Scope out
- M02h5: park scatter, shrubs, far impostors, and EZ-Tree, whose MIT code enters only after `pnpm license:scan` and a licence check or replacement of its bundled textures.
- Licensed models (DL-OWN-06): M10d0 on. Tree pits: M02h2. `xr` profile: M02h8 (inherits `low`).
- No fal, scan or licensed asset; the target image is never committed, sampled or fed to fal.

## Deliverables
- `packages/shared/src/world/tree-form.ts`, `packages/shared/test/tree-form.spec.ts`; `tools/map/src/{stages/s3-water.ts, config.ts, sources/synth.ts, bake.ts}`, `tools/map/test/tree-forms.bake.spec.ts`; `packages/engine/src/platform/tier-config.ts`.
- `packages/world/src/client/`: new `chunks/{tree-forms.ts, vegetation-pool.ts}`, `look/wind.ts`; edits `chunks/{mesher.ts, mesh-types.ts, chunk-renderer.ts, materials.ts}`, `look/{look-materials.ts, config.ts}`, `{world-view.ts, world-bridge.ts}`; tests `packages/world/test/{trees.forms, trees.pool, trees.mesher}.spec.ts`.
- **E2E:** `tests/e2e/world-trees.spec.ts` (`@world-trees`, `@trees-ledger`, one `@xr @trees-ledger` case).
- **Data (not counted):** `tree-forms.json`, `look.json`, `look-shots.json` (with schemas), `platform-flags.json`, goldens, ledger, BD rows.
- No new script or dependency; ≈ 23 code files.

## Interfaces
- C08 1.1 (`02-world-contracts.md` §8, DL-741) keeps the shape; when `WorldIndex.c08` is `'1.1.0'` the TREE byte carries a `TreeForm` (forms 0–4 here), and a `'1.0.0'` index keeps the species meaning. Packs and client ship together under one `bakeId`.
- `TreeForm`, forms, pools, the `trees` stride, `look().vegetation` and the ledger are S02 internals.
- Contract change proposals: none beyond C08 1.1, which the Architect has made (DL-741).

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 and no new file holds GLSL, `ShaderMaterial`, `alphaTest` or `transparent: true` — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given `tree-forms.json` When the form and bake tests run Then the table validates, synth species map to their forms and unknown names to the hash split, every tree byte of the `synth` and `civic-excerpt` bakes is 0–4 with all five forms in `synth`, repeated bakes give identical pack hashes, both `bakeId`s differ from the parent's, and `bake-report.json` has `treeForms` and `treeUnmatched` — proof: `pnpm map:build -- --area synth && pnpm map:build -- --area civic-excerpt && pnpm check:unit -- packages/shared tools/map`
- AC-3 Given each set When `trees.forms` and `trees.mesher` run Then geometries are byte-identical across builds and within their caps (260/120/48), `low` has two geometries, only `full` carries `sway`, heights lie in `[min, max]` (`min` at `u = 0`, `max` at `u = 1`, the mode at `(mode − min)/(max − min)`) under M02g2's eave cap, and mesher output is byte-identical across runs — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world`
- AC-4 Given 200 scripted unit adds, removals and `drawM` crossings When `trees.pool` runs Then each drawn unit's instances appear once in the prefix, `count` is the sum of drawn ranges, freed ranges are reused, capacity only doubles, only `near` pools cast and hold only units within `dynamicCasterRadiusM`, and pool counts are 10/5/2 — proof: `pnpm check:unit -- packages/world/test/trees.pool.spec.ts`
- AC-5 Given a QA `synth` build When `@world-trees` runs at `desktop`, `mobile` and `mobile-low` on `chromium-webgl2` and `webkit-webgl2` Then `look().vegetation` reports `full`/`lite`/`low` with 10/5/2 pools and all five forms, `wind > 0` only at `desktop`, `drawn` after a 2 km teleport and back equals the resident units' instances within `drawM`, and `world.treeForms: false` reports one cone pool — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-trees && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-trees`
- AC-6 Given the regenerated goldens (`golden-update` label) When `@look-golden` and `@look-owner` run Then every shot, `trees-street` at `desktop` and `mobile-low` included, is within M02e's tolerance, and two `trees-street` captures are byte-identical — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @look-golden && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-owner`
- AC-7 Given the same build When the earlier suites run Then `@world-look`, `@look-tune`, `@look-fixes`, `@world-landmarks`, `@world-route`, `@world-backdrop` and the XR smoke pass — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-look|@look-tune|@look-fixes|@world-landmarks|@world-route|@world-backdrop" && DV_WORLD=synth pnpm check:e2e:xr`
- AC-8 Given every perf scenario in fail mode and the committed ledger When `@trees-ledger` runs, flat and in the `@xr` case Then every tier is in budget (shadow passes counted), `mobile-low` is ≤ 100 objects with a delta ≤ +2 and ≤ 48 triangles per tree, `legacy` and `xr` deltas are ≤ 0, and `desktop` is ≤ +40 — proof: `DV_WORLD=synth pnpm check:perf -- --fail && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @trees-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-9 Given the branch When the asset, IP and licence gates run Then they pass with no new asset, provenance record, licence entry or dependency — proof: `pnpm assets:catalog && pnpm check:assets && pnpm provenance:check && pnpm ip:strings && pnpm license:scan`
- AC-10 Given the production build When it is verified and deployed to a Preview Then it succeeds, `__dvBridge` is absent and the header checks pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-11 Given the operator's `sf` re-bake published to staging with this build When the operator drives Dolores Street, Third Street and Golden Gate Park in Safari and Chrome at `desktop` and at `?tier=mobile-low` Then palms, planes and cypresses show below neighbouring eaves, `mobile-low` reports ≤ 100 objects, and `treeForms`, frames and `notes.json` are in `docs/look/M02h4-sf/` — proof: manual: desktop Mac (Safari and Chrome), `pnpm map:build -- --area sf`, `pnpm deploy:prod -- --env staging`, `pnpm check:smoke -- https://tha-bay-web-staging.gratitude-8f4.workers.dev`, frames and `notes.json` committed

## Test plan
- **Unit:** `tree-form`, `tree-forms.bake`, `trees.forms`, `trees.mesher`, `trees.pool`.
- **E2E:** `@world-trees`, `@trees-ledger`, `@look-golden` and `@look-owner` run in the `DV_WORLD=synth` half (`--grep-invert "$GRAYBOX_GREP"`); none matches `GRAYBOX_GREP`, which is unchanged. `@trees-ledger` and `@look-golden` are `chromium-webgl2` only; `@xr @trees-ledger` runs on `xr-quest3`. The graybox fixture keeps species `i % 3`; any `@graybox` golden framing a tree is regenerated under `golden-update`.
- **Perf:** AC-8. **Operator:** AC-11.

## Demo script
How to see it:
1. Run `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, then open `/?play=sandbox&debug=1&tier=desktop&gl=1`.
2. `__dvBridge.world.shot('trees-street')`: five forms at mixed heights. `setWeather('rain')`: crowns sway; `setLookLayer('wind', false)` stops them.
3. `&tier=mobile-low`: two opaque forms, 2 pools in the debug look row; `?xr-emulate=quest3`: the same set, no wind.

## Effort
0.75 Builder session; ≈ 23 code files; risk **medium** (pool churn, real species data, golden churn). Order: bake, mesher, forms, pools, wind, goldens, ledger. Short on time: cut wind (BD row), never a form.

## Risks & fallbacks
- **Compaction costly on `sf`:** wider hysteresis, then at most one recompaction per second (BD row).
- **Species unmatched:** add table rows; the default split stays broadleaf.
- **`desktop` over +40 or `mobile-low` triangles over budget:** shrink `dynamicCasterRadiusM`, lower `drawM`, then the `low` cap to 36. Never raise a budget.
- **No partial upload on WebGL2:** full `needsUpdate`, spec/03 §7 row.

## Notes for the Builder
- Read first: `02-world-bake.md` §4–§6, `02-world-contracts.md` (record 22, `RenderChunk`), `02-world.md` §5.2–§5.4, `11-platform.md` §4.5, M02g1, M02g2, DL-OWN-06, DL-OWN-07.
- Evidence (look study, 2026-10-26): capture "Vegetation" (desktop-04, desktop-06), render audit item 6, art-source "Street trees and foliage" (no CC0 palm), plan Phase 1.
- Forms are original code. The mesher stays deterministic and `three`-free (`asset.worker`); trees stay render-only. Verify `InstancedMesh.count` and the partial-update API against the installed `three@0.186.1`.
- The `sf` re-bake needs the operator's raw cache (the BD-REL-01 route). Secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for AC-10 and AC-11 (SKIP locally). Branch: `m02h4-vegetation-forms`.
