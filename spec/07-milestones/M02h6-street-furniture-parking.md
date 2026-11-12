# M02h6 — street-furniture-parking

## Goal
After this session the M02h2 sidewalks carry signal masts with live aspects, stop signs, hydrants about every 90 m, meters, shelters, benches, utility poles and (desktop only) trolley wires, and curbs with C08 `parkingSides` gain parked cars: render-only instances on M10d1's realistic traffic families, with no sim entity and no state-hash change. Furniture is original and procedural, with no texture or fal spend (DL-OWN-07 Phase 1; render audit item 11). A per-profile render-object ledger keeps `mobile-low` ≤ 100 and `legacy` at +0.

## Requirements
- R-MAP-01: signals, stop signs and shelters stand where C08 puts junction controls and transit stops.
- R-MAP-04: the living city gains curbside parked cars and signal heads that match the sim.
- R-ENG-02: render objects, triangles and upload bytes stay inside each tier's budget.
- R-PLAT-05 (s): iPhone 15 `mobile-low` keeps its frame budget.
- R-IP-01: original props and sign faces; no logo, agency mark or real product.

## Depends on
- **M02h2:** sidewalk ribbons, `curb.heightM`, the curb line, the ledger chain (other export names: use what merged, BD row).
- **Run order (`_PLAN.md` §0 rule 10):** after M02h5 (Phase 1 rows share `mesher.ts`, `surfaces.ts`, `look.json`, `look-shots.json` and the ledger chain).
- **M10d1** (DL-755; merged about 2.5 sessions before this row starts, `_PLAN.md` §3): the families of `traffic/archetype-mesh.ts` and `config/world/traffic-art.json`, `traffic/materials.ts` (`aTint`, `aLights`, livery bit) and the registry.
- **M03b1:** `TrafficRenderer`, `parkedPose`, `slotUnit`, `density.json` `tierFactors.parked`.
- Merged context: M02g1 (`layers`, `setLookLayer`, blob layer, ledger shape), M02e (profiles, `shot()`, `@look-golden`), M02b2 (lamps, blackout), M02b1 (mesher, upload gate).
- Contracts: C08 1.1 (rule 12 pools, DL-741), C13 1.2, C06 1.1 (read).

## Scope in
- **Placement:** pure `placeFurniture(sim, cfg): Float32Array` in `packages/shared/src/world/furniture.ts` (C02 lint, detmath, seeds from `ctrU32(worldSeed, …)`). It returns `x, z, yaw, type` records in the `RenderChunk.furniture` frame, with `type` a u8 from `config/world/furniture.json`. Rules (design values †):
  - stop sign: each approach of an `AllWayStop`, each `stopApproaches` edge of a `MinorStop`, on the right curb 1.5 m † before the stop line;
  - hydrant: each sidewalk side, every 90 m † from a seeded phase, ≥ 6 m † from junction boxes;
  - meter: on parking sides of Arterial and Collector edges, one per 14 m;
  - shelter and bench at `PedNodeFlag.Transit` nodes; benches at `Plaza` nodes every 40 m †; utility poles on one side of Local edges every 40 m †;
  - all on the sidewalk top, ≥ `widthM/2 + 0.4 m` from the centreline, ≥ 1.0 m from other items, lamps and trees.
- **Graph-bound items** (mesh time, not records): one signal assembly (pole, mast arm, head) per `stopApproaches` edge of each `Signal` junction, the head storing the approach's straight movement (else its first); trolley wires 5.5 m † above `BusLane` and `TramEmbedded` lanes.
- **Record source:** by default the mesher calls `placeFurniture` when `render.furniture` is empty (no re-bake). DL-740 keeps that route for v1 (no re-bake). The bake fill, `s13-pack.ts` (today `new Float32Array(0)`) calling it, is built and tested but stays off until a later re-bake turns it on; AC-2 proves both paths mesh identically.
- **Mesher:** `UnitMesh.furniture` (`kind, x, y, z, yaw, arg`, local like `lamps`), counted in `meshBytes` and `transferListOf`. It stays deterministic and within the 2 MB `mobile-low` upload cap. The chunk `furniture` object stays empty (`mesher.ts:4`).
- **Pools** (`packages/world/src/client/furniture/`): one global `InstancedMesh` per pool across resident L0 chunks.
  - added on upload, removed on unload, freed slots zero-scaled; code-built geometry, 24–150 triangles per item; the `post` pool is one kit where `aKind` collapses the other kinds' parts (stop sign, meter, hydrant, blade);
  - TSL materials per profile; receive shadows, cast none, no collider (like the M02b2 lamps); M02g1 layers `furniture` and `parked`:

