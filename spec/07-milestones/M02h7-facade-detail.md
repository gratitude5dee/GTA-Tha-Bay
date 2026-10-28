# M02h7 — facade-detail

## Goal
After this session SF buildings stop reading as boxes with a printed window grid (DL-OWN-07, Phase 1). Street shop walls get a storefront with a plain sign panel and an awning; flat-roof walls a cornice; ResLow and ResMid street walls bay windows; reveals a recess bump; storefront and bay glass reflect the sky through M02g1's `skyReflect`. All procedural, inside the existing `buildings` object: 0 added render objects, no new texture asset, fal or contract change; the walls take M10d0's brick and stucco sets through the new `albedo` seam, and M10d2's atlas hook keeps working. Interior mapping and rooftop clutter are deferred.

## Requirements
- R-MAP-01: storefronts, awnings, cornices and bays make streets read as San Francisco.
- R-MAP-04: signs and shop glass light by hour.
- R-PLAT-03: TSL only, WebGPU and WebGL2.
- R-PLAT-05 (s): `mobile-low` gets shader bands only, inside its budget.
- R-ENG-02: a render-object and triangle ledger per profile; `check:perf` green.

## Depends on
- **M10d0** (DL-755): `withSurfaceTextures`, `config/world/surface-textures.json` and its coverage test, the `brick` and `stucco` sets. Merged about 4.8 sessions before this row starts.
- **M02g2:** depth-bias rules, footprint fades, `tests/support/flicker.ts`, the ledger chain.
- **Run order (`_PLAN.md` §0 rule 10):** after M02h6 (Phase 1 rows share `mesher.ts`, `surfaces.ts`, `look.json`, `look-shots.json` and the ledger chain).
- Through M02g2: M02g1 (`look/sky-reflect.ts`, `look/windows.ts`, `setLookLayer`, ledger shape, `@look-owner`) and M02e (`facade.ts`, `FacadeAtlasHook`, `surf`/`facade` arrays, `shot()`, `@look-golden`).
- Contracts: C08 1.1 (DL-741) and C13 1.2, read only.

## Scope in
† = design value in `config/world/look.json` (`facadeKit`) or `mesher.json` (`kit`), tuned here.

Evidence: capture study "Buildings and facades" (frame `desktop-02`, Market & 4th a dark mullion box); render audit items 8 and 9. Code on `claude/build`: `facade.ts:24` (`SHOP` per class only), `:106–107` (shop glass, no awning or sign), `:128` (recess is darkening only), `:184–194` (glass), `:53–62` (`FacadeAtlasHook`, read by no shader); `mesher.ts:264` `addBuilding`, walls `:313–327`; `look-materials.ts:89–123` (one building material, walls `WallBase..+5` at `:94`); `mesher.json` `trisPerBuilding` 80/60/40/18.

- **Street test** (`chunks/facade-kit.ts`, new, pure, no `three`): a wall ≥ 4 m † faces the street when its outward normal from the midpoint meets a same-chunk `SimChunk.segments` centreline within 14 m †, within 30° of parallel.
- **Flags and ids** (`look/surfaces.ts`): `surf.w` bits `FLAG_SHOP`, `FLAG_BAY`, `FLAG_CORNICE` beside `FLAG_PARAPET`, per wall; one new id, `Awning`, appended at rebase (tests key on names).
- **Shop walls:** street walls of Commercial and Civic, and of ResMid where `hash(seed) < 0.4` †. Tower keeps M02e's class rule, no awning.
- **Geometry** (`addBuilding`; `desktop` and `mobile` mesher profiles, only with a facade record):
  - **Awning** per shop wall: a canopy along the wall minus 0.4 m per end, top at `groundFloorM − 0.2`, depth 1.0 m †, drop 0.45 m †; top, flipped underside and two cheeks, 6 triangles; colours from `facadeKit.awningPalette` † (original), stripes by seed.
  - **Bay window** on ResLow and ResMid street walls: three faces with 45° sides, 2.4–3.6 m wide, 0.6–0.9 m deep † by seed, from `groundFloorM` to the eave − 0.3 m, capped: 10 triangles. `FLAG_BAY` wall faces; `facade.u` gives the front one bay cell and each side half, so M02e's grid draws a window per face per floor. Skipped if a corner falls inside another footprint; per wall desktop ≤ 2, mobile ≤ 1.
  - **Cornice** (desktop only), flat-roof ResMid, Commercial and Civic: the ring offset 0.35 m † outward (mitred, clamped at concave corners), 0.6 m † tall, front and underside per edge, 4 triangles; rings with an edge < 1 m skip it.
  - **Budget:** `kit.trisPerBuilding` † desktop 48, mobile 16, low 0, visionpro 0, after M02b1's simplification; parts that do not fit drop whole (cornice, then bay, then awning); `MeshStats.kitTriangles`. `legacy` has no facade record, so the kit is off.