| Profile | Pools | Parked | Objects added (≤) |
|---|---|---|---|
| `full` (ultra, desktop) | signal, post, shelter, pole, wire | 4 (one per family) | 9 |
| `lite` (mobile) | signal, post, shelter | 3 (one per family) | 6 |
| `min` (mobile-low) | signal, post (no meter, blade) | 1 (car family only) | 3 |
| `legacy` (XR, `world.look: false`) | — | 0 | 0 |

  Instance caps per profile are design values (farthest dropped first).
- **Signal heads** reuse `traffic/lights.ts`:
  - new `signalEmissive` reads `aAspect` (green, amber, red, dark) as `lampEmissive` reads `aLights`;
  - `furniture/signals.ts` evaluates C08 `signalAspect(program, tick, movement, blackout)` at 10 Hz within 200 m, from a new engine-internal `WorldFrame.simTick` (snapshot tick, `boot-engine.ts`) and `WorldFrame.blackout`.
- **Sign faces** (`faces.ts`): TSL signed-distance shapes, no texture or font: a red octagon with "STOP" from bars and arcs, a one-way arrow, blank green blades (no street names), a generic bus-stop flag.
- **Parked dressing** (`traffic/parked-dressing.ts`): one `InstancedMesh` per M10d1 family of the profile, on that family's body and material, using whatever the registry holds (on `full` the opaque mesh only; glass shades through the part id); on `min` the car family only, which keeps `mobile-low` at +3. Lights stay off.
  - only slots with index ≥ `densityCap(capacity, tierFactors.parked[tier])`, which the sim never fills on that tier (C01 prefix rule), so the sets are disjoint;
  - pose from `parkedPose`, archetype and colour from `slotUnit` as in the sim (on `min` every archetype draws the car family's body); slots within 0.6 car lengths of a live pose skipped;
  - drawn only between `ghostM` † (30/28/25 m) and `dressFarM` † (300/200/140 m) from player and camera, 8 m dithered fades, so the player never reaches a bodiless car;
  - `dressShare` † thins slots; dressed cars join M02g1's blob object (+0); nothing is written to the sim.
- **Bridge and ledger:**
  - `look().furniture` reports `{ source, pools: {kind: {instances, cap}}, objects, parked: {instances, cap}, heads: {n, aspects} }`.
  - `@furniture-ledger` writes (`DV_LOOK_WRITE=1`) or checks `docs/look/M02h6-render-ledger.json` in M02g1's shape; baseline = the same build with both layers off (`platform.perf.live()`), at shots `noon-street` and new `junction-noon` (13:00 clear, synth junction per BD row).

## Scope out
- Car bodies: M10d1. Licensed (CC0, CC-BY) or fal props: a later Track B import that swaps pool geometry through `kit.ts` (DL-OWN-06, DL-755; unscheduled).
- Colliders and sim parked density (sim, hash changes): Architect. `xr` profile: M02h8.
- Trash cans, news boxes, fire escapes, street-name text, murals, public art (`02-world-bake.md` S4 rule 8).

## Deliverables
- Code:
  - `packages/shared/src/world/{furniture.ts, index.ts}`;
  - new `packages/world/src/client/furniture/{kit.ts, faces.ts, pools.ts, signals.ts, wires.ts}` and `traffic/parked-dressing.ts`;
  - edits to `traffic/{lights.ts, instances.ts}`, `chunks/{mesher.ts, mesh-types.ts, chunk-renderer.ts}`, `jobs.ts`, `look/{config.ts, look-materials.ts}`, `world-view.ts`, `world-bridge.ts` and `packages/engine/src/client/boot/{world-layer.ts, boot-engine.ts}`;
  - `tools/map/src/stages/s13-pack.ts` on the bake path only.
- Tests:
  - `packages/shared/test/world-furniture.spec.ts`;
  - `packages/world/test/{furniture.mesher, furniture.signals, furniture.pools, parked-dressing}.spec.ts`, plus `look.no-fetch.spec.ts` extended;
  - `tests/e2e/world-furniture.spec.ts` (`@world-furniture`, `@furniture-ledger`, `@xr @world-furniture`) and `tests/e2e/world-look.spec.ts` (new shot).
- Data (not counted): `config/world/{furniture.json, look.json, look-shots.json}`, `config/schemas/world-furniture.schema.json`, `tools/ci/checklists/M02h6-iphone15.json`. Generated: the ledger and the regenerated `tests/e2e/golden/look/*` (`golden-update` label).
- No new script, dependency, asset or provenance record. BD rows.

## Interfaces
- C08 1.1 (`02-world-contracts.md` §8): rule 12 global pools for furniture and parked dressing; shapes unchanged. `RenderChunk.furniture` keeps `x, z, yaw, type`, with a u8 table in S02 config. C13 1.2 budgets are read, and `CrowdLimits` still bounds sim cars only. C06 1.1 is unchanged. `WorldFrame.simTick` is engine-internal.
- Contract change proposals: none beyond C08 1.1 (DL-741). DL-740 and DL-741 settle three points:
  1. global pools satisfy C08 1.1 rule 12 and replace `02-world.md` §5's per-chunk `BatchedMesh` caps;
  2. mesher-time fill in v1, the bake fill kept off;
  3. dressing sits outside `CrowdLimits`.

## Acceptance criteria
- AC-1 Given the branch When install, typecheck, lint, unit tests and build run Then all exit 0 with the C02 lint over `furniture.ts` — proof: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm check:unit && pnpm build`
- AC-2 Given the `synth` and `civic-excerpt` bakes When placement and the mesher run twice per profile Then:
  - the output is byte-identical;
  - signals, stop signs, meters and shelters match the Scope in rules;
  - hydrant gaps are 90 m ± 10 %;
  - the distance rules hold;
  - a pre-filled `render.furniture` meshes the same as an empty one;
  - no `mobile-low` L0 unit exceeds 2 MB.
  — proof: `pnpm map:build -- --area synth && pnpm map:build -- --area civic-excerpt && pnpm check:unit -- packages/shared packages/world`
- AC-3 Given every `synth` signal head over ticks 0–7,199 When `furniture.signals` runs Then `aAspect` equals the sim graph's `signal(node, movement)`, and `dark` under blackout — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world`
- AC-4 Given `synth` at each flat tier When `parked-dressing` runs 600 ticks beside the traffic sim Then:
  - no drawn slot is one the sim filled or could fill;
  - poses, archetypes and colours equal the sim's rules;
  - no car is inside `ghostM` or near a live pose;
  - counts stay within the caps, and `legacy` draws 0.
  — proof: `pnpm map:build -- --area synth && pnpm check:unit -- packages/world`
- AC-5 Given the branch When the determinism suites run Then world state hashes are unchanged in Node, Chromium and WebKit — proof: `DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-hash && pnpm --filter @dv/engine test:determinism`
- AC-6 Given a `synth` QA build When `@world-furniture` opens `?tier=desktop`, `mobile` and `mobile-low` at `junction-noon` Then:
  - `look().furniture` lists the profile's pools, with `objects` at or below the table;
  - `parked.instances` is above 0;
  - `heads.aspects` changes within 30 s;
  - layers off report 0;
  - every image or `texture/` request is a ref in `look().textures?.refs ?? []` (M10d0) or `world.art().refs` (M10d1), and switching the `furniture` and `parked` layers on adds no request (furniture and sign faces fetch nothing).
  — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @world-furniture && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @world-furniture`
- AC-7 Given every perf scenario and the ledger When fail-mode perf and `@furniture-ledger` run Then:
  - budgets hold;
  - per-shot deltas are ≤ 9 (`full`), 6 (`lite`) and 3 (`min`);
  - `mobile-low` after is ≤ 100;
  - XR adds 0.
  — proof: `DV_WORLD=synth pnpm check:perf -- --fail && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep @furniture-ledger && DV_WORLD=synth pnpm check:e2e:xr`
- AC-8 Given every committed look golden set regenerated (`_PLAN-3.md` Look program rule 6) plus `junction-noon` at `desktop` and `mobile-low` When the look golden suites run Then all are within M02e's tolerance — proof: `pnpm map:build -- --area synth && DV_WORLD=synth pnpm check:e2e -- --project=chromium-webgl2 --grep "@look-golden|@markings-golden|@textures-golden|@facade-golden" && DV_WORLD=synth pnpm check:e2e -- --project=webkit-webgl2 --grep @look-owner`
- AC-9 Given the branch When the asset and IP gates and the production build run Then the gates pass with no new asset, image or provenance record, `__dvBridge` is absent and the Preview passes its headers — proof: `pnpm assets:catalog && pnpm check:assets && pnpm provenance:check && pnpm ip:strings && pnpm names:lint && pnpm build && pnpm --filter @dv/web verify:dist && pnpm deploy:preview`
- AC-10 Given an operator `synth` Preview on an iPhone 15 Home Screen app at `mobile-low` When the checklist runs `downtown-rush` with the layers on, then off Then `perf:verify` passes, and `notes.json` records the delta — proof: manual: iPhone 15 (Home Screen app), Preview from `pnpm map:build -- --area synth && DV_WORLD=synth VITE_DV_QA=1 pnpm build && pnpm deploy:preview`, `pnpm perf:checklist -- tools/ci/checklists/M02h6-iphone15.json`, upload to `docs/device-runs/M02h6/iphone15/`, then `pnpm perf:verify -- docs/device-runs/M02h6/iphone15/perf.json --tier mobile-low --checklist tools/ci/checklists/M02h6-iphone15.json`

## Test plan
- **Unit:** placement, mesher records, signals, pools (chunk churn, caps), dressing, no-fetch.
- **E2E:** `@world-furniture` and `@furniture-ledger` (`chromium-webgl2` only) run in the `DV_WORLD=synth` half and do not match `GRAYBOX_GREP`; `@xr @world-furniture` runs on `xr-quest3`.
- **Perf** and **device:** AC-7 and AC-10.

## Demo script
How to see it:
1. `pnpm map:build -- --area synth && DV_WORLD=synth pnpm dev`, then open `/?debug=1&tier=desktop`.
2. Run `__dvBridge.world.shot('junction-noon')`. Masts, stop signs, hydrants and meters line the curbs, and parked cars fill the street beyond about 30 m.
3. Release the shot: the heads cycle in step with traffic.
4. Toggle layers `furniture` and `parked` in the debug panel; compare `__dvBridge.platform.perf.live().renderObjects`.
5. Open `/?debug=1&tier=mobile-low&gl=1`: only signals and posts appear.
6. Open `/?xr-emulate=quest3`: nothing is added.
7. On the operator's `sf` bake: `DV_WORLD=sf VITE_DV_QA=1 pnpm build`, teleport to Market & 4th.

## Effort
1 Builder session; ≈ 29 code files; risk medium-high (pool churn, the dressing fade, golden churn). Order: placement, mesher, pools, signals, dressing, ledger, goldens.

## Risks & fallbacks
- **`mobile-low` over budget:** drop `post` there, then `parked`, through `layers`. Never raise a budget.
- **Visible fade or sparse near street:** tune `ghostM`, `dressShare` (data); beyond that, report it (sim parking or colliders: Architect).
- **No `Transit` or `Plaza` node in `synth`:** assert shelters and benches on `civic-excerpt`.
- **No snapshot tick on the main thread:** clock seconds × 60 (BD row).
- **Flaky goldens:** M02e's nightly fallback.

## Notes for the Builder
- Read first: `02-world.md` §5.2–§5.4; `02-world-contracts.md` rules 10–12; `02-world-living.md` §1.4, §1.6, §2.6, §4, §7; `02-world-bake.md` §6 and spawn capacities; the M02g1, M02h2, M03b1, M10d1 files; the look study (render audit item 11: `mesher.ts:4`, `s13-pack.ts:194`; capture study "Props and street furniture") and the plan's Phase 1 row.
- Original sign faces only (no agency files or fonts); the target image is never committed; since DL-OWN-10 the owner's look references may be used as look inputs (a fal reference input, a side-by-side comparison, a palette), read from outside the repository; no fal call.
- Rebuild the pools in `onRendererReplaced`. `shot()` freezes the aspect clock.
- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` for AC-9 and AC-10 (SKIP locally). AC-10 needs Q-13's device, else "Blocked on: Q-13". Branch `m02h6-street-furniture-parking`.