- **Shader** (`facade.ts`, `look-materials.ts`):
  - **Storefront** (`FLAG_SHOP`, `full`, `lite`): kick plate, M02e's shop pane, transom, and a sign panel from `groundFloorM − 0.9` to `− 0.25` † with pilasters. The sign is one palette-hash colour: no text, glyph or logo. At night sign and shop glass follow a new `shop` row in M02g1's `windows.ts`.
  - **Recess bump** (`full`): TSL `bumpMap` on an analytic reveal height (0.12 m †), faded by M02e's `detailK`. Without cornice geometry: a normal tilt and lighter tone at the wall top.
  - **Glass:** storefront and bay panes call M02g1's `skyReflect` with the bumped normal wherever `envMap` is false; no second implementation.
  - **`min` (`mobile-low`):** bands only from `facade.v` and `FLAG_SHOP` (shopfront, awning stripe, sign, night emissive), ≤ 8 ALU.
  - **Awning:** a branch on `Awning`, roughness 0.8 †, wet from `uWet`.
- **M10d2 seam:** `wallNodes` takes `albedo?: (base: L) => L`, applied only to the wall albedo (`:173`), never to awning, sign, glass, trim or emissive; built from `FacadeAtlasHook.get()` on `full` and `lite`, never `min`; `null` leaves the graph unchanged.
- **Wall textures** (moved here from M10d0, DL-755): the seam calls `withSurfaceTextures` for the wall albedo (`base × detail`), on `full` and `lite` only: brick on `wall.Commercial`, `wall.Industrial` and `wall.Civic`, stucco on `wall.ResLow` and `wall.ResMid`, moved from `procedural[]` to `bindings` in `surface-textures.json`; `Awning` joins `procedural[]`. **Atlas `mobile` variant:** no edge joins this row and M10d2; if M10d2 has merged, this row binds that variant on `mobile` through the seam and carries M10d2's `@art-skyline ?tier=mobile` case, else M10d2 does.
- **Bridge (QA):** `look().facade` `{ kit, shopWalls, awnings, bays, cornices, kitTriangles, minBands }`; `setLookLayer('facade', on)` re-meshes once.
- **Shots** (synth, `look-shots.json`, positions in a BD row): `facade-shopfront` and `facade-bays` at 13:00 `clear`, `facade-night` at 22:00, and a `facade-graze` pair 0.05 m apart for `flicker.ts`.
- **Ledger:** `@facade-ledger` writes `docs/look/M02h7-render-ledger.json` in M02g1's shape with `perLayer.facade` and building triangles (`DV_LOOK_WRITE=1` writes, else checks); baseline the latest merged ledger's `after`, `xr` from `__dvBridge.perf.live()`. Plan: +0 objects on desktop, mobile, mobile-low (≤ 100) and legacy; building triangles ≤ +35 % † desktop, ≤ +20 % † mobile, +0 mobile-low and legacy; shadow passes unchanged.

## Scope out
- Interior mapping, rooftop clutter, fire escapes, garage doors: a later file through the Architect.
- Facade KTX2 atlas: M10d2 (the later of the two binds its `mobile` variant). The PBR sets themselves: M10d0. L1/L2 massing. `xr` profile: M02h8.
- Street layers: M02h1–M02h6. Story-start lighting, HUD icons (DL-738), fal or licensed assets.

## Deliverables
- New `packages/world/src/client/chunks/facade-kit.ts`. Edits: `chunks/{mesher.ts, mesh-types.ts, chunk-renderer.ts}`, `look/{facade.ts, look-materials.ts, surfaces.ts, config.ts, windows.ts, look-view.ts}`, `client/world-bridge.ts`.
- Tests: `packages/world/test/{facade.kit.spec.ts, facade.street.spec.ts, facade.materials.spec.ts}`, edits to `look.surfaces.spec.ts` and `look.materials.spec.ts`; `tests/e2e/world-facade.spec.ts` (`@world-facade`, `@facade-golden`, `@facade-ledger`, one `@xr @facade-ledger` case).
- Data (not counted): `look.json`, `mesher.json`, `surface-textures.json` (wall bindings), schemas, shots, goldens in `tests/e2e/golden/facade/`, flicker baseline, ledger, BD rows. No new script, dependency or asset.

## Interfaces
- C08 1.1 (`BuildingRecord`, `SimChunk.segments`) and C13 1.2 (`TierBudget`) read unchanged. `FacadeAtlasHook` keeps its shape; the seam, flags, `Awning`, `kitTriangles`, config keys and bridge field are S02 internals.
- Contract change proposals: none.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 and no new file holds GLSL or `ShaderMaterial` — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the `synth` and `civic-excerpt` bakes and hand-built fixtures (walls facing a segment at 10 m, at 20 m and at 45°, a 3 m wall, two touching row houses) When the mesher runs twice per profile Then:
  - buffers are byte-identical, and `low` and legacy bytes equal the parent commit's (committed hashes);
  - awnings sit only on street-passing `FLAG_SHOP` walls, bays only on ResLow/ResMid street walls at or above `groundFloorM`, cornices only on `desktop` flat-roof ResMid/Commercial/Civic walls;
  - in the fixtures only the 10 m wall qualifies, the touching bay is skipped, and a shrinking allowance drops cornice, then bay, then awning;
  - no building exceeds `trisPerBuilding + kit.trisPerBuilding`, and every surface id is in the table — proof: `pnpm map:build -- --area synth && pnpm map:build -- --area civic-excerpt && pnpm check:unit -- packages/world`
- AC-3 Given `createLookMaterials` for `full`, `lite` and `min` When `facade.materials` runs Then every material builds, the bump exists only on `full`, `facade.ts` imports `skyReflect` from `look/sky-reflect.ts` and defines none of its own, the `albedo` seam is called once on `full` and `lite` and never on `min`, a `null` hook with textures off creates no texture node, with the wall bindings the seam samples brick and stucco on `full` and `lite`, the coverage test of `textures.config` passes, and `look.no-fetch` passes — proof: `pnpm check:unit -- packages/world/test/facade.materials.spec.ts packages/world/test/look.materials.spec.ts packages/world/test/textures.config.spec.ts`
- AC-4 Given a QA `synth` build When `@world-facade` runs at `?tier=desktop`, `mobile` and `mobile-low` on `chromium-webgl2` and `webkit-webgl2` Then:
  - `desktop` and `mobile` report `kit: true` with awnings, bays and shop walls > 0, and cornices > 0 only at `desktop`;
  - `mobile-low` reports `kit: false`, `kitTriangles: 0`, `minBands: true`; `setLook(false)` reports `kit: false`;
  - sign emissive is > 0 at 22:00 and 0 at 13:00; `skyReflect` is true wherever `envMap` is false;
  - `look().textures.sets` holds `brick` and `stucco` at `desktop` and `mobile` and neither at `mobile-low`;
  - the `facade-graze` pair flickers at most 10 % over its committed baseline — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-facade && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-facade`
- AC-5 Given committed facade goldens (`golden-update` label) When `@facade-golden` (three shots × `desktop`, `mobile`, `mobile-low`) and the regenerated `@look-golden` run on `chromium-webgl2` and `@look-owner` on `webkit-webgl2` Then every shot is within M02e's tolerance, repeats are byte-identical, and a different synth `bakeId` fails naming both — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@facade-golden|@look-golden" && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-owner`
- AC-6 Given every perf scenario in fail mode and the committed ledger When `@facade-ledger` runs flat and in the `@xr` case Then every tier is in budget, the object delta is 0 on all four profiles, `mobile-low` stays ≤ 100, `xr` `after` equals `baseline`, and building triangles grow ≤ 35 % (`desktop`), ≤ 20 % (`mobile`), 0 (`mobile-low`) — proof: `DV_WORLD=synth pnpm check:perf -- --fail && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @facade-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-7 Given the same build When the earlier suites run Then `@world-look`, `@look-tune`, `@look-fixes`, `@world-landmarks`, `@world-sky`, `@world-route`, `@world-boot-size` and the XR smoke pass — proof: `DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@world-look|@look-tune|@look-fixes|@world-landmarks|@world-sky|@world-route|@world-boot-size" && DV_WORLD=synth pnpm check:e2e:xr`
- AC-8 Given the branch When the asset and IP gates run Then they pass with no new asset, provenance record or licence entry — proof: `pnpm assets:catalog && pnpm check:assets && pnpm provenance:check && pnpm ip:strings && pnpm names:lint`
- AC-9 Given the production build When it is verified and deployed to a Preview Then it succeeds, `__dvBridge` is absent and the header checks pass — proof: `pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-10 Given the merged default branch republished to staging When the operator plays New Game to the m.a1.01 truck stage and drives a commercial street of the `sf` bake in Safari and Chrome Then storefronts, awnings and bays read, no sign shows text or a logo, and before/after frames are in `docs/look/M02h7-sf/` — proof: manual: desktop Mac (Safari and Chrome), `pnpm deploy:prod -- --env staging`, `pnpm check:smoke -- https://tha-bay-web-staging.gratitude-8f4.workers.dev`, frames and `notes.json` committed

## Test plan
- **Unit:** the five specs of Deliverables.
- **E2E:** `@world-facade`, `@facade-golden` and `@facade-ledger` run in the `DV_WORLD=synth` half (`--grep-invert "$GRAYBOX_GREP"`); none matches `GRAYBOX_GREP` (unchanged). `@facade-golden` and `@facade-ledger` skip outside `chromium-webgl2`; `@xr @facade-ledger` runs on `xr-quest3`; on `chromium-webgpu` `@world-facade` asserts the same report.
- **Perf:** AC-6. **Operator:** AC-10. No device run: `mobile-low` gains ≤ 8 ALU and 0 triangles (M11a1 measures).

## Demo script
How to see it:
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, open `/?play=sandbox&debug=1&tier=desktop&gl=1`.
2. Console: `__dvBridge.world.shot('facade-shopfront')`: kick plates, sky-reflecting shop glass, sign panels, awnings, cornice.
3. `shot('facade-bays')`: bay windows with a window on every face. `shot('facade-night')`: signs and shop glass lit.
4. `__dvBridge.world.setLookLayer('facade', false)`, then `true`: before and after.
5. Reload with `&tier=mobile-low`: flat shopfront bands only.

## Effort
1 Builder session; ≈ 19 code files; risk **medium-high** (geometry on real footprints, triangle growth, golden churn). Order: street test, awnings, bays, cornices, shader bands, bump, glass, seam, bridge, goldens, ledger. Short on time: cornices become the shader band (BD row), then the bump goes.

## Risks & fallbacks
- **Triangles over plan:** lower `kit.trisPerBuilding` (data), then one bay per wall. Never raise a budget.
- **Bays clip neighbours on `sf`:** also test edge midpoints.
- **Parts outside C08 prisms:** bays and awnings start near 3 m; camera clipping goes in a BD row.
- **Concave cornice mitres:** skip that ring's cornice. **Bump shimmer:** tighter `detailK`. **Flaky goldens:** nightly, bridge counts in the PR suite (DL row).

## Notes for the Builder
- Read first: `02-world-bake.md` §4, §6; `02-world.md` §5.2–§5.4; `11-platform.md` §4.5; M02e, M02g1, M02g2, M10d0, M10d2; `_PLAN-3.md` Look program; DL-704; DL-OWN-07, DL-OWN-09.
- Verify TSL `bumpMap` in `three@0.186.1` (the audit lists it); if absent, a `dFdx`/`dFdy` normal in TSL plus a spec/03 §7 row.
- The mesher stays deterministic and `three`-free; sim, collision and C08 prisms are untouched. Rebase hotspot: M02h1–M02h6 also edit `mesher.ts` and `surfaces.ts`; M10d0's `art-hook` lines in `look-materials.ts` stay as they are.
- Original content only: authored colours, no text or brand shape; the target image is never committed, sampled or fed to fal; no new licensed or fal asset.
- Goldens: `DV_UPDATE_GOLDEN=1` outside CI under `golden-update`. Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` for AC-9 and AC-10 (SKIP locally). Branch `m02h7-facade-detail`.
